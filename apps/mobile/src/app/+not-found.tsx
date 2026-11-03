import { router, usePathname } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import { API_URL } from '@/lib/client';
import { Button, Card, Screen, T } from '@/ui';

/**
 * An address the app has no screen for (a link to a page that lives on the site, or one that's wrong): said so, with the
 * site's page a tap away and the way back to Играй — not a blank screen.
 */
export default function NotFound() {
  const path = usePathname();
  return (
    <Screen centered>
      <Card style={{ alignItems: 'center', gap: 12 }}>
        <T style={{ fontSize: 40, lineHeight: 48 }}>🧭</T>
        <T variant="h2" role="heading" align="center">
          Това е на сайта
        </T>
        <T tone="fg2" align="center">
          Тази страница още я няма в приложението. Отвори я на сайта — или се върни към играта.
        </T>
        <Button
          title="Отвори на сайта"
          onPress={() => void WebBrowser.openBrowserAsync(`${API_URL}${path}`)}
          style={{ alignSelf: 'stretch' }}
        />
        <Button
          title="Към Играй"
          variant="secondary"
          onPress={() => router.replace('/')}
          style={{ alignSelf: 'stretch' }}
        />
      </Card>
    </Screen>
  );
}
