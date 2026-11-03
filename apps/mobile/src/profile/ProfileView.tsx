import {
  api,
  availableAchievements,
  fmt,
  longDate,
  pct,
  plural,
  seconds,
  useOpenQueues,
  useStore,
} from '@almanac/client';
import { avatarEmoji, levelProgress, type ProfileStats, titleName } from '@almanac/shared';
import { router } from 'expo-router';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { radius, useColors } from '@/theme';
import { Button, Card, LoadError, Progress, Screen, T } from '@/ui';
import { PlayerActions } from './PlayerActions';
import { CategoryBars, LatestAchievements, Modes, RecentMatches, Seasons } from './parts';

/**
 * A player's profile (the web's ProfilePage): who they are and their level, their numbers, seasons, modes, accuracy by
 * category, the latest achievements and matches. Your own has the way to Settings; another player's, a friend's
 * actions, a report and a block.
 */
export function ProfileView({ username }: { username: string }) {
  const me = useStore((s) => s.me);
  // New XP or a friendship change refreshes the one on screen.
  const version = useStore((s) => `${s.me?.xp}:${s.friendsVersion}`);
  const { data, error, status, loading, reload, set } = useLoad(() => api.profile(username), `${username}:${version}`);
  if (!me) return null;
  if (!data && error && status === 404) {
    return (
      <Screen centered>
        <View style={{ alignItems: 'center', gap: 8 }}>
          <T style={{ fontSize: 40, lineHeight: 48 }}>🕵️</T>
          <T variant="title" align="center">
            {error}
          </T>
        </View>
      </Screen>
    );
  }
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      {error && !data ? (
        <LoadError title="Профилът не се зареди" error={error} onRetry={reload} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : (
        <Profile data={data} isMe={data.user.id === me.id} guest={me.isGuest} onChange={set} />
      )}
    </Screen>
  );
}

function Profile({
  data,
  isMe,
  guest,
  onChange,
}: {
  data: ProfileStats;
  isMe: boolean;
  guest: boolean;
  onChange: (p: ProfileStats) => void;
}) {
  const colors = useColors();
  const openQueues = useOpenQueues();
  const { user, overview: o } = data;
  const progress = levelProgress(user.xp);
  const achievable = availableAchievements(openQueues, (id) => data.achievements.some((a) => a.id === id)).length;
  return (
    <>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.ink2,
              borderWidth: 1,
              borderColor: colors.line,
            }}
          >
            <T style={{ fontSize: 40, lineHeight: 48 }}>{avatarEmoji(user.avatar)}</T>
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="small" tone="link">
              {titleName(user.title)}
            </T>
            <T variant="h1" role="heading" numberOfLines={2}>
              {user.username}
            </T>
            <T variant="caption" tone="fg3">
              Играе от {longDate(user.createdAt)} · {data.achievements.length}/{achievable} постижения
            </T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', columnGap: 12 }}>
          <T variant="bodyStrong">Ниво {progress.level}</T>
          <T variant="small" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
            {fmt(user.xp)} XP общо
          </T>
        </View>
        <Progress
          value={progress.pct}
          label={`Ниво ${progress.level}`}
          valueText={`${fmt(progress.into)} от ${fmt(progress.needed)} XP до следващото`}
        />
        {isMe ? (
          <>
            {guest && (
              <T variant="small" tone="fg2">
                Играеш като гост: запази профила в Настройки, за да не го загубиш.
              </T>
            )}
            <Button title="Настройки" variant="secondary" onPress={() => router.push('/settings')} />
          </>
        ) : (
          <PlayerActions profile={data} guest={guest} onChange={onChange} />
        )}
      </Card>

      <T variant="h2" role="heading">
        Статистика
      </T>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        <Stat label="Изиграни мачове" value={fmt(o.gamesPlayed)} />
        <Stat
          label="Победи"
          value={fmt(o.wins)}
          hint={
            o.multiplayerGames
              ? `${pct(o.wins, o.multiplayerGames)}% от ${plural(o.multiplayerGames, 'мач срещу съперници', 'мача срещу съперници')}`
              : undefined
          }
        />
        <Stat
          label="Точност"
          value={o.questionsAnswered ? `${pct(o.correctAnswers, o.questionsAnswered)}%` : '—'}
          hint={o.questionsAnswered ? `${fmt(o.correctAnswers)} от ${fmt(o.questionsAnswered)} верни` : undefined}
        />
        <Stat label="Най-много верни подред" icon="🔥" value={String(o.bestStreak)} />
        <Stat label="Най-бърз верен отговор" value={o.fastestCorrectMs !== null ? seconds(o.fastestCorrectMs) : '—'} />
        <Stat label="Средно време (верни)" value={o.avgCorrectMs !== null ? seconds(o.avgCorrectMs) : '—'} />
        <Stat label="Рекорд в „Соло“" value={fmt(o.bestSoloScore)} />
        <Stat
          label="Научени факти"
          icon="📖"
          value={fmt(data.knowledge.facts)}
          hint={`от ${fmt(data.knowledge.total)}`}
          onPress={isMe ? () => router.navigate('/knowledge') : undefined}
        />
        <Stat label="Дневна серия" icon="🗓️" value={String(o.dailyStreak)} hint={`Най-дълга: ${o.bestDailyStreak}`} />
        <Stat label="Одобрени въпроси" icon="✍️" value={String(o.questionsApproved)} />
      </View>

      <Seasons seasons={data.seasons} />
      <Modes modes={data.modes} openQueues={openQueues} />
      <CategoryBars categories={data.categories} />
      <LatestAchievements achievements={data.achievements} />
      <RecentMatches recent={data.recent} isMe={isMe} />
    </>
  );
}

/**
 * A number with what it is, two to a row; `icon` is only seen, not said. `onPress`: where its details are (your own
 * „Моите знания“).
 */
function Stat({
  label,
  value,
  icon,
  hint,
  onPress,
}: {
  label: string;
  value: string;
  icon?: string;
  hint?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const style = {
    flexGrow: 1,
    flexBasis: '45%' as const,
    gap: 4,
    padding: 14,
    borderRadius: radius.lg,
    borderCurve: 'continuous' as const,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.glass,
  };
  const body = (
    <>
      <T variant="caption" tone="fg3">
        {label}
      </T>
      <T variant="h2" style={{ fontVariant: ['tabular-nums'] }}>
        {icon ? `${icon} ${value}` : value}
      </T>
      {hint ? (
        <T variant="caption" tone="fg3">
          {hint}
        </T>
      ) : null}
    </>
  );
  const said = `${label}: ${value}${hint ? `, ${hint}` : ''}`;
  return onPress ? (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={said}
      accessibilityHint="Отваря „Моите знания“"
      onPress={onPress}
      style={({ pressed }) => [style, pressed && { backgroundColor: colors.lineStrong }]}
    >
      {body}
    </Pressable>
  ) : (
    <View accessible accessibilityLabel={said} style={style}>
      {body}
    </View>
  );
}
