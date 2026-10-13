import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.baurp.trivochat",
  appName: "Trivo Chat Elite",
  // scripts/stage-web.mjs copies the real build (dist/client or .output/public) here.
  webDir: "www",
  server: {
    androidScheme: "https",
    cleartext: true,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    minWebViewVersion: 87,
    buildOptions: {
      releaseType: "APK",
    },
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 1500,
      backgroundColor: "#0F172A",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_CROP",
      showSpinner: false,
    },
  },
};

export default config;
