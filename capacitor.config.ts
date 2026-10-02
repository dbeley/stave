import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'dev.dbeley.stave',
  appName: 'stave',
  webDir: 'dist',
  android: {
    // Plain http scheme so the WebView can talk to a LAN Subsonic server
    // without mixed-content blocking.
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'http',
  },
  plugins: {
    CapacitorHttp: {
      // Off by default: a music player streams via <audio>, which needs the
      // browser fetch path for range requests. See docs/ANDROID.md.
      enabled: false,
    },
    // Core SystemBars plugin (Capacitor 8). Android 15+ forces edge-to-edge, so
    // the WebView is drawn under the system bars; `insetsHandling: 'css'` feeds
    // the safe-area insets and `initialViewportFitValueHint: 'cover'` avoids a
    // layout jump on first paint. The bars consume the insets in
    // StatusBar.svelte / HintBar.svelte.
    SystemBars: {
      style: 'DARK',
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
    // Kept for Android <= 14, where this plugin can still set the status bar
    // background; on 15+ the color is ignored by the OS.
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0e1417',
    },
  },
};

export default config;
