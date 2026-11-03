import { api, errorMessage, useStore } from '@almanac/client';
import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { Consent } from '@/components/Consent';
import { signedIn } from '@/lib/client';
import { Button, Screen, T } from '@/ui';

/** The way in, or — signed in — the home screen. */
export default function Index() {
  const me = useStore((s) => s.me);
  return me ? <Home name={me.username} guest={me.isGuest} /> : <Welcome />;
}

function Welcome() {
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

function Home({ name, guest }: { name: string; guest: boolean }) {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      /* signed out on the phone either way */
    }
    useStore.setState({ me: null });
    setBusy(false);
  }
  return (
    <Screen centered>
      <T variant="label" tone="fg3" align="center">
        {guest ? 'Профил на гост' : 'Профил'}
      </T>
      <T variant="h1" align="center" role="heading">
        {name}
      </T>
      <T tone="fg2" align="center">
        Играта идва в приложението екран по екран: дотогава тя е на almanac.bg, със същия профил.
      </T>
      {/* A guest has no name or password to come back with: leaving would lose the account (the web warns first). */}
      {!guest && <Button title="Изход" variant="secondary" loading={busy} onPress={() => void signOut()} />}
    </Screen>
  );
}
