import { useStore } from '@quiz/client';
import clsx from 'clsx';
import { Check, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';

/** A blip shorter than this (or the first connect after a page load) isn't worth a banner. */
const GRACE_MS = 1500;

/**
 * A lost connection, said plainly on every page (the header's dot on the avatar is easy to miss, and the match screen
 * has no header) — and, for a moment, that it's back. Floats under the top bar so nothing on screen moves when it
 * comes and goes. `explained`: the page already says why (the update banner), so this keeps quiet.
 */
export function ConnectionBanner({ explained = false }: { explained?: boolean }) {
  // A link gone quiet reads as lost too: the socket would only notice when its ping times out, with the match going on.
  const connected = useStore((s) => s.connected && !s.stalled);
  const stalled = useStore((s) => s.connected && s.stalled);
  const [banner, setBanner] = useState<'offline' | 'restored' | null>(null);
  const shown = useRef(false);

  useEffect(() => {
    if (explained) {
      shown.current = false;
      return setBanner(null);
    }
    if (!connected) {
      setBanner((b) => (b === 'restored' ? null : b));
      const show = setTimeout(() => {
        shown.current = true;
        setBanner('offline');
      }, GRACE_MS);
      return () => clearTimeout(show);
    }
    if (!shown.current) return;
    shown.current = false;
    setBanner('restored');
    const hide = setTimeout(() => setBanner(null), 2200);
    return () => clearTimeout(hide);
  }, [connected, explained]);

  return (
    // The live region stays mounted so the change itself gets announced. `data-connection` is for the browser tests.
    <div
      role="status"
      data-connection={connected ? 'up' : stalled ? 'stalled' : 'down'}
      className="pointer-events-none fixed inset-x-0 top-[4.5rem] z-40 flex justify-center px-4"
    >
      <AnimatePresence mode="wait">
        {banner && (
          <motion.p
            key={banner}
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className={clsx(
              'inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-xl backdrop-blur-xl',
              banner === 'offline'
                ? 'border-rose-400/40 bg-rose-950/85 text-rose-100'
                : 'border-emerald-400/40 bg-emerald-950/85 text-emerald-100',
            )}
          >
            {banner === 'offline' ? (
              <>
                <WifiOff className="size-4 shrink-0" aria-hidden />
                {stalled ? 'Връзката прекъсва — чакаме сървъра…' : 'Няма връзка — опитваме отново…'}
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
