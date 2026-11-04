import { fmt, useStore } from '@almanac/client';
import { levelProgress } from '@almanac/shared';
import { View } from 'react-native';
import { useColors } from '@/theme';
import { Avatar, Card, Progress, T } from '@/ui';

/** Who you are: your avatar and name, your level and how far into it. */
export function ProfileCard() {
  const _colors = useColors();
  const me = useStore((s) => s.me);
  if (!me) return null;
  const progress = levelProgress(me.xp);
  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <Avatar avatar={me.avatar} frame={me.frame} size={56} />
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
      <Progress
        value={progress.pct}
        label={`Ниво ${progress.level}`}
        valueText={`${fmt(progress.into)} от ${fmt(progress.needed)} XP до следващото`}
      />
      <T variant="caption" tone="fg3">
        {fmt(progress.into)} / {fmt(progress.needed)} XP до ниво {progress.level + 1}
      </T>
    </Card>
  );
}
