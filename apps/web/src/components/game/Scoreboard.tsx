import { fmt, type LiveGame } from '@quiz/client';
import { emoteById, type Standing, TEAMS, type TeamId } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Skull } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef } from 'react';
import { useCountUp, useSideScroll } from '../../lib/hooks';
import { useMediaQuery } from '../../lib/media';
import { Avatar, PlayerTag } from '../Avatar';
import { inDropZone } from './elimination';
import { myTeamOf, TeamScoreBar, TeamTotal, teamColor, teamTotals } from './teams';

/* Who stands where during a match: the board beside it on wide screens, the strip of players on phones. */

export function Scoreboard({ game }: { game: LiveGame }) {
  if (game.start.teams) return <TeamScoreboard game={game} />;
  return (
    <div className="glass sticky top-20 rounded-3xl p-3">
      <p className="px-2 pt-1 pb-2 t-eyebrow text-fg-3">Класиране</p>
      <ul className="space-y-1">
        {game.standings.map((s) => (
          <ScoreRow key={s.id} game={game} standing={s} />
        ))}
      </ul>
    </div>
  );
}

function TeamScoreboard({ game }: { game: LiveGame }) {
  const totals = teamTotals(game.standings, game.players);
  const myTeam = myTeamOf(game);
  const leader: TeamId | null = totals[0] === totals[1] ? null : totals[0] > totals[1] ? 0 : 1;
  return (
    <div className="sticky top-20 space-y-3">
      {([0, 1] as TeamId[]).map((team) => {
        const color = teamColor(team);
        const members = game.standings.filter((s) => game.players[s.id]?.team === team);
        return (
          <div key={team} className="glass overflow-hidden rounded-3xl" style={{ borderColor: `${color}44` }}>
            <div
              className="flex items-center gap-2 px-4 py-3"
              style={{ background: `linear-gradient(90deg, ${color}26, transparent 80%)` }}
            >
              <span className="size-2.5 rounded-full" style={{ background: color, boxShadow: `0 0 10px ${color}` }} />
              <span className="font-display text-sm font-bold" style={{ color }}>
                {TEAMS[team].name}
              </span>
              {myTeam === team && <span className="text-xs font-semibold text-fg-3">· твоят отбор</span>}
              {leader === team && <span className="text-sm">👑</span>}
              <TeamTotal value={totals[team]} className="ml-auto t-card" />
            </div>
            <ul className="space-y-1 p-2">
              {members.map((s) => (
                <ScoreRow key={s.id} game={game} standing={s} />
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function ScoreRow({ game, standing: s }: { game: LiveGame; standing: Standing }) {
  const p = game.players[s.id];
  const score = useCountUp(s.score);
  const out = s.eliminatedAt !== null || s.left;
  const me = s.id === game.start.youId;
  const result = game.reveal?.index === game.question?.index ? game.reveal?.results[s.id] : undefined;
  const answered = game.phase === 'question' && game.answered.includes(s.id);
  const reactions = game.reactions.filter((r) => r.playerId === s.id);

  return (
    // Animated when the order changes, not the size (a size animation squeezes the row, which reads as a flicker).
    <motion.li
      layout="position"
      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
      className={clsx(
        'relative flex items-center gap-3 rounded-2xl px-2 py-2',
        me && 'bg-violet-500/12 ring-1 ring-violet-400/30',
      )}
    >
      <span className="w-5 text-center text-sm font-bold text-fg-3 tabular-nums">{out ? '' : s.rank}</span>
      <Avatar avatar={p.avatar} frame={p.frame} size={38} dim={out || !s.connected}>
        {answered && (
          <motion.span
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="absolute -right-1 -bottom-1 grid size-4.5 place-items-center rounded-full bg-emerald-400 text-ink"
          >
            <Check className="size-3" strokeWidth={4} />
          </motion.span>
        )}
      </Avatar>
      <div className={clsx('min-w-0 flex-1 text-sm', out && 'opacity-50')}>
        {me && <span className="sr-only">Ти: </span>}
        <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
      </div>
      <div className="text-right">
        {/* One line's height whatever it holds (a score, "напусна", the skull): a knockout doesn't move the board. */}
        <div className={clsx('flex h-6 items-center justify-end font-bold tabular-nums', out && 'text-fg-3')}>
          {s.left ? (
            'напусна'
          ) : s.eliminatedAt !== null ? (
            <Skull aria-hidden className="size-4 text-rose-300" />
          ) : (
            fmt(score)
          )}
        </div>
        {/* Room for the question's points even before they're in: every row keeps its height through the reveal, so
            the board doesn't grow and shrink (eight rows jumping, twice a question). */}
        <div className="h-4">
          <AnimatePresence>
            {result && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className={clsx(
                  'text-xs leading-4 font-bold tabular-nums',
                  result.correct ? 'text-emerald-300' : 'text-rose-300',
                )}
              >
                {result.correct ? `+${fmt(result.points)}` : result.points < 0 ? `−${fmt(-result.points)}` : '✗'}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
      <Reactions reactions={reactions} />
    </motion.li>
  );
}

function Reactions({ reactions }: { reactions: LiveGame['reactions'] }) {
  return (
    <div className="pointer-events-none absolute top-0 left-10">
      <AnimatePresence>
        {reactions.map((r) => (
          <motion.span
            key={r.key}
            initial={{ opacity: 0, y: 10, scale: 0.4 }}
            animate={{ opacity: [0, 1, 1, 0], y: -46, scale: [0.4, 1.3, 1.1, 1] }}
            transition={{ duration: 2.4, times: [0, 0.15, 0.7, 1] }}
            className="absolute text-2xl"
          >
            {emoteById(r.emote)?.emoji}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export function MobileStrip({ game }: { game: LiveGame }) {
  const teams = game.start.teams;
  const short = useMediaQuery('(max-height: 740px)');
  const strip = useSideScroll<HTMLUListElement>();
  // Who goes out at the next knockout (a ring), and you, kept in view when the row is wider than the screen: last
  // place is at the far end, where the row fades.
  const danger = inDropZone(game);
  const mine = useRef<HTMLLIElement>(null);
  const myRank = game.standings.find((s) => s.id === game.start.youId)?.rank;
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolled when your place changes
  useEffect(() => {
    // The middle, not just inside the edge: the row's far end fades out.
    mine.current?.scrollIntoView({ inline: 'center', block: 'nearest' });
  }, [myRank]);
  // Team games: group teammates together so the colors read as two blocks.
  const order = teams
    ? [...game.standings].sort((a, b) => (game.players[a.id]?.team ?? 0) - (game.players[b.id]?.team ?? 0))
    : game.standings;
  return (
    // Sideways on a phone there's no room for it: the score is in the top bar, the standings come with each reveal.
    <div className="border-b border-line lg:hidden flat:hidden">
      {teams && (
        <div className="px-4 pt-3 sm:hidden">
          <TeamScoreBar totals={teamTotals(game.standings, game.players)} myTeam={myTeamOf(game)} compact />
        </div>
      )}
      {/* Eight players don't all fit on a small phone: the row fades where more of it is hidden, and scrolls from the
          keyboard too. */}
      <ul
        ref={strip.ref}
        aria-label="Класиране"
        tabIndex={strip.scrolls ? 0 : undefined}
        className={clsx(
          'focus-ring flex gap-3 overflow-x-auto px-4 py-3 short:py-2 tiny:py-1.5',
          strip.more && '[mask-image:linear-gradient(90deg,#000_85%,transparent)]',
        )}
      >
        {order.map((s) => {
          const p = game.players[s.id];
          const me = s.id === game.start.youId;
          const out = s.eliminatedAt !== null || s.left;
          const answered = game.phase === 'question' && game.answered.includes(s.id);
          const reactions = game.reactions.filter((r) => r.playerId === s.id);
          const color = teams && p.team !== null ? teamColor(p.team) : null;
          const status = s.left
            ? 'напусна'
            : s.eliminatedAt !== null
              ? 'отпадна'
              : `${s.score} точки${answered ? ', отговори' : ''}`;
          return (
            <motion.li
              layout
              key={s.id}
              ref={me ? mine : undefined}
              className="relative flex shrink-0 flex-col items-center gap-1"
            >
              <span className="sr-only">
                {me ? 'Ти' : p.name}
                {p.isBot && ' (бот)'}: {status}
                {danger === s.id && ', отпада при следващото отпадане'}
              </span>
              <div
                className="relative rounded-full"
                style={
                  color
                    ? { boxShadow: `0 0 0 2px ${color}` }
                    : danger === s.id
                      ? { boxShadow: '0 0 0 2px #fb7185' }
                      : undefined
                }
                aria-hidden
              >
                <Avatar avatar={p.avatar} frame={p.frame} size={short ? 32 : 40} dim={out}>
                  {answered && (
                    <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink bg-emerald-400" />
                  )}
                </Avatar>
                <PlayerMark me={me} bot={p.isBot} />
              </div>
              <span
                className={clsx('text-[11px] font-bold tabular-nums', me ? 'text-violet-300' : 'text-fg-2')}
                aria-hidden
              >
                {out ? '💀' : fmt(s.score)}
              </span>
              {color && <span className="h-0.5 w-6 rounded-full" style={{ background: color }} aria-hidden />}
              <Reactions reactions={reactions} />
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

/** "ТИ" / "БОТ" on an avatar's top edge: who's who without relying on color. */
export function PlayerMark({ me, bot }: { me: boolean; bot: boolean }) {
  if (!me && !bot) return null;
  return (
    <span
      aria-hidden
      className={clsx(
        'absolute -top-1.5 left-1/2 -translate-x-1/2 rounded-md px-1 py-0.5 text-[10px] leading-none font-extrabold tracking-wide',
        me ? 'bg-violet-600 text-white' : 'bg-ink-2 text-fg-2 ring-1 ring-white/20',
      )}
    >
      {me ? 'ТИ' : 'БОТ'}
    </span>
  );
}
