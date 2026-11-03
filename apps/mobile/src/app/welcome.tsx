import { api, errorMessage } from '@almanac/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Consent } from '@/components/Consent';
import { signedIn } from '@/lib/client';
import { Button, Screen, T } from '@/ui';

/** The way in: as a guest, or with an account (the router sends a signed-in player to the tabs: _layout.tsx). */
export default function Welcome() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function playAsGuest() {
    setBusy(true);
    setError(null);
    try {
      await signedIn(await api.guest());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen centered>
      <T variant="hero" align="center" role="heading">
        АЛМАНАХ
      </T>
      <T tone="fg2" align="center">
        10 въпроса на деня — едни и същи за цяла България. Три минути, една класация. Кой знае най-много?
      </T>
      <View style={{ gap: 12, marginTop: 8 }}>
        <Button title="Играй като гост" size="lg" loading={busy} onPress={() => void playAsGuest()} />
        <T variant="small" tone="fg3" align="center">
          Без регистрация. Нивото и серията се пазят — запазваш профила с име и парола, когато решиш.
        </T>
        {error ? (
          <T variant="small" tone="bad" align="center" role="alert">
            {error}
          </T>
        ) : null}
        <Button title="Имам профил — вход" variant="secondary" onPress={() => router.push('/sign-in')} />
        <Button title="Създай профил" variant="ghost" onPress={() => router.push('/sign-up')} />
      </View>
      <Consent />
    </Screen>
  );
}
