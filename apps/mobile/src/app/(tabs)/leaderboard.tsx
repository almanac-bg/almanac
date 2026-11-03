import { api, fmt, useOpenQueues, useStore } from '@almanac/client';
import {
  avatarEmoji,
  dayKey,
  type LeaderboardBoard,
  type LeaderboardEntry,
  MODES,
  rankFor,
  TIME_ZONE,
} from '@almanac/shared';
import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useLoad } from '@/lib/load';
import { Choices } from '@/settings/parts';
import { radius, useColors } from '@/theme';
import { LoadError, Screen, T } from '@/ui';

const GUEST_LINE = 'Класациите са за играчи с профил: запази прогреса си, за да влезеш в тях.';

/** Класации: by level, the day's, and each open ranked queue's season (the web's LeaderboardPage). */
export default function Leaderboard() {
  const me = useStore((s) => s.me);
  const open = useOpenQueues();
  const boards: { id: LeaderboardBoard; label: string }[] = [
    { id: 'level', label: 'Ниво' },
    { id: 'daily', label: 'Днес' },
    ...open.map((m) => ({ id: m, label: MODES[m].name })),
  ];
  const [board, setBoard] = useState<LeaderboardBoard>('level');
  const [scope, setScope] = useState<'all' | 'friends'>('all');
  const { data, error, loading, reload } = useLoad(() => api.leaderboard(board), board);
  if (!me) return null;
  const amongFriends = board === 'daily' && scope === 'friends';
  const entries = (amongFriends ? data?.friends : data?.entries) ?? [];
  const meEntry = amongFriends ? null : (data?.me ?? null);
  const meInList = entries.some((e) => e.user.id === me.id);
  const dailyLine =
    me.daily.played && dayKey(me.createdAt) === me.daily.day
      ? 'Днешният ти резултат е само за теб: новият ти профил влиза в класацията от утре.'
      : 'Изиграй въпросите на деня, за да влезеш в класацията. Отворена е до полунощ.';
  return (
    <Screen refreshing={loading && !!data} onRefresh={reload}>
      <T variant="h1" role="heading">
        Класации
      </T>
      <T tone="fg2">
        {board === 'level'
          ? 'Най-опитните играчи по натрупан XP.'
          : board === 'daily'
            ? 'Резултатите от въпросите на деня. Класацията се нулира в полунощ.'
            : `Рейтинг в класирания режим „${MODES[board].name}“.`}
      </T>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
        <Choices label="Класация" options={boards} value={board} onChange={setBoard} />
      </ScrollView>
      {board === 'daily' && !me.isGuest && (
        <Choices
          label="Сред кого"
          options={[
            { id: 'all', label: 'Цяла България' },
            { id: 'friends', label: 'Приятели' },
          ]}
          value={scope}
          onChange={setScope}
        />
      )}
      {data?.season && (
        <T variant="small" tone="gold">
          🏆 Сезон {data.season.name} · завършва{' '}
          {new Date(data.season.endsAt - 1).toLocaleDateString('bg-BG', {
            day: 'numeric',
            month: 'long',
            timeZone: TIME_ZONE,
          })}
        </T>
      )}
      {error && !data ? (
        <LoadError title="Класацията не се зареди" error={error} onRetry={reload} />
      ) : !data ? (
        <ActivityIndicator style={{ marginTop: 40 }} />
      ) : entries.length === 0 ? (
        <View style={{ gap: 6, alignItems: 'center', paddingVertical: 24 }}>
          <T variant="title" align="center">
            {amongFriends
              ? 'Никой от приятелите ти не е играл днес'
              : board === 'daily'
                ? 'Още никой не е в днешната класация'
                : 'Още никой не е класиран'}
          </T>
          <T tone="fg2" align="center">
            {me.isGuest ? GUEST_LINE : board === 'daily' ? dailyLine : 'Изиграй класиран мач и оглави тази класация.'}
          </T>
        </View>
      ) : (
        <View style={{ gap: 8 }}>
          {entries.map((e) => (
            <Row key={e.user.id} entry={e} board={board} mine={e.user.id === me.id} />
          ))}
          {meEntry && !meInList && (
            <>
              <T variant="caption" tone="fg3" align="center">
                ⋯
              </T>
              <Row entry={meEntry} board={board} mine />
            </>
          )}
          {me.isGuest && (
            <T variant="small" tone="fg3" align="center">
              {GUEST_LINE}
            </T>
          )}
        </View>
      )}
    </Screen>
  );
}

const MEDALS = ['🥇', '🥈', '🥉'];

function Row({ entry: e, board, mine }: { entry: LeaderboardEntry; board: LeaderboardBoard; mine: boolean }) {
  const colors = useColors();
  const value =
    board === 'level'
      ? `${fmt(e.value)} XP`
      : board === 'daily'
        ? `${fmt(e.value)} т.${e.correct !== undefined ? ` · ${e.correct}/10` : ''}`
        : `${rankFor(e.value).name} · ${e.value}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${e.rank}. ${mine ? 'Ти' : e.user.username}: ${value}`}
      accessibilityHint="Отваря профила"
      onPress={() =>
        mine
          ? router.navigate('/profile')
          : router.push({ pathname: '/profile/[username]', params: { username: e.user.username } })
      }
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 12,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: mine ? colors.violet : colors.line,
        backgroundColor: pressed ? colors.lineStrong : mine ? `${colors.violet}18` : colors.ink2,
      })}
    >
      <T variant="title" style={{ minWidth: 32, textAlign: 'center' }}>
        {MEDALS[e.rank - 1] ?? e.rank}
      </T>
      <T style={{ fontSize: 24, lineHeight: 30 }}>{avatarEmoji(e.user.avatar)}</T>
      <T variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
        {mine ? `${e.user.username} (ти)` : e.user.username}
      </T>
      <T variant="small" tone="fg2" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </Pressable>
  );
}
