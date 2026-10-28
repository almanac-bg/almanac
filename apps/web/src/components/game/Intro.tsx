import { fmt, type LiveGame, useNow } from '@quiz/client';
import { categoryById, type GamePlayer, MODES, TEAMS, type TeamId } from '@quiz/shared';
import clsx from 'clsx';
import { Skull } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../../lib/media';
import { sfx } from '../../lib/sound';
import { Avatar, LevelBadge, machineTag, RankBadge } from '../Avatar';
import { PowerupNotesLine, useNewPowerups } from './Powerups';
import { PlayerMark } from './Scoreboard';
import { SCORING_LINE, takeScoringHint } from './scoring';
import { myTeamOf, teamColor } from './teams';

/** Before the first question: the countdown, and who plays whom. */
export function Intro({ game }: { game: LiveGame }) {
  // Козове this player meets for the first time: named here, where nothing is ticking yet.
  const fresh = useNewPowerups(game.start.powerups, null);
  // Once per match (the countdown screen mounts once): the first few matches spell out how points are counted. One
  // note at a time, so the countdown stays on a small phone's screen: new козове first, the scoring waits a match.
  const [scoring] = useState(() => !fresh.length && takeScoringHint());
  const now = useNow(100);
  const left = Math.max(0, Math.ceil((game.countdownEndsAt - now) / 1000));
  const lastLeft = useRef(left);
  useEffect(() => {
    if (left !== lastLeft.current) {
      if (left > 0) sfx.countdown();
      else sfx.go();
      lastLeft.current = left;
    }
  }, [left]);

  const players = game.start.players;
  const mode = MODES[game.start.mode];
  const category = categoryById(game.start.category);
  const me = players.find((p) => p.id === game.start.youId)!;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      // The countdown is the only thing on screen: in the middle of it.
      className="flex min-h-[55dvh] flex-col items-center justify-center py-8 text-center"
    >
      <p className="t-eyebrow text-fg-3">{game.start.duelWith ? 'Дуел с приятел' : mode.name}</p>
      {players.length === 1 ? (
        <div className="mt-8 flex flex-col items-center">
          <motion.span initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} className="text-7xl">
            {game.start.duelWith ? '⚔️' : game.start.mode === 'daily' ? '🗓️' : category?.icon}
          </motion.span>
          <h1 className="mt-4 font-display text-3xl font-bold">
            {game.start.duelWith
              ? `Дуел с ${game.start.duelWith.username}`
              : game.start.mode === 'daily'
                ? 'Въпросите на деня'
                : category?.name}
          </h1>
          {game.start.duelWith && (
            <p className="mt-2 font-semibold text-amber-200">
              {game.start.duelWith.score !== null
                ? `${fmt(game.start.duelWith.score)} точки за биене`
                : `Играеш пръв — ${game.start.duelWith.username} има 24 часа да те бие`}
            </p>
          )}
          <p className="mt-2 text-fg-3">
            {game.start.totalQuestions} въпроса · {game.start.timeMs / 1000} секунди за всеки
            {(game.start.mode === 'daily' || game.start.mode === 'challenge') && ' · без козове'}
          </p>
        </div>
      ) : game.start.teams ? (
        <TeamsVersus game={game} />
      ) : players.length === 2 ? (
        <Versus a={me} b={players.find((p) => p.id !== me.id)!} />
      ) : (
        <div className="mt-8 grid max-w-2xl grid-cols-4 gap-4 sm:gap-6">
          {players.map((p, i) => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 30, scale: 0.6 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: 0.1 + i * 0.12, type: 'spring', stiffness: 300, damping: 18 }}
              className="flex flex-col items-center gap-2"
            >
              <div className="relative">
                <Avatar avatar={p.avatar} frame={p.frame} size={64} />
                <PlayerMark me={p.id === me.id} tag={machineTag(p)} />
              </div>
              <span className={clsx('max-w-20 truncate text-xs font-semibold', p.id === me.id && 'text-violet-300')}>
                {p.name}
              </span>
            </motion.div>
          ))}
        </div>
      )}
      {game.rounds.length > 0 && <RoundsPlan game={game} />}
      {scoring && <p className="mt-6 max-w-sm text-sm text-balance text-fg-2">{SCORING_LINE}</p>}
      <PowerupNotesLine powerups={fresh} className="mt-6 max-w-md" />
      {game.start.eliminationSchedule.length > 0 && (
        <p className="mt-8 inline-flex items-center gap-2 rounded-full bg-rose-500/10 px-4 py-2 text-sm text-rose-200">
          <Skull className="size-4" /> Последният отпада след въпроси {game.start.eliminationSchedule.join(', ')}
        </p>
      )}
      <AnimatePresence mode="popLayout">
        <motion.div
          key={left}
          initial={{ scale: 2.2, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.5, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 20 }}
          className="mt-10 animate-shimmer font-display text-8xl font-black text-gradient"
        >
          {left > 0 ? left : 'Старт!'}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function Versus({ a, b }: { a: GamePlayer; b: GamePlayer }) {
  // Two 120px avatars and the "VS" between them don't fit the narrowest phones; there the name is smaller and gets the
  // level's room too (the rank under it says more about the opponent).
  const roomy = useMediaQuery('(min-width: 360px)');
  const side = (p: GamePlayer, dir: 1 | -1) => (
    <motion.div
      initial={{ x: -120 * dir, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.1 }}
      className="flex w-36 min-w-0 flex-col items-center gap-3 sm:w-48"
    >
      <Avatar avatar={p.avatar} frame={p.frame} size={roomy ? 120 : 88} />
      <div className="flex max-w-full items-center gap-1.5">
        <span className={clsx('min-w-0 truncate font-display font-bold', !roomy && 'text-sm')}>{p.name}</span>
        {roomy && <LevelBadge level={p.level} className="shrink-0" />}
      </div>
      {p.rating !== null && <RankBadge rating={p.rating} />}
      {p.isBot && <span className="text-xs text-fg-3">БОТ</span>}
      {p.record && (
        <span className="text-xs text-balance text-fg-3">
          ЗАПИС · мач от {new Date(p.record.playedAt).toLocaleDateString('bg-BG', { day: 'numeric', month: 'long' })}
        </span>
      )}
      {p.isBot && !!p.strong?.length && (
        <span className="text-xs text-balance text-fg-2">
          силен в {p.strong.map((c) => `${categoryById(c)?.icon} ${categoryById(c)?.name}`).join(', ')}
        </span>
      )}
    </motion.div>
  );
  return (
    <div className="mt-8 flex max-w-full items-start gap-3 sm:gap-10">
      {side(a, 1)}
      <VsMark />
      {side(b, -1)}
    </div>
  );
}

