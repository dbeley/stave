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
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0e1417',
    },
  },
};

export default config;
