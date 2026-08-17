import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cvhc.homecare',
  appName: 'CVHC HomeCare',
  webDir: 'dist',
  // @capacitor-community/background-geolocation is Capacitor-7-only (its
  // latest release pins cap 7) and has never shipped in a WORKING native
  // build: the local debug APKs accidentally excluded it (broken node_modules
  // install), and the first build that DID include it — the Play Store AAB —
  // froze clock-in on a native bridge call. Exclude it from BOTH platforms;
  // the web layer lazy-imports it with a null fallback and uses
  // watchPosition breadcrumbs instead, which is what production has always
  // actually run.
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
