import { actions, fmt, type LiveGame } from '@quiz/client';
import {
  decimalsOf,
  type GamePlayer,
  isExact,
  NUMBER,
  type PlayerResult,
  type QuestionPayload,
  type RevealPayload,
  snapNumber,
} from '@quiz/shared';
import clsx from 'clsx';
import { Delete, Flame, Lock, Minus, Plus } from 'lucide-react';
import { motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { Button } from '../ui';
import { lineRange, maxDigits, numberText, offText, placeOn } from './numbers';

type Input = NonNullable<QuestionPayload['number']>;

/** A small range of whole numbers (a percentage, an age) is a slider; anything else is typed. */
const slides = (n: Input) => n.scale === 'linear' && n.step >= 1 && n.max - n.min <= 100;

/** Typed text as a number: a comma or a dot for the decimals, a minus in front; null while it's no number yet. */
function parse(text: string): number | null {
  if (!/\d/.test(text)) return null;
  const value = Number(text.replace(',', '.').replace('−', '-'));
  return Number.isFinite(value) ? value : null;
}

/**
 * The answer to a number question: typed on a keypad of its own (the phone's keyboard would cover half the screen) or
 * the keyboard's digits, or slid to on a small range, then locked in. Once it's in, the number stays on show.
 */
export function NumberAnswer({ game, q, disabled }: { game: LiveGame; q: QuestionPayload; disabled: boolean }) {
  const n = q.number!;
  const locked = game.myChoice !== null;
  const slider = slides(n);
  // Empty until it's moved, a slider too: a thumb resting in the middle mustn't be an answer by itself.
  const [text, setText] = useState('');
  const value = parse(text);
  const valid = value !== null && value >= n.min && value <= n.max;
  const decimals = decimalsOf(n.step) > 0;
  const inert = disabled || locked;

  const type = (key: string) =>
    setText((t) => {
      if (key === ',') return decimals && !t.includes(',') ? `${t || '0'},` : t;
      if (key === '−') return t.startsWith('−') ? t.slice(1) : `−${t}`;
      const digits = t.replace(/[^\d]/g, '').length;
      if (digits >= maxDigits(n)) return t;
      // No leading zeros ("007"), but "0,5" is fine.
      return t === '0' || t === '−0' ? t.slice(0, -1) + key : t + key;
    });
  const erase = () => setText((t) => t.slice(0, -1));
  const submit = () => {
    if (valid && !inert) actions.guess(snapNumber(value, n));
  };

  // The keyboard types too: digits, a comma, a minus, ⌫ and Enter (a key on a focused button stays that button's).
  const keys = useRef({ type, erase, submit });
  keys.current = { type, erase, submit };
  useEffect(() => {
    if (inert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('textarea, select, [contenteditable], input:not([type="range"])')) return;
      const { type, erase, submit } = keys.current;
      if (/^\d$/.test(e.key) && !slider) type(e.key);
      else if ((e.key === ',' || e.key === '.') && !slider) type(',');
      else if (e.key === '-' && n.min < 0 && !slider) type('−');
      else if (e.key === 'Backspace' && !slider) erase();
      else if (e.key === 'Enter' && !target?.closest('button')) submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inert, slider, n.min]);

  const shown = locked && game.myGuess !== null ? game.myGuess : value;
  const middle = snapNumber((n.min + n.max) / 2, n);
  return (
    <div className="mx-auto flex w-full max-w-sm flex-col items-center gap-3 short:gap-2">
      <output
        aria-live="polite"
        aria-label={shown === null ? 'Още няма число' : `Твоят отговор: ${numberText(shown, n)}`}
        className={clsx(
          'flex min-h-16 w-full items-center justify-center gap-2 rounded-2xl border px-4 font-display text-4xl font-bold tabular-nums short:min-h-12 short:text-3xl',
          locked ? 'border-emerald-400/40 bg-emerald-500/10 text-emerald-100' : 'border-line bg-tint/[0.045]',
          !locked && text && !valid && 'border-rose-400/50',
        )}
      >
        {locked && <Lock aria-hidden className="size-5 text-emerald-300" />}
        {shown === null ? (
          <span className="text-fg-3">{text || '?'}</span>
        ) : locked ? (
          numberText(shown, n)
        ) : (
          <>
            <span>{slider ? numberText(shown, { ...n, unit: '' }) : text}</span>
            {n.unit && <span className="text-xl font-semibold text-fg-2">{n.unit}</span>}
          </>
        )}
      </output>
      {!locked && (
        <div className="text-center text-xs leading-relaxed">
          <p className={clsx(text && !valid ? 'font-semibold text-rose-300' : 'text-fg-2')}>
            от {numberText(n.min, n)} до {numberText(n.max, n)}
          </p>
          <p className="text-fg-3">
            до {fmt(NUMBER.points)} точки според близостта · +{NUMBER.exactBonus} за точно
          </p>
        </div>
      )}
      {!locked &&
        (slider ? (
          <div className="flex w-full items-center gap-3">
            <StepButton
              label="По-малко"
              disabled={inert}
              onClick={() => setText(String(Math.max(n.min, (value ?? middle) - n.step)))}
            >
              <Minus className="size-5" />
            </StepButton>
            <input
              type="range"
              min={n.min}
              max={n.max}
              step={n.step}
              value={value ?? middle}
              disabled={inert}
              onChange={(e) => setText(e.target.value)}
              aria-label="Твоят отговор"
              className="h-11 flex-1 accent-violet-400"
            />
            <StepButton
              label="Повече"
              disabled={inert}
              onClick={() => setText(String(Math.min(n.max, (value ?? middle) + n.step)))}
            >
              <Plus className="size-5" />
            </StepButton>
          </div>
        ) : (
          <fieldset className="grid w-full grid-cols-3 gap-2 short:gap-1.5" aria-label="Цифри">
            {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
              <Key key={d} onClick={() => type(d)} disabled={inert}>
                {d}
              </Key>
            ))}
            {n.min < 0 ? (
              <Key onClick={() => type('−')} disabled={inert} label="Минус">
                −
              </Key>
            ) : decimals ? (
              <Key onClick={() => type(',')} disabled={inert} label="Десетична запетая">
                ,
              </Key>
            ) : (
              <span />
            )}
            <Key onClick={() => type('0')} disabled={inert}>
              0
            </Key>
            <Key onClick={erase} disabled={inert || !text} label="Изтрий">
              <Delete aria-hidden className="size-6" />
            </Key>
          </fieldset>
        ))}
      {!locked && (
        <Button size="lg" className="w-full short:h-12" disabled={!valid || inert} onClick={submit}>
          Заключи
        </Button>
      )}
    </div>
  );
}

