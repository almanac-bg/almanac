import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { dismissToast, useStore } from '@quiz/client';

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
          // Not a button: toasts leave on their own, a tap just clears one early.
          <motion.div
            layout
            key={t.id}
            onClick={() => dismissToast(t.id)}
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
            <span className="text-xl leading-none" aria-hidden>
              {t.icon ?? (t.kind === 'error' ? '⚠️' : t.kind === 'success' ? '✨' : 'ℹ️')}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{t.title}</span>
              {t.body && <span className="mt-0.5 block text-xs text-fg-2">{t.body}</span>}
            </span>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
