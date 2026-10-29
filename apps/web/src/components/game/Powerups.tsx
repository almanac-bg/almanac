import { actions, type LiveGame } from '@quiz/client';
import { POWERUPS, type PowerupDef, type PowerupId } from '@quiz/shared';
import clsx from 'clsx';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { Emoji } from '../Emoji';

/**
 * A key per коз, where there's a keyboard: left to right as in the bar, under 1–4 for the answers. Matched by the key's
 * place (`KeyboardEvent.code`), so a Bulgarian layout plays the same keys.
 */
export const POWERUP_KEYS: Record<PowerupId, string> = { fifty: 'Q', retry: 'W', double: 'E' };

/** A key's letter on screen: only for a mouse and a keyboard (a touch screen has no keys to press). */
export function KeyHint({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={clsx(
        'hidden min-w-5 place-items-center rounded-md border border-tint/15 px-1 font-sans text-xs leading-5 font-semibold text-fg-3 pointer-fine:inline-grid',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

// ─── Explaining them ───────────────────────────────────────────────────────

// The name is from when they were "жокери": whoever has read about one shouldn't get it again.
const EXPLAINED_KEY = 'quiz:jokers-explained';

function readExplained(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(EXPLAINED_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/**
 * Which of `ids` this player hasn't read about yet (on this device): fixed when the screen opens, and remembered as
 * read once they've been on it `readMs` — only where the whole explanation is on screen with time to read it (waiting
 * for players, the category picker, a room); `null` never remembers (the countdown, which only names them).
 */
export function useNewPowerups(ids: readonly PowerupId[], readMs: number | null): PowerupDef[] {
  const [fresh] = useState(() => {
    const explained = readExplained();
    return POWERUPS.filter((p) => ids.includes(p.id) && !explained.includes(p.id));
  });
  useEffect(() => {
    if (!fresh.length || readMs === null) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          EXPLAINED_KEY,
          JSON.stringify([...new Set([...readExplained(), ...fresh.map((p) => p.id)])]),
        );
      } catch {
        /* storage unavailable: it gets explained again next time */
      }
    }, readMs);
    return () => clearTimeout(timer);
  }, [fresh, readMs]);
  return fresh;
}

/**
 * Every коз this player hasn't read about yet, explained: for a screen with time to read before a match. Read once it
 * has been on screen a few seconds (not merely on the page, scrolled out of sight).
 */
export function FreshPowerupNotes({ className }: { className?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(false);
  const fresh = useNewPowerups(ALL_POWERUPS, inView ? 4000 : null);
  useEffect(() => {
    const el = box.current;
    if (!el || inView) return;
    const watch = new IntersectionObserver(([entry]) => entry.isIntersecting && setInView(true), { threshold: 0.6 });
    watch.observe(el);
    return () => watch.disconnect();
  }, [inView]);
  if (!fresh.length) return null;
  return (
    <div ref={box} className={className}>
      <PowerupNotes powerups={fresh} />
    </div>
  );
}

const ALL_POWERUPS = POWERUPS.map((p) => p.id);

/** What new козове do, with their keys: for the wait for players, where there are seconds to read it. */
export function PowerupNotes({ powerups, className }: { powerups: PowerupDef[]; className?: string }) {
  if (!powerups.length) return null;
  return (
    <div className={clsx('rounded-2xl border border-amber-300/35 bg-amber-400/[0.07] p-3.5 text-left', className)}>
      <p className="mb-2 t-eyebrow text-amber-300">{powerups.length === 1 ? 'Нов коз' : 'Нови козове'}</p>
      <ul className="space-y-2">
        {powerups.map((p) => (
          <li key={p.id} className="flex gap-2.5 text-sm">
            <span className="text-base leading-snug" aria-hidden>
              <Emoji e={p.icon} />
            </span>
            <span className="min-w-0 flex-1 text-fg-2">
              <span className="font-bold text-fg">{p.name}</span> — {p.description}
            </span>
            <KeyHint className="mt-px shrink-0 self-start">{POWERUP_KEYS[p.id]}</KeyHint>
          </li>
        ))}
      </ul>
      <p className="mt-2.5 text-xs text-fg-3">Всеки коз е по веднъж на мач и по един на въпрос.</p>
    </div>
  );
}

/**
 * The same, for a countdown: a glance, not a read (so it doesn't count as explained). One new коз keeps its description;
 * more get their names (what each does is in "Колекция", and on the next screen with time for it).
 */
export function PowerupNotesLine({ powerups, className }: { powerups: PowerupDef[]; className?: string }) {
  if (!powerups.length) return null;
  const [only] = powerups;
  return (
    <div className={clsx('text-sm text-balance text-fg-2', className)}>
      <p className="mb-1.5 t-eyebrow text-amber-300">{powerups.length === 1 ? 'Нов коз' : 'Нови козове'}</p>
      {powerups.length === 1 ? (
        <p>
          <Emoji e={only.icon} /> <span className="font-bold text-fg">{only.name}</span> — {only.description}
        </p>
      ) : (
        <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 font-semibold text-fg">
          {powerups.map((p) => (
            <span key={p.id}>
              <Emoji e={p.icon} /> {p.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ─── The bar ───────────────────────────────────────────────────────────────

/** Why a коз can't be played right now, if it can't (the server has the final word). */
function blockedBy(game: LiveGame, p: PowerupDef): string | null {
  if (game.usedPowerups.includes(p.id)) return 'вече е изигран';
  if (game.powerupThisQuestion) return 'само един коз на въпрос';
  if (p.notOnEasy && game.question?.difficulty === 'easy') return 'само на среден и труден въпрос';
  // True or false (a host's own set): taking one away, or a second try, would be the answer.
  if ((p.id === 'fifty' || p.id === 'retry') && (game.question?.options.length ?? 4) < 4)
    return 'не и при вярно/невярно';
  return null;
}

/** Chips for козове already working on this question. */
export function ActivePowerups({ game }: { game: LiveGame }) {
  const chips: string[] = [];
  // The bet's downside stays in view until the answer: "or nothing" is easy to miss under an icon.
  if (game.doubled) chips.push('💰 ×2 точки · грешка −500');
  if (game.retryArmed && !game.retryPrompt) chips.push('🔁 „Втори шанс“ е активен');
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

/** How long the reason a коз can't be played stays up after tapping it. */
const BLOCKED_HINT_MS = 2200;

/**
 * The козове, while the question is open. Nothing to read here: what they do was said before the match (and is in
 * "Колекция"); here a tap, or a key, and on a phone a word under each icon. Tapping one that can't be played says why
 * (a touch screen has no hover title to tell).
 */
export function PowerupBar({ game, offline }: { game: LiveGame; offline: boolean }) {
  const [hint, setHint] = useState<{ id: PowerupId; text: string } | null>(null);
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(hintTimer.current), []);
  if (game.start.powerups.length === 0) return null;
  const powerups = POWERUPS.filter((p) => game.start.powerups.includes(p.id));
  const explain = (p: PowerupDef, blocked: string) => {
    clearTimeout(hintTimer.current);
    setHint({ id: p.id, text: `${p.name}: ${blocked}` });
    hintTimer.current = setTimeout(() => setHint(null), BLOCKED_HINT_MS);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex w-full flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ActivePowerups game={game} />
        <AnimatePresence>
          {hint && (
            <motion.span
              key={hint.id}
              role="status"
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-full border border-line bg-tint/5 px-2.5 py-1 text-xs font-semibold text-fg-2"
            >
              <Emoji e={POWERUPS.find((d) => d.id === hint.id)?.icon ?? ''} /> {hint.text}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {/* Phones (and phones held sideways): one row of icons, so the козове sit on the same screen as the answers. The
          names are in each button's label. */}
      <div
        className={clsx(
          'flex flex-wrap gap-2 transition-opacity max-sm:flex-nowrap max-sm:gap-1.5 flat:flex-nowrap flat:gap-1.5',
          offline && 'opacity-50',
        )}
      >
        {powerups.map((p) => {
          const blocked = blockedBy(game, p);
          const used = game.usedPowerups.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              data-powerup={p.id}
              // Not `disabled` when it's only blocked: a tap then says why.
              disabled={offline || used}
              aria-disabled={!!blocked || undefined}
              onClick={() => (blocked ? explain(p, blocked) : actions.powerup(p.id))}
              title={blocked ? `${p.name} — ${blocked}` : `${p.name} (${POWERUP_KEYS[p.id]}): ${p.description}`}
              aria-label={`${p.name}: ${p.description}${blocked ? ` (${blocked})` : ''}`}
              aria-keyshortcuts={POWERUP_KEYS[p.id]}
              className={clsx(
                'focus-ring relative inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-all max-sm:h-12 max-sm:min-w-10 max-sm:max-w-16 max-sm:flex-1 max-sm:flex-col max-sm:justify-center max-sm:gap-0.5 max-sm:px-0 flat:w-12 flat:justify-center flat:px-0',
                used
                  ? 'border-line text-fg-3 line-through opacity-50'
                  : blocked
                    ? 'border-line text-fg-3 opacity-60'
                    : 'border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:shadow-[0_0_20px_-6px_rgb(251_191_36/0.8)]',
              )}
            >
              <span className="text-base leading-none max-sm:text-base flat:text-lg" aria-hidden>
                <Emoji e={p.icon} />
              </span>
              <span className="max-sm:hidden flat:hidden">{p.name}</span>
              <span aria-hidden className="text-xs leading-none font-semibold sm:hidden flat:hidden">
                {p.short}
              </span>
              {!used && (
                <KeyHint className="absolute -top-2 -right-1.5 bg-ink-2 leading-4 max-sm:hidden! flat:hidden!">
                  {POWERUP_KEYS[p.id]}
                </KeyHint>
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
