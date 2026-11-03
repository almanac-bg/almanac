import { MINORS_NOTICE } from '@almanac/shared';
import * as WebBrowser from 'expo-web-browser';
import { View } from 'react-native';
import { API_URL } from '@/lib/client';
import { T } from '@/ui';

const open = (path: string) => void WebBrowser.openBrowserAsync(`${API_URL}${path}`);

/** Playing as a guest accepts the terms too, so this sits under every way in (as on the web: landing/Entry.tsx). */
export function Consent() {
  return (
    <View style={{ gap: 6 }}>
      <T variant="caption" tone="fg3" align="center">
        Като играеш, приемаш{' '}
        <T variant="caption" tone="link" onPress={() => open('/terms')} accessibilityRole="link">
          Условията за ползване
        </T>
        . Как пазим данните ти — в{' '}
        <T variant="caption" tone="link" onPress={() => open('/privacy')} accessibilityRole="link">
          Политиката за поверителност
        </T>
        .
      </T>
      <T variant="caption" tone="fg3" align="center">
        {MINORS_NOTICE}
      </T>
    </View>
  );
}
