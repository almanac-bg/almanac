import { Linking, Platform } from 'react-native';
import { Button, Screen, T } from '@/ui';

const STORE = Platform.select({
  ios: 'itms-apps://apps.apple.com/app/id0', // the App Store id, once the app has one (8o: App Store Connect)
  default: 'market://details?id=bg.almanac.app',
});

/**
 * The server no longer takes this version (packages/shared → client.ts, MIN_PROTOCOL): nothing else would work, so this
 * is all the app shows until it's updated.
 */
export function UpdateScreen() {
  return (
    <Screen centered>
      <T variant="h1" align="center" role="heading">
        Има нова версия
      </T>
      <T tone="fg2" align="center">
        Тази версия на АЛМАНАХ вече не може да играе с останалите. Обнови приложението — отнема минута, а прогресът ти
        остава.
      </T>
      <Button title="Обнови" size="lg" onPress={() => void Linking.openURL(STORE)} />
    </Screen>
  );
}
