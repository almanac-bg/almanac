import { dismissToast, type Toast, useStore } from '@quiz/client';
import clsx from 'clsx';
import { AlertTriangle, Info, Sparkles, X } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { useEffect, useRef } from 'react';
import { Emoji } from './Emoji';

/** How far a toast has to be swiped to go. */
const SWIPE_PX = 80;

/**
 * Notifications. Screen readers hear them in two regions, both always there (a region that appears with its content
 * isn't announced): errors interrupt, everything else waits its turn.
 */
export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[60] flex flex-col items-center gap-2 px-4 sm:top-auto sm:right-5 sm:bottom-5 sm:left-auto sm:items-end">
      <Region role="alert" toasts={toasts.filter((t) => t.kind === 'error')} />
      <Region role="status" toasts={toasts.filter((t) => t.kind !== 'error')} />
    </div>
  );
}

function Region({ role, toasts }: { role: 'alert' | 'status'; toasts: Toast[] }) {
  return (
    <div role={role} className="flex w-full flex-col items-center gap-2 empty:hidden sm:items-end">
      <AnimatePresence>
        {toasts.map((t) => (
          <ToastCard key={t.id} toast={t} />
        ))}
      </AnimatePresence>
    </div>
  );
}

/** One toast: it leaves by itself after its time, which stands still while it's pointed at or focused. */
function ToastCard({ toast: t }: { toast: Toast }) {
  const left = useRef(t.ttlMs);
  const since = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = () => {
    if (timer.current) return;
    since.current = Date.now();
    timer.current = setTimeout(() => dismissToast(t.id), left.current);
  };
  const pause = () => {
    if (!timer.current) return;
    clearTimeout(timer.current);
    timer.current = null;
    left.current = Math.max(1_000, left.current - (Date.now() - since.current));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: started once per toast; pause/run keep their own state
  useEffect(() => {
    run();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  return (
    // Not a button itself: a tap (or a swipe, on a phone) clears it early; the × is the button for keyboards.
    <m.div
      layout
      onClick={() => dismissToast(t.id)}
      onPointerEnter={pause}
      onPointerLeave={run}
      onFocus={pause}
      onBlur={run}
      drag="x"
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={(_, { offset }) => Math.abs(offset.x) > SWIPE_PX && dismissToast(t.id)}
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
      <button
        type="button"
        aria-label="Затвори"
        onClick={(e) => {
          e.stopPropagation();
          dismissToast(t.id);
        }}
        className="focus-ring -m-2 grid size-8 shrink-0 place-items-center rounded-lg text-fg-3 hover:text-fg pointer-coarse:size-11"
      >
        <X aria-hidden className="size-4" />
      </button>
    </m.div>
  );
}
