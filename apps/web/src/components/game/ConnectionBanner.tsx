import { useStore } from '@quiz/client';
import clsx from 'clsx';
import { Check, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/**
 * The match screen hides the header (and its "Свързване…" pill), so it says it itself when the link drops — and,
 * for a moment, when it's back. Floats under the top bar so nothing on screen moves when it comes and goes.
 */
export function ConnectionBanner() {
  const connected = useStore((s) => s.connected);
  const [restored, setRestored] = useState(false);
  const dropped = useRef(false);

  useEffect(() => {
    if (!connected) {
      dropped.current = true;
      setRestored(false);
      return;
    }
    if (!dropped.current) return;
    dropped.current = false;
    setRestored(true);
    const hide = setTimeout(() => setRestored(false), 2200);
    return () => clearTimeout(hide);
  }, [connected]);

  const state = !connected ? 'offline' : restored ? 'restored' : null;
  return (
    // The live region stays mounted so the change itself gets announced.
    <div role="status" className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-40 flex justify-center px-4">
      <AnimatePresence mode="wait">
        {state && (
          <motion.p
            key={state}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-xl backdrop-blur-xl',
              state === 'offline'
                ? 'border-rose-400/40 bg-rose-950/85 text-rose-100'
                : 'border-emerald-400/40 bg-emerald-950/85 text-emerald-100',
            )}
          >
            {state === 'offline' ? (
              <>
                <WifiOff className="size-4 shrink-0" aria-hidden />
                Няма връзка — опитваме отново…
              </>
            ) : (
              <>
                <Check className="size-4 shrink-0" aria-hidden />
                Връзката е възстановена
              </>
            )}
          </motion.p>
        )}
      </AnimatePresence>
    </div>
  );
}
