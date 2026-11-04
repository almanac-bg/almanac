import { fmt, longDate, ordinal, pct, plural, timeAgo } from '@almanac/client';
import {
  achievementById,
  CATEGORIES,
  isQueueMode,
  MASTERY_TIERS,
  MODES,
  type ModeId,
  type ProfileStats,
  type QueueModeId,
  RANK_TIERS,
  RARITIES,
  rankFor,
  seasonTitle,
} from '@almanac/shared';
import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Button, Card, IconText, Progress, T } from '@/ui';

const MODE_ORDER: ModeId[] = ['solo', 'daily', 'duel', 'teams', 'squad', 'royale', 'evening', 'custom'];

function Heading({ title }: { title: string }) {
  return (
    <T variant="h2" role="heading">
      {title}
    </T>
  );
}

/** A small rounded label tinted in its colour: a season's rank, an achievement. */
function Chip({ color, children, label }: { color: string; children: React.ReactNode; label?: string }) {
  return (
    <View
      accessible={!!label}
      accessibilityLabel={label}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: `${color}55`,
        backgroundColor: `${color}14`,
      }}
    >
      {children}
    </View>
  );
}

/** The rank reached in each season played, ranked. */
export function Seasons({ seasons }: { seasons: ProfileStats['seasons'] }) {
  if (seasons.length === 0) return null;
  return (
    <>
      <Heading title="Сезони" />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {seasons.map(({ season, tier }) => {
          const t = tier ? RANK_TIERS.find((x) => x.id === tier) : undefined;
          return (
            <Chip
              key={season}
              color={t?.color ?? '#94a3b8'}
              label={`${seasonTitle(season)}: ${t ? t.name : 'без ранг'}`}
            >
              <T style={{ fontSize: 22, lineHeight: 28 }}>{t ? '🏅' : '—'}</T>
              <View>
                <T variant="small" style={{ fontFamily: fonts.semibold }}>
                  {seasonTitle(season)}
                </T>
                <T variant="caption" tone="fg2">
                  {t ? t.name : 'Без ранг'}
                </T>
              </View>
            </Chip>
          );
        })}
      </View>
    </>
  );
}

/** A ranked rating as its rank: a dot in the rank's colour, its name and the number. */
export function RankBadge({ rating }: { rating: number }) {
  const tier = rankFor(rating);
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: 999,
        borderWidth: 1,
        borderColor: `${tier.color}55`,
        backgroundColor: `${tier.color}14`,
      }}
    >
      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: tier.color }} />
      <T variant="caption" style={{ fontFamily: fonts.bold }}>
        {tier.name}
      </T>
      <T variant="caption" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
        {rating}
      </T>
    </View>
  );
}

/** Each mode played, with its matches, wins and average place; the ones not yet played in a line under them. */
export function Modes({ modes, openQueues }: { modes: ProfileStats['modes']; openQueues: QueueModeId[] }) {
  const colors = useColors();
  const played = MODE_ORDER.filter((id) => modes.some((m) => m.mode === id));
  // Only what can be played today: a ranked queue that hasn't opened yet would read as a to-do nobody can do.
  const unplayed = MODE_ORDER.filter((id) => !played.includes(id) && (!isQueueMode(id) || openQueues.includes(id)));
  return (
    <>
      <Heading title="Режими" />
      <Card style={{ gap: 0, paddingVertical: 6 }}>
        {played.map((id, i) => {
          const m = modes.find((x) => x.mode === id)!;
          const mode = MODES[id];
          // Played alone (the daily too): no wins to count.
          const multiplayer = id !== 'solo' && id !== 'daily';
          return (
            <View
              key={id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 10,
                borderTopWidth: i ? 1 : 0,
                borderTopColor: colors.line,
              }}
            >
              <View style={{ width: 4, height: 32, borderRadius: 2, backgroundColor: mode.accent[0] }} />
              <View style={{ flex: 1 }}>
                <T variant="bodyStrong">{mode.name}</T>
                <T variant="caption" tone="fg3">
                  {plural(m.games, 'мач', 'мача')}
                  {multiplayer ? ` · ${pct(m.wins, m.games)}% победи` : ''}
                  {m.avgPlacement != null ? ` · средно ${ordinal(Math.round(m.avgPlacement))} място` : ''}
                </T>
              </View>
              {m.rating != null && <RankBadge rating={m.rating} />}
            </View>
          );
        })}
        {unplayed.length > 0 && (
          <T
            variant="small"
            tone="fg3"
            style={{ paddingVertical: 10, borderTopWidth: played.length ? 1 : 0, borderTopColor: colors.line }}
          >
            Още без мачове: {unplayed.map((id) => MODES[id].name).join(', ')}
          </T>
        )}
      </Card>
    </>
  );
}

