import { actions, fmt, toast, useStore } from '@quiz/client';
import { levelProgress, MODES, type QueueModeId, START_RATING, SUBMISSION_RULES } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, DoorOpen } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ChallengeCard } from '../components/home/ChallengeCard';
import { CommunityCard } from '../components/home/CommunityCard';
import { DailyCard } from '../components/home/DailyCard';
import { EmailNudge } from '../components/home/EmailNudge';
import { FriendsCard } from '../components/home/FriendsCard';
import { ModeCard, RankInfo, SoloPicker } from '../components/home/ModeCard';
import { useOpenQueues } from '../components/home/openQueues';
import { ProfileCard } from '../components/home/ProfileCard';
import { QuestsCard } from '../components/home/QuestsCard';
import { usePageTitle } from '../lib/title';

/** Below this the "N играят в момента" count reads as an empty room rather than a busy one, so it stays hidden. */
const LIVE_COUNT_MIN = 5;

export function HomePage() {
  usePageTitle(null);
  const me = useStore((s) => s.me)!;
  const lobby = useStore((s) => s.lobby);
  const room = useStore((s) => s.room);
  const [soloOpen, setSoloOpen] = useState(false);
  const [rankInfo, setRankInfo] = useState<{ mode: QueueModeId; open: boolean } | null>(null);
  const level = levelProgress(me.xp).level;
  // Brand-new players get pointed at the gentlest way in (one pointer: two would leave them choosing again).
  const newcomer = level === 1;
  // The first levels meet the daily first, beside who they are: it works with nobody else online and it's the same ten
  // questions for all of Bulgaria. Friends come further down (there's nobody to add yet).
  const starter = level <= 2;
  // Writing questions opens at level 3; until then the card would only hold a disabled button.
  const community = level >= SUBMISSION_RULES.minLevel || me.isAdmin;
  // Only the ranked queues the server has open (a closed one would only refuse the player).
  const ranked = useOpenQueues();

  async function queue(mode: QueueModeId) {
    const res = await actions.joinQueue(mode);
    if (!res.ok) toast({ kind: 'error', title: res.error });
  }

  return (
    <div className="space-y-6">
      {room && (
        // A link (it goes somewhere), like the bar of a match in progress.
        <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}>
          <Link
            to="/room"
            className="glass focus-ring flex w-full flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border-fuchsia-400/30 px-5 py-3 text-left"
          >
            <DoorOpen aria-hidden className="size-5 text-fuchsia-300" />
            <span className="text-sm">
              Ти си в стая <b className="font-mono tracking-widest">{room.code}</b>
            </span>
            <span className="ml-auto inline-flex items-center gap-1 text-sm font-semibold text-fuchsia-300">
              Към стаята <ArrowRight aria-hidden className="size-4" />
            </span>
          </Link>
        </motion.div>
      )}

      <EmailNudge />

      {/* Phones read top to bottom: who you are, what to play, today's daily and quests, then friends and the rest.
          From tablets up (md) the same pieces form a grid with the modes across the middle and "today" under them. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2 md:gap-x-4 md:gap-y-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ProfileCard className="md:col-start-1 md:row-start-1" />
        {starter && <DailyCard className="md:col-start-2 md:row-start-1" />}

        <section aria-labelledby="modes-title" className="md:col-span-2 md:row-start-2">
          <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
            <h2 id="modes-title" className="t-section">
              Избери битка
            </h2>
            {lobby && lobby.inGame >= LIVE_COUNT_MIN && (
              <span className="text-sm text-fg-3">
                <span className="text-fg-2">{fmt(lobby.inGame)}</span> играят в момента
              </span>
            )}
          </div>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <ModeCard
              mode={MODES.solo}
              className={clsx(
                'sm:col-span-2',
                ranked.length ? 'lg:col-span-1' : 'lg:col-span-3',
                ranked.length > 1 && 'lg:row-span-2',
              )}
              big
              starter={newcomer}
              onPlay={() => setSoloOpen(true)}
            />
            {ranked.map((id, i) => (
              <ModeCard
                key={id}
                mode={MODES[id]}
                className={queueSpan(i, ranked.length)}
                searching={lobby?.queues[id] ?? 0}
                rating={me.ratings[id] ?? START_RATING}
                onRankInfo={() => setRankInfo({ mode: id, open: true })}
                onPlay={() => queue(id)}
              />
            ))}
          </div>
        </section>

        {!starter && <DailyCard className="md:col-start-1 md:row-start-3" />}
        <QuestsCard className="md:col-start-2 md:row-start-3" />
        <ChallengeCard className={clsx('md:col-start-1 md:row-start-4', !community && 'md:col-span-2')} />
        <FriendsCard className={starter ? 'md:col-start-1 md:row-start-3' : 'md:col-start-2 md:row-start-1'} />
        {community && <CommunityCard className="md:col-start-2 md:row-start-4" />}
      </div>

      <SoloPicker open={soloOpen} onClose={() => setSoloOpen(false)} />
      {rankInfo && (
        <RankInfo mode={rankInfo.mode} open={rankInfo.open} onClose={() => setRankInfo({ ...rankInfo, open: false })} />
      )}
    </div>
  );
}

/**
 * Grid spans for the i-th of n open ranked modes, so the grid has no holes however many are open.
 * Tablets (2 columns, Соло across the top): they pair up, an odd last one takes a whole row.
 * Desktops (3 columns, Соло down the left): one or two go wide beside it; more pair up, an odd last one wide —
 * with all five, the last runs the full width under Соло.
 */
function queueSpan(i: number, n: number) {
  const last = i === n - 1;
  return clsx(
    n % 2 === 1 && last && 'sm:col-span-2',
    (n <= 2 || (n === 3 && last)) && 'lg:col-span-2',
    n === 5 && last && 'lg:col-span-3',
  );
}
