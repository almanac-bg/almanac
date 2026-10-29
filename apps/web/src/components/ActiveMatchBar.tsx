import { useStore } from '@quiz/client';
import { ChevronRight } from 'lucide-react';
import { AnimatePresence, m } from 'motion/react';
import { Link } from 'react-router';

/** Shown on every other page while a match is still running (e.g. after the back button): one tap returns to it. */
export function ActiveMatchBar() {
  const live = useStore((s) => !!s.game && s.game.phase !== 'ended');
  return (
    <AnimatePresence>
      {live && (
        <m.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-violet-400/25 bg-violet-500/15"
        >
          <Link
            to="/game"
            className="mx-auto flex min-h-11 max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-center text-sm font-bold text-violet-100 sm:px-6"
          >
            <span className="relative flex size-2.5" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex size-2.5 rounded-full bg-rose-400" />
            </span>
            Мачът тече — върни се в играта
            <ChevronRight className="size-4" aria-hidden />
          </Link>
        </m.div>
      )}
    </AnimatePresence>
  );
}
