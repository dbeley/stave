{
  description = "TUI-inspired Subsonic/Navidrome music client — PWA + Android app (Svelte 5, Capacitor, NixOS-first)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    let
      pkgVersion = (builtins.fromJSON (builtins.readFile ./package.json)).version;

      # NixOS modules are exposed as curried module functions so they can carry
      # the flake's own package as a default without needing `self` in scope.
      appModule =
        { pkgs, ... }:
        import ./nix/module.nix {
          defaultPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
      navidromeModule =
        { pkgs, ... }:
        import ./nix/navidrome.nix {
          appPackage = self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
    in
    (flake-utils.lib.eachSystem
      [
        "x86_64-linux"
        "aarch64-linux"
      ]
      (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          inherit (nixpkgs) lib;

          srcFilter =
            path: type:
            let
              base = baseNameOf path;
            in
            !(builtins.elem base [
              ".git"
              "node_modules"
              "dist"
              "coverage"
              "testdata"
              "devdata"
              "android-sdk"
              ".envrc"
            ])
            && !(lib.hasPrefix "result" base)
            && !(lib.hasSuffix ".apk" base)
            && !(lib.hasSuffix ".aab" base);

          src = lib.cleanSourceWith {
            src = ./.;
            filter = srcFilter;
          };

          # The pnpm dependency tree, pinned by hash. `just deps-update` bumps
          # the deps and rewrites this in place; `just nix-hash` does just the hash.
          pnpmDeps = pkgs.fetchPnpmDeps {
            inherit src;
            pname = "stave";
            version = pkgVersion;
            hash = "sha256-WATAFPeM9w9bKyO73B3j6WXHD92BVqLq8AzzrJ5KIhE=";
            fetcherVersion = 4;
          };

          buildSpa =
            {
              baseUrl ? "./",
            }:
            pkgs.stdenv.mkDerivation {
              pname = "stave";
              version = pkgVersion;

              inherit src pnpmDeps;

              nativeBuildInputs = [
                pkgs.nodejs_22
                pkgs.pnpm
                pkgs.pnpmConfigHook
              ];

              env.BASE_URL = baseUrl;

              buildPhase = ''
                runHook preBuild
                pnpm build
                runHook postBuild
              '';

              installPhase = ''
                runHook preInstall
                mkdir -p $out
                cp -r dist/. $out/
                # Runtime configuration lives outside the hashed bundles.
                echo 'window.__STAVE_CONFIG__ = window.__STAVE_CONFIG__ || {};' > $out/config.js
                runHook postInstall
              '';

              meta = {
                description = "TUI-inspired Subsonic/Navidrome music client (web PWA)";
                homepage = "https://github.com/dbeley/stave";
                license = lib.licenses.gpl3Plus;
                platforms = lib.platforms.unix;
              };
            };

          seedLibrary = pkgs.writeShellApplication {
            name = "stave-seed-library";
            runtimeInputs = with pkgs; [
              ffmpeg
              coreutils
              findutils
              gnused
              gnugrep
            ];
            text = builtins.readFile ./scripts/seed-library.sh;
            meta.description = "Generate a royalty-free demo music library (synthesised, tagged, with cover art)";
          };

          devNavidrome = pkgs.writeShellApplication {
            name = "stave-dev-navidrome";
            runtimeInputs = with pkgs; [
              navidrome
              curl
              jq
              coreutils
              findutils
              gnugrep
              # `user create` needs a pty (script) and the user check parses CSV (awk).
              util-linux
              gawk
            ];
            text = builtins.readFile ./scripts/dev-navidrome.sh;
            meta.description = "Run a throwaway Navidrome on a demo library for local development";
          };

          mockSubsonic = pkgs.writeShellApplication {
            name = "stave-mock-server";
            runtimeInputs = [ pkgs.nodejs_22 ];
            text = ''
              exec node ${./tools/mock-subsonic/server.mjs} "$@"
            '';
            meta.description = "Mock Subsonic server (fixtures + generated audio) for tests and e2e";
          };

          devEnv = {
            JAVA_HOME = "${pkgs.jdk21.home}";
            PLAYWRIGHT_BROWSERS_PATH = "${pkgs.playwright-driver.browsers}";
            PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
            PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS = "1";
          };
        in
        {
          packages = {
            default = buildSpa { };
            spa = buildSpa { };
            # Same SPA, built for hosting under a sub-path (e.g. GitHub Pages).
            spa-subpath = buildSpa { baseUrl = "/stave/"; };
            # kebab-case names so `nix run .#dev-navidrome` works from the CLI.
            seed-library = seedLibrary;
            dev-navidrome = devNavidrome;
            mock-server = mockSubsonic;
          };

          devShells.default = pkgs.mkShell {
            buildInputs = with pkgs; [
              # web
              nodejs_22
              pnpm
              just
              # android
              jdk21
              android-tools
              patchelf
              # local backend / fixtures
              ffmpeg
              navidrome
              # tooling
              git
              gh
              curl
              jq
              python3
              typescript-language-server
              svelte-language-server
              # e2e (browsers come from the nix store, not a download)
              playwright-driver
              # nix hygiene
              nixfmt-rfc-style
              statix
              deadnix
            ];

            inherit (devEnv)
              JAVA_HOME
              PLAYWRIGHT_BROWSERS_PATH
              PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD
              PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS
              ;

            shellHook = ''
              export PATH="$PWD/node_modules/.bin:$PATH"

              # Project-local Android SDK (populated by gradle on first build).
              if [ -z "''${ANDROID_HOME:-}" ]; then
                export ANDROID_HOME="$PWD/android-sdk"
              fi
              export ANDROID_SDK_ROOT="$ANDROID_HOME"

              if [ -d android ]; then
                printf 'sdk.dir=%s\n' "$ANDROID_HOME" > android/local.properties
              fi

              mkdir -p "$ANDROID_HOME/licenses"
              printf '\n24333f8a63b6825ea9c5514f83c2829b004d1fee\n' \
                > "$ANDROID_HOME/licenses/android-sdk-license"

              cat <<'EOF'

              stave dev shell   (just --list for all recipes)

                just dev              vite dev server on :5173
                just test             unit + component tests (vitest)
                just verify           lint + test + build
                just seed-library     generate the demo music library
                just navidrome        run a throwaway Navidrome on it
                just mock             mock Subsonic server for tests/e2e
                just android-build    debug APK (needs the Android SDK)

              EOF
              echo "  ANDROID_HOME = $ANDROID_HOME"
            '';
          };

          checks =
            let
              tests = pkgs.stdenv.mkDerivation {
                pname = "stave-tests";
                version = pkgVersion;
                inherit src pnpmDeps;
                nativeBuildInputs = [
                  pkgs.nodejs_22
                  pkgs.pnpm
                  pkgs.pnpmConfigHook
                ];
                buildPhase = ''
                  runHook preBuild
                  pnpm vitest run
                  runHook postBuild
                '';
                installPhase = "touch $out";
              };

              # Validate that both NixOS modules evaluate *and wire together*
              # correctly. Evaluating `system.build.toplevel` would demand a
              # bootable system (`fileSystems`, `boot.loader`), which is
              # irrelevant here — so this asserts the values the modules are
              # supposed to produce instead.
              nixosModulesEval =
                let
                  system = pkgs.nixos [
                    (import ./nix/module.nix { defaultPackage = pkgs.hello; })
                    (import ./nix/navidrome.nix { appPackage = pkgs.hello; })
                    {
                      services.stave = {
                        enable = true;
                        hostName = "music.example.org";
                        # Exercises the palette path. Stylix is not imported in
                        # this eval, so the explicit option is the only source —
                        # which is also the branch a non-stylix host uses.
                        palette = {
                          accent = "#123456";
                          bg = "#0a0b0c";
                        };
                      };
                      services.stave.navidrome = {
                        enable = true;
                        musicFolder = "/var/lib/music";
                      };
                      system.stateVersion = "26.11";
                    }
                  ];
                  cfg = system.config;
                  vhost = cfg.services.nginx.virtualHosts."music.example.org";
                  prefill = cfg.services.stave.server;
                  musicFolder = cfg.services.navidrome.settings.MusicFolder;

                  # The same module without any palette, to prove that "no
                  # palette" emits no key at all rather than an empty object the
                  # app would then offer as a broken theme.
                  plain = pkgs.nixos [
                    (import ./nix/module.nix { defaultPackage = pkgs.hello; })
                    {
                      services.stave.enable = true;
                      system.stateVersion = "26.11";
                    }
                  ];
                  paletteConfig = "${vhost.root}/config.js";
                  plainConfig = "${plain.config.services.nginx.virtualHosts."localhost".root}/config.js";
                in
                pkgs.runCommand "stave-nixos-modules-check" { } ''
                  set -eu
                  fail() { echo ":: $1" >&2; exit 1; }

                  # The app module serves the SPA through nginx on the host name.
                  [ -n "${vhost.root}" ] || fail "no nginx virtual host for music.example.org"

                  # Enabling the backend module starts Navidrome on the folder…
                  [ "${lib.boolToString cfg.services.navidrome.enable}" = "true" ] \
                    || fail "navidrome module did not enable the service"
                  [ "${musicFolder}" = "/var/lib/music" ] \
                    || fail "music folder not passed through (got ${musicFolder})"

                  # …and points the web app at it, so one import is a working stack.
                  [ "${prefill}" = "http://127.0.0.1:4533" ] \
                    || fail "app not pre-filled with the navidrome url (got ${prefill})"

                  # The palette reaches the browser as plain colours…
                  grep -q '"accent":"#123456"' ${paletteConfig} \
                    || fail "palette colours missing from the generated config.js"
                  grep -q '"bg":"#0a0b0c"' ${paletteConfig} \
                    || fail "palette background missing from the generated config.js"

                  # …while no palette configured means no key at all.
                  if grep -q '"palette"' ${plainConfig}; then
                    fail "config.js carries a palette key although none was configured"
                  fi

                  echo "nixos modules evaluate and wire up correctly" > $out
                '';
            in
            {
              inherit tests;
              package = buildSpa { };
              nixos-modules = nixosModulesEval;
              # Build the helper scripts too. `writeShellApplication` runs
              # shellcheck, so this is what turns a lint slip in `scripts/*.sh`
              # into a failing `nix flake check` instead of a broken
              # `nix run .#seed-library` that nobody notices for hours — which is
              # exactly how the SC2006 and SC2034 failures above slipped through.
              helpers = pkgs.linkFarm "stave-helper-scripts" [
                {
                  name = "seed-library";
                  path = seedLibrary;
                }
                {
                  name = "dev-navidrome";
                  path = devNavidrome;
                }
                {
                  name = "mock-server";
                  path = mockSubsonic;
                }
              ];
              # Shellcheck the developer gate script as well. It is deliberately
              # not a `nix run` helper — it drives the dev shell's toolchain and
              # never commits or pushes — but a lint slip in it would be exactly
              # as silent as in the scripts above.
              gate-script =
                pkgs.runCommand "stave-gate-script-check"
                  {
                    nativeBuildInputs = [ pkgs.shellcheck ];
                  }
                  ''
                    shellcheck ${./scripts/gate.sh}
                    shellcheck ${./scripts/android-keystore.sh}
                    shellcheck ${./scripts/android-sign-setup.sh}
                    shellcheck ${./scripts/android-media-session.sh}
                    touch $out
                  '';
            };

          formatter = pkgs.nixfmt-rfc-style;
        }
      )
    )
    // {
      nixosModules = {
        default = appModule;
        stave = appModule;
        navidrome = navidromeModule;
      };

      overlays.default = final: _prev: {
        stave = self.packages.${final.stdenv.hostPlatform.system}.default;
      };
    };
}
