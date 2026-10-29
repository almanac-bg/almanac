import { actions, fmt, type LiveGame } from '@quiz/client';
import { type GamePlayer, ORDER, type PlayerResult, type QuestionPayload, type RevealPayload } from '@quiz/shared';
import clsx from 'clsx';
import { Check, Flame, Lock } from 'lucide-react';
import { m } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { keepTogether } from '../../lib/typography';
import { Avatar } from '../Avatar';
import { Emoji } from '../Emoji';
import { Button } from '../ui';
import { LETTERS } from './answers';
import { KeyHint } from './Powerups';

/** An item's value as the reveal shows it: a year as it's written (BC ones „пр.н.е.“), any other number with its unit. */
export function orderValueText(value: number, unit: string): string {
  if (!unit && Number.isInteger(value)) return value < 0 ? `${-value} г. пр.н.е.` : String(value);
  const text = value.toLocaleString('bg-BG', { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
}

/**
 * „Подреди“: the four things are tapped in the order they go, each moving up to its place with its number; a tap on a
 * placed one takes it back out (and those after it move up). The keys 1–4 tap А–Г (GamePage, as for options), ⌫ takes
 * back the last, Enter locks it in. Once it's in, the order stays on show.
 */
export function OrderAnswer({ game, q, disabled }: { game: LiveGame; q: QuestionPayload; disabled: boolean }) {
  const items = q.order!.items;
  const locked = game.myChoice !== null;
  const [picked, setPicked] = useState<number[]>([]);
  const order = locked && game.myOrder ? game.myOrder : picked;
  const inert = disabled || locked;
  const complete = order.length === items.length;

  const toggle = (item: number) =>
    setPicked((p) => (p.includes(item) ? p.filter((i) => i !== item) : p.length < items.length ? [...p, item] : p));
  const undo = () => setPicked((p) => p.slice(0, -1));
  const submit = () => {
    if (!inert && picked.length === items.length) actions.arrange(picked);
  };

  const keys = useRef({ undo, submit });
  keys.current = { undo, submit };
  useEffect(() => {
    if (inert) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (document.querySelector('[role="dialog"], [aria-modal="true"]')) return;
      const target = e.target instanceof Element ? e.target : null;
      if (target?.closest('input, textarea, select, [contenteditable]')) return;
      if (e.key === 'Backspace') keys.current.undo();
      else if (e.key === 'Enter' && !target?.closest('button')) keys.current.submit();
      else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [inert]);

  // The placed ones first, in their order; the rest after them as shown.
  const rows = [...order, ...items.map((_, i) => i).filter((i) => !order.includes(i))];
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-3 short:gap-2">
      {!locked && (
        <p className="text-center text-xs text-fg-3">
          Докосни ги в реда, в който вървят · по {ORDER.perItem} точки за всяко на мястото му
        </p>
      )}
      <ol className="grid gap-2 short:gap-1.5" aria-label="Твоят ред">
        {rows.map((item) => {
          const place = order.indexOf(item);
          const placed = place >= 0;
          return (
            <m.li key={item} layout transition={{ type: 'spring', stiffness: 500, damping: 38 }}>
              <button
                type="button"
                aria-disabled={inert || undefined}
                aria-pressed={placed}
                data-answer={item}
                aria-keyshortcuts={String(item + 1)}
                onClick={() => !inert && toggle(item)}
                className={clsx(
                  'focus-ring flex min-h-14 w-full items-center gap-3 rounded-2xl border px-3.5 py-2.5 text-left transition-[background,border-color,opacity] duration-200 short:min-h-11 short:py-1.5 sm:min-h-16',
                  placed
                    ? locked
                      ? 'border-emerald-400/40 bg-emerald-500/10'
                      : 'border-violet-300/60 bg-violet-500/15'
                    : 'border-line bg-tint/[0.045]',
                  !inert && 'hover:bg-tint/[0.08]',
                  inert && !placed && 'opacity-45',
                )}
              >
                <span
                  aria-hidden
                  className={clsx(
                    'grid size-9 shrink-0 place-items-center rounded-full font-display text-base font-bold short:size-8',
                    placed
                      ? locked
                        ? 'bg-emerald-400 text-emerald-950'
                        : 'bg-violet-400 text-violet-950'
                      : 'border border-dashed border-tint/25 text-fg-3',
                  )}
                >
                  {placed ? place + 1 : LETTERS[item]}
                </span>
                <span className="flex-1 text-[15px] font-semibold sm:text-base">
                  <span className="sr-only">{LETTERS[item]}) </span>
                  {keepTogether(items[item])}
                  <span className="sr-only">{placed ? ` — на място ${place + 1}` : ' — не е подредено'}</span>
                </span>
                {locked && placed ? (
                  <Lock aria-hidden className="size-4 shrink-0 text-emerald-300" />
                ) : (
                  <KeyHint className="shrink-0">{String(item + 1)}</KeyHint>
                )}
              </button>
            </m.li>
          );
        })}
      </ol>
      <p aria-live="polite" className="sr-only">
        {locked ? 'Редът е заключен.' : `Подредени ${order.length} от ${items.length}.`}
      </p>
      {!locked && (
        <Button size="lg" className="w-full short:h-12" disabled={!complete || inert} onClick={submit}>
          {complete ? 'Заключи' : `Подредени ${order.length} от ${items.length}`}
        </Button>
      )}
    </div>
  );
}

/**
 * The right order: each thing in its place with its year (or number), marked where you had it right; with others in
 * the match, how many each had in place.
 */
export function OrderReveal({ game, q, reveal }: { game: LiveGame; q: QuestionPayload; reveal: RevealPayload }) {
  const { items } = q.order!;
  const { order: right, values, unit } = reveal.answerOrder!;
  const youId = game.start.youId;
  const given = reveal.results[youId]?.order?.given ?? null;
  const others = Object.entries(reveal.results)
    .filter(([id, r]) => id !== youId && r.order)
    .map(([id, r]) => ({ id, right: r.order!.right, player: game.players[id] }))
    .filter((o): o is typeof o & { player: GamePlayer } => !!o.player)
    .sort((a, b) => b.right - a.right);
  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-2">
      <ol className="grid gap-2 short:gap-1.5" aria-label="Правилният ред">
        {right.map((item, place) => {
          const yours = given?.indexOf(item) ?? -1;
          const hit = yours === place;
          return (
            <m.li
              key={item}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.08 * place }}
              className={clsx(
                'flex min-h-14 items-center gap-3 rounded-2xl border px-3.5 py-2.5 short:min-h-11 short:py-1.5',
                hit ? 'border-emerald-400/60 bg-emerald-500/15' : 'border-line bg-tint/[0.045]',
              )}
            >
              <span
                aria-hidden
                className="grid size-9 shrink-0 place-items-center rounded-full bg-amber-300 font-display text-base font-bold text-amber-950 short:size-8"
              >
                {place + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold sm:text-base">{keepTogether(items[item])}</span>
                {values && (
                  <span className="block text-sm font-semibold text-amber-200 tabular-nums">
                    {orderValueText(values[item], unit)}
                  </span>
                )}
              </span>
              {given &&
                (hit ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-sm font-bold text-emerald-300">
                    <Check aria-hidden className="size-4" strokeWidth={3} />
                    <span className="sr-only">При теб също на място {place + 1}</span>
                  </span>
                ) : (
                  <span className="shrink-0 text-xs font-semibold text-rose-300">
                    {yours >= 0 ? `при теб ${yours + 1}.` : ''}
                  </span>
                ))}
            </m.li>
          );
        })}
      </ol>
      {others.length > 0 && (
        <ul className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1.5 pt-1 text-sm text-fg-2">
          {others.slice(0, 6).map((o) => (
            <li key={o.id} className="inline-flex items-center gap-1.5" title={o.player.name}>
              <Avatar avatar={o.player.avatar} frame={o.player.frame} size={22} />
              <span className="tabular-nums">
                <span className="sr-only">{o.player.name}: </span>
                {o.right}/{items.length}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How your order did: its points, how many were in place, and the streak it kept (all of them right). */
export function OrderSummary({ result }: { result: PlayerResult }) {
  const placed = result.order?.right ?? 0;
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.8, y: 10 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 18 }}
      className="flex flex-wrap items-center gap-3"
    >
      {!result.order?.given ? (
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
          <span
            className={clsx(
              'rounded-full px-2.5 py-1 text-sm font-bold',
              result.correct ? 'bg-amber-400/20 text-amber-200' : 'bg-tint/10 text-fg-2',
            )}
          >
            {result.correct ? '🎯 Всичко на място!' : `${placed} от ${ORDER.items} на място`}
          </span>
          {result.streak >= 2 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-orange-500/15 px-2.5 py-1 text-sm font-bold text-orange-300">
              <Flame className="size-4" /> Серия {result.streak}
            </span>
          )}
        </>
      )}
    </m.div>
  );
}

/**
 * An order's answer in a list of questions (the review, the almanac): the things in their right order with their
 * numbers, marking the ones `given` had in place.
 */
export function RightOrderList({
  items,
  unit,
  given,
}: {
  /** `value`: none on a host's own question without numbers. */
  items: { text: string; value: number | null }[];
  unit: string;
  /** For each place, whether yours had the right thing there (none: not yours to mark). */
  given?: boolean[];
}) {
  return (
    <ol className="mt-1.5 space-y-0.5 text-sm">
      {items.map((item, place) => (
        <li key={item.text} className="flex gap-2">
          <span className="w-4 shrink-0 text-right font-semibold text-fg-3 tabular-nums">{place + 1}.</span>
          <span className={clsx('min-w-0', given ? (given[place] ? 'text-emerald-300' : 'text-fg-2') : 'text-fg')}>
            {keepTogether(item.text)}
            {item.value !== null && (
              <span className="text-fg-3 tabular-nums"> · {orderValueText(item.value, unit)}</span>
            )}
            {given?.[place] && <span className="sr-only"> (при теб на място)</span>}
          </span>
        </li>
      ))}
    </ol>
  );
}
