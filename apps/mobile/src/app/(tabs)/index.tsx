import { useNow, useStore } from '@almanac/client';
import { EVENING, sofiaHour } from '@almanac/shared';
import { View } from 'react-native';
import { NotificationsBell } from '@/home/Bell';
import { ChallengeCard } from '@/home/ChallengeCard';
import { CommunityCard } from '@/home/CommunityCard';
import { DailyCard } from '@/home/DailyCard';
import { DuelTurn } from '@/home/DuelTurn';
import { EveningCard } from '@/home/EveningCard';
import { Modes } from '@/home/Modes';
import { EmailNudge, ReviewTurn } from '@/home/Nudges';
import { ProfileCard } from '@/home/ProfileCard';
import { QuestsCard } from '@/home/QuestsCard';
import { RoomBanner, RoomsCard } from '@/home/RoomsCard';
import { Screen, T } from '@/ui';

/**
 * Играй, top to bottom as the web's home on a phone: what's waiting for you (your room, a friend's duel, „Поправителен“,
 * an address to add, the evening Роял when it's near), who you are, what to play, the day's questions and quests, a
 * challenge link, friends and rooms — and the evening Роял in a line the rest of the day. The day's ten come first for
 * someone who has played before and not yet today.
 */
export default function Play() {
  const dailyFirst = useStore((s) => !!s.me && !s.me.daily.played && s.me.stats.games > 0);
  // From an hour before until that evening's matches are over: on top. The rest of the day, a line at the bottom.
  const now = useNow(60_000);
  const eveningNear = sofiaHour(now) >= EVENING.hour - 1 && sofiaHour(now) <= EVENING.hour;
  return (
    <Screen>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <T variant="h1" role="heading" accessibilityLabel="Играй">
          Играй
        </T>
        <NotificationsBell />
      </View>
      <RoomBanner />
      <DuelTurn />
      <ReviewTurn />
      <EmailNudge />
      {eveningNear && <EveningCard />}
      {dailyFirst && <DailyCard />}
      <ProfileCard />
      <Modes />
      {!dailyFirst && <DailyCard />}
      <QuestsCard />
      <ChallengeCard />
      <RoomsCard />
      <CommunityCard />
      {!eveningNear && <EveningCard compact />}
    </Screen>
  );
}