function Key({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // A click doesn't take the focus (Tab still reaches it): Enter then locks the number in, instead of pressing the
      // last key clicked again.
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      aria-label={label}
      className="focus-ring grid h-14 place-items-center rounded-2xl border border-line bg-tint/[0.045] font-display text-2xl font-bold transition-[background,transform] select-none hover:bg-tint/[0.08] active:scale-[0.96] disabled:opacity-40 short:h-11 short:text-xl"
    >
      {children}
    </button>
  );
}

function StepButton({
  children,
  onClick,
  disabled,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="focus-ring grid size-11 shrink-0 place-items-center rounded-2xl border border-line bg-tint/[0.045] hover:bg-tint/[0.08] disabled:opacity-40"
    >
      {children}
    </button>
  );
}

/**
 * The answer on a number line: a gold pin for it, each player's number above the line (yours ringed), how far off
 * each was, and, with others in the match, who came closest.
 */
export function NumberLine({ game, q, reveal }: { game: LiveGame; q: QuestionPayload; reveal: RevealPayload }) {
  const n = q.number!;
  const answer = reveal.answerNumber!;
  const youId = game.start.youId;
  const guesses = Object.entries(reveal.results)
    .filter(([, r]) => r.number && r.number.guess !== null)
    .map(([id, r]) => ({ id, guess: r.number!.guess!, closeness: r.number!.closeness, player: game.players[id] }))
    .filter((g): g is typeof g & { player: GamePlayer } => !!g.player);
  const [lo, hi] = lineRange([answer, ...guesses.map((g) => g.guess)], n);
  const at = (v: number) => `${(placeOn(v, lo, hi, n.scale) * 100).toFixed(2)}%`;

  // Numbers close together take turns above the line, so no avatar hides another.
  const ordered = [...guesses].sort((a, b) => a.guess - b.guess);
  const row = new Map<string, number>();
  ordered.forEach((g, i) => {
    const prev = ordered[i - 1];
    const crowded = prev && placeOn(g.guess, lo, hi, n.scale) - placeOn(prev.guess, lo, hi, n.scale) < 0.12;
    row.set(g.id, crowded ? 1 - (row.get(prev.id) ?? 0) : 0);
  });

  const best = guesses.length > 1 ? Math.max(...guesses.map((g) => g.closeness)) : null;
  const closest = best !== null && best > 0 ? guesses.filter((g) => g.closeness === best) : [];

  return (
    <div className="glass rounded-3xl px-5 pt-4 pb-5 sm:px-8">
      <div className="relative mx-4 h-36 sm:mx-6">
        <div className="absolute inset-x-0 top-[96px] h-1 rounded-full bg-tint/10" />
        {ordered.map((g, i) => (
          <motion.div
            key={g.id}
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 + i * 0.08 }}
            className="absolute flex -translate-x-1/2 flex-col items-center"
            style={{ left: at(g.guess), top: row.get(g.id) ? 0 : 34 }}
          >
            <span
              className={clsx(
                'mb-0.5 rounded-full px-1.5 text-[11px] leading-4 font-bold whitespace-nowrap tabular-nums',
                isExact(g.guess, { answer, step: n.step }) ? 'bg-amber-400/25 text-amber-200' : 'bg-tint/10 text-fg-2',
              )}
            >
              {offText(g.guess, answer, n)}
            </span>
            <span className={clsx('rounded-full', g.id === youId && 'ring-2 ring-violet-300')} title={g.player.name}>
              <Avatar avatar={g.player.avatar} frame={g.player.frame} size={28} />
            </span>
            {/* Down to the line: from the upper row, past the lower one. */}
            <span className="w-px bg-tint/40" style={{ height: row.get(g.id) ? 50 : 16 }} />
          </motion.div>
        ))}
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
          className="absolute top-[88px] flex -translate-x-1/2 flex-col items-center"
          style={{ left: at(answer) }}
        >
          <span className="size-5 rotate-45 rounded-[4px] bg-amber-300 shadow-[0_0_18px_rgb(252_211_77/0.8)]" />
          <span className="mt-1.5 rounded-full bg-amber-300 px-2 py-0.5 font-display text-sm font-bold whitespace-nowrap text-amber-950 tabular-nums">
            {numberText(answer, n)}
          </span>
        </motion.div>
      </div>
      {closest.length > 0 && (
        <p className="text-center text-sm text-fg-2">
          {closest.length > 1 ? (
            'Еднакво близо'
          ) : (
            <>
              По-близо:{' '}
              <span className="font-semibold text-fg">{closest[0].id === youId ? 'ти' : closest[0].player.name}</span>
            </>
          )}
        </p>
      )}
      <ul className="sr-only">
        {guesses.map((g) => (
          <li key={g.id}>
            {g.id === youId ? 'Ти' : g.player.name}: {numberText(g.guess, n)} ({offText(g.guess, answer, n)})
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How your number did: its points, spot on or how far off, and the streak it kept. */
export function NumberSummary({ result, q, answer }: { result: PlayerResult; q: QuestionPayload; answer: number }) {
  const n = q.number!;
  const guess = result.number?.guess ?? null;
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="flex flex-wrap items-center gap-3"
    >
      {guess === null ? (
        <span className="font-display text-2xl font-bold text-rose-300">
          Времето изтече <Emoji e="⏱️" />
        </span>
      ) : (
        <>
          <span
            className={clsx(
              'font-display text-3xl font-black',
              result.points > 0 ? 'text-emerald-300 drop-shadow-[0_0_18px_rgb(52_211_153/0.6)]' : 'text-rose-300',
            )}
          >
            +{fmt(result.points)}
          </span>
          {isExact(guess, { answer, step: n.step }) ? (
            <span className="rounded-full bg-amber-400/20 px-2.5 py-1 text-sm font-bold text-amber-200">
              <Emoji e="🎯" /> Точно!
            </span>
          ) : (
            <span className="rounded-full bg-tint/10 px-2.5 py-1 text-sm font-bold text-fg-2">
              {result.points > 0 ? '' : 'Твърде далеч · '}
              {offText(guess, answer, n)}
            </span>
          )}
          {result.streak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300">
              <Flame className="size-4" /> Серия {result.streak}
            </span>
          )}
        </>
      )}
    </motion.div>
  );
}
