// What the stores and the phone read from the app (app.config.ts): links for its screens, iPad, the system's back with
// its preview, and the privacy manifest Apple asks for — the required-reason APIs with their reasons, no tracking.
import appConfig from '../app.config';

const config = appConfig({ config: {} } as never);

test('the project on Expo’s build service: @hpivanov/almanac', () => {
  expect(config.owner).toBe('hpivanov');
  expect(config.slug).toBe('almanac');
  expect(config.extra?.eas?.projectId).toBe('e497207e-ea34-4199-8608-fc8835104dc3');
});

test('iPad and the predictive back gesture are on; links for the site open the app', () => {
  expect(config.ios?.supportsTablet).toBe(true);
  expect(config.android?.predictiveBackGestureEnabled).toBe(true);
  expect(config.ios?.associatedDomains).toContain('applinks:almanac.bg');
});

test('the privacy manifest: each required-reason API with its reason, and no tracking', () => {
  const manifest = config.ios?.privacyManifests;
  expect(manifest?.NSPrivacyTracking).toBe(false);
  const reasons = Object.fromEntries(
    (manifest?.NSPrivacyAccessedAPITypes ?? []).map((t) => [
      t.NSPrivacyAccessedAPIType,
      t.NSPrivacyAccessedAPITypeReasons,
    ]),
  );
  expect(reasons).toEqual({
    NSPrivacyAccessedAPICategoryUserDefaults: ['CA92.1'],
    NSPrivacyAccessedAPICategoryFileTimestamp: ['C617.1'],
    NSPrivacyAccessedAPICategorySystemBootTime: ['35F9.1'],
  });
});

test('Firebase’s file for pushes on Android: the one GOOGLE_SERVICES_JSON names, none in the repository', () => {
  expect(config.android?.googleServicesFile).toBeUndefined();
  process.env.GOOGLE_SERVICES_JSON = '/home/expo/workingdir/google-services.json';
  try {
    expect(appConfig({ config: {} } as never).android?.googleServicesFile).toBe(
      '/home/expo/workingdir/google-services.json',
    );
  } finally {
    delete process.env.GOOGLE_SERVICES_JSON;
  }
});

test('the photo library only, never the camera or the microphone', () => {
  const picker = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, object];
  expect(picker[1]).toMatchObject({ cameraPermission: false, microphonePermission: false });
});

test('nothing asked that the app doesn’t use: no drawing over other apps, no storage, no Face ID', () => {
  expect(config.android?.blockedPermissions).toEqual(
    expect.arrayContaining([
      'android.permission.SYSTEM_ALERT_WINDOW',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ]),
  );
  const store = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-secure-store') as [string, object];
  expect(store[1]).toMatchObject({ faceIDPermission: false });
});
