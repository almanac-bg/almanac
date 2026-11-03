// What the stores and the phone read from the app (app.config.ts): links for its screens, iPad, the system's back with
// its preview, and the privacy manifest Apple asks for — the required-reason APIs with their reasons, no tracking.
import appConfig from '../app.config';

const config = appConfig({ config: {} } as never);

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

test('the photo library only, never the camera or the microphone', () => {
  const picker = config.plugins?.find((p) => Array.isArray(p) && p[0] === 'expo-image-picker') as [string, object];
  expect(picker[1]).toMatchObject({ cameraPermission: false, microphonePermission: false });
});
