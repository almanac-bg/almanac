import { actions, DIFFICULTY_LABEL, fmt, type LiveGame, useNow } from '@quiz/client';
import { answerPoints, categoryById, type GamePlayer, type QuestionPayload } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, Check, Flame, Skull, Users, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { sfx } from '../../lib/sound';
import { keepTogether } from '../../lib/typography';
import { Avatar } from '../Avatar';
import { Button, Spinner } from '../ui';
import { LETTERS, OPTION_COLORS } from './answers';
import { ActivePowerups, FreezeAfterAnswer, KeyHint, PowerupBar } from './Powerups';

/** A question on screen: the clock, the points it's worth, the answers, your pick and how it went. */
export function QuestionView({ game, offline }: { game: LiveGame; offline: boolean }) {
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  const cat = categoryById(q.category)!;
  const youId = game.start.youId;
  const active = !game.eliminated.includes(youId) && !reveal && !game.resyncing;
  const mine = reveal?.results[youId];
  const reduceMotion = useReducedMotion();

  // Re-render while frozen so the overlay counts down and lifts on time.
  const now = useNow(200, game.frozenUntil > Date.now());
  const frozen = active && game.frozenUntil > now;

  // Who picked what, shown under each option at reveal.
  const pickers = useMemo(() => {
    const map: Record<number, GamePlayer[]> = {};
    if (!reveal) return map;
    for (const [pid, r] of Object.entries(reveal.results)) {
      if (r.choice === null || pid === youId) continue;
      map[r.choice] ??= [];
      map[r.choice].push(game.players[pid]);
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
          // MotionConfig only stills movement; this loop is opacity, so it stops here.
          <motion.span
            animate={reduceMotion ? undefined : { opacity: [1, 0.55, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300"
          >
            <Skull className="size-3.5" /> Елиминация след този въпрос
          </motion.span>
        )}
      </div>

      <div className="glass relative mt-4 overflow-hidden rounded-3xl p-6 short:mt-3 short:max-sm:p-4 tiny:mt-2 tiny:max-sm:p-3 sm:p-8 flat:mt-2 flat:p-3">
        <div
          className="absolute -top-20 left-1/2 size-60 -translate-x-1/2 rounded-full opacity-30 blur-3xl"
          style={{ background: cat.color }}
        />
        {/* Phones: the timer floats at the top right and the question wraps around it, instead of a narrow column of
            two-word lines beside it. Wider screens: side by side. */}
        <div className="relative sm:flex sm:items-start sm:gap-5">
          <div className="float-right mb-1 ml-3 sm:order-2 sm:float-none sm:ml-0">
            <TimerRing deadline={game.deadline} duration={q.durationMs + game.extraMs} stopped={!!reveal} />
            {!reveal && <LivePoints game={game} q={q} />}
          </div>
          <div className="sm:flex-1">
            <h1 className="text-[clamp(1.35rem,3.2vw,2rem)] leading-snug font-bold text-pretty hyphens-auto short:max-sm:text-[1.15rem] sm:text-balance large:text-[2.375rem] flat:text-[1.05rem]">
              {keepTogether(q.q)}
            </h1>
            {q.author && <p className="mt-3 text-xs font-medium text-fg-3">✍️ Въпрос от {q.author}</p>}
          </div>
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

      <div className="relative mt-4 short:mt-3 tiny:mt-2 flat:mt-2">
        <div className="grid gap-3 short:max-sm:gap-2 tiny:max-sm:gap-1.5 sm:grid-cols-2 flat:gap-1.5">
          {q.options.map((text, i) => (
            <AnswerButton
              // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
              key={i}
              index={i}
              text={text}
              selected={game.myChoice === i}
              locked={game.myChoice !== null}
              removed={game.removed.includes(i)}
              disabled={!active || frozen || offline}
              offline={(offline || game.resyncing) && !reveal}
              correct={reveal ? reveal.correct === i : null}
              pickers={pickers[i] ?? []}
            />
          ))}
        </div>
        <AnimatePresence>{frozen && <FreezeOverlay game={game} now={now} />}</AnimatePresence>
      </div>

      <div className="mt-5 flex min-h-12 flex-wrap items-center gap-3 short:mt-3 tiny:mt-2 flat:mt-1.5">
        <AnimatePresence mode="wait">
          {reveal && mine ? (
            <RevealSummary key="sum" result={mine} />
          ) : reveal ? null : game.myChoice !== null ? (
            <motion.div
              key="wait"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-wrap items-center gap-2"
            >
              <LockStatus game={game} offline={offline} />
              <ActivePowerups game={game} />
              <FreezeAfterAnswer game={game} offline={offline} />
            </motion.div>
          ) : (
            active && <PowerupBar key="pw" game={game} offline={offline} />
          )}
        </AnimatePresence>
      </div>
      {/* Only in a run played alone: with others, the rhythm is everyone's (their facts wait for the results). */}
      {reveal?.fact && game.start.players.length === 1 && <FactNote index={q.index} fact={reveal.fact} />}
    </motion.section>
  );
}

/**
 * "Знаеше ли?" under the result, in a run played alone. The run goes on at its usual pace; "Спри, за да прочета" holds
 * the next question until "Продължи" (nobody else is waiting), so reading is the player's choice, never a delay.
 */
function FactNote({ index, fact }: { index: number; fact: string }) {
  const [state, setState] = useState<'shown' | 'asking' | 'holding'>('shown');
  const ref = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  // On a short screen the note comes in below the fold, where "Спри" can't be reached in the few seconds of the
  // reveal: the page scrolls just enough to show it, and goes back to where it was when the question leaves.
  useEffect(() => {
    const before = window.scrollY;
    const timer = setTimeout(
      () => ref.current?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' }),
      400,
    );
    return () => {
      clearTimeout(timer);
      if (window.scrollY !== before) window.scrollTo({ top: before });
    };
  }, [reduceMotion]);

  async function hold() {
    setState('asking');
    // Too late (the next question was already on its way): it simply comes, and this note goes with the question.
    setState((await actions.holdOnFact(index)) ? 'holding' : 'shown');
  }

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] p-3.5 short:max-sm:mt-2 short:max-sm:p-3 sm:p-4"
    >
      <p className="text-sm text-fg-2 text-pretty sm:text-[15px]">
        <span className="font-bold text-amber-200">💡 Знаеше ли? </span>
        {fact}
      </p>
      <div className="mt-2 flex justify-end">
        {state === 'holding' ? (
          <Button size="sm" onClick={actions.resumeAfterFact}>
            Продължи <ArrowRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={hold} loading={state === 'asking'}>
            Спри, за да прочета
          </Button>
        )}
      </div>
    </motion.div>
  );
}

/** A pick counts once the server has it (it echoes `answered`); until then this says so instead of claiming a lock. */
function LockStatus({ game, offline }: { game: LiveGame; offline: boolean }) {
  if (!game.answered.includes(game.start.youId)) {
    return offline ? (
      <p className="inline-flex items-center gap-2 text-sm text-rose-200">
        <WifiOff className="size-4" aria-hidden /> Отговорът не е потвърден — няма връзка
      </p>
    ) : (
      // Normally confirmed within a blink: only a slow link ever gets to see this.
      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="inline-flex items-center gap-2 text-sm text-fg-2"
      >
        <Spinner className="size-3.5" /> Изпращаме отговора…
      </motion.p>
    );
  }
  const playing = game.start.players.length - game.eliminated.length;
  return (
    <p className="inline-flex items-center gap-2 text-sm text-fg-2">
      <Check className="size-4 text-emerald-400" aria-hidden /> Отговорът е заключен
      {game.start.players.length > 1 && (
        <span className="text-fg-3">
          · <Users className="mb-0.5 inline size-3.5" aria-hidden /> {game.answered.length}/{playing}
          <span className="sr-only"> са отговорили</span>
        </span>
      )}
    </p>
  );
}

/**
 * Ice over the answers while "Леден удар" holds you: out of sight, not only out of reach (seen through frost, they'd be
 * read and picked the moment it lifts — no time lost at all).
 */
function FreezeOverlay({ game, now }: { game: LiveGame; now: number }) {
  const by = game.frozenBy ? game.players[game.frozenBy]?.name : null;
  const left = Math.max(0, Math.ceil((game.frozenUntil - now) / 1000));
  const reduceMotion = useReducedMotion();
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1.04 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.25 }}
      className="absolute -inset-1.5 z-10 grid place-items-center overflow-hidden rounded-3xl border border-cyan-200/40 bg-[#0d2a3a]"
      style={{
        backgroundImage:
          'radial-gradient(circle at 20% 20%, rgb(207 250 254 / 0.22), transparent 40%), radial-gradient(circle at 80% 70%, rgb(165 243 252 / 0.18), transparent 45%), linear-gradient(135deg, rgb(255 255 255 / 0.08), transparent 60%)',
        boxShadow: 'inset 0 0 60px rgb(165 243 252 / 0.25)',
      }}
    >
      <div className="flex flex-col items-center text-center">
        <motion.span
          animate={reduceMotion ? undefined : { rotate: [0, 12, -12, 0] }}
          transition={{ repeat: Infinity, duration: 2 }}
          className="text-5xl drop-shadow-[0_0_18px_rgb(165_243_252/0.9)]"
        >
          ❄️
        </motion.span>
        <p className="mt-2 font-display text-xl font-bold text-cyan-50">{by ? `${by} те замрази!` : 'Замразиха те!'}</p>
        <p className="mt-1 font-display text-3xl font-black text-cyan-200 tabular-nums">{left}</p>
      </div>
    </motion.div>
  );
}

