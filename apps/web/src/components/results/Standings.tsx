import { fmt, type LiveGame, ordinal, plural } from '@quiz/client';
import { type FinalStanding, type GameEndPayload, type MatchRewards, TEAMS, type TeamId } from '@quiz/shared';
import clsx from 'clsx';
import { ChartColumn, Share2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Link } from 'react-router';
import { shareText } from '../../lib/share';
import { Avatar, LevelBadge, machineTag, PlayerTag } from '../Avatar';
import { teamColor } from '../game/teams';
import { challengeShareText } from '../home/challengeLink';
import { Button, Card } from '../ui';
import { FriendButton } from './FriendButton';

/**
 * A challenge link's result, where a match would show its podium: your place among everyone who played the link, and
 * the link to pass on. The first to finish it (usually whoever made it) sets the score the others chase.
 */
export function ChallengeStanding({
  challenge,
  score,
  questions,
  onBoard,
}: {
  challenge: NonNullable<MatchRewards['challenge']>;
  score: number;
  questions: number;
  onBoard: () => void;
}) {
  const first = challenge.total <= 1;
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3, type: 'spring', stiffness: 180, damping: 20 }}
      className="mx-auto mt-8 max-w-xl"
    >
      <Card className="relative overflow-hidden p-6 text-center sm:p-7">
        <div
          aria-hidden
          className="absolute -top-20 left-1/2 size-56 -translate-x-1/2 rounded-full glow text-indigo-400/20"
        />
        {first ? (
          <>
            <h2 className="relative t-card">Сега прати линка</h2>
            <p className="relative mx-auto mt-2 max-w-sm text-sm text-fg-2">
              Всеки, който го отвори, играе същите {questions} въпроса веднъж, без козове. Линкът важи 7 дни.
            </p>
          </>
        ) : (
          <>
            <h2 className="sr-only">Класиране по линка</h2>
            <div className="relative flex items-baseline justify-center gap-2">
              <span
                className={clsx(
                  'font-display text-5xl font-black',
                  challenge.rank === 1 ? 'text-amber-300' : 'text-indigo-300',
                )}
              >
                #{challenge.rank}
              </span>
              <span className="text-fg-2">от {plural(challenge.total, 'играч', 'играчи')}</span>
            </div>
            <p className="relative mt-2 text-xs text-fg-3">Класирането се променя, докато другите играят линка.</p>
          </>
        )}
        <div className="relative mt-5 grid gap-2 sm:flex sm:justify-center sm:gap-3">
          <Button onClick={() => shareText(challengeShareText(challenge.id, score, questions), 'Линкът е копиран')}>
            <Share2 className="size-4" /> Сподели линка
          </Button>
          <Button variant="secondary" onClick={onBoard}>
            <ChartColumn className="size-4" /> Виж класирането
          </Button>
        </div>
      </Card>
    </motion.section>
  );
}

/** The chip PlayerTag shows for bots, for the podium (which doesn't use PlayerTag). */
function MachineTag({ label }: { label: string }) {
  return (
    <span className="shrink-0 rounded-md bg-white/10 px-1 py-px text-[10px] font-bold tracking-wide text-fg-3">
      {label}
    </span>
  );
}

