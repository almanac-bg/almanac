import { useStore } from '@quiz/client';
import clsx from 'clsx';
import { RotateCcw, TriangleAlert, WifiOff } from 'lucide-react';
import type { LoadFailure } from '../lib/load';
import { Button } from './ui';

/**
 * A load that failed: what went wrong and a way to try again. `compact` fits inside a card; the default fills a page.
 * Pair it with `useLoad`, which also retries by itself when the connection comes back.
 */
export function LoadError({
  title,
  error,
  onRetry,
  compact,
  className,
}: {
  title: string;
  error: LoadFailure;
  onRetry: () => void;
  compact?: boolean;
  className?: string;
}) {
  const connected = useStore((s) => s.connected);
  const Icon = error.status === 0 || !connected ? WifiOff : TriangleAlert;
  // Offline the request's own message is noise: the connection is the problem, and it's retried by itself.
  const detail = connected ? error.message : 'Няма връзка със сървъра. Ще опитаме отново, щом се върне.';

  if (compact) {
    // Sized by its card, not the screen: in a narrow card the button goes under the text, in a wide one beside it.
    return (
      <div
        role="alert"
        className={clsx('@container rounded-2xl border border-rose-400/20 bg-rose-500/10 p-3', className)}
      >
        <div className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2.5 @md:grid-cols-[auto_minmax(0,1fr)_auto] @md:items-center">
          <Icon aria-hidden className="mt-0.5 size-5 text-rose-300 @md:mt-0" />
          <div className="text-sm">
            <p className="font-semibold text-rose-100">{title}</p>
            <p className="text-xs text-fg-3">{detail}</p>
          </div>
          <Button
            variant="secondary"
            className="col-start-2 row-start-2 justify-self-start @md:col-start-3 @md:row-start-1"
            onClick={onRetry}
          >
            <RotateCcw className="size-4" /> Опитай пак
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className={clsx('grid place-items-center gap-3 py-16 text-center', className)}>
      <span className="grid size-14 place-items-center rounded-2xl bg-rose-500/10 text-rose-300">
        <Icon aria-hidden className="size-7" />
      </span>
      <p className="t-card">{title}</p>
      <p className="max-w-sm text-sm text-fg-3">{detail}</p>
      <Button variant="secondary" className="mt-2" onClick={onRetry}>
        <RotateCcw className="size-4" /> Опитай пак
      </Button>
    </div>
  );
}
