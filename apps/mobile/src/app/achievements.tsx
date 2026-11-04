import {
  achievementHint,
  achievementRewards,
  api,
  availableAchievements,
  fmt,
  longDate,
  useOpenQueues,
} from '@almanac/client';
import { type AchievementProgress, RARITIES, sentences } from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { fonts, radius, useColors } from '@/theme';
import { Card, LoadError, Progress, Screen, T } from '@/ui';
import { Choices } from '@/ui/controls';

type Filter = 'all' | 'unlocked' | 'locked';

/**
 * Постижения (the web's AchievementsPage): every one there is to earn today, the unlocked first — each with its rarity,
 * what it gives, and when it came or how far along it is.
 */
export default function Achievements() {
  const { data, error, loading, reload } = useLoad(() => api.achievements());
  const [filter, setFilter] = useState<Filter>('all');
  const items = data?.achievements ?? null;
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      {!items && error ? (
        <LoadError title="Постиженията не се заредиха" error={error} onRetry={reload} />
      ) : !items ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <List items={items} filter={filter} setFilter={setFilter} />
      )}
    </Screen>
  );
}

function List({
  items,
  filter,
  setFilter,
}: {
  items: AchievementProgress[];
  filter: Filter;
  setFilter: (f: Filter) => void;
}) {
  const colors = useColors();
  const open = useOpenQueues();
  const byId = new Map(items.map((i) => [i.id, i]));
  const available = availableAchievements(open, (id) => !!byId.get(id)?.unlockedAt);
  const unlocked = available.filter((a) => byId.get(a.id)?.unlockedAt).length;
  const list = available
    .filter((a) => {
      const done = !!byId.get(a.id)?.unlockedAt;
      return filter === 'all' || (filter === 'unlocked' ? done : !done);
    })
    .sort((a, b) => Number(!!byId.get(b.id)?.unlockedAt) - Number(!!byId.get(a.id)?.unlockedAt));
  const told = `${unlocked} от ${available.length}`;
  return (
    <>
      <View style={{ gap: 8 }}>
        <T tone="fg2">
          Отключени <T style={{ fontFamily: fonts.bold }}>{unlocked}</T> от {available.length}
        </T>
        <Progress
          value={available.length ? unlocked / available.length : 0}
          color="#f472b6"
          label="Постижения"
          valueText={told}
        />
      </View>
      <Choices<Filter>
        label="Покажи"
        options={[
          { id: 'all', label: 'Всички' },
          { id: 'unlocked', label: 'Отключени' },
          { id: 'locked', label: 'Заключени' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {list.map((a) => {
        const p = byId.get(a.id);
        const done = !!p?.unlockedAt;
        const rarity = RARITIES[a.rarity];
        const extras = achievementRewards(a.id);
        const status = done
          ? `✓ Отключено на ${longDate(p!.unlockedAt!)}`
          : a.goal !== undefined && p?.progress != null
            ? `${fmt(p.progress)} от ${fmt(a.goal)}`
            : achievementHint(a.id);
        return (
          <Card key={a.id} accent={done ? rarity.color : undefined} style={{ gap: 8 }}>
            <View
              accessible
              accessibilityLabel={`${a.name}${done ? '' : ' (заключено)'}, ${rarity.name}: ${sentences(a.description, `+${a.xp} XP${extras.length ? `, ${extras.join(', ')}` : ''}`, status)}`}
              style={{ flexDirection: 'row', gap: 12 }}
            >
              <View
                style={{
                  width: 52,
                  height: 52,
                  borderRadius: radius.lg,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: done ? `${rarity.color}22` : colors.glass,
                }}
              >
                <T style={{ fontSize: 26, lineHeight: 32 }}>{done ? a.icon : '🔒'}</T>
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 8 }}>
                  <T variant="bodyStrong">{a.name}</T>
                  <T variant="caption" style={{ fontFamily: fonts.bold }}>
                    {rarity.name}
                  </T>
                </View>
                <T variant="small" tone="fg2">
                  {a.description}
                </T>
                <T variant="caption" tone="fg3">
                  +{a.xp} XP{extras.length > 0 ? ` · ${extras.join(', ')}` : ''}
                </T>
              </View>
            </View>
            {done ? (
              <T variant="caption" tone="good" style={{ fontFamily: fonts.semibold }}>
                {status}
              </T>
            ) : a.goal !== undefined && p?.progress != null ? (
              <View style={{ gap: 4 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <T variant="caption" tone="fg3">
                    Прогрес
                  </T>
                  <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
                    {fmt(p.progress)} / {fmt(a.goal)}
                  </T>
                </View>
                <Progress value={p.progress / a.goal} color={rarity.color} height={6} />
              </View>
            ) : (
              <T variant="caption" tone="fg3">
                {status}
              </T>
            )}
          </Card>
        );
      })}
      <Pressable accessibilityRole="link" onPress={() => router.push('/locker')} style={{ alignSelf: 'center' }}>
        <T variant="small" tone="fg3" align="center">
          Някои постижения отключват специални аватари, рамки и титли —{' '}
          <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
            виж „Колекция“
          </T>
          .
        </T>
      </Pressable>
    </>
  );
}
