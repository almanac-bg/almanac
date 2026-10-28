import { actions, fmt, toast, useStore } from '@quiz/client';
import { levelProgress, MODES, type QueueModeId, START_RATING, SUBMISSION_RULES } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, DoorOpen, Swords } from 'lucide-react';
import { motion } from 'motion/react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useDuels, usePlayDuel } from '../components/duels';
import { ChallengeCard } from '../components/home/ChallengeCard';
import { CommunityCard } from '../components/home/CommunityCard';
import { DailyCard } from '../components/home/DailyCard';
import { EmailNudge } from '../components/home/EmailNudge';
import { FriendsCard } from '../components/home/FriendsCard';
import { ModeCard, RankInfo, SoloPicker } from '../components/home/ModeCard';
import { useOpenQueues } from '../components/home/openQueues';
import { ProfileCard } from '../components/home/ProfileCard';
import { QuestsCard } from '../components/home/QuestsCard';
import { Button } from '../components/ui';
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
  // Brand-new players get pointed at one way in (two would leave them choosing again): a duel, which the gentle bots of
  // the first matches make a likely first win; Соло where no duel queue is open. The modes come right after who they
  // are, on every screen: the first Play button is on the first screen.
  const newcomer = level === 1;
  // Someone who has played before and not yet today: the day's questions first, on phones (wider screens show more).
  const dailyFirst = !me.daily.played && me.stats.games > 0;
  // The first levels have nobody to add yet: on wide screens the profile runs across the top on its own (a short row,
  // so the modes are on the first screen too) and the friends go further down.
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

      <DuelTurn />
      <EmailNudge />

      {/* Phones read top to bottom: who you are, what to play, today's daily and quests, then friends and the rest.
          From tablets up (md) the same pieces form a grid with the modes across the middle and "today" under them. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-2 md:gap-x-4 md:gap-y-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ProfileCard className={clsx('md:col-start-1 md:row-start-1', starter && 'md:col-span-2')} />

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
              starter={newcomer && !ranked.includes('duel')}
              onPlay={() => setSoloOpen(true)}
            />
            {ranked.map((id, i) => (
              <ModeCard
                key={id}
                mode={MODES[id]}
                className={queueSpan(i, ranked.length)}
                searching={lobby?.queues[id] ?? 0}
                rating={me.ratings[id] ?? START_RATING}
                starter={newcomer && id === 'duel'}
                onRankInfo={() => setRankInfo({ mode: id, open: true })}
                onPlay={() => queue(id)}
              />
            ))}
          </div>
        </section>

        <DailyCard className={clsx('md:col-start-1 md:row-start-3', dailyFirst && 'max-md:order-first')} />
        <QuestsCard className="md:col-start-2 md:row-start-3" />
        <ChallengeCard className={clsx('md:col-start-1 md:row-start-4', !community && !starter && 'md:col-span-2')} />
        <FriendsCard className={starter ? 'md:col-start-2 md:row-start-4' : 'md:col-start-2 md:row-start-1'} />
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

/** A friend duel waiting for you: at the top, a tap from playing it (the first of them, if there are more). */
function DuelTurn() {
  const guest = useStore((s) => !!s.me?.isGuest);
  const { data } = useDuels(!guest);
  const { playing, play } = usePlayDuel();
  const yours = (data?.duels ?? []).filter((d) => d.state === 'yours');
  if (!yours.length) return null;
  const [first] = yours;
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 rounded-2xl border border-amber-300/30 bg-amber-400/[0.08] px-4 py-3"
    >
      <Swords aria-hidden className="size-5 shrink-0 text-amber-300" />
      <p className="min-w-0 flex-1 text-sm">
        <b>{first.friend.username}</b> те предизвика на дуел
        {first.theirs && <span className="text-fg-2"> · {fmt(first.theirs.score)} т. за биене</span>}
        {yours.length > 1 && <span className="text-fg-3"> (и още {yours.length - 1})</span>}
      </p>
      <Button size="sm" onClick={() => play(first.id)} loading={playing === first.id}>
        Играй
      </Button>
    </motion.div>
  );
}
