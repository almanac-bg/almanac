import { dismissToast, useStore } from '@quiz/client';
import clsx from 'clsx';
import { AlertTriangle, Info, Sparkles, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { Emoji } from './Emoji';

/** How far a toast has to be swiped to go. */
const SWIPE_PX = 80;

/** Notifications. Screen readers hear them too: errors interrupt, everything else waits its turn. */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:right-5 sm:bottom-5 sm:left-auto sm:items-end"
    >
      <AnimatePresence>
        {toasts.map((t) => (
          // Not a button: toasts leave on their own, a tap (or a swipe, on a phone) just clears one early.
          <motion.div
            layout
            key={t.id}
            onClick={() => dismissToast(t.id)}
            drag="x"
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.7}
            onDragEnd={(_, { offset }) => Math.abs(offset.x) > SWIPE_PX && dismissToast(t.id)}
            role={t.kind === 'error' ? 'alert' : undefined}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, x: 40, scale: 0.95 }}
            className={clsx(
              'glass pointer-events-auto flex w-full max-w-sm cursor-pointer items-start gap-3 rounded-2xl bg-ink-2/90 p-4 text-left shadow-2xl',
              t.kind === 'error' && 'border-rose-400/40',
              t.kind === 'success' && 'border-emerald-400/40',
            )}
          >
            {/* An achievement or an unlock brings its own picture; otherwise a line icon for what kind of news it is. */}
            {t.icon ? (
              <Emoji e={t.icon} size="1.5rem" />
            ) : t.kind === 'error' ? (
              <AlertTriangle aria-hidden className="size-5 shrink-0 text-rose-300" />
            ) : t.kind === 'success' ? (
              <Sparkles aria-hidden className="size-5 shrink-0 text-emerald-300" />
            ) : (
              <Info aria-hidden className="size-5 shrink-0 text-cyan-300" />
            )}
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-xs text-fg-2">{t.body}</span>}
            </span>
            <X aria-hidden className="size-4 shrink-0 text-fg-3" />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
