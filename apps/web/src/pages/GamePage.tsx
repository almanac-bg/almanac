import {
  categoryById,
  emoteById,
  type GamePlayer,
  MODES,
  POWERUPS,
  type PowerupId,
  type Standing,
  type TeamId,
  TEAMS,
  TIME_BONUS_MS,
} from '@quiz/shared';
import clsx from 'clsx';
import { Check, Flame, Skull, Users, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Navigate } from 'react-router';
import { Avatar, LevelBadge, PlayerTag, RankBadge } from '../components/Avatar';
import { TeamScoreBar, TeamTotal, teamColor, teamTotals } from '../components/game/teams';
import { Button, Modal } from '../components/ui';
import { actions, DIFFICULTY_LABEL, fmt, type LiveGame, useNow, useStore } from '@quiz/client';
import { useCountUp } from '../lib/hooks';
import { sfx } from '../lib/sound';
import { Results } from './Results';

const LETTERS = ['А', 'Б', 'В', 'Г'];
const OPTION_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6'];

export function GamePage() {
  const game = useStore((s) => s.game);
  if (!game) return <Navigate to="/" replace />;
  if (game.phase === 'ended' && game.end) return <Results game={game} />;
  return <Arena game={game} />;
}

const myTeamOf = (game: LiveGame): TeamId | null => game.players[game.start.youId]?.team ?? null;

function Arena({ game }: { game: LiveGame }) {
  const [leaving, setLeaving] = useState(false);
  const single = game.start.players.length === 1;
  const meEliminated = game.eliminated.includes(game.start.youId);

  // Keyboard: 1-4 answer.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= 4) actions.answer(n - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="flex min-h-dvh flex-col">
      <TopBar game={game} onLeave={() => setLeaving(true)} />
      {!single && <MobileStrip game={game} />}

      <div
        className={clsx(
          'mx-auto grid w-full max-w-6xl flex-1 gap-6 px-4 pt-4 pb-28 sm:px-6',
          !single && 'lg:grid-cols-[minmax(0,1fr)_320px]',
        )}
      >
        <div className="relative min-w-0">
          <AnimatePresence mode="wait">
            {game.phase === 'countdown' ? (
              <Intro key="intro" game={game} />
            ) : game.question ? (
              <QuestionView key={`q${game.question.index}`} game={game} />
            ) : (
              <motion.div key="wait" className="grid place-items-center py-32 text-fg-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                Следващият въпрос идва…
              </motion.div>
            )}
          </AnimatePresence>
          <Feed game={game} />
        </div>
        {!single && (
          <aside className="hidden lg:block">
            <Scoreboard game={game} />
          </aside>
        )}
      </div>

      {!single && <EmoteBar emotes={game.start.emotes} />}
      <EliminationBanner game={game} />
      {meEliminated && game.phase !== 'countdown' && (
        <div className="fixed inset-x-0 bottom-20 z-30 mx-auto w-fit rounded-full border border-rose-400/30 bg-rose-500/15 px-4 py-2 text-sm text-rose-200 backdrop-blur">
          💀 Отпадна — гледаш като зрител
        </div>
      )}

      <Modal open={leaving} onClose={() => setLeaving(false)} title="Да напуснеш ли мача?">
        <p className="text-fg-2">
          {game.start.mode === 'daily'
            ? 'Днешният опит ще се зачете с точките досега — нов опит има чак утре.'
            : game.start.ranked
              ? 'Оставаш на последно място и губиш рейтинг.'
              : 'Прогресът от този мач няма да се зачете.'}
        </p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setLeaving(false)}>
            Остани
          </Button>
          <Button variant="danger" onClick={actions.leaveGame}>
            Напусни
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ─── Top bar ───────────────────────────────────────────────────────────────

