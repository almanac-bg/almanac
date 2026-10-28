import { avatarEmoji, frameById, type GamePlayer, rankFor, titleName } from '@quiz/shared';
import clsx from 'clsx';
import type { ReactNode } from 'react';

export function Avatar({
  avatar,
  frame,
  size = 48,
  className,
  dim,
  children,
}: {
  avatar: string;
  frame: string;
  size?: number;
  className?: string;
  dim?: boolean;
  children?: ReactNode;
}) {
  const f = frameById(frame);
  const ring = Math.max(2, Math.round(size * 0.07));
  return (
    <div
      className={clsx(
        'relative shrink-0 rounded-full transition-[filter,opacity]',
        dim && 'opacity-40 grayscale',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <div className="absolute inset-0 overflow-hidden rounded-full">
        <div
          className={clsx('absolute -inset-1/4', f.animated && 'animate-spin-slow')}
          style={{ background: f.background }}
        />
      </div>
      <div
        className="absolute grid place-items-center rounded-full bg-[radial-gradient(circle_at_30%_25%,#2a2445,#0e0c18_70%)]"
        style={{ inset: ring }}
      >
        <span aria-hidden style={{ fontSize: size * 0.5, lineHeight: 1 }}>
          {avatarEmoji(avatar)}
        </span>
      </div>
      {children}
    </div>
  );
}

export function LevelBadge({ level, className }: { level: number; className?: string }) {
  return (
    <span
      title={`Ниво ${level}`}
      className={clsx(
        // A dark digit: white on this gradient is under 3:1.
        'inline-grid min-w-6 place-items-center rounded-lg bg-[linear-gradient(135deg,#a855f7,#22d3ee)] px-1.5 py-0.5 text-[11px] leading-none font-extrabold text-ink shadow-[0_2px_10px_-2px_rgb(168_85_247/0.7)]',
        className,
      )}
    >
      {level}
    </span>
  );
}

export function RankBadge({ rating, compact }: { rating: number; compact?: boolean }) {
  const tier = rankFor(rating);
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-bold"
      style={{ borderColor: `${tier.color}55`, background: `${tier.color}14`, color: tier.color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: tier.color, boxShadow: `0 0 8px ${tier.color}` }} />
      {tier.name}
      {!compact && <span className="font-semibold text-fg-2 tabular-nums">{rating}</span>}
    </span>
  );
}

/** What a player who isn't a person in the match is: a bot, or a real player's match played back. */
export const machineTag = (p: Pick<GamePlayer, 'isBot' | 'record'>) => (p.isBot ? 'БОТ' : p.record ? 'ЗАПИС' : null);

export function PlayerTag({
  name,
  title,
  level,
  tag,
}: {
  name: string;
  title: string;
  level: number;
  /** БОТ, ЗАПИС (machineTag). */
  tag?: string | null;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5">
        <span className="truncate font-semibold">{name}</span>
        <LevelBadge level={level} />
        {tag && (
          <span className="rounded-md bg-white/10 px-1 py-px text-[10px] font-bold tracking-wide text-fg-2">{tag}</span>
        )}
      </div>
      <div className="truncate text-xs text-fg-3">{titleName(title)}</div>
    </div>
  );
}
