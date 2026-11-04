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
    // Apple's required-reason APIs, said in the app's own privacy manifest (React Native and Expo use them): the
    // preferences the app keeps (CA92.1), files' dates for its own files (C617.1), the time since the phone started
    // for its clocks (35F9.1). No tracking, of any kind.
    privacyManifests: {
      NSPrivacyTracking: false,
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategorySystemBootTime',
          NSPrivacyAccessedAPITypeReasons: ['35F9.1'],
        },
      ],
    },
  },
  android: {
    package: 'bg.almanac.app',
    // Firebase's file, without which Android gives the app no token for pushes (FCM): its path in GOOGLE_SERVICES_JSON
    // — on Expo's build service a file variable, for a build here the downloaded file's. Never in the repository
    // (.gitignore): it names the Firebase project and its key, and a fork has a project of its own. Without it the app
    // builds and runs, with no pushes on Android (docs/app-stores.md → Известията).
    googleServicesFile: process.env.GOOGLE_SERVICES_JSON || undefined,
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
    // Pushes from Apple's and Google's services (the server sends them; nativePush.ts): the mark in white on Android.
    ['expo-notifications', { icon: './assets/notification-icon.png', color: '#8b5cf6' }],
    // A picture for a question of your own („Моите въпроси“): from the library only, never the camera or the mic.
    [
      'expo-image-picker',
      {
        photosPermission: 'За снимка към твой въпрос в „Моите въпроси“.',
        cameraPermission: false,
        microphonePermission: false,
      },
    ],
  ],
  // tsconfig's paths are the type checker's; Metro resolves on its own (metro.config.js).
  experiments: { typedRoutes: true, reactCompiler: true, tsconfigPaths: false },
});
