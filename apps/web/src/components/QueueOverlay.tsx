import { actions, plural, useNow, useStore } from '@quiz/client';
import { avatarEmoji, MODES, POWERUPS, type QueueStatus } from '@quiz/shared';
import clsx from 'clsx';
import { Bot, User, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { type RefObject, useId, useRef } from 'react';
import { accentFill } from '../lib/accent';
import { Avatar } from './Avatar';
import { PowerupNotes, useNewPowerups } from './game/Powerups';
import { Button, useDialog } from './ui';

export function QueueOverlay() {
  const queue = useStore((s) => s.queue);
  // A dialog while it's up: focus on "Откажи", Escape cancels the search, the lobby behind is out of reach.
  const box = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  useDialog(!!queue, actions.leaveQueue, box, cancel);

  return (
    <AnimatePresence>
      {queue && (
        <motion.div
          ref={box}
          role="dialog"
          aria-modal
          aria-labelledby={titleId}
          className="fixed inset-0 z-50 overflow-y-auto bg-ink/80 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="grid min-h-full place-items-center p-6">
            <Searching queue={queue} cancel={cancel} titleId={titleId} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Every queue is ranked, and a ranked match deals all of them (the server's registry). */
const RANKED_POWERUPS = POWERUPS.map((p) => p.id);

/** The search itself: mounts with each one, so the козове it explains are the ones still new at that moment. */
function Searching({
  queue,
  cancel,
  titleId,
}: {
  queue: QueueStatus;
  cancel: RefObject<HTMLButtonElement | null>;
  titleId: string;
}) {
  const since = useStore((s) => s.queueSince);
  const me = useStore((s) => s.me)!;
  const now = useNow(250);
  const fresh = useNewPowerups(RANKED_POWERUPS, 4000);
  const mode = MODES[queue.mode];
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const botsIn = queue.botFillMs != null ? Math.ceil(queue.botFillMs / 1000) : null;

  return (
    <div className="flex w-full max-w-md flex-col items-center text-center">
      <div className={clsx('relative grid place-items-center', fresh.length ? 'size-36 short:hidden' : 'size-56')}>
        {[0, 0.7, 1.4].map((delay) => (
          <span
            key={delay}
            className={clsx(
              'absolute inset-0 m-auto animate-pulse-ring rounded-full border-2',
              fresh.length ? 'size-20' : 'size-28',
            )}
            style={{ borderColor: mode.accent[0], animationDelay: `${delay}s` }}
          />
        ))}
        <div
          className="absolute inset-8 rounded-full opacity-40 blur-2xl"
          style={{ background: `radial-gradient(circle, ${mode.accent[0]}, transparent 70%)` }}
        />
        <Avatar avatar={me.avatar} frame={me.frame} size={fresh.length ? 72 : 104} />
      </div>

      <div className="mt-4 rounded-full px-3 py-1 text-xs font-bold tracking-widest uppercase" style={accentFill(mode)}>
        {mode.name} · {mode.short}
      </div>
      <h2 id={titleId} className="mt-4 font-display text-2xl font-bold sm:text-3xl">
        Търсим играчи…
      </h2>
      {/* The clock ticks every second: not read out (the seats and the bots below are). */}
      <p aria-hidden className="mt-2 font-mono text-lg text-fg-2 tabular-nums">
        {String(Math.floor(elapsed / 60)).padStart(2, '0')}:{String(elapsed % 60).padStart(2, '0')}
      </p>

      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {Array.from({ length: queue.needed }, (_, i) => (
          <motion.span
            // biome-ignore lint/suspicious/noArrayIndexKey: one placeholder per seat; a seat is its position
            key={i}
            initial={false}
            animate={{ scale: i < queue.found ? 1 : 0.85, opacity: i < queue.found ? 1 : 0.35 }}
            className="grid size-10 place-items-center rounded-full border border-line bg-white/5 text-lg"
            style={i < queue.found ? { borderColor: mode.accent[0], boxShadow: `0 0 16px -4px ${mode.accent[0]}` } : {}}
          >
            {i === 0 ? avatarEmoji(me.avatar) : i < queue.found ? <User className="size-4" /> : '·'}
          </motion.span>
        ))}
      </div>
      {/* Changes only when the server sends news (a seat filled), so it's read out then and stays quiet otherwise. */}
      <div aria-live="polite" className="flex flex-col items-center">
        <p className="mt-3 text-sm text-fg-3">
          {queue.found} от {queue.needed} играчи
        </p>
        {botsIn !== null && queue.found < queue.needed && (
          <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-fg-2">
            <Bot aria-hidden className="size-3.5" />
            {/* "секунди" in full: "След 6 с … с ботове" read as two of the same word. */}
            {botsIn > 0
              ? `След ${plural(botsIn, 'секунда', 'секунди')} местата се попълват с ботове на твоето ниво`
              : 'Ботовете влизат…'}
          </p>
        )}
      </div>

      <Button ref={cancel} variant="secondary" className="mt-8" onClick={actions.leaveQueue}>
        <X aria-hidden className="size-4" /> Откажи
      </Button>

      {/* Ranked matches give everyone all five козове: a newcomer meets them here, with seconds to spare (under
          "Откажи", which stays in reach). */}
      <PowerupNotes powerups={fresh} className="mt-8 w-full" />
    </div>
  );
}
