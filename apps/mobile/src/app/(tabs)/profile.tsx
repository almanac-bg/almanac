import { fmt, useStore } from '@almanac/client';
import { router } from 'expo-router';
import { View } from 'react-native';
import { ProfileCard } from '@/home/ProfileCard';
import { Button, Screen, T } from '@/ui';

/** Профил, for now: who you are and your numbers, and the way to Settings (the profile's own page grows here). */
export default function Profile() {
  const me = useStore((s) => s.me);
  if (!me) return null;
  return (
    <Screen>
      <T variant="h1" role="heading">
        Профил
      </T>
      <ProfileCard />
      {me.isGuest && (
        <T variant="small" tone="fg2">
          Играеш като гост: запази профила в Настройки, за да не го загубиш.
        </T>
      )}
      <View style={{ gap: 4 }}>
        <T tone="fg2">Изиграни мачове: {fmt(me.stats.games)}</T>
        <T tone="fg2">Победи: {fmt(me.stats.wins)}</T>
        <T tone="fg2">
          Верни отговори: {fmt(me.stats.correct)} от {fmt(me.stats.answered)}
        </T>
      </View>
      <Button title="Настройки" variant="secondary" onPress={() => router.push('/settings')} />
    </Screen>
  );
}