function TopBar({ game, onLeave }: { game: LiveGame; onLeave: () => void }) {
  const mode = MODES[game.start.mode];
  const me = game.standings.find((s) => s.id === game.start.youId);
  const score = useCountUp(me?.score ?? 0);
  const q = game.question;
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/70 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
        <button
          onClick={onLeave}
          aria-label="Напусни мача"
          className="focus-ring grid size-9 place-items-center rounded-xl text-fg-3 hover:bg-white/5 hover:text-fg"
        >
          <X className="size-5" />
        </button>
        <span
          className="rounded-full px-2.5 py-0.5 text-[11px] font-extrabold tracking-wider whitespace-nowrap text-white uppercase"
          style={{ background: `linear-gradient(90deg, ${mode.accent[0]}, ${mode.accent[1]})` }}
        >
          {game.start.mode === 'daily' ? 'Днес' : mode.name}
        </span>
        {game.start.teams ? (
          <div className="mx-auto hidden sm:block">
            <TeamScoreBar totals={teamTotals(game.standings, game.players)} myTeam={myTeamOf(game)} />
          </div>
        ) : (
          q && (
            <div className="hidden items-center gap-1 sm:flex" aria-label={`Въпрос ${q.index + 1} от ${q.total}`}>
              {Array.from({ length: q.total }, (_, i) => (
                <span
                  key={i}
                  className={clsx(
                    'h-1.5 rounded-full transition-all',
                    i < q.index ? 'w-3 bg-violet-400/70' : i === q.index ? 'w-6 bg-white' : 'w-3 bg-white/15',
                    game.start.eliminationSchedule.includes(i + 1) && i >= q.index && 'bg-rose-400/50',
                  )}
                />
              ))}
            </div>
          )
        )}
        {q && <span className="text-sm font-semibold text-fg-2 tabular-nums sm:hidden">{q.index + 1}/{q.total}</span>}
        <div className="ml-auto flex items-center gap-3">
          {me && me.streak >= 2 && (
            <motion.span
              key={me.streak}
              initial={{ scale: 1.4 }}
              animate={{ scale: 1 }}
              className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300"
            >
              <Flame className="size-4" /> {me.streak}
            </motion.span>
          )}
          <span className="font-display text-xl font-bold tabular-nums">{fmt(score)}</span>
        </div>
      </div>
    </header>
  );
}

// ─── Intro / countdown ─────────────────────────────────────────────────────

function Intro({ game }: { game: LiveGame }) {
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
      className="flex flex-col items-center py-8 text-center sm:py-12"
    >
      <p className="text-xs font-bold tracking-[0.3em] text-fg-3 uppercase">{mode.name}</p>
      {players.length === 1 ? (
        <div className="mt-8 flex flex-col items-center">
          <motion.span initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} className="text-7xl">
            {game.start.mode === 'daily' ? '📅' : category?.icon}
          </motion.span>
          <h2 className="mt-4 font-display text-3xl font-bold">{game.start.mode === 'daily' ? 'Въпросите на деня' : category?.name}</h2>
          <p className="mt-2 text-fg-3">
            {game.start.totalQuestions} въпроса · {game.start.timeMs / 1000} секунди за всеки
            {game.start.mode === 'daily' && ' · без жокери'}
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
              <Avatar avatar={p.avatar} frame={p.frame} size={64} />
              <span className={clsx('max-w-20 truncate text-xs font-semibold', p.id === me.id && 'text-violet-300')}>
                {p.name}
              </span>
            </motion.div>
          ))}
        </div>
      )}
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
          className="mt-10 font-display text-8xl font-black text-gradient"
        >
          {left > 0 ? left : 'Старт!'}
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}

function Versus({ a, b }: { a: GamePlayer; b: GamePlayer }) {
  const side = (p: GamePlayer, dir: 1 | -1) => (
    <motion.div
      initial={{ x: -120 * dir, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 160, damping: 18, delay: 0.1 }}
      className="flex w-36 flex-col items-center gap-3 sm:w-48"
    >
      <Avatar avatar={p.avatar} frame={p.frame} size={120} />
      <div className="flex items-center gap-1.5">
        <span className="max-w-32 truncate font-display font-bold">{p.name}</span>
        <LevelBadge level={p.level} />
      </div>
      {p.rating !== null && <RankBadge rating={p.rating} />}
      {p.isBot && <span className="text-xs text-fg-3">БОТ</span>}
    </motion.div>
  );
  return (
    <div className="mt-8 flex items-start gap-4 sm:gap-10">
      {side(a, 1)}
      <VsMark />
      {side(b, -1)}
    </div>
  );
}