/** A match in rounds: the first round's category now, who picks the others, and the final. */
function RoundsPlan({ game }: { game: LiveGame }) {
  const first = categoryById(game.rounds[0].category ?? '');
  return (
    <p className="mt-6 max-w-md text-sm text-balance text-fg-2">
      Рунд 1:{' '}
      <span className="font-semibold text-fg">
        {first?.icon} {first?.name}
      </span>
      . Категорията на следващите {game.rounds.length - 1} избира изоставащият. Накрая — финал с число.
    </p>
  );
}

function VsMark() {
  return (
    <motion.span
      initial={{ scale: 4, opacity: 0, rotate: -15 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ delay: 0.45, type: 'spring', stiffness: 300, damping: 14 }}
      className="mt-8 shrink-0 font-display text-5xl font-black text-fuchsia-400 italic drop-shadow-[0_0_24px_rgb(232_121_249/0.7)] sm:text-6xl"
    >
      VS
    </motion.span>
  );
}

/** Two team columns sliding in from the sides, "VS" slamming in between. */
function TeamsVersus({ game }: { game: LiveGame }) {
  const myTeam = myTeamOf(game);
  const column = (team: TeamId, dir: 1 | -1) => {
    const members = game.start.players.filter((p) => p.team === team);
    const color = teamColor(team);
    return (
      <motion.div
        initial={{ x: -120 * dir, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.1 }}
        className="flex w-36 min-w-0 flex-col items-center gap-4 sm:w-52"
      >
        <span
          className="max-w-full rounded-full border px-3 py-1 text-center font-display text-sm font-bold"
          style={{ color, borderColor: `${color}66`, background: `${color}18`, boxShadow: `0 0 24px -8px ${color}` }}
        >
          {TEAMS[team].name}
          {myTeam === team && <span className="ml-1.5 font-sans text-xs font-semibold text-fg-2">· твоят отбор</span>}
        </span>
        {members.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.25 + i * 0.12, type: 'spring', stiffness: 300, damping: 18 }}
            className="flex flex-col items-center gap-1.5"
          >
            <div className="rounded-full p-0.5" style={{ boxShadow: `0 0 0 2px ${color}, 0 0 28px -6px ${color}` }}>
              <Avatar avatar={p.avatar} frame={p.frame} size={72} />
            </div>
            <span
              className={clsx(
                'flex max-w-full items-center gap-1 text-sm font-semibold',
                p.id === game.start.youId && 'text-violet-300',
              )}
            >
              <span className="truncate">{p.name}</span>
              <LevelBadge level={p.level} />
            </span>
          </motion.div>
        ))}
      </motion.div>
    );
  };
  return (
    <div className="mt-8 flex max-w-full items-start gap-3 sm:gap-10">
      {column(0, 1)}
      <div className="shrink-0 self-center">
        <VsMark />
      </div>
      {column(1, -1)}
    </div>
  );
}
