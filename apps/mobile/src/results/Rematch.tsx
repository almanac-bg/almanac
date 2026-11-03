import {
  actions,
  getState,
  type LiveGame,
  REMATCH_NO_ANSWER_MS,
  REMATCH_OFFER_MS,
  type Rematch,
  type RematchStatus,
  rematchLines,
  useNow,
  useStore,
} from '@almanac/client';
import { type GamePlayer, isQueueMode } from '@almanac/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, View } from 'react-native';
import { fonts, radius, useColors } from '@/theme';
import { Avatar, Button, T } from '@/ui';

/** When this phone first showed each match's offer: coming back to the results keeps the same clock. */
const shownAt = new Map<string, number>();
/** Offers declined here (the results left); coming back to them shows them over. */
const declined = new Set<string>();

/**
 * „Реванш“ after a ranked queue match with other people (the web's useRematch): the same humans play again once all of
 * them ask. Null when the match doesn't qualify. Leaving the results declines it, so nobody waits on someone who's
 * gone — unless what took over is the next match itself.
 */
export function useRematch(game: LiveGame): Rematch | null {
  const end = game.end!;
  const gameId = end.gameId;
  const youId = game.start.youId;
  // Mirrors the server: humans who didn't leave, at least two of them, you among them.
  const opponents = useMemo(() => {
    if (!end.ranked || !isQueueMode(end.mode)) return [];
    const stayed = end.standings.filter((s) => !s.left).map((s) => game.players[s.id]);
    if (!stayed.some((p) => p?.id === youId)) return [];
    return stayed.filter((p): p is GamePlayer => !!p && p.id !== youId && !p.isBot && p.userId !== null);
  }, [end, game.players, youId]);
  const eligible = opponents.length > 0;
  const yourTeam = game.players[youId]?.team ?? null;
  const teammates = yourTeam === null ? 0 : opponents.filter((p) => p.team === yourTeam).length;
  const sides = teammates === 0 ? 'against' : teammates === opponents.length ? 'with' : 'mixed';

  const offer = useStore((s) => (s.rematch?.gameId === gameId ? s.rematch : null));
  const [until] = useState(() => {
    if (!shownAt.has(gameId)) shownAt.set(gameId, Date.now());
    return (shownAt.get(gameId) ?? Date.now()) + REMATCH_OFFER_MS;
  });
  const [asked, setAsked] = useState(false);
  const [seen, setSeen] = useState(false);
  const [expired, setExpired] = useState(() => Date.now() >= until);
  const [unanswered, setUnanswered] = useState(false);

  // An offer that was live and is now gone (while this match is still on screen) was called off.
  useEffect(() => {
    if (offer) setSeen(true);
  }, [offer]);
  useEffect(() => {
    if (!eligible || expired) return;
    const timer = setTimeout(() => setExpired(true), until - Date.now());
    return () => clearTimeout(timer);
  }, [eligible, expired, until]);
  const youReady = !!offer?.ready.includes(youId);
  useEffect(() => {
    if (!asked || youReady) return;
    const timer = setTimeout(() => setUnanswered(true), REMATCH_NO_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [asked, youReady]);

  // Leaving the results declines it — checked a tick later: a new match taking over (the rematch itself) isn't leaving.
  useEffect(() => {
    if (!eligible) return;
    return () => {
      setTimeout(() => {
        const current = getState().game;
        if (current && current.start.gameId !== gameId) return;
        declined.add(gameId);
        actions.declineRematch(gameId);
      }, 0);
    };
  }, [eligible, gameId]);

  if (!eligible) return null;
  const ready = new Set(offer?.ready.filter((id) => id !== youId));
  const over = declined.has(gameId) || expired || unanswered || (seen && !offer);
  const status: RematchStatus = over ? 'over' : asked || youReady ? 'waiting' : ready.size ? 'invited' : 'open';
  return {
    status,
    opponents,
    ready,
    sides,
    until,
    involved: asked || seen,
    request: () => {
      setAsked(true);
      actions.requestRematch(gameId);
    },
  };
}

/** The offer as one row, over the results' bottom bar: who it's with (a tick on who asked), what's on, the button. */
export function RematchStrip({ rematch: r }: { rematch: Rematch }) {
  const colors = useColors();
  const now = useNow(1000);
  const { title, detail, button } = rematchLines(r);
  const hidden = r.status === 'over' && !r.involved;
  // The news said as it changes (a friend asked, it fell through), on iOS too.
  const said = useRef(title);
  useEffect(() => {
    if (!hidden && title !== said.current) AccessibilityInfo.announceForAccessibility(title);
    said.current = title;
  }, [title, hidden]);
  // Nobody asked before it ran out: nothing to report.
  if (hidden) return null;
  const invited = r.status === 'invited';
  const left = Math.max(0, Math.ceil((r.until - now) / 1000));
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        padding: 10,
        borderRadius: radius.lg,
        borderCurve: 'continuous',
        borderWidth: 1,
        borderColor: invited ? `${colors.gold}88` : colors.line,
        backgroundColor: invited ? `${colors.gold}1a` : colors.glass,
        opacity: r.status === 'over' ? 0.7 : 1,
      }}
    >
      <View style={{ flexDirection: 'row' }}>
        {r.opponents.slice(0, 3).map((p, i) => (
          <View key={p.id} style={{ marginLeft: i ? -10 : 0 }}>
            <Avatar avatar={p.avatar} frame={p.frame} size={32} />
            {r.ready.has(p.id) && r.status !== 'over' && (
              <View
                style={{
                  position: 'absolute',
                  right: -2,
                  bottom: -2,
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: colors.good,
                }}
              >
                <T style={{ fontSize: 10, lineHeight: 12, color: colors.onFill, fontFamily: fonts.bold }}>✓</T>
              </View>
            )}
          </View>
        ))}
      </View>
      <View style={{ flex: 1 }}>
        {/* Only the news is said as it changes; the seconds ticking under it would be read out every second. */}
        <T
          variant="small"
          numberOfLines={2}
          accessibilityLiveRegion="polite"
          tone={r.status === 'over' ? 'fg3' : 'fg'}
          style={{ fontFamily: r.status === 'over' ? fonts.regular : fonts.semibold }}
        >
          {title}
        </T>
        {r.status !== 'over' && (
          <T variant="caption" tone="fg3" numberOfLines={1} accessibilityElementsHidden importantForAccessibility="no">
            {detail} · {left} с
          </T>
        )}
      </View>
      {r.status === 'waiting' ? (
        <ActivityIndicator />
      ) : button ? (
        <Button title={button} variant={invited ? 'gold' : 'secondary'} onPress={r.request} />
      ) : null}
    </View>
  );
}