function VsMark() {
  return (
    <motion.span
      initial={{ scale: 4, opacity: 0, rotate: -15 }}
      animate={{ scale: 1, opacity: 1, rotate: 0 }}
      transition={{ delay: 0.45, type: 'spring', stiffness: 300, damping: 14 }}
      className="mt-8 font-display text-5xl font-black text-fuchsia-400 italic drop-shadow-[0_0_24px_rgb(232_121_249/0.7)] sm:text-6xl"
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
        className="flex w-36 flex-col items-center gap-4 sm:w-52"
      >
        <span
          className="rounded-full border px-3 py-1 font-display text-sm font-bold"
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
            <span className={clsx('flex max-w-full items-center gap-1 text-sm font-semibold', p.id === game.start.youId && 'text-violet-300')}>
              <span className="truncate">{p.name}</span>
              <LevelBadge level={p.level} />
            </span>
          </motion.div>
        ))}
      </motion.div>
    );
  };
  return (
    <div className="mt-8 flex items-start gap-3 sm:gap-10">
      {column(0, 1)}
      <div className="self-center">
        <VsMark />
      </div>
      {column(1, -1)}
    </div>
  );
}

// ─── Question ──────────────────────────────────────────────────────────────

function QuestionView({ game }: { game: LiveGame }) {
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  const cat = categoryById(q.category)!;
  const youId = game.start.youId;
  const active = !game.eliminated.includes(youId) && !reveal;
  const mine = reveal?.results[youId];
  const others = game.start.players.length - 1;

  // "Още време" pushes the deadline out; compare against where it started for this question.
  const initialDeadline = useRef(game.deadline);
  const extraMs = Math.max(0, game.deadline - initialDeadline.current);

  // Re-render while frozen so the overlay counts down and lifts on time.
  const now = useNow(200, game.frozenUntil > Date.now());
  const frozen = active && game.frozenUntil > now;

  // Who picked what, shown under each option at reveal.
  const pickers = useMemo(() => {
    const map: Record<number, GamePlayer[]> = {};
    if (!reveal) return map;
    for (const [pid, r] of Object.entries(reveal.results)) {
      if (r.choice === null || pid === youId) continue;
      (map[r.choice] ??= []).push(game.players[pid]);
    }
    return map;
  }, [reveal, game.players, youId]);

  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="mx-auto max-w-3xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold"
          style={{ borderColor: `${cat.color}55`, background: `${cat.color}14`, color: cat.color }}
        >
          {cat.icon} {cat.name}
        </span>
        <span className="rounded-full bg-white/5 px-2.5 py-1 text-xs font-semibold text-fg-3">
          {DIFFICULTY_LABEL[q.difficulty]}
        </span>
        {q.elimination && (
          <motion.span
            animate={{ opacity: [1, 0.55, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300"
          >
            <Skull className="size-3.5" /> Елиминация след този въпрос
          </motion.span>
        )}
        <span className="ml-auto text-sm font-semibold text-fg-3 tabular-nums">
          Въпрос {q.index + 1} / {q.total}
        </span>
      </div>

      <div className="glass relative mt-4 overflow-hidden rounded-3xl p-6 sm:p-8">
        <div
          className="absolute -top-20 left-1/2 size-60 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: cat.color }}
        />
        <div className="relative flex items-start gap-5">
          <div className="flex-1">
            <h2 className="text-[clamp(1.35rem,3.2vw,2rem)] leading-snug font-bold text-balance">{q.q}</h2>
            {q.author && <p className="mt-3 text-xs font-medium text-fg-3">✍️ Въпрос от {q.author}</p>}
          </div>
          <TimerRing deadline={game.deadline} duration={q.durationMs + extraMs} stopped={!!reveal} />
        </div>
      </div>

      <AnimatePresence>
        {game.retryPrompt && !reveal && (
          <motion.div
            initial={{ opacity: 0, y: -8, height: 0 }}
            animate={{ opacity: 1, y: 0, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-4 overflow-hidden"
          >
            <div className="flex items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/12 px-4 py-3 text-amber-100">
              <span className="text-xl">🔁</span>
              <span className="text-sm font-semibold sm:text-base">
                Грешно! Имаш още един опит <span className="text-amber-300">(за ½ точки)</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="relative mt-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {q.options.map((text, i) => (
            <AnswerButton
              key={i}
              index={i}
              text={text}
              selected={game.myChoice === i}
              locked={game.myChoice !== null}
              removed={game.removed.includes(i)}
              disabled={!active || frozen}
              correct={reveal ? reveal.correct === i : null}
              pickers={pickers[i] ?? []}
            />
          ))}
        </div>
        <AnimatePresence>
          {frozen && <FreezeOverlay game={game} now={now} />}
        </AnimatePresence>
      </div>

      <div className="mt-5 flex min-h-12 flex-wrap items-center gap-3">
        <AnimatePresence mode="wait">
          {reveal && mine ? (
            <RevealSummary key="sum" result={mine} />
          ) : reveal ? null : game.myChoice !== null ? (
            <motion.div key="wait" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-wrap items-center gap-2">
              <p className="inline-flex items-center gap-2 text-sm text-fg-2">
                <Check className="size-4 text-emerald-400" /> Отговорът е заключен
                {others > 0 && (
                  <span className="text-fg-3">
                    · <Users className="mb-0.5 inline size-3.5" /> {game.answered.length}/{game.start.players.length - game.eliminated.length}
                  </span>
                )}
              </p>
              <ActiveJokers game={game} extraMs={extraMs} />
            </motion.div>
          ) : (
            active && <PowerupBar key="pw" game={game} extraMs={extraMs} />
          )}
        </AnimatePresence>
      </div>
    </motion.section>
  );
}

/** Frosted panel over the answers while "Леден удар" holds you. */
function FreezeOverlay({ game, now }: { game: LiveGame; now: number }) {
  const by = game.frozenBy ? game.players[game.frozenBy]?.name : null;
  const left = Math.max(0, Math.ceil((game.frozenUntil - now) / 1000));
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
      className="absolute -inset-1.5 z-10 grid place-items-center overflow-hidden rounded-3xl border border-cyan-200/40 bg-cyan-300/10 backdrop-blur-[6px]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 20%, rgb(207 250 254 / 0.25), transparent 40%), radial-gradient(circle at 80% 70%, rgb(165 243 252 / 0.2), transparent 45%), linear-gradient(135deg, rgb(255 255 255 / 0.08), transparent 60%)',
        boxShadow: 'inset 0 0 60px rgb(165 243 252 / 0.25)',
      }}
      role="status"
    >
      <div className="flex flex-col items-center text-center">
        <motion.span
          animate={{ rotate: [0, 12, -12, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-5xl drop-shadow-[0_0_18px_rgb(165_243_252/0.9)]"
        >
          ❄️
        </motion.span>
        <p className="mt-2 font-display text-xl font-bold text-cyan-50">{by ? `${by} те замрази!` : 'Замразен отговор!'}</p>
        <p className="mt-1 font-display text-3xl font-black text-cyan-200 tabular-nums">{left}</p>
      </div>
    </motion.div>
  );
}

function TimerRing({ deadline, duration, stopped }: { deadline: number; duration: number; stopped: boolean }) {
  const now = useNow(100, !stopped);
  const [frozen, setFrozen] = useState<number | null>(null);
  useEffect(() => {
    if (stopped && frozen === null) setFrozen(Math.max(0, deadline - Date.now()));
  }, [stopped, frozen, deadline]);
  const remaining = frozen ?? Math.max(0, deadline - now);
  const secs = Math.ceil(remaining / 1000);
  const pct = Math.min(1, remaining / duration);
  const color = pct > 0.5 ? '#22d3ee' : pct > 0.25 ? '#fbbf24' : '#fb7185';

  const lastTick = useRef(secs);
  useEffect(() => {
    if (!stopped && secs !== lastTick.current && secs <= 5 && secs > 0) sfx.tick();
    lastTick.current = secs;
  }, [secs, stopped]);

  const R = 26;
  const C = 2 * Math.PI * R;
  return (
    <div className={clsx('relative grid size-16 shrink-0 place-items-center sm:size-20', secs <= 3 && !stopped && 'animate-pulse')}>
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90">
        <circle cx="32" cy="32" r={R} fill="none" stroke="rgb(255 255 255 / 0.08)" strokeWidth="5" />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 0.1s linear, stroke 0.3s', filter: `drop-shadow(0 0 6px ${color})` }}
        />
      </svg>
      <span className="font-display text-xl font-bold tabular-nums sm:text-2xl" style={{ color }}>
        {secs}
      </span>
    </div>
  );
}

function AnswerButton({
  index,
  text,
  selected,
  locked,
  removed,
  disabled,
  correct,
  pickers,
}: {
  index: number;
  text: string;
  selected: boolean;
  locked: boolean;
  removed: boolean;
  disabled: boolean;
  correct: boolean | null;
  pickers: GamePlayer[];
}) {
  const color = OPTION_COLORS[index];
  const revealed = correct !== null;
  const wrongPick = revealed && selected && !correct;
  const state = revealed ? (correct ? 'correct' : wrongPick ? 'wrong' : 'dim') : selected ? 'selected' : locked ? 'dim' : 'idle';

  return (
    <motion.button
      layout
      data-answer={index}
      disabled={disabled || locked || removed}
      onClick={() => actions.answer(index)}
      initial={{ opacity: 0, y: 14 }}
      animate={{
        opacity: removed ? 0.25 : state === 'dim' ? 0.45 : 1,
        y: 0,
        x: state === 'wrong' ? [0, -8, 8, -5, 5, 0] : 0,
        scale: state === 'correct' ? [1, 1.04, 1] : 1,
      }}
      transition={{ delay: revealed ? 0 : 0.05 * index, duration: state === 'wrong' ? 0.45 : 0.3 }}
      whileHover={!disabled && !locked && !removed ? { y: -3 } : undefined}
      whileTap={!disabled && !locked && !removed ? { scale: 0.97 } : undefined}
      className={clsx(
        'focus-ring group relative flex min-h-[3.75rem] items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-[background,border-color,box-shadow] duration-200 sm:min-h-[5.5rem] sm:gap-4 sm:p-5',
        state === 'correct'
          ? 'border-emerald-400/70 bg-emerald-500/20 shadow-[0_0_40px_-8px_rgb(52_211_153/0.8)]'
          : state === 'wrong'
            ? 'border-rose-400/70 bg-rose-500/20'
            : 'glass hover:bg-white/[0.08]',
        removed && 'line-through',
      )}
      style={state === 'selected' ? { borderColor: color, boxShadow: `0 0 0 1px ${color}, 0 0 36px -8px ${color}` } : undefined}
    >
      <span
        className="absolute inset-y-0 left-0 w-1 transition-all group-hover:w-1.5"
        style={{ background: state === 'correct' ? '#34d399' : state === 'wrong' ? '#fb7185' : color }}
      />
      <span
        className="grid size-10 shrink-0 place-items-center rounded-xl font-display text-base font-bold"
        style={{
          background: state === 'correct' ? '#34d399' : state === 'wrong' ? '#fb7185' : `${color}22`,
          color: state === 'correct' || state === 'wrong' ? '#0b0a14' : color,
        }}
      >
        {state === 'correct' ? <Check className="size-5" strokeWidth={3} /> : state === 'wrong' ? <X className="size-5" strokeWidth={3} /> : LETTERS[index]}
      </span>
      <span className="flex-1 text-[15px] font-semibold sm:text-base">{text}</span>
      {pickers.length > 0 && (
        <span className="flex -space-x-2">
          {pickers.slice(0, 4).map((p) => (
            <motion.span key={p.id} initial={{ scale: 0 }} animate={{ scale: 1 }} title={p.name}>
              <Avatar avatar={p.avatar} frame={p.frame} size={26} />
            </motion.span>
          ))}
          {pickers.length > 4 && (
            <span className="grid size-[26px] place-items-center rounded-full bg-white/15 text-[10px] font-bold">+{pickers.length - 4}</span>
          )}
        </span>
      )}
    </motion.button>
  );
}

function RevealSummary({ result }: { result: NonNullable<LiveGame['reveal']>['results'][string] }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="flex flex-wrap items-center gap-3"
    >
      {result.correct ? (
        <>
          <span className="font-display text-3xl font-black text-emerald-300 drop-shadow-[0_0_18px_rgb(52_211_153/0.6)]">
            +{fmt(result.points)}
          </span>
          {result.doubled && <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-sm font-bold text-amber-300">×2</span>}
          {result.retried && (
            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-sm font-bold text-amber-200">🔁 Втори шанс · ½ точки</span>
          )}
          {result.streak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300">
              <Flame className="size-4" /> Серия {result.streak}
            </span>
          )}
          {result.timeMs !== null && <span className="text-sm text-fg-3">за {(result.timeMs / 1000).toFixed(1).replace('.', ',')} с</span>}
        </>
      ) : (
        <span className="font-display text-2xl font-bold text-rose-300">
          {result.choice === null ? 'Времето изтече ⏱️' : 'Грешно 😬'}
        </span>
      )}
    </motion.div>
  );
}

/** Is there an opponent still answering (so "Леден удар" has someone to hit)? Client-side approximation. */
function hasFreezeTarget(game: LiveGame): boolean {
  const youId = game.start.youId;
  const myTeam = myTeamOf(game);
  return game.start.players.some((p) => {
    if (p.id === youId || game.eliminated.includes(p.id) || game.answered.includes(p.id)) return false;
    if (game.standings.find((s) => s.id === p.id)?.left) return false;
    return !game.start.teams || p.team !== myTeam;
  });
}

/** Chips for jokers already working on this question. */
function ActiveJokers({ game, extraMs }: { game: LiveGame; extraMs: number }) {
  const chips: string[] = [];
  if (game.doubled) chips.push('💰 ×2 точки');
  if (game.retryArmed && !game.retryPrompt) chips.push('🔁 Втори шанс е активен');
  if (extraMs > 0) chips.push(`⏳ +${Math.round(extraMs / 1000)} с`);
  if (!chips.length) return null;
  return (
    <>
      {chips.map((c) => (
        <motion.span
          key={c}
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-full border border-amber-300/30 bg-amber-400/10 px-2.5 py-1 text-xs font-bold text-amber-200"
        >
          {c}
        </motion.span>
      ))}
    </>
  );
}

function PowerupBar({ game, extraMs }: { game: LiveGame; extraMs: number }) {
  if (game.start.powerups.length === 0) return null;
  const canFreeze = hasFreezeTarget(game);
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <ActiveJokers game={game} extraMs={extraMs} />
      </div>
      <div className="flex flex-wrap gap-2">
        {POWERUPS.filter((p) => game.start.powerups.includes(p.id)).map((p) => {
          const used = game.usedPowerups.includes(p.id);
          const noTarget = p.id === 'freeze' && !canFreeze;
          const blocked = !used && (game.powerupThisQuestion || noTarget);
          const title = used
            ? `${p.name} — вече е използван`
            : game.powerupThisQuestion
              ? 'Само един жокер на въпрос'
              : noTarget
                ? 'Няма кого да замразиш — всички съперници отговориха'
                : p.description;
          return (
            <button
              key={p.id}
              disabled={used || blocked}
              onClick={() => actions.powerup(p.id as PowerupId)}
              title={title}
              aria-label={`${p.name}: ${p.description}`}
              className={clsx(
                'focus-ring inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-all',
                used
                  ? 'border-line text-fg-3 line-through opacity-50'
                  : blocked
                    ? 'border-line text-fg-3 opacity-60'
                    : p.id === 'freeze'
                      ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:shadow-[0_0_20px_-6px_rgb(34_211_238/0.9)]'
                      : 'border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:shadow-[0_0_20px_-6px_rgb(251_191_36/0.8)]',
              )}
            >
              <span className="text-base leading-none">{p.icon}</span> {p.name}
            </button>
          );
        })}
      </div>
      <span className="text-xs text-fg-3">
        {game.powerupThisQuestion
          ? 'Вече игра жокер на този въпрос — следващият на следващия.'
          : `Всеки жокер е по веднъж на мач и по един на въпрос.${
              game.start.powerups.includes('time') ? ` „Още време“ дава +${TIME_BONUS_MS / 1000} с.` : ''
            }`}
      </span>
    </motion.div>
  );
}

// ─── Scoreboard ────────────────────────────────────────────────────────────

function Scoreboard({ game }: { game: LiveGame }) {
  if (game.start.teams) return <TeamScoreboard game={game} />;
  return (
    <div className="glass sticky top-20 rounded-3xl p-3">
      <p className="px-2 pt-1 pb-2 text-xs font-bold tracking-widest text-fg-3 uppercase">Класиране</p>
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
              <TeamTotal value={totals[team]} className="ml-auto font-display text-lg font-bold" />
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
    <motion.li
      layout
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
        <PlayerTag name={p.name} title={p.title} level={p.level} isBot={p.isBot} />
      </div>
      <div className="text-right">
        <div className={clsx('font-bold tabular-nums', out && 'text-fg-3')}>
          {s.left ? 'напусна' : s.eliminatedAt !== null ? <Skull className="ml-auto size-4 text-rose-300" /> : fmt(score)}
        </div>
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className={clsx('text-xs font-bold tabular-nums', result.correct ? 'text-emerald-300' : 'text-rose-300')}
            >
              {result.correct ? `+${fmt(result.points)}` : '✗'}
            </motion.div>
          )}
        </AnimatePresence>
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

function MobileStrip({ game }: { game: LiveGame }) {
  const teams = game.start.teams;
  // Team games: group teammates together so the colors read as two blocks.
  const order = teams
    ? [...game.standings].sort((a, b) => (game.players[a.id]?.team ?? 0) - (game.players[b.id]?.team ?? 0))
    : game.standings;
  return (
    <div className="border-b border-line lg:hidden">
      {teams && (
        <div className="px-4 pt-3 sm:hidden">
          <TeamScoreBar totals={teamTotals(game.standings, game.players)} myTeam={myTeamOf(game)} compact />
        </div>
      )}
      <div className="flex gap-3 overflow-x-auto px-4 py-3">
        {order.map((s) => {
          const p = game.players[s.id];
          const out = s.eliminatedAt !== null || s.left;
          const answered = game.phase === 'question' && game.answered.includes(s.id);
          const reactions = game.reactions.filter((r) => r.playerId === s.id);
          const color = teams && p.team !== null ? teamColor(p.team) : null;
          return (
            <motion.div layout key={s.id} className="relative flex shrink-0 flex-col items-center gap-1">
              <div className="rounded-full" style={color ? { boxShadow: `0 0 0 2px ${color}` } : undefined}>
                <Avatar avatar={p.avatar} frame={p.frame} size={40} dim={out}>
                  {answered && <span className="absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full border-2 border-ink bg-emerald-400" />}
                </Avatar>
              </div>
              <span
                className={clsx(
                  'text-[11px] font-bold tabular-nums',
                  s.id === game.start.youId ? 'text-violet-300' : 'text-fg-2',
                )}
              >
                {out ? '💀' : fmt(s.score)}
              </span>
              {color && <span className="h-0.5 w-6 rounded-full" style={{ background: color }} />}
              <Reactions reactions={reactions} />
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Emotes, feed, eliminations ────────────────────────────────────────────

/** Full bar on desktop; on phones a single button that expands, so it never covers the answers. */
function EmoteBar({ emotes }: { emotes: string[] }) {
  const [cooldown, setCooldown] = useState(false);
  const [open, setOpen] = useState(false);
  function send(id: string) {
    if (cooldown) return;
    actions.react(id);
    sfx.pop();
    setCooldown(true);
    setOpen(false);
    setTimeout(() => setCooldown(false), 800);
  }
  return (
    <div className="fixed right-3 bottom-0 z-30 pb-[env(safe-area-inset-bottom)] sm:inset-x-0">
      <button
        onClick={() => setOpen(!open)}
        aria-label="Реакции"
        aria-expanded={open}
        className={clsx(
          'focus-ring mb-3 ml-auto grid size-12 place-items-center rounded-full border border-line bg-ink-2/90 text-2xl shadow-xl backdrop-blur-xl sm:hidden',
          open && 'hidden',
        )}
      >
        😀
      </button>
      <div
        className={clsx(
          'mx-auto mb-3 w-fit max-w-[calc(100vw-1.5rem)] gap-1 overflow-x-auto rounded-2xl border border-line bg-ink-2/80 p-1.5 backdrop-blur-xl',
          open ? 'flex' : 'hidden sm:flex',
        )}
      >
        {emotes.map((id) => (
          <motion.button
            key={id}
            whileTap={{ scale: 0.8 }}
            whileHover={{ scale: 1.2, y: -3 }}
            onClick={() => send(id)}
            className={clsx('focus-ring grid size-10 shrink-0 place-items-center rounded-xl text-2xl', cooldown && 'opacity-50')}
            aria-label={`Реакция ${emoteById(id)?.emoji}`}
          >
            {emoteById(id)?.emoji}
          </motion.button>
        ))}
      </div>
    </div>
  );
}

function Feed({ game }: { game: LiveGame }) {
  return (
    <div className="pointer-events-none absolute -top-2 right-0 z-20 flex flex-col items-end gap-1.5">
      <AnimatePresence>
        {game.feed.map((f) => (
          <motion.span
            key={f.key}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            className={clsx(
              'rounded-full border px-3 py-1 text-xs font-semibold backdrop-blur',
              f.icon === '❄️'
                ? 'border-cyan-200/30 bg-cyan-400/15 text-cyan-100'
                : 'border-amber-300/20 bg-amber-400/10 text-amber-200',
            )}
          >
            {f.icon} {f.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

function EliminationBanner({ game }: { game: LiveGame }) {
  const ids = game.phase === 'reveal' ? (game.reveal?.eliminated ?? []) : [];
  const [shown, setShown] = useState<string[]>([]);
  useEffect(() => {
    if (!ids.length) return;
    const show = setTimeout(() => setShown(ids), 900);
    const hide = setTimeout(() => setShown([]), 3600);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join()]);

  return (
    <AnimatePresence>
      {shown.length > 0 && (
        <motion.div
          className="pointer-events-none fixed inset-0 z-40 grid place-items-center bg-rose-950/40 backdrop-blur-[2px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
        >
          {shown.map((id) => {
            const p = game.players[id];
            const me = id === game.start.youId;
            return (
              <motion.div
                key={id}
                initial={{ scale: 1.6, opacity: 0, rotate: -6 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', stiffness: 260, damping: 16 }}
                className="flex flex-col items-center text-center"
              >
                <Avatar avatar={p.avatar} frame={p.frame} size={110} dim />
                <p className="mt-4 font-display text-4xl font-black text-rose-300 drop-shadow-[0_0_24px_rgb(251_113_133/0.7)]">
                  {me ? 'Отпадна!' : `${p.name} отпада!`}
                </p>
                <p className="mt-1 text-fg-2">Най-нисък резултат след въпрос {(game.question?.index ?? 0) + 1}</p>
              </motion.div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
