import { api, errorMessage, setState as setStore, toast, unlockPreview, useStore } from '@quiz/client';
import type { MatchRewards, UnlockRef } from '@quiz/shared';
import { Check } from 'lucide-react';
import { AnimatePresence, m, useIsPresent } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { sfx } from '../../lib/sound';
import { Avatar } from '../Avatar';
import { Button, Modal } from '../ui';
import { burst } from './confetti';

type Step = { kind: 'level'; level: number } | { kind: 'unlock'; unlock: UnlockRef; more: number };

/** Unlocks shown one by one at most; the rest are counted on the last one (a first match can bring half a dozen). */
const SHOWN_UNLOCKS = 3;

/** What a match brought that deserves a moment of its own: a new level, then the avatars and frames it unlocked. */
export function rewardSteps(rewards: MatchRewards | null | undefined): Step[] {
  if (!rewards) return [];
  const unlocks = rewards.unlocks.filter((u) => u.kind === 'avatar' || u.kind === 'frame');
  const shown = unlocks.slice(0, SHOWN_UNLOCKS);
  return [
    ...(rewards.levelAfter > rewards.levelBefore ? [{ kind: 'level' as const, level: rewards.levelAfter }] : []),
    ...shown.map((unlock, i) => ({
      kind: 'unlock' as const,
      unlock,
      more: i === shown.length - 1 ? unlocks.length - shown.length : 0,
    })),
  ];
}

/**
 * The rewards of a match, one beat at a time before its page: the new level, then each new avatar or frame, large, with
 * „Сложи го“. „Нататък“ goes on; Escape or a tap outside skips the rest. An ordinary match has none and goes straight
 * to its page. (All at once on one long page, a level-up landed as a line among a dozen.)
 */
export function RewardMoment({ steps, open, onDone }: { steps: Step[]; open: boolean; onDone: () => void }) {
  const [at, setAt] = useState(0);
  const step = steps[at];
  useEffect(() => {
    if (!open || !step) return;
    if (step.kind === 'level') {
      sfx.levelUp();
      burst(0.9);
    } else sfx.achievement();
  }, [open, step]);
  if (!step) return null;
  const last = at + 1 >= steps.length;
  return (
    <Modal open={open} onClose={onDone} label="Ново от този мач" className="max-w-sm text-center">
      <AnimatePresence mode="wait">
        <Beat key={at} step={step} last={last} first={at === 0} onNext={() => (last ? onDone() : setAt(at + 1))} />
      </AnimatePresence>
    </Modal>
  );
}

/**
 * One step. While it fades out it takes no taps (one would land on the step already left and be lost) and leaves the
 * accessibility tree; the next one takes the focus, so Enter keeps going.
 */
function Beat({ step, last, first, onNext }: { step: Step; last: boolean; first: boolean; onNext: () => void }) {
  const present = useIsPresent();
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!first) button.current?.focus({ preventScroll: true });
  }, [first]);
  return (
    <m.div
      inert={!present}
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="flex flex-col items-center"
    >
      {step.kind === 'level' ? (
        <>
          <p className="t-eyebrow text-amber-300">Ново ниво</p>
          <p className="mt-3 font-display text-8xl leading-none font-black text-gradient">{step.level}</p>
        </>
      ) : (
        <Unlocked unlock={step.unlock} more={step.more} />
      )}
      <Button
        ref={button}
        className="mt-8 w-full"
        size="lg"
        variant={step.kind === 'unlock' ? 'ghost' : 'primary'}
        onClick={onNext}
      >
        {last ? 'Към резултата' : 'Нататък'}
      </Button>
    </m.div>
  );
}

/** A new avatar or frame on the player as they are, and a button to wear it. */
function Unlocked({ unlock, more }: { unlock: UnlockRef; more: number }) {
  const me = useStore((s) => s.me);
  const [state, setState] = useState<'idle' | 'saving' | 'worn'>('idle');
  if (!me) return null;
  const { name } = unlockPreview(unlock);
  const worn = state === 'worn' || (unlock.kind === 'avatar' ? me.avatar === unlock.id : me.frame === unlock.id);

  async function wear() {
    setState('saving');
    try {
      const { user } = await api.loadout({ [unlock.kind]: unlock.id });
      setStore({ me: user });
      setState('worn');
    } catch (err) {
      setState('idle');
      toast({ kind: 'error', title: errorMessage(err, 'Неуспешно запазване.') });
    }
  }

  return (
    <>
      <p className="t-eyebrow text-amber-300">Ново за теб</p>
      <m.div
        className="mt-4"
        initial={{ scale: 0.3, rotate: -18 }}
        animate={{ scale: 1, rotate: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 14, delay: 0.15 }}
      >
        <Avatar
          avatar={unlock.kind === 'avatar' ? unlock.id : me.avatar}
          frame={unlock.kind === 'frame' ? unlock.id : me.frame}
          size={144}
        />
      </m.div>
      <p className="mt-4 text-xl font-extrabold">{name}</p>
      {more > 0 && <p className="mt-1 text-sm text-fg-2">и още {more} — в „Колекция“</p>}
      {worn ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-300">
          <Check aria-hidden className="size-4" /> Носиш го
        </p>
      ) : (
        <Button className="mt-4" onClick={() => void wear()} loading={state === 'saving'}>
          Сложи го
        </Button>
      )}
    </>
  );
}
