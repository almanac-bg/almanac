import { actions, DIFFICULTY_LABEL, fmt, type LiveGame, percent, useNow } from '@quiz/client';
import { answerPoints, type Crowd, categoryById, type GamePlayer, HOLD, type QuestionPayload } from '@quiz/shared';
import clsx from 'clsx';
import { ArrowRight, Check, Flame, Lightbulb, Pause, Skull, Users, WifiOff, X } from 'lucide-react';
import { AnimatePresence, m, useReducedMotion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMatchKeysOn } from '../../lib/matchKeys';
import { sfx } from '../../lib/sound';
import { keepTogether } from '../../lib/typography';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { Button, Spinner } from '../ui';
import { accentText, LETTERS, OPTION_COLORS } from './answers';
import { inDropZone, nextElimination } from './elimination';
import { NumberAnswer, NumberLine, NumberSummary } from './NumberQuestion';
import { numberText } from './numbers';
import { OrderAnswer, OrderReveal, OrderSummary } from './OrderQuestion';
import { ActivePowerups, KeyHint, PowerupBar } from './Powerups';
import { QuestionPicture } from './QuestionPicture';

/** A question on screen: the clock, the points it's worth, the answers, your pick and how it went. */
export function QuestionView({ game, offline }: { game: LiveGame; offline: boolean }) {
  const q = game.question!;
  const reveal = game.reveal?.index === q.index ? game.reveal : null;
  // Соло without a clock: each answer waits for „Продължи“.
  const untimedRun = game.start.mode === 'solo' && game.start.pace === 'untimed';
  const cat = categoryById(q.category)!;
  const youId = game.start.youId;
  // Knocked out: the questions go on, and can still be answered — for XP and the almanac, outside the race.
  const out = game.eliminated.includes(youId);
  const active = !reveal && !game.resyncing;
  const mine = reveal?.results[youId];
  const reduceMotion = useReducedMotion();
  const number = q.kind === 'number';
  const order = q.kind === 'order';
  // Against a recording, a round's category is the one picked when it was played: said where the round begins.
  const round = game.rounds.findIndex((r) => r.from === q.index);
  const recordedRound = round > 0 && game.start.players.some((p) => p.record);
  // Each new question takes the focus (the view is new per question): a screen reader reads it, and Tab goes on to its
  // answers — unless a field of its own (a number to type) has taken it already.
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    // From its top: a page scrolled down to tap a low answer (a phone held sideways) left the next question's heading
    // under the top bar. A screen that didn't move stays as it is.
    if (window.scrollY > 0) window.scrollTo({ top: 0 });
    const focused = document.activeElement;
    if (focused instanceof HTMLInputElement || focused instanceof HTMLTextAreaElement) return;
    heading.current?.focus({ preventScroll: true });
  }, []);

  // Who picked what, shown under each option at reveal.
  const eliminated = game.eliminated;
  const pickers = useMemo(() => {
    const map: Record<number, GamePlayer[]> = {};
    if (!reveal) return map;
    for (const [pid, r] of Object.entries(reveal.results)) {
      // Not those knocked out before this question, answering on: they're no part of the race.
      const outBefore = eliminated.includes(pid) && !reveal.eliminated.includes(pid);
      if (r.choice === null || pid === youId || outBefore) continue;
      map[r.choice] ??= [];
      map[r.choice].push(game.players[pid]);
    }
    return map;
  }, [reveal, game.players, youId, eliminated]);

  return (
    // The clock is already running: the last question gets out of the way at once (the next one waits for it to
    // leave), and the new one is readable within a fifth of a second, while it settles into place.
    <m.section
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, transition: { duration: 0.08 } }}
      transition={{ y: { type: 'spring', stiffness: 260, damping: 26 }, opacity: { duration: 0.15 } }}
      // On a phone the screen is a column: the question on top, the answers at the bottom, where the thumb is.
      className="mx-auto w-full max-w-3xl max-sm:flex max-sm:flex-1 max-sm:flex-col"
    >
      <div className="flex flex-wrap items-center gap-2">
        {q.final && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-400/20 px-2.5 py-1 text-xs font-extrabold tracking-wide text-amber-200 uppercase">
            <Emoji e="🎯" /> Финал{q.times > 1 && ` · ×${q.times}`}
          </span>
        )}
        {game.start.questionSet ? (
          // A host's own set: its name, not a category or difficulty of the bank's.
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-tint/5 px-3 py-1 text-xs font-bold text-fg-2">
            <Emoji e="📝" /> {game.start.questionSet}
          </span>
        ) : (
          <>
            {/* Neutral: a category's own colour right above the answers (geography's green, literature's red) read as
                right or wrong. */}
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-tint/5 px-3 py-1 text-xs font-bold text-fg-2">
              <Emoji e={cat.icon} /> {cat.name}
            </span>
            <span className="rounded-full bg-tint/5 px-2.5 py-1 text-xs font-semibold text-fg-3">
              {DIFFICULTY_LABEL[q.difficulty]}
            </span>
          </>
        )}
        {recordedRound && (
          <span className="rounded-full bg-tint/5 px-2.5 py-1 text-xs font-semibold text-fg-2">
            Рунд {round + 1} · избран в записания мач
          </span>
        )}
        {q.elimination && (
          // MotionConfig only stills movement; this loop is opacity, so it stops here.
          <m.span
            animate={reduceMotion ? undefined : { opacity: [1, 0.55, 1] }}
            transition={{ repeat: Infinity, duration: 1.4 }}
            className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2.5 py-1 text-xs font-bold text-rose-300"
          >
            <Skull className="size-3.5" /> Елиминация след този въпрос
          </m.span>
        )}
        {out && (
          <span className="rounded-full bg-tint/5 px-2.5 py-1 text-xs font-semibold text-fg-2">
            <Emoji e="💀" /> Отпадна · отговаряш за XP
          </span>
        )}
        {inDropZone(game).has(youId) && !reveal && (
          <span className="inline-flex items-center gap-1 rounded-full border border-rose-400/40 bg-rose-500/20 px-2.5 py-1 text-xs font-bold text-rose-200">
            {/* The evening Роял knocks out the bottom few: "last" would be wrong for most of them. */}
            {game.start.mode === 'evening'
              ? q.elimination
                ? 'Ти си сред отпадащите: изпревари някого!'
                : `Ти си сред отпадащите · отпадане след въпрос ${nextElimination(game)}`
              : q.elimination
                ? 'На последно място си: изпревари някого!'
                : `На последно място си · отпадане след въпрос ${nextElimination(game)}`}
          </span>
        )}
      </div>

      <div className="glass relative mt-4 overflow-hidden rounded-3xl p-6 short:mt-3 short:max-sm:p-4 tiny:mt-2 tiny:max-sm:p-3 sm:p-8 flat:mt-2 flat:p-3">
        <div
          className="absolute -top-20 left-1/2 size-60 -translate-x-1/2 rounded-full opacity-30 glow"
          style={{ color: accentText(cat.color) }}
        />
        {/* The category's face, large and faint in the corner: what kind of question it is, at a glance. */}
        {!game.start.questionSet && !q.image && (
          <Emoji
            e={cat.icon}
            size="clamp(5.5rem, 22vw, 8.5rem)"
            className="pointer-events-none absolute -right-3 -bottom-4 -rotate-12 opacity-[0.18]"
          />
        )}
        {q.image && (
          <QuestionPicture image={q.image} credit={reveal?.credit} className="relative mb-4 short:mb-2 flat:mb-1.5" />
        )}
        {/* Phones: the timer floats at the top right and the question wraps around it, instead of a narrow column of
            two-word lines beside it. Wider screens: side by side. */}
        <div className="relative sm:flex sm:items-start sm:gap-5">
          <div className="float-right mb-1 ml-3 sm:order-2 sm:float-none sm:ml-0">
            <TimerRing
              deadline={game.deadline}
              duration={q.durationMs}
              stopped={!!reveal}
              untimed={q.speedMs === null}
            />
            {/* A number has no speed bonus (what it's worth is how close it is), and an order's comes only with all of it
                right. */}
            {!reveal && !number && !order && <LivePoints game={game} q={q} />}
          </div>
          <div className="sm:flex-1">
            {/* Where the focus lands as the question opens: read there whole — which one, a picture's description, the
                question, then (its description) the options or what to do — rather than in a live message the focus
                move would cut off (MatchAnnouncer says only which question it is). */}
            <h1
              ref={heading}
              tabIndex={-1}
              aria-describedby={`q${q.index}-how`}
              className="text-[clamp(1.35rem,3.2vw,2rem)] leading-snug font-bold text-pretty hyphens-auto short:max-sm:text-[1.15rem] sm:text-balance large:text-[2.375rem] flat:text-[1.05rem]"
            >
              <span className="sr-only">
                Въпрос {q.index + 1} от {q.total}: {q.image ? `Картина: ${q.image.alt}. ` : ''}
              </span>
              {keepTogether(q.q)}
            </h1>
            <p id={`q${q.index}-how`} className="sr-only">
              {q.number
                ? `Напиши число между ${numberText(q.number.min, q.number)} и ${numberText(q.number.max, q.number)}.`
                : q.order
                  ? `Подреди, като ги избереш едно след друго, после Enter: ${q.order.items
                      .map((o, i) => `${LETTERS[i]}) ${o}.`)
                      .join(' ')}`
                  : q.options.map((o, i) => `${LETTERS[i]}) ${o}.`).join(' ')}
            </p>
            {q.author && <p className="mt-3 text-xs font-medium text-fg-3">✍️ Въпрос от {q.author}</p>}
          </div>
        </div>
      </div>

      <div className="max-sm:mt-auto">
        <AnimatePresence>
          {game.retryPrompt && !reveal && (
            <m.div
              initial={{ opacity: 0, y: -8, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 overflow-hidden"
            >
              <div className="flex items-center gap-3 rounded-2xl border border-amber-300/40 bg-amber-400/12 px-4 py-3 text-amber-100">
                <span className="text-xl">
                  <Emoji e="🔁" />
                </span>
                <span className="text-sm font-semibold sm:text-base">
                  Грешно! Имаш още един опит <span className="text-amber-300">(за ½ точки)</span>
                </span>
              </div>
            </m.div>
          )}
        </AnimatePresence>

        <div className="relative mt-4 short:mt-3 tiny:mt-2 flat:mt-2">
          {number ? (
            reveal?.answerNumber !== undefined ? (
              <NumberLine game={game} q={q} reveal={reveal} />
            ) : (
              <NumberAnswer game={game} q={q} disabled={!active || offline} />
            )
          ) : order ? (
            reveal?.answerOrder ? (
              <OrderReveal game={game} q={q} reveal={reveal} />
            ) : (
              <OrderAnswer game={game} q={q} disabled={!active || offline} />
            )
          ) : (
            // Under a picture, two by two on a phone too: the picture takes the room a column of four would.
            <div
              className={clsx(
                'grid gap-3 short:max-sm:gap-2 tiny:max-sm:gap-1.5 sm:grid-cols-2 flat:gap-1.5',
                q.image && 'grid-cols-2 max-sm:gap-2',
              )}
            >
              {q.options.map((text, i) => (
                <AnswerButton
                  // biome-ignore lint/suspicious/noArrayIndexKey: the four answers are fixed slots (А–Г)
                  key={i}
                  index={i}
                  text={text}
                  selected={game.myChoice === i}
                  locked={game.myChoice !== null}
                  removed={game.removed.includes(i)}
                  disabled={!active || offline}
                  offline={(offline || game.resyncing) && !reveal}
                  correct={reveal ? reveal.correct === i : null}
                  pickers={pickers[i] ?? []}
                  compact={!!q.image}
                />
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 flex min-h-12 flex-wrap items-center gap-3 short:mt-3 tiny:mt-2 flat:mt-1.5">
          <AnimatePresence mode="wait">
            {reveal && mine ? (
              number && reveal.answerNumber !== undefined ? (
                <NumberSummary key="sum" result={mine} q={q} answer={reveal.answerNumber} />
              ) : order ? (
                <OrderSummary key="sum" result={mine} />
              ) : (
                <RevealSummary key="sum" result={mine} />
              )
            ) : reveal ? null : game.myChoice !== null ? (
              <m.div
                key="wait"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex flex-wrap items-center gap-2"
              >
                <LockStatus game={game} offline={offline} />
                <ActivePowerups game={game} />
              </m.div>
            ) : (
              active && !out && !number && !order && <PowerupBar key="pw" game={game} offline={offline} />
            )}
          </AnimatePresence>
          {reveal?.crowd && <CrowdNote crowd={reveal.crowd} kind={q.kind} />}
        </div>
        {/* Only in a run played alone: with others, the rhythm is everyone's (their facts wait for the results). Without
            a clock, every answer waits for „Продължи“ (the server holds it). */}
        {reveal?.fact && game.start.players.length === 1 && (
          <FactNote index={q.index} fact={reveal.fact} waiting={untimedRun} />
        )}
        {/* Соло is the player's own time: any answer can wait (a fact has its own stop, above). */}
        {reveal && !reveal.fact && game.start.mode === 'solo' && (
          <PauseAfterAnswer index={q.index} waiting={untimedRun} />
        )}
        {/* A class whose teacher stopped on this answer to talk it through. */}
        {reveal && game.paused === reveal.index && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm font-semibold text-fg-2">
            <Pause aria-hidden className="size-4 shrink-0" /> Пауза на големия екран — следващият въпрос идва след нея.
          </p>
        )}
      </div>
    </m.section>
  );
}

/**
 * "Знаеше ли?" under the result, in a run played alone. The run goes on at its usual pace; "Спри, за да прочета" holds
 * the next question until "Продължи" (nobody else is waiting), so reading is the player's choice, never a delay.
 */
function FactNote({ index, fact, waiting }: { index: number; fact: string; waiting: boolean }) {
  const [state, setState] = useState<'shown' | 'asking' | 'holding'>(waiting ? 'holding' : 'shown');
  useContinueKey(state === 'holding');
  const goOn = useFocusOnHold(state === 'holding');
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
    <m.div
      ref={ref}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.3 }}
      className="mt-3 rounded-2xl border border-amber-300/25 bg-amber-400/[0.07] p-3.5 short:max-sm:mt-2 short:max-sm:p-3 sm:p-4"
    >
      <p className="text-sm text-fg-2 text-pretty sm:text-[15px]">
        <span className="font-bold text-amber-200">
          <Lightbulb aria-hidden className="mb-0.5 inline size-4" /> Знаеше ли?{' '}
        </span>
        {keepTogether(fact)}
      </p>
      <div className="mt-2 flex justify-end">
        {state === 'holding' ? (
          <Button ref={goOn} size="sm" onClick={actions.resumeAfterFact}>
            Продължи <ArrowRight aria-hidden className="size-4" />
          </Button>
        ) : (
          <Button data-hold size="sm" variant="ghost" onClick={hold} loading={state === 'asking'}>
            Спри, за да прочета
          </Button>
        )}
      </div>
      {state === 'holding' && <HoldEnding holdMs={waiting ? HOLD.untimedMs : HOLD.pauseMs} />}
    </m.div>
  );
}

/**
 * „Пауза“ after an answer in Соло: the next question waits until „Продължи“ (or a couple of minutes). Without a clock
 * (`waiting`) every answer waits from the start.
 */
function PauseAfterAnswer({ index, waiting }: { index: number; waiting: boolean }) {
  const [state, setState] = useState<'shown' | 'asking' | 'holding'>(waiting ? 'holding' : 'shown');
  useContinueKey(state === 'holding');
  const goOn = useFocusOnHold(state === 'holding');
  async function hold() {
    setState('asking');
    setState((await actions.holdOnFact(index)) ? 'holding' : 'shown');
  }
  return (
    <div className="mt-3 flex justify-end short:max-sm:mt-2">
      {state === 'holding' ? (
        <Button ref={goOn} size="sm" onClick={actions.resumeAfterFact}>
          Продължи <ArrowRight aria-hidden className="size-4" />
        </Button>
      ) : (
        <Button data-hold size="sm" variant="ghost" onClick={hold} loading={state === 'asking'}>
          <Pause aria-hidden className="size-4" /> Пауза
        </Button>
      )}
      {state === 'holding' && <HoldEnding holdMs={waiting ? HOLD.untimedMs : HOLD.pauseMs} />}
    </div>
  );
}

/**
 * A hold goes on by itself after a while (HOLD): its last seconds are said, once, rather than the next question
 * arriving out of nowhere (WCAG 2.2.1).
 */
function HoldEnding({ holdMs }: { holdMs: number }) {
  const [since] = useState(() => Date.now());
  const now = useNow(1000);
  const left = Math.ceil((since + holdMs - now) / 1000);
  const ending = left * 1000 <= HOLD.warnMs;
  return (
    <p className="mt-2 w-full text-right text-xs text-fg-3">
      {/* Said once, as the last seconds begin (a line changing every second would talk over everything). */}
      <span role="status" className="sr-only">
        {ending ? `Мачът продължава сам след ${HOLD.warnMs / 1000} секунди. „Продължи“ го пуска веднага.` : ''}
      </span>
      {ending && <span aria-hidden>Мачът продължава сам след {Math.max(0, left)} с</span>}
    </p>
  );
}

/**
 * „Продължи“, taking the focus from the button that asked for the hold (it's gone once the hold is on, and focus would
 * fall to the page): only when the player asked, not when a run without a clock holds every answer by itself.
 */
function useFocusOnHold(holding: boolean) {
  const button = useRef<HTMLButtonElement>(null);
  const wasHolding = useRef(holding);
  useEffect(() => {
    if (holding && !wasHolding.current && button.current?.ownerDocument.activeElement === document.body)
      button.current.focus();
    wasHolding.current = holding;
  }, [holding]);
  return button;
}

/** Enter goes on from a held answer, as „Продължи“ does (not while typing, or on a focused button that has its own). */
function useContinueKey(on: boolean) {
  useEffect(() => {
    if (!on) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.repeat) return;
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, button, a')) return;
      e.preventDefault();
      actions.resumeAfterFact();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [on]);
}

/** „62% знаят“: how everyone who played this question before did on it (once enough have). */
function CrowdNote({ crowd, kind }: { crowd: Crowd; kind: QuestionPayload['kind'] }) {
  const share = percent(crowd.known);
  return (
    <m.span
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.35 }}
      className="inline-flex items-center gap-1.5 text-sm text-fg-3"
      title={`От ${fmt(crowd.answers)} отговора досега`}
    >
      <Users aria-hidden className="size-3.5" />
      {kind === 'number'
        ? `${share} бяха близо`
        : kind === 'order'
          ? `${share} подредиха всичко`
          : crowd.known < 0.1
            ? `Само ${share} знаят`
            : `${share} знаят`}
    </m.span>
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
      <m.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
        className="inline-flex items-center gap-2 text-sm text-fg-2"
      >
        <Spinner className="size-3.5" /> Изпращаме отговора…
      </m.p>
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
 * What a right answer would score if you picked it now: the speed bonus draining in front of you makes every question
 * a race — once the question has been read (it holds still for its reading window). Once you've picked, it stops at
 * what your pick can earn.
 */
function LivePoints({ game, q }: { game: LiveGame; q: QuestionPayload }) {
  const picked = game.myChoice !== null;
  const now = useNow(100, !picked);
  // A pick from before a reconnect: when it was made isn't known here.
  if (game.myChoice === -1) return null;
  const streak = (game.standings.find((s) => s.id === game.start.youId)?.streak ?? 0) + 1;
  const openedAt = game.deadline - q.durationMs;
  const points = answerPoints({
    timeMs: Math.max(0, now - openedAt),
    // A server from before Соло's paces sends no speedMs: then it's the question's clock.
    limitMs: q.speedMs ?? q.durationMs,
    readMs: q.readMs,
    streak,
    doubled: game.doubled,
    retried: game.retryPrompt,
    untimed: q.speedMs === null,
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

function TimerRing({
  deadline,
  duration,
  stopped,
  untimed,
}: {
  deadline: number;
  duration: number;
  stopped: boolean;
  /** Соло without a clock: no countdown, just the sign that there's none. */
  untimed?: boolean;
}) {
  const now = useNow(100, !stopped && !untimed);
  const [frozen, setFrozen] = useState<number | null>(null);
  useEffect(() => {
    if (stopped && frozen === null) setFrozen(Math.max(0, deadline - Date.now()));
  }, [stopped, frozen, deadline]);
  const remaining = frozen ?? Math.max(0, deadline - now);
  const secs = Math.ceil(remaining / 1000);
  const pct = Math.min(1, remaining / duration);
  // The theme's own (deeper on the light one, where the bright ones don't read on white).
  const color = pct > 0.5 ? 'var(--color-cyan)' : pct > 0.25 ? 'var(--color-gold)' : 'var(--color-bad)';

  const lastTick = useRef(secs);
  useEffect(() => {
    if (!stopped && !untimed && secs !== lastTick.current && secs <= 5 && secs > 0) sfx.tick(secs);
    lastTick.current = secs;
  }, [secs, stopped, untimed]);

  if (untimed)
    return (
      <div
        role="img"
        aria-label="Без часовник"
        className="relative grid size-14 shrink-0 place-items-center rounded-full border-[3.5px] border-line short:max-sm:size-12 sm:size-20 flat:size-12"
      >
        <span aria-hidden className="font-display text-2xl font-bold text-fg-3 sm:text-3xl flat:text-xl">
          ∞
        </span>
      </div>
    );

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
      {/* overflow-visible: the ring's glow reaches past the drawing's box, and a clipped glow shows up as a square.
          will-change: a layer of its own. The ring is redrawn every frame while it runs, and in the card's layer each
          frame redrew the card's blurred glow with it. */}
      <svg
        viewBox="0 0 64 64"
        className="absolute inset-0 -rotate-90 overflow-visible will-change-transform"
        aria-hidden
      >
        <circle cx="32" cy="32" r={R} fill="none" style={{ stroke: 'var(--color-line)' }} strokeWidth="5" />
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
      <span
        className="font-display text-xl font-bold tabular-nums short:max-sm:text-lg sm:text-2xl flat:text-lg"
        style={{ color }}
        aria-hidden
      >
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
  compact = false,
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
  /** Two by two under a picture, on a phone too. */
  compact?: boolean;
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
  const keys = useMatchKeysOn();
  return (
    // The hover lift is on the button, the hover itself on this wrapper that stays put: lifting the button can't move
    // it out from under a resting pointer (which made it flicker between raised and lowered).
    <div className="group/lift grid">
      <m.button
        type="button"
        data-answer={index}
        aria-keyshortcuts={keys ? String(index + 1) : undefined}
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
          compact && 'max-sm:min-h-12 max-sm:gap-2 max-sm:px-2.5 max-sm:py-2 sm:min-h-16 sm:py-3',
          liftable && 'group-hover/lift:-translate-y-[3px] motion-reduce:group-hover/lift:translate-y-0',
          // Told apart by more than colour: the right answer is filled in, a wrong pick an outline with its text struck
          // through.
          state === 'correct'
            ? 'border-emerald-300 bg-emerald-400 text-on-fill shadow-[0_0_40px_-8px_rgb(52_211_153/0.8)]'
            : state === 'wrong'
              ? 'border-2 border-rose-400 bg-transparent'
              : // Not .glass: no backdrop blur on buttons that move with every question and reveal (a moving blurred
                // backdrop is re-blurred each frame on a phone's GPU); the page behind is soft already.
                state === 'selected'
                ? 'border-(--pick) bg-tint/[0.045] shadow-[0_0_0_1px_var(--pick),0_0_36px_-8px_var(--pick)]'
                : 'border-line bg-tint/[0.045] hover:bg-tint/[0.08]',
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
          className={clsx(
            'grid size-10 shrink-0 place-items-center rounded-xl font-display text-base font-bold short:max-sm:size-8 flat:size-8',
            compact && 'max-sm:size-8',
          )}
          style={{
            // On the filled right answer, a darker badge; on a wrong pick, a solid red one.
            background:
              state === 'correct'
                ? 'color-mix(in oklab, currentColor 16%, transparent)'
                : state === 'wrong'
                  ? '#fb7185'
                  : `${color}22`,
            color: state === 'correct' ? 'inherit' : state === 'wrong' ? '#0b0a14' : accentText(color),
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
        <span
          className={clsx(
            'flex-1 font-semibold sm:text-base large:text-lg',
            compact ? 'text-sm' : 'text-[15px]',
            state === 'wrong' && 'line-through decoration-rose-400 decoration-2',
          )}
        >
          <span className="sr-only">{LETTERS[index]}) </span>
          {keepTogether(text)}
          {status.length > 0 && <span className="sr-only"> — {status.join(' — ')}</span>}
        </span>
        {/* Kept in place (only hidden) once the answer is in, so the text beside it doesn't reflow. */}
        <KeyHint className={clsx('shrink-0 self-start', state !== 'idle' && 'invisible')}>{String(index + 1)}</KeyHint>
        {pickers.length > 0 && (
          <span aria-hidden className="flex -space-x-2">
            {pickers.slice(0, 4).map((p) => (
              <m.span key={p.id} initial={{ scale: 0 }} animate={{ scale: 1 }} title={p.name}>
                <Avatar avatar={p.avatar} frame={p.frame} size={26} />
              </m.span>
            ))}
            {pickers.length > 4 && (
              <span className="grid size-[26px] place-items-center rounded-full bg-tint/15 text-xs font-bold">
                +{pickers.length - 4}
              </span>
            )}
          </span>
        )}
      </m.button>
    </div>
  );
}

function RevealSummary({ result }: { result: NonNullable<LiveGame['reveal']>['results'][string] }) {
  return (
    <m.div
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
              <Emoji e="🔁" /> Втори шанс · ½ точки
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
            {result.choice === null ? (
              <>
                Времето изтече <Emoji e="⏱️" />
              </>
            ) : (
              <>
                Грешно <Emoji e="😬" />
              </>
            )}
          </span>
          {result.points < 0 && (
            <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-sm font-bold text-rose-300">
              <Emoji e="💰" /> −{fmt(-result.points)}
            </span>
          )}
        </>
      )}
    </m.div>
  );
}
