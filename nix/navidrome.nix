{ appPackage ? null }:
{
  config,
  lib,
  pkgs,
  ...
}:

let
  cfg = config.services.stave.navidrome;
in
{
  options.services.stave.navidrome = {
    enable = lib.mkEnableOption "an optional Navidrome backend for stave";

    musicFolder = lib.mkOption {
      type = lib.types.path;
      example = "/srv/music";
      description = "Folder containing the music library.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 4533;
      description = "Port Navidrome listens on (loopback by default).";
    };

    address = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Address to bind. Keep loopback unless you front it with TLS.";
    };

    openFirewall = lib.mkOption {
      type = lib.types.bool;
      default = false;
      description = "Open the Navidrome port in the firewall.";
    };

    environmentFile = lib.mkOption {
      type = lib.types.nullOr lib.types.path;
      default = null;
      example = "/run/secrets/navidrome-env";
      description = ''
        File with secret `ND_*` environment variables (Last.fm keys,
        transcoding settings). Never point this at a world-readable store path.
      '';
    };

    serveApp = lib.mkOption {
      type = lib.types.bool;
      default = true;
      description = ''
        Also enable services.stave (the web app) and pre-fill it with this
        Navidrome instance's URL, so one module gives a working stack.
      '';
    };
  };

  config = lib.mkIf cfg.enable {
    services.navidrome = {
      enable = true;
      inherit (cfg) openFirewall environmentFile;
      settings = {
        Address = cfg.address;
        Port = cfg.port;
        MusicFolder = cfg.musicFolder;
        # Nobody needs to phone home from a self-hosted music server.
        EnableInsightsCollector = false;
        # The scan interval is intentionally not set here: Navidrome 0.64
        # ignores every config-file spelling of it (ScanInterval, ScanSchedule,
        # Scanner.Interval), logs a warning, and uses its own default. Add it to
        # settings yourself if a future version starts honouring a spelling.
      };
    };

    services.stave = lib.mkIf cfg.serveApp {
      enable = true;
      package = appPackage;
      server = "http://${cfg.address}:${toString cfg.port}";
    };

    systemd.services.navidrome.serviceConfig = {
      # Music libraries are usually owned by a human, so be forgiving.
      SupplementaryGroups = [ "audio" ];
      ReadWritePaths = [ cfg.musicFolder ];
    };

    # Navidrome should start after the library exists / is mounted.
    systemd.services.navidrome.unitConfig.RequiresMountsFor = [ cfg.musicFolder ];
  };
}
