import { useStore } from '@almanac/client';
import { DailyCard } from '@/home/DailyCard';
import { Modes } from '@/home/Modes';
import { ProfileCard } from '@/home/ProfileCard';
import { Screen, T } from '@/ui';

/**
 * Играй: who you are, the day's questions, what to play (the web's home on a phone, top to bottom). The day's ten come
 * first for someone who has played before and not yet today.
 */
export default function Play() {
  const dailyFirst = useStore((s) => !!s.me && !s.me.daily.played && s.me.stats.games > 0);
  return (
    <Screen>
      <T variant="h1" role="heading" accessibilityLabel="Играй">
        Играй
      </T>
      <ProfileCard />
      {dailyFirst && <DailyCard />}
      <Modes />
      {!dailyFirst && <DailyCard />}
    </Screen>
  );
}
