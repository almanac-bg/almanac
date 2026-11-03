import { fmt, useStore } from '@almanac/client';
import { avatarEmoji, levelProgress } from '@almanac/shared';
import { View } from 'react-native';
import { radius, useColors } from '@/theme';
import { T } from '@/ui';
import { Card } from './Card';

/** Who you are: your avatar and name, your level and how far into it. */
export function ProfileCard() {
  const colors = useColors();
  const me = useStore((s) => s.me)!;
  const progress = levelProgress(me.xp);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View
          style={{
            width: 56,
            height: 56,
            borderRadius: 28,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: colors.ink2,
            borderWidth: 1,
            borderColor: colors.line,
          }}
        >
          <T style={{ fontSize: 30, lineHeight: 36 }}>{avatarEmoji(me.avatar)}</T>
        </View>
        <View style={{ flex: 1 }}>
          <T variant="title" numberOfLines={1}>
            {me.username}
          </T>
          <T variant="small" tone="fg2">
            Ниво {progress.level}
            {me.isGuest ? ' · профил на гост' : ''}
          </T>
        </View>
      </View>
      <View
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`Ниво ${progress.level}: ${fmt(progress.into)} от ${fmt(progress.needed)} XP до следващото`}
        accessibilityValue={{ min: 0, max: progress.needed, now: progress.into }}
        style={{ height: 8, borderRadius: radius.sm, backgroundColor: colors.ink2, overflow: 'hidden' }}
      >
        <View style={{ width: `${Math.round(progress.pct * 100)}%`, height: '100%', backgroundColor: colors.violet }} />
      </View>
      <T variant="caption" tone="fg3">
        {fmt(progress.into)} / {fmt(progress.needed)} XP до ниво {progress.level + 1}
      </T>
    </Card>
  );
}
