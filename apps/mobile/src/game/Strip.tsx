import { fmt, inDropZone, type LiveGame } from '@almanac/client';
import { avatarEmoji } from '@almanac/shared';
import { ScrollView, View } from 'react-native';
import { gutter, radius, useColors } from '@/theme';
import { T } from '@/ui';

/**
 * Where everyone stands, under the top bar (the web's MobileStrip): one on one, the two scores face to face; a class's
 * forty, a line; otherwise a row of players, scrolling.
 */
export function Strip({ game }: { game: LiveGame }) {
  const colors = useColors();
  const youId = game.start.youId;
  if (game.start.players.length === 2 && !game.start.teams) {
    const [a, b] = [youId, game.start.players.find((p) => p.id !== youId)?.id ?? ''].map((id) =>
      game.standings.find((s) => s.id === id),
    );
    const them = b ? game.players[b.id] : null;
    return (
      <View
        accessible
        accessibilityLabel={`Ти ${fmt(a?.score ?? 0)}, ${them?.name ?? 'съперникът'} ${fmt(b?.score ?? 0)}`}
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          paddingHorizontal: gutter,
          paddingVertical: 10,
          borderBottomWidth: 1,
          borderBottomColor: colors.line,
        }}
      >
        <T variant="bodyStrong">Ти · {fmt(a?.score ?? 0)}</T>
        <T variant="bodyStrong" tone="fg2">
          {fmt(b?.score ?? 0)} · {them?.name}
        </T>
      </View>
    );
  }
  if (game.start.players.length > 12) {
    const mine = game.standings.find((s) => s.id === youId);
    const leader = game.standings[0];
    return (
      <View
        style={{ paddingHorizontal: gutter, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.line }}
      >
        <T variant="small">
          {mine ? `Ти: ${mine.rank} от ${game.standings.length} · ${fmt(mine.score)} т.` : ''}
          {leader && leader.id !== youId ? ` · води ${game.players[leader.id]?.name} (${fmt(leader.score)})` : ''}
        </T>
      </View>
    );
  }
  const danger = inDropZone(game);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityLabel="Класиране"
      contentContainerStyle={{ gap: 10, paddingHorizontal: gutter, paddingVertical: 10 }}
      style={{ flexGrow: 0, borderBottomWidth: 1, borderBottomColor: colors.line }}
    >
      {game.standings.map((s) => {
        const p = game.players[s.id];
        const me = s.id === youId;
        const out = s.eliminatedAt !== null || s.left;
        const answered = game.phase === 'question' && game.answered.includes(s.id);
        const reaction = game.reactions.filter((r) => r.playerId === s.id).at(-1);
        return (
          <View
            key={s.id}
            accessible
            accessibilityLabel={`${s.rank}. ${me ? 'Ти' : p?.name}, ${fmt(s.score)} точки${out ? ', отпадна' : ''}${answered ? ', отговори' : ''}${danger.has(s.id) ? ', в зоната за отпадане' : ''}`}
            style={{
              alignItems: 'center',
              gap: 2,
              minWidth: 56,
              paddingHorizontal: 6,
              paddingVertical: 4,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: danger.has(s.id) ? colors.bad : me ? colors.violet : 'transparent',
              opacity: out ? 0.4 : 1,
            }}
          >
            <T variant="title">{reaction ? reaction.emote : p ? avatarEmoji(p.avatar) : '·'}</T>
            <T variant="caption" tone={me ? 'fg' : 'fg2'} numberOfLines={1} style={{ maxWidth: 72 }}>
              {me ? 'Ти' : p?.name}
              {answered ? ' ✓' : ''}
            </T>
            <T variant="caption" tone="fg3" style={{ fontVariant: ['tabular-nums'] }}>
              {fmt(s.score)}
            </T>
          </View>
        );
      })}
    </ScrollView>
  );
}
