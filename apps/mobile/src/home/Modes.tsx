import { actions, fmt, useOpenQueues, useStore } from '@almanac/client';
import { levelProgress, MODES, type QueueModeId, START_RATING } from '@almanac/shared';
import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Card, T } from '@/ui';
import { DuoSheet, useDuoNeed } from './DuoSheet';
import { RankSheet } from './RankSheet';
import { SoloSheet } from './SoloSheet';

/** From this many in matches the count shows: a handful reads as an empty place. */
const LIVE_COUNT_MIN = 5;

/**
 * „Избери битка“: Соло, and the ranked queues the server has open (their rating and who's searching now). Отбори is two
 * friends together: its tile says what it needs, and a tap asks who with.
 */
export function Modes() {
  const colors = useColors();
  const me = useStore((s) => s.me);
  const lobby = useStore((s) => s.lobby);
  const connected = useStore((s) => s.connected);
  const ranked = useOpenQueues();
  const [soloOpen, setSoloOpen] = useState(false);
  const [duoOpen, setDuoOpen] = useState(false);
  const [rankOf, setRankOf] = useState<QueueModeId | null>(null);
  const duoNeed = useDuoNeed(ranked.some((id) => MODES[id].teams));
  // In the queue as a pair: the question of who with is answered.
  const queued = useStore((s) => !!s.queue);
  useEffect(() => {
    if (queued) setDuoOpen(false);
  }, [queued]);
  const [error, setError] = useState<string | null>(null);
  const queue = async (mode: QueueModeId) => {
    if (MODES[mode].teams) return setDuoOpen(true);
    setError(null);
    const res = await actions.joinQueue(mode);
    if (!res.ok) setError(res.error);
  };
  if (!me) return null;
  // A brand-new player is pointed at one way in: a duel, which the gentle bots of the first matches make a likely first
  // win; Соло where no duel queue is open.
  const newcomer = levelProgress(me.xp).level === 1;
  const starter = newcomer ? (ranked.includes('duel') ? 'duel' : 'solo') : null;
  return (
    <View style={{ gap: 12 }}>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          gap: 8,
        }}
      >
        <T variant="h2" role="heading">
          Избери битка
        </T>
        {lobby && lobby.inGame >= LIVE_COUNT_MIN && (
          <T variant="small" tone="fg3">
            {fmt(lobby.inGame)} играят в момента
          </T>
        )}
      </View>
      {/* Above the modes it dims: below them it was off the screen, and the dimmed modes said nothing. */}
      {!connected && (
        <T variant="small" tone="fg3" role="status">
          Свързваме се…
        </T>
      )}
      <ModeTile
        name={MODES.solo.name}
        tagline={MODES.solo.tagline}
        accent={MODES.solo.accent[0]}
        disabled={!connected}
        starter={starter === 'solo'}
        onPress={() => setSoloOpen(true)}
      />
      {ranked.map((id) => (
        <ModeTile
          key={id}
          name={MODES[id].name}
          tagline={MODES[id].tagline}
          accent={MODES[id].accent[0]}
          detail={`Рейтинг ${fmt(me.ratings[id] ?? START_RATING)}${MODES[id].teams ? ` · ${duoNeed.text}` : lobby?.queues[id] ? ` · ${lobby.queues[id]} търсят` : ''}`}
          disabled={!connected}
          starter={starter === id}
          onPress={() => void queue(id)}
          onInfo={() => setRankOf(id)}
        />
      ))}
      {error ? (
        <T variant="small" tone="bad" role="alert">
          {error}
        </T>
      ) : null}
      <SoloSheet open={soloOpen} onClose={() => setSoloOpen(false)} />
      <DuoSheet open={duoOpen} onClose={() => setDuoOpen(false)} />
      <RankSheet mode={rankOf} onClose={() => setRankOf(null)} />
      <View style={{ height: 1, backgroundColor: colors.line, marginTop: 4 }} />
    </View>
  );
}

function ModeTile({
  name,
  tagline,
  accent,
  detail,
  disabled,
  onPress,
  onInfo,
  starter = false,
}: {
  name: string;
  tagline: string;
  accent: string;
  detail?: string;
  disabled: boolean;
  onPress: () => void;
  /** A ranked mode: what its rank means. */
  onInfo?: () => void;
  /** A newcomer's way in: „Започни оттук“. */
  starter?: boolean;
}) {
  const colors = useColors();
  return (
    <View>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${name}${starter ? ' (започни оттук)' : ''}: ${tagline}${detail ? `. ${detail}` : ''}`}
        style={({ pressed }) => ({ opacity: disabled ? 0.5 : pressed ? 0.85 : 1, borderRadius: radius.xl })}
      >
        <Card accent={accent}>
          <View
            style={{
              flexDirection: 'row',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
              paddingRight: onInfo ? 44 : 0,
            }}
          >
            <T variant="h2" style={{ color: accent }}>
              {name}
            </T>
            {starter && (
              <View
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 2,
                  borderRadius: 999,
                  backgroundColor: `${colors.good}26`,
                }}
              >
                <T variant="caption" tone="good" style={{ fontFamily: fonts.bold }}>
                  Започни оттук
                </T>
              </View>
            )}
          </View>
          <T variant="small" tone="fg2">
            {tagline}
          </T>
          {detail ? (
            <T variant="caption" tone="fg3">
              {detail}
            </T>
          ) : null}
        </Card>
      </Pressable>
      {onInfo && (
        // Beside the tile, not in it: its own button for a screen reader too.
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Рейтинг и рангове в „${name}“`}
          onPress={onInfo}
          hitSlop={6}
          style={({ pressed }) => ({
            position: 'absolute',
            top: 10,
            right: 10,
            width: 40,
            height: 40,
            borderRadius: 20,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? colors.lineStrong : colors.glass,
          })}
        >
          <T tone="fg3" style={{ fontFamily: fonts.bold }}>
            ?
          </T>
        </Pressable>
      )}
    </View>
  );
}
