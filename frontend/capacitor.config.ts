import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cvhc.homecare',
  appName: 'CVHC HomeCare',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    iosScheme: 'https',
    // In development, point to your local server:
    // url: 'http://192.168.1.x:5173',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
  },
  ios: {
    contentInset: 'always',
    scrollEnabled: true,
    // Allow the in-app webview to load https://api.chippewavalleyhomecare.com etc.
    // (background fetch requires capabilities set in Xcode separately.)
    limitsNavigationsToAppBoundDomains: false,
    // @capacitor-community/background-geolocation has no Capacitor 8 release —
    // its SPM manifest pins capacitor-swift-pm 7.x, which conflicts with every
    // other plugin and breaks iOS package resolution. The web layer lazy-loads
    // it with a catch(() => null) fallback, so iOS simply runs without it —
    // consistent with the store declaration of no background tracking.
    // Android is untouched (no includePlugins override there).
    includePlugins: [
      '@capacitor/geolocation',
      '@capacitor/haptics',
      '@capacitor/keyboard',
      '@capacitor/local-notifications',
      '@capacitor/network',
      '@capacitor/push-notifications',
      '@capacitor/splash-screen',
      '@capacitor/status-bar',
    ],
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      backgroundColor: '#1D4ED8',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
    StatusBar: {
      style: 'Dark',
      backgroundColor: '#ffffff',
      overlaysWebView: false,
    },
    Keyboard: {
      resize: 'body',
      style: 'dark',
      resizeOnFullScreen: true,
    },
    Geolocation: {
      // Android requires these in AndroidManifest.xml too
    },
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#1D4ED8',
      sound: 'default',
    },
  },
};

export default config;
