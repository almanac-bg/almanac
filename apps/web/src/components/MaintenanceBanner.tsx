import { useStore } from '@quiz/client';
import { AnimatePresence, motion } from 'motion/react';
import { Emoji } from './Emoji';

/** While the server restarts for an update: running matches finish, new ones wait a minute or two. */
export function MaintenanceBanner() {
  const message = useStore((s) => s.maintenance);
  return (
    <AnimatePresence>
      {message && (
        <motion.div
          role="status"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          className="overflow-hidden border-b border-amber-400/20 bg-amber-500/10"
        >
          <p className="mx-auto flex max-w-6xl items-center justify-center gap-2 px-4 py-2.5 text-center text-sm font-semibold text-amber-200 sm:px-6">
            <span aria-hidden>
              <Emoji e="🔧" />
            </span>{' '}
            {message}
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