export function Podium({ game, standings }: { game: LiveGame; standings: FinalStanding[] }) {
  const top = standings.slice(0, 3);
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top.length === 2 ? [top[1], top[0]] : top;
  const heights: Record<number, string> = { 1: 'h-36 sm:h-44', 2: 'h-24 sm:h-32', 3: 'h-16 sm:h-24' };
  const medals: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
  const rest = standings.slice(3);

  return (
    <section className="mt-10">
      <div className="flex items-end justify-center gap-2 sm:gap-6">
        {order.map((s) => {
          const p = game.players[s.id];
          const me = s.id === game.start.youId;
          return (
            <motion.div
              key={s.id}
              initial={{ opacity: 0, y: 40 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + (3 - s.placement) * 0.2, type: 'spring', stiffness: 180, damping: 18 }}
              className="flex w-0 max-w-40 min-w-0 flex-1 flex-col items-center"
            >
              {s.placement === 1 && (
                <motion.span
                  initial={{ y: -20, opacity: 0, rotate: -20 }}
                  animate={{ y: 0, opacity: 1, rotate: 0 }}
                  transition={{ delay: 1, type: 'spring' }}
                  className="text-4xl drop-shadow-[0_0_16px_rgb(251_191_36/0.7)]"
                >
                  👑
                </motion.span>
              )}
              <Avatar avatar={p.avatar} frame={p.frame} size={s.placement === 1 ? 84 : 68} dim={s.left} />
              <div
                className={clsx(
                  'mt-2 flex max-w-full items-center gap-1 text-sm font-semibold',
                  me && 'text-violet-300',
                )}
              >
                {p.record ? (
                  // A recording is someone's match: their profile is a tap away.
                  <Link
                    to={`/profile/${encodeURIComponent(p.name)}`}
                    className="focus-ring truncate rounded underline decoration-white/30 underline-offset-2"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="truncate">{p.name}</span>
                )}
                <LevelBadge level={p.level} />
              </div>
              {/* The bot chip goes on the score line: next to the name it would cut the name to a few letters. */}
              <div className="flex items-center gap-1.5 text-xs text-fg-3 tabular-nums">
                {s.left ? 'напусна' : `${fmt(s.score)} т.`}
                {machineTag(p) && <MachineTag label={machineTag(p)!} />}
              </div>
              <FriendButton player={p} youId={game.start.youId} compact={top.length > 2} className="mt-1.5" />
              <div
                className={clsx(
                  'mt-3 grid w-full place-items-start justify-center rounded-t-2xl border border-b-0 border-line pt-3 text-3xl',
                  heights[s.placement],
                  s.placement === 1
                    ? 'bg-[linear-gradient(180deg,rgb(251_191_36/0.3),rgb(251_191_36/0.02))]'
                    : 'bg-[linear-gradient(180deg,rgb(255_255_255/0.08),rgb(255_255_255/0.01))]',
                )}
              >
                {medals[s.placement]}
              </div>
            </motion.div>
          );
        })}
      </div>
      {rest.length > 0 && (
        <Card className="mx-auto mt-0 max-w-xl rounded-t-none p-2">
          {rest.map((s) => {
            const p = game.players[s.id];
            return (
              <div
                key={s.id}
                className={clsx(
                  'flex items-center gap-2 rounded-2xl px-3 py-2 sm:gap-3',
                  s.id === game.start.youId && 'bg-violet-500/12',
                )}
              >
                <span className="w-10 shrink-0 text-sm font-bold whitespace-nowrap text-fg-3">
                  {ordinal(s.placement)}
                </span>
                <Avatar avatar={p.avatar} frame={p.frame} size={34} dim={s.left} />
                <div className="min-w-0 flex-1 text-sm">
                  <PlayerTag name={p.name} title={p.title} level={p.level} tag={machineTag(p)} />
                </div>
                <FriendButton player={p} youId={game.start.youId} compact />
                <span className="text-sm text-fg-2 tabular-nums">
                  {s.left ? 'напусна' : s.eliminatedAt !== null ? `💀 ${s.eliminatedAt}` : fmt(s.score)}
                </span>
              </div>
            );
          })}
        </Card>
      )}
    </section>
  );
}

/** Team games: two columns with totals and members, the winners crowned. */
export function TeamResult({ game, end }: { game: LiveGame; end: GameEndPayload }) {
  const scores = end.teamScores!;
  const winner = scores[0].team;
  const myTeam = game.players[game.start.youId]?.team ?? null;
  return (
    <section className="mt-10 grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
      {([0, 1] as TeamId[]).map((team) => {
        const color = teamColor(team);
        const won = team === winner;
        const total = scores.find((x) => x.team === team)?.score ?? 0;
        const members = end.standings
          .filter((s) => game.players[s.id]?.team === team)
          .sort((a, b) => b.score - a.score);
        return (
          <motion.div
            key={team}
            initial={{ opacity: 0, x: team === 0 ? -30 : 30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.3 + team * 0.12, type: 'spring', stiffness: 180, damping: 20 }}
          >
            <Card
              className={clsx('relative h-full overflow-hidden p-5', !won && 'opacity-85')}
              style={{
                borderColor: won ? `${color}99` : `${color}33`,
                boxShadow: won ? `0 0 48px -16px ${color}` : undefined,
              }}
            >
              <div
                className="absolute -top-16 -right-10 size-48 rounded-full opacity-25 glow"
                style={{ color: color }}
              />
              <div className="relative flex items-start justify-between gap-3">
                <div>
                  <p className="t-card" style={{ color }}>
                    {won && <span className="mr-1.5">👑</span>}
                    {TEAMS[team].name}
                  </p>
                  <p className="text-xs text-fg-3">{myTeam === team ? 'Твоят отбор' : 'Съперници'}</p>
                </div>
                <span className="font-display text-3xl font-black tabular-nums">{fmt(total)}</span>
              </div>
              <div className="relative mt-4 space-y-1.5">
                {members.map((s) => {
                  const p = game.players[s.id];
                  return (
                    <div
                      key={s.id}
                      className={clsx(
                        'flex items-center gap-2 rounded-2xl px-2 py-2 sm:gap-3',
                        s.id === game.start.youId && 'bg-violet-500/12',
                      )}
                    >
                      <Avatar avatar={p.avatar} frame={p.frame} size={36} dim={s.left} />
                      <div className="min-w-0 flex-1 text-sm">
                        <PlayerTag name={p.name} title={p.title} level={p.level} tag={machineTag(p)} />
                      </div>
                      <FriendButton player={p} youId={game.start.youId} compact />
                      <span className="text-sm font-semibold text-fg-2 tabular-nums">
                        {s.left ? 'напусна' : fmt(s.score)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </motion.div>
        );
      })}
    </section>
  );
}
