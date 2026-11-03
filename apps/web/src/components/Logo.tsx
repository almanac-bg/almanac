import { BRAND } from '@almanac/shared';
import clsx from 'clsx';

/**
 * The name with its mark, as the header shows it. A module of its own: the landing, the guides and the class screen
 * draw it without the header's code (the signed-in frame is a file of its own, loaded with the lobby).
 */
export function Logo({ className }: { className?: string }) {
  return (
    <span className={clsx('inline-flex items-center gap-[0.3em] font-display font-black tracking-tight', className)}>
      <Rosette className="h-[0.95em] w-auto shrink-0" />
      <span className="text-fg">{BRAND.name}</span>
    </span>
  );
}

/** The mark's petal (public/favicon.svg), pointing up; the rosette turns it four ways. */
const PETAL = 'M32 30.2C24.5 24.7 21.5 14.7 26 9.9c3.2-3.4 8.8-3.4 12 0 4.5 4.8 1.5 14.8-6 20.3z';

/** The mark without its tile: four answers, one of them right. Its colours follow the theme (--logo-*). */
export function Rosette({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="8.5 8.5 47 47" className={className}>
      {[-45, 45, 135, 225].map((turn) => (
        <path
          key={turn}
          d={PETAL}
          transform={`rotate(${turn} 32 32)`}
          className={turn === -45 ? 'fill-(--logo-gold)' : 'fill-(--logo-petal)'}
        />
      ))}
    </svg>
  );
}
