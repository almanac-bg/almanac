import { fmt, useStore } from '@almanac/client';
import { levelProgress, TITLES } from '@almanac/shared';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, Card, Progress, T } from '@/ui';

/**
 * Who you are: your avatar, name and title, your level and how far into it — and, under it, what's waiting: the day's
 * first-match bonus, a level's reward to pick, a guest's progress to save (the web's ProfileCard on a phone).
 */
export function ProfileCard() {
  const colors = useColors();
  const me = useStore((s) => s.me);
  if (!me) return null;
  const progress = levelProgress(me.xp);
  const title = TITLES.find((t) => t.id === me.title)?.name;
  const [choice] = me.choices;
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar avatar={me.avatar} frame={me.frame} size={56} />
        <View style={{ flex: 1 }}>
          <T variant="title" numberOfLines={1}>
            {me.username}
          </T>
          <T variant="small" tone="fg2" numberOfLines={1}>
            {[title, `Ниво ${progress.level}`, me.isGuest && 'профил на гост'].filter(Boolean).join(' · ')}
          </T>
        </View>
      </View>
      <Progress
        value={progress.pct}
        label={`Ниво ${progress.level}`}
        valueText={`${fmt(progress.into)} от ${fmt(progress.needed)} XP до следващото`}
      />
      <T variant="caption" tone="fg3">
        {fmt(progress.into)} / {fmt(progress.needed)} XP до ниво {progress.level + 1}
      </T>
      {(me.dailyBonusAvailable || choice) && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {me.dailyBonusAvailable && <Chip text="🎁 Първият мач за деня носи +100 XP" />}
          {/* A milestone's reward waiting to be picked: the collection has it. */}
          {choice && <Chip text={`🎁 Избери награда за ниво ${choice.level}`} onPress={() => router.push('/locker')} />}
        </View>
      )}
      {/* A guest's progress lives on this device until it's saved: said once there's some worth keeping (level 2: a
          match or two in), not before the first question. A room's guest is told what happens to theirs. */}
      {me.isGuest && progress.level >= 2 && (
        <View
          style={{
            gap: 10,
            padding: 14,
            borderRadius: radius.md,
            borderCurve: 'continuous',
            borderWidth: 1,
            borderColor: `${colors.gold}40`,
            backgroundColor: `${colors.gold}14`,
          }}
        >
          <T variant="small">
            {me.roomGuest
              ? 'Влезе като гост за стая: до час, след като излезеш, профилът и играта ти се изтриват. Запази ги с име и парола, ако искаш да останат.'
              : 'Играеш като гост: прогресът е само на този телефон. Запази го с име и парола.'}
          </T>
          <Button title="Запази прогреса" variant="secondary" onPress={() => router.push('/settings')} />
        </View>
      )}
    </Card>
  );
}

/** A gold pill under the level: a note, or (with `onPress`) a way to what it's about. */
function Chip({ text, onPress }: { text: string; onPress?: () => void }) {
  const colors = useColors();
  const look = {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
    minHeight: 32,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: `${colors.gold}26`,
  };
  const label = (
    <T variant="caption" tone="gold" style={{ fontFamily: fonts.bold }}>
      {text}
    </T>
  );
  if (!onPress) return <View style={look}>{label}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={text.replace(/^🎁\s*/, '')}
      hitSlop={{ top: 8, bottom: 8 }}
      style={({ pressed }) => [look, pressed && { opacity: 0.7 }]}
    >
      {label}
    </Pressable>
  );
}