/**
 * What a right answer would score if you picked it now: the speed bonus draining in front of you makes every question
 * a race. Once you've picked, it stops at what your pick can earn.
 */
function LivePoints({ game, q }: { game: LiveGame; q: QuestionPayload }) {
  const picked = game.myChoice !== null;
  const now = useNow(100, !picked);
  // A pick from before a reconnect: when it was made isn't known here.
  if (game.myChoice === -1) return null;
  const streak = (game.standings.find((s) => s.id === game.start.youId)?.streak ?? 0) + 1;
  const openedAt = game.deadline - q.durationMs - game.extraMs;
  const points = answerPoints({
    timeMs: Math.max(0, now - openedAt),
    limitMs: q.durationMs,
    streak,
    doubled: game.doubled,
    retried: game.retryPrompt,
  });
  return (
    <p
      aria-hidden
      className={clsx(
        'mt-1 text-center font-display text-xs font-bold text-amber-300 tabular-nums transition-opacity sm:text-sm',
        picked && 'opacity-60',
      )}
    >
      +{fmt(points)}
    </p>
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
    // role="timer" is never read out on its own: the time is there when the reader looks, not on every tick.
    <div
      role="timer"
      aria-label={`Оставащо време: ${secs} ${secs === 1 ? 'секунда' : 'секунди'}`}
      className={clsx(
        'relative grid size-14 shrink-0 place-items-center short:max-sm:size-12 sm:size-20 flat:size-12',
        secs <= 3 && !stopped && 'motion-safe:animate-pulse',
      )}
    >
      {/* overflow-visible: the ring's glow reaches past the drawing's box, and a clipped glow shows up as a square. */}
      <svg viewBox="0 0 64 64" className="absolute inset-0 -rotate-90 overflow-visible" aria-hidden>
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
      <span className="font-display text-xl font-bold tabular-nums sm:text-2xl" style={{ color }} aria-hidden>
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
  offline,
  correct,
  pickers,
}: {
  index: number;
  text: string;
  selected: boolean;
  locked: boolean;
  removed: boolean;
  disabled: boolean;
  /** No connection (or not yet re-synced): shown as out of reach, not just unresponsive. */
  offline: boolean;
  correct: boolean | null;
  pickers: GamePlayer[];
}) {
  const color = OPTION_COLORS[index];
  const revealed = correct !== null;
  const wrongPick = revealed && selected && !correct;
  const state = revealed
    ? correct
      ? 'correct'
      : wrongPick
        ? 'wrong'
        : 'dim'
    : selected
      ? 'selected'
      : locked || offline
        ? 'dim'
        : 'idle';

  // What the colors and icons say, for screen readers.
  const status: string[] = [];
  if (removed) status.push('премахнат');
  if (state === 'correct') status.push(selected ? 'верен отговор, твоят избор' : 'верен отговор');
  else if (wrongPick) status.push('твоят избор, грешен');
  else if (selected) status.push('твоят избор');
  if (pickers.length) status.push(`избран от ${pickers.map((p) => p.name).join(', ')}`);

  const inert = disabled || locked || removed;
  const liftable = !inert;
  return (
    // The hover lift is on the button, the hover itself on this wrapper that stays put: lifting the button can't move
    // it out from under a resting pointer (which made it flicker between raised and lowered).
    <div className="group/lift grid">
      <motion.button
        type="button"
        layout
        data-answer={index}
        aria-keyshortcuts={String(index + 1)}
        // Not `disabled`: that would drop keyboard focus from the answer you just picked (to the top of the page).
        aria-disabled={inert || undefined}
        onClick={() => !inert && actions.answer(index)}
        initial={{ opacity: 0, y: 14 }}
        animate={{
          opacity: removed ? 0.25 : state === 'dim' ? 0.45 : 1,
          y: 0,
          x: state === 'wrong' ? [0, -8, 8, -5, 5, 0] : 0,
          scale: state === 'correct' ? [1, 1.04, 1] : 1,
        }}
        transition={{ delay: revealed ? 0 : 0.05 * index, duration: state === 'wrong' ? 0.45 : 0.3 }}
        whileTap={liftable ? { scale: 0.97 } : undefined}
        className={clsx(
          'focus-ring group relative flex min-h-[3.75rem] items-center gap-3 overflow-hidden rounded-2xl border px-3.5 py-3 text-left transition-[background,border-color,box-shadow,translate] duration-200 short:max-sm:min-h-12 short:max-sm:py-2 tiny:max-sm:min-h-11 tiny:max-sm:py-1.5 sm:min-h-[5.5rem] sm:gap-4 sm:p-5 large:min-h-28 flat:min-h-10 flat:p-2',
          liftable && 'group-hover/lift:-translate-y-[3px] motion-reduce:group-hover/lift:translate-y-0',
          state === 'correct'
            ? 'border-emerald-400/70 bg-emerald-500/20 shadow-[0_0_40px_-8px_rgb(52_211_153/0.8)]'
            : state === 'wrong'
              ? 'border-rose-400/70 bg-rose-500/20'
              : // Not .glass: no backdrop blur on buttons that move with every question and reveal (a moving blurred
                // backdrop is re-blurred each frame on a phone's GPU); the page behind is soft already.
                state === 'selected'
                ? 'border-(--pick) bg-white/[0.045] shadow-[0_0_0_1px_var(--pick),0_0_36px_-8px_var(--pick)]'
                : 'border-line bg-white/[0.045] hover:bg-white/[0.08]',
          // Your own pick, once the answer is out: a ring in the result's colour (the pick's accent outline is gone).
          revealed && selected && (correct ? 'ring-2 ring-emerald-200/70' : 'ring-2 ring-rose-200/70'),
          removed && 'line-through',
        )}
        // The pick's colour as a variable for the classes above: an inline style that comes and goes would stay put
        // (Motion keeps what it once had), and the pick's glow would outlast the reveal.
        style={{ '--pick': color } as React.CSSProperties}
      >
        <span
          className="absolute inset-y-0 left-0 w-1 transition-all group-hover:w-1.5"
          style={{ background: state === 'correct' ? '#34d399' : state === 'wrong' ? '#fb7185' : color }}
        />
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl font-display text-base font-bold short:max-sm:size-8 flat:size-8"
          style={{
            background: state === 'correct' ? '#34d399' : state === 'wrong' ? '#fb7185' : `${color}22`,
            color: state === 'correct' || state === 'wrong' ? '#0b0a14' : color,
          }}
        >
          {state === 'correct' ? (
            <Check className="size-5" strokeWidth={3} />
          ) : state === 'wrong' ? (
            <X className="size-5" strokeWidth={3} />
          ) : (
            LETTERS[index]
          )}
        </span>
        <span className="flex-1 text-[15px] font-semibold sm:text-base large:text-lg">
          <span className="sr-only">{LETTERS[index]}) </span>
          {keepTogether(text)}
          {status.length > 0 && <span className="sr-only"> — {status.join(' — ')}</span>}
        </span>
        {/* Kept in place (only hidden) once the answer is in, so the text beside it doesn't reflow. */}
        <KeyHint className={clsx('shrink-0 self-start', state !== 'idle' && 'invisible')}>{String(index + 1)}</KeyHint>
        {pickers.length > 0 && (
          <span aria-hidden className="flex -space-x-2">
            {pickers.slice(0, 4).map((p) => (
              <motion.span key={p.id} initial={{ scale: 0 }} animate={{ scale: 1 }} title={p.name}>
                <Avatar avatar={p.avatar} frame={p.frame} size={26} />
              </motion.span>
            ))}
            {pickers.length > 4 && (
              <span className="grid size-[26px] place-items-center rounded-full bg-white/15 text-[10px] font-bold">
                +{pickers.length - 4}
              </span>
            )}
          </span>
        )}
      </motion.button>
    </div>
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
          {result.doubled && (
            <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-sm font-bold text-amber-300">×2</span>
          )}
          {result.retried && (
            <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-sm font-bold text-amber-200">
              🔁 Втори шанс · ½ точки
            </span>
          )}
          {result.streak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300">
              <Flame className="size-4" /> Серия {result.streak}
            </span>
          )}
          {result.timeMs !== null && (
            <span className="text-sm text-fg-3">за {(result.timeMs / 1000).toFixed(1).replace('.', ',')} с</span>
          )}
        </>
      ) : (
        <>
          <span className="font-display text-2xl font-bold text-rose-300">
            {result.choice === null ? 'Времето изтече ⏱️' : 'Грешно 😬'}
          </span>
          {result.points < 0 && (
            <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-sm font-bold text-rose-300">
              💰 −{fmt(-result.points)}
            </span>
          )}
        </>
      )}
    </motion.div>
  );
}
