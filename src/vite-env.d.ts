/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly BASE_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Optional runtime configuration injected by the host (public/ or nginx). */
interface Window {
  __STAVE_CONFIG__?: {
    server?: string;
    username?: string;
    instanceName?: string;
  };
}
