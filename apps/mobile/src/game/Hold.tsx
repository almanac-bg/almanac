import { actions, useNow } from '@almanac/client';
import { HOLD } from '@almanac/shared';
import { useEffect, useState } from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { radius, useColors } from '@/theme';
import { Button, T } from '@/ui';

type HoldState = 'shown' | 'asking' | 'holding';

/** Asks the server to hold the next question; too late (it's on its way already), the note simply goes with this one. */
function useHold(index: number, waiting: boolean) {
  const [state, setState] = useState<HoldState>(waiting ? 'holding' : 'shown');
  const hold = async () => {
    setState('asking');
    setState((await actions.holdOnFact(index)) ? 'holding' : 'shown');
  };
  return { state, hold };
}

/**
 * „Знаеше ли?“ under the result, in a run played alone. The run goes on at its usual pace; „Спри, за да прочета“ holds
 * the next question until „Продължи“, so reading is the player's choice, never a delay. Without a clock (`waiting`)
 * every answer waits from the start.
 */
export function FactNote({ index, fact, waiting }: { index: number; fact: string; waiting: boolean }) {
  const colors = useColors();
  const { state, hold } = useHold(index, waiting);
  return (
    <View
      style={{
        marginTop: 12,
        padding: 14,
        gap: 10,
        borderRadius: radius.lg,
        borderWidth: 1,
        borderColor: 'rgba(251,191,36,0.3)',
        backgroundColor: colors.ink2,
      }}
    >
      <T variant="small" tone="fg2">
        <T variant="small" tone="gold" style={{ fontWeight: '700' }}>
          💡 Знаеше ли?{' '}
        </T>
        {fact}
      </T>
      <HoldButton state={state} onHold={() => void hold()} holdLabel="Спри, за да прочета" />
      {state === 'holding' && <HoldEnding holdMs={waiting ? HOLD.untimedMs : HOLD.pauseMs} />}
    </View>
  );
}

/** „Пауза“ after an answer in Соло: the next question waits until „Продължи“ (or a couple of minutes). */
export function PauseAfterAnswer({ index, waiting }: { index: number; waiting: boolean }) {
  const { state, hold } = useHold(index, waiting);
  return (
    <View style={{ marginTop: 12, gap: 6 }}>
      <HoldButton state={state} onHold={() => void hold()} holdLabel="Пауза" />
      {state === 'holding' && <HoldEnding holdMs={waiting ? HOLD.untimedMs : HOLD.pauseMs} />}
    </View>
  );
}

function HoldButton({ state, onHold, holdLabel }: { state: HoldState; onHold: () => void; holdLabel: string }) {
  return state === 'holding' ? (
    <Button title="Продължи" onPress={actions.resumeAfterFact} style={{ alignSelf: 'flex-end' }} />
  ) : (
    <Button
      title={holdLabel}
      variant="ghost"
      loading={state === 'asking'}
      onPress={onHold}
      style={{ alignSelf: 'flex-end' }}
    />
  );
}

/** A hold goes on by itself after a while (HOLD): its last seconds are said, once (WCAG 2.2.1). */
function HoldEnding({ holdMs }: { holdMs: number }) {
  const [since] = useState(() => Date.now());
  const now = useNow(1000);
  const left = Math.ceil((since + holdMs - now) / 1000);
  const ending = left * 1000 <= HOLD.warnMs;
  useEffect(() => {
    if (ending)
      AccessibilityInfo.announceForAccessibility(
        `Мачът продължава сам след ${HOLD.warnMs / 1000} секунди. „Продължи“ го пуска веднага.`,
      );
  }, [ending]);
  return ending ? (
    <T variant="caption" tone="fg3" align="right">
      Мачът продължава сам след {Math.max(0, left)} с
    </T>
  ) : null;
}

/**
 * „Без часовник“ still closes a question walked away from (HOLD.untimedMs): its last HOLD.warnMs say so, with
 * „Още време“ to keep it open (WCAG 2.2.1).
 */
export function UntimedEnding({ index, deadline }: { index: number; deadline: number }) {
  const [warn, setWarn] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setWarn(false);
    const t = setTimeout(() => setWarn(true), Math.max(0, deadline - HOLD.warnMs - Date.now()));
    return () => clearTimeout(t);
  }, [deadline]);
  useEffect(() => {
    if (warn)
      AccessibilityInfo.announceForAccessibility(
        `Въпросът се затваря след ${HOLD.warnMs / 1000} секунди. „Още време“ го държи отворен.`,
      );
  }, [warn]);
  const now = useNow(1000, warn);
  if (!warn) return null;
  const left = Math.max(0, Math.ceil((deadline - now) / 1000));
  return (
    <View style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 12 }}>
      <T variant="caption" tone="fg3">
        Въпросът се затваря след {left} с
      </T>
      <Button
        title="Още време"
        variant="secondary"
        loading={busy}
        onPress={async () => {
          setBusy(true);
          await actions.moreTime(index);
          setBusy(false);
        }}
      />
    </View>
  );
}