/** The share of right answers in each category, with the mastery tier earned there. */
export function CategoryBars({ categories }: { categories: ProfileStats['categories'] }) {
  const rows = CATEGORIES.map((c) => {
    const s = categories.find((x) => x.category === c.id);
    return { ...c, answered: s?.answered ?? 0, correct: s?.correct ?? 0, tier: s?.tier ?? null };
  });
  return (
    <>
      <Heading title="Точност по категории" />
      <Card style={{ gap: 12 }}>
        {rows.map((r) => {
          const tier = r.tier !== null ? MASTERY_TIERS[r.tier] : undefined;
          const accuracy = r.answered ? r.correct / r.answered : 0;
          return (
            <View
              key={r.id}
              accessible
              accessibilityLabel={`${r.name}${tier ? ` (${tier.name})` : ''}: ${
                r.answered
                  ? `${Math.round(accuracy * 100)}%, ${fmt(r.correct)} от ${fmt(r.answered)} верни`
                  : 'още няма отговори'
              }`}
              style={{ gap: 6 }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <IconText icon={r.icon} variant="small" tone="fg2" containerStyle={{ flex: 1 }}>
                  {r.name}
                  {tier ? ` ${tier.icon}` : ''}
                </IconText>
                <T
                  variant="small"
                  tone={r.answered ? 'fg' : 'fg3'}
                  style={{ fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] }}
                >
                  {r.answered ? `${Math.round(accuracy * 100)}%` : '—'}
                </T>
              </View>
              <Progress value={accuracy} height={6} color="#a78bfa" />
            </View>
          );
        })}
        <T variant="caption" tone="fg3">
          Дял верни отговори от всички зададени въпроси в категорията.
        </T>
        {rows.some((r) => r.tier !== null) && (
          <T variant="caption" tone="fg3">
            Майсторство: {MASTERY_TIERS.map((t) => `${t.icon} ${t.name}`).join('  ')}
          </T>
        )}
      </Card>
    </>
  );
}

/** The twelve latest achievements, in their rarity's colour. */
export function LatestAchievements({
  achievements,
  isMe,
}: {
  achievements: ProfileStats['achievements'];
  isMe: boolean;
}) {
  return (
    <>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Heading title="Последни постижения" />
        {isMe && (
          <Pressable
            accessibilityRole="link"
            accessibilityLabel="Всички постижения"
            onPress={() => router.push('/achievements')}
            hitSlop={8}
          >
            <T variant="small" tone="link" style={{ fontFamily: fonts.semibold }}>
              Всички →
            </T>
          </Pressable>
        )}
      </View>
      {achievements.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 34, lineHeight: 42 }}>🏆</T>
          <T variant="title" align="center">
            Все още няма постижения
          </T>
          <T tone="fg2" align="center">
            Изиграй първия си мач и започни колекцията.
          </T>
        </Card>
      ) : (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {achievements.slice(0, 12).map(({ id, unlockedAt }) => {
            const a = achievementById(id);
            if (!a) return null;
            return (
              <Chip
                key={id}
                color={RARITIES[a.rarity].color}
                label={`${a.name}: ${a.description}, ${longDate(unlockedAt)}`}
              >
                <T style={{ fontSize: 20, lineHeight: 26 }}>{a.icon}</T>
                <T variant="small" style={{ fontFamily: fonts.semibold }}>
                  {a.name}
                </T>
              </Chip>
            );
          })}
        </View>
      )}
    </>
  );
}

const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}`;

/** The latest matches, one to a row: the mode and when, then the place, the points, the right answers, XP, rating. */
export function RecentMatches({ recent, isMe }: { recent: ProfileStats['recent']; isMe: boolean }) {
  const colors = useColors();
  return (
    <>
      <Heading title="Последни мачове" />
      {recent.length === 0 ? (
        <Card style={{ alignItems: 'center' }}>
          <T style={{ fontSize: 34, lineHeight: 42 }}>🎮</T>
          <T variant="title" align="center">
            Няма изиграни мачове
          </T>
          {isMe && (
            <>
              <T tone="fg2" align="center">
                Първият мач пълни тази страница: точност, серии, рекорди.
              </T>
              <Button title="Към игрите" onPress={() => router.navigate('/')} />
            </>
          )}
        </Card>
      ) : (
        <Card style={{ gap: 0, paddingVertical: 6 }}>
          {recent.map((r, i) => {
            const won = r.players > 1 && r.placement === 1;
            const place = r.players > 1 ? `${won ? '🏆 ' : ''}${ordinal(r.placement)} от ${r.players}` : null;
            return (
              <View
                key={r.matchId}
                accessible
                style={{ gap: 4, paddingVertical: 10, borderTopWidth: i ? 1 : 0, borderTopColor: colors.line }}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
                  <T variant="bodyStrong">{MODES[r.mode].name}</T>
                  <T variant="caption" tone="fg3">
                    {timeAgo(r.endedAt)}
                  </T>
                </View>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: 12, rowGap: 2 }}>
                  {place && (
                    <T variant="small" tone={won ? 'gold' : 'fg2'} style={won ? { fontFamily: fonts.bold } : undefined}>
                      {place}
                    </T>
                  )}
                  <T variant="small" tone="fg2">
                    {fmt(r.score)} т.
                  </T>
                  <T variant="small" tone="fg2">
                    {r.correct}/{r.questions} верни
                  </T>
                  <T variant="small" tone="link">
                    +{fmt(r.xp)} XP
                  </T>
                  {r.ratingDelta !== null && (
                    <T variant="small" tone={r.ratingDelta >= 0 ? 'good' : 'bad'}>
                      {signed(r.ratingDelta)} рейтинг
                    </T>
                  )}
                </View>
              </View>
            );
          })}
        </Card>
      )}
    </>
  );
}
