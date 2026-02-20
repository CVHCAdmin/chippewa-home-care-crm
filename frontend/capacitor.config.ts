import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.cvhc.homecare',
  appName: 'CVHC HomeCare',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    // In development, point to your local server:
    // url: 'http://192.168.1.x:5173',
    // cleartext: true,
  },
  android: {
    buildOptions: {
      releaseType: 'APK',
    },
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
      backgroundColor: '#1D4ED8',
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
