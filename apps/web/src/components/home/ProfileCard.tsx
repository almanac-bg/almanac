import { fmt, unlockPreview, useNow, useStore } from '@quiz/client';
import {
  levelProgress,
  type QueueModeId,
  START_RATING,
  seasonEndsAt,
  seasonKey,
  seasonName,
  TITLES,
  type UnlockRef,
  upcomingUnlocks,
} from '@quiz/shared';
import clsx from 'clsx';
import { Gift, Trophy } from 'lucide-react';
import { Link } from 'react-router';
import { useMediaQuery } from '../../lib/media';
import { Avatar, LevelBadge, RankBadge } from '../Avatar';
import { GuestNudge } from '../ClaimAccount';
import { FitName } from '../FitName';
import { Card, ProgressBar } from '../ui';

export function ProfileCard({ className }: { className?: string }) {
  const me = useStore((s) => s.me)!;
  const progress = levelProgress(me.xp);
  const next = upcomingUnlocks(progress.level, 1)[0];
  const roomy = useMediaQuery('(min-width: 640px)');
  return (
    <Card className={clsx('relative flex flex-col overflow-hidden p-4 sm:p-7', className)}>
      <div className="absolute -top-24 -right-16 size-64 rounded-full bg-violet-600/30 blur-3xl" />
      <div className="relative flex items-center gap-4 sm:gap-5">
        <Avatar avatar={me.avatar} frame={me.frame} size={roomy ? 84 : 56} />
        <div className="min-w-0">
          <p className="text-sm text-fg-3">Здравей,</p>
          {/* Names run to 20 characters: a size down before a second line (see FitName). Half the width on tablets. */}
          <FitName
            name={me.username}
            className="font-display text-xl leading-tight font-bold sm:text-3xl md:text-2xl lg:text-3xl"
          />
          <p className="text-sm text-fg-2">{TITLES.find((t) => t.id === me.title)?.name}</p>
        </div>
      </div>
      {/* Beside the taller daily card (wide screens) the extra height goes here: the level and the chips sit at the
          bottom instead of leaving an empty band under them. */}
      <div className="flex-1" />
      <div className="relative mt-4 sm:mt-6">
        <div className="mb-2 flex items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-2 font-semibold">
            <LevelBadge level={progress.level} /> Ниво {progress.level}
          </span>
          <span className="text-fg-3 tabular-nums">
            {fmt(progress.into)} / {fmt(progress.needed)} XP
          </span>
        </div>
        <ProgressBar value={progress.pct} className="h-2.5" />
      </div>
      {/* Phones keep the daily bonus and the next unlock (what the bar above leads to); the season waits for wider
          screens. */}
      <div
        className={clsx(
          'relative mt-4 flex flex-wrap items-center gap-2 sm:mt-5',
          !me.dailyBonusAvailable && !next && 'max-sm:hidden',
        )}
      >
        {me.dailyBonusAvailable && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-400/15 px-3 py-1 text-xs font-bold text-amber-300">
            <Gift aria-hidden className="size-3.5" /> Първият мач за деня носи +100 XP
          </span>
        )}
        {next && <UpNext unlock={next} />}
        <SeasonChip ratings={me.ratings} className="max-sm:hidden" />
      </div>
      {/* Guests: right under the level it's about — all of this lives on this device until the account is saved. Once
          there's progress worth keeping (level 2: a match or two in), not before the first question. */}
      {progress.level >= 2 && <GuestNudge className="relative mt-4 sm:mt-5" />}
    </Card>
  );
}

function UpNext({ unlock }: { unlock: UnlockRef & { level: number } }) {
  const { icon, name } = unlockPreview(unlock);
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/5 px-2.5 py-1 text-xs text-fg-2 sm:px-3">
      <span className="shrink-0">Ниво {unlock.level}:</span>
      <span aria-hidden className="text-base leading-none">
        {icon}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

function SeasonChip({ ratings, className }: { ratings: Partial<Record<QueueModeId, number>>; className?: string }) {
  const now = useNow(60_000);
  const id = seasonKey(now);
  const days = Math.max(1, Math.ceil((seasonEndsAt(id) - now) / 86_400_000));
  const best = Math.max(START_RATING, ...Object.values(ratings).filter((r): r is number => r !== undefined));
  return (
    <Link
      to="/leaderboard"
      className={clsx(
        'inline-flex items-center gap-2 rounded-full bg-white/5 px-3 py-1 text-xs text-fg-2 hover:bg-white/10',
        className,
      )}
    >
      <Trophy className="size-3.5 text-amber-300" />
      Сезон {seasonName(id)} · още {days} {days === 1 ? 'ден' : 'дни'}
      <RankBadge rating={best} compact />
    </Link>
  );
}
