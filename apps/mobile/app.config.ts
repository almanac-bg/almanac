// The app's identity and what the stores and the phone read from it. The version is the repository's (release-please
// keeps package.json in step); the build number is the store's to count (Expo's remote versions).
import type { ConfigContext, ExpoConfig } from 'expo/config';
import links from './app-links.json';
import pkg from './package.json';

const DOMAIN = 'almanac.bg';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'АЛМАНАХ',
  slug: 'almanac',
  scheme: 'almanac',
  version: pkg.version,
  orientation: 'default',
  // Light and dark, as the phone is set (Settings can fix one, as on the web).
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  backgroundColor: '#07060d',
  ios: {
    bundleIdentifier: 'bg.almanac.app',
    supportsTablet: true,
    // Links to the game's screens open the app (the server's apple-app-site-association lists which), and passwords
    // saved for the site are offered in it.
    associatedDomains: [`applinks:${DOMAIN}`, `webcredentials:${DOMAIN}`],
    config: { usesNonExemptEncryption: false },
    infoPlist: { CFBundleDevelopmentRegion: 'bg', CFBundleLocalizations: ['bg'] },
  },
  android: {
    package: 'bg.almanac.app',
    adaptiveIcon: {
      backgroundColor: '#140f26',
      foregroundImage: './assets/android-icon-foreground.png',
      monochromeImage: './assets/android-icon-monochrome.png',
    },
    // The system's back gesture with its preview (Android 16 asks for it).
    predictiveBackGestureEnabled: true,
    softwareKeyboardLayoutMode: 'resize',
    intentFilters: [
      {
        action: 'VIEW',
        autoVerify: true,
        data: links.android,
        category: ['BROWSABLE', 'DEFAULT'],
      },
    ],
  },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-font',
    ['expo-splash-screen', { backgroundColor: '#07060d', image: './assets/splash-icon.png', imageWidth: 160 }],
  ],
  // tsconfig's paths are the type checker's; Metro resolves on its own (metro.config.js).
  experiments: { typedRoutes: true, reactCompiler: true, tsconfigPaths: false },
});
