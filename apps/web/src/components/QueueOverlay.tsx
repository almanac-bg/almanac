import { actions, useNow, useStore } from '@quiz/client';
import { avatarEmoji, MODES } from '@quiz/shared';
import { Bot, User, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Avatar } from './Avatar';
import { Button } from './ui';

export function QueueOverlay() {
  const queue = useStore((s) => s.queue);
  const since = useStore((s) => s.queueSince);
  const me = useStore((s) => s.me)!;
  const now = useNow(250, !!queue);

  const mode = queue ? MODES[queue.mode] : null;
  const elapsed = Math.max(0, Math.floor((now - since) / 1000));
  const botsIn = queue?.botFillMs != null ? Math.ceil(queue.botFillMs / 1000) : null;

  return (
    <AnimatePresence>
      {queue && mode && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center bg-ink/80 p-6 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          <div className="flex w-full max-w-md flex-col items-center text-center">
            <div className="relative grid size-56 place-items-center">
              {[0, 0.7, 1.4].map((delay) => (
                <span
                  key={delay}
                  className="absolute inset-0 m-auto size-28 animate-pulse-ring rounded-full border-2"
                  style={{ borderColor: mode.accent[0], animationDelay: `${delay}s` }}
                />
              ))}
              <div
                className="absolute inset-8 rounded-full opacity-40 blur-2xl"
                style={{ background: `radial-gradient(circle, ${mode.accent[0]}, transparent 70%)` }}
              />
              <Avatar avatar={me.avatar} frame={me.frame} size={104} />
            </div>

            <div
              className="mt-4 rounded-full px-3 py-1 text-xs font-bold tracking-widest text-white uppercase"
              style={{ background: `linear-gradient(90deg, ${mode.accent[0]}, ${mode.accent[1]})` }}
            >
              {mode.name} · {mode.short}
            </div>
            <h2 className="mt-4 font-display text-2xl font-bold sm:text-3xl">Търсим съперници…</h2>
            <p className="mt-2 font-mono text-lg text-fg-2 tabular-nums">
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
                  style={
                    i < queue.found ? { borderColor: mode.accent[0], boxShadow: `0 0 16px -4px ${mode.accent[0]}` } : {}
                  }
                >
                  {i === 0 ? avatarEmoji(me.avatar) : i < queue.found ? <User className="size-4" /> : '·'}
                </motion.span>
              ))}
            </div>
            <p className="mt-3 text-sm text-fg-3">
              {queue.found} от {queue.needed} играчи
            </p>
            {botsIn !== null && queue.found < queue.needed && (
              <p className="mt-4 inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1.5 text-xs text-fg-2">
                <Bot className="size-3.5" />
                {botsIn > 0 ? `Ботове попълват празните места след ${botsIn} с` : 'Ботовете влизат…'}
              </p>
            )}

            <Button variant="secondary" className="mt-8" onClick={actions.leaveQueue}>
              <X className="size-4" /> Откажи
            </Button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
