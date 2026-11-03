import { api, fmt, useStore } from '@almanac/client';
import { useState } from 'react';
import { Alert, View } from 'react-native';
import { ProfileCard } from '@/home/ProfileCard';
import { Button, Screen, T } from '@/ui';

/** Профил, for now: who you are and your numbers, and signing out (the profile's own page grows here). */
export default function Profile() {
  const me = useStore((s) => s.me)!;
  const [busy, setBusy] = useState(false);
  const signOut = async () => {
    setBusy(true);
    try {
      await api.logout();
    } catch {
      /* signed out on the phone either way */
    }
    useStore.setState({ me: null });
  };
  // A guest has no name or password to come back with: leaving loses the account, so it says so first (as the web).
  const ask = () =>
    me.isGuest
      ? Alert.alert(
          'Изход от профила на гост',
          'Играеш като гост, без име и парола — след изход няма как да влезеш отново. Нивото, серията и всичко изиграно се губят завинаги.',
          [
            { text: 'Остани', style: 'cancel' },
            { text: 'Излез', style: 'destructive', onPress: () => void signOut() },
          ],
        )
      : void signOut();
  return (
    <Screen>
      <T variant="h1" role="heading">
        Профил
      </T>
      <ProfileCard />
      <View style={{ gap: 4 }}>
        <T tone="fg2">Изиграни мачове: {fmt(me.stats.games)}</T>
        <T tone="fg2">Победи: {fmt(me.stats.wins)}</T>
        <T tone="fg2">
          Верни отговори: {fmt(me.stats.correct)} от {fmt(me.stats.answered)}
        </T>
      </View>
      <Button title="Изход" variant="secondary" loading={busy} onPress={ask} />
    </Screen>
  );
}
