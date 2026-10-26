import { actions, type LiveGame } from '@quiz/client';
import { POWERUPS, type PowerupDef, type PowerupId, TIME_BONUS_MS } from '@quiz/shared';
import clsx from 'clsx';
import { CircleHelp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useId, useState } from 'react';
import { myTeamOf } from './teams';

// ─── Explaining them ───────────────────────────────────────────────────────

const EXPLAINED_KEY = 'quiz:jokers-explained';

function readExplained(): string[] {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(EXPLAINED_KEY) ?? '[]');
    return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

export interface JokerGuide {
  /** Jokers new to this player: explained next to the buttons through this match, until dismissed. */
  intro: PowerupId[];
  dismissIntro: () => void;
  /** Every description, opened with "?". */
  open: boolean;
  toggle: () => void;
}

/**
 * What the jokers do. Touch screens never show a `title`, so the first match a player has a joker it's explained right
 * by the buttons, and "?" lists every description any time. Held by the match screen so it outlives each question.
 */
export function useJokerGuide(powerups: PowerupId[]): JokerGuide {
  const [intro, setIntro] = useState<PowerupId[]>(() => {
    const explained = readExplained();
    return powerups.filter((id) => !explained.includes(id));
  });
  const [open, setOpen] = useState(false);

  // Remembered as soon as it's shown: next match it's no longer news ("?" still has it).
  useEffect(() => {
    if (!intro.length) return;
    try {
      localStorage.setItem(EXPLAINED_KEY, JSON.stringify([...new Set([...readExplained(), ...intro])]));
    } catch {
      /* storage unavailable: it gets explained again next time */
    }
  }, [intro]);

  return {
    intro,
    dismissIntro: useCallback(() => setIntro([]), []),
    open,
    toggle: useCallback(() => setOpen((o) => !o), []),
  };
}

// ─── The bar ───────────────────────────────────────────────────────────────

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
export function ActiveJokers({ game }: { game: LiveGame }) {
  const chips: string[] = [];
  if (game.doubled) chips.push('💰 ×2 точки');
  if (game.retryArmed && !game.retryPrompt) chips.push('🔁 „Втори шанс“ е активен');
  if (game.extraMs > 0) chips.push(`⏳ +${Math.round(game.extraMs / 1000)} с`);
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

export function PowerupBar({ game, guide, offline }: { game: LiveGame; guide: JokerGuide; offline: boolean }) {
  const guideId = useId();
  if (game.start.powerups.length === 0) return null;

  const canFreeze = hasFreezeTarget(game);
  const jokers = POWERUPS.filter((p) => game.start.powerups.includes(p.id));
  /** Why a joker can't be played right now, if it can't. */
  const blockedBy = (p: PowerupDef) =>
    game.usedPowerups.includes(p.id)
      ? 'вече е използван'
      : game.powerupThisQuestion
        ? 'само един жокер на въпрос'
        : p.id === 'freeze' && !canFreeze
          ? 'всички съперници вече отговориха'
          : p.notOnEasy && game.question?.difficulty === 'easy'
            ? 'само на среден и труден въпрос'
            : null;
  const intro = jokers.filter((p) => guide.intro.includes(p.id) && !game.usedPowerups.includes(p.id));
  const listed = guide.open ? jokers : intro;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex w-full flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ActiveJokers game={game} />
      </div>
      {/* Phones (and phones held sideways): one row of icons, so the jokers sit on the same screen as the answers. The
          names are in each button's label and tooltip, and in the guide behind "?". */}
      <div
        className={clsx(
          'flex flex-wrap gap-2 transition-opacity max-sm:flex-nowrap max-sm:gap-1.5 flat:flex-nowrap flat:gap-1.5',
          offline && 'opacity-50',
        )}
      >
        {jokers.map((p) => {
          const blocked = blockedBy(p);
          const used = game.usedPowerups.includes(p.id);
          return (
            <button
              key={p.id}
              type="button"
              disabled={!!blocked || offline}
              onClick={() => actions.powerup(p.id)}
              title={blocked ? `${p.name} — ${blocked}` : p.description}
              aria-label={`${p.name}: ${p.description}${blocked ? ` (${blocked})` : ''}`}
              className={clsx(
                'focus-ring inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-all max-sm:min-w-10 max-sm:max-w-14 max-sm:flex-1 max-sm:justify-center max-sm:px-0 flat:w-12 flat:justify-center flat:px-0',
                used
                  ? 'border-line text-fg-3 line-through opacity-50'
                  : blocked
                    ? 'border-line text-fg-3 opacity-60'
                    : p.id === 'freeze'
                      ? 'border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:shadow-[0_0_20px_-6px_rgb(34_211_238/0.9)]'
                      : 'border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:shadow-[0_0_20px_-6px_rgb(251_191_36/0.8)]',
              )}
            >
              <span className="text-base leading-none max-sm:text-lg flat:text-lg" aria-hidden>
                {p.icon}
              </span>
              <span className="max-sm:hidden flat:hidden">{p.name}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={guide.toggle}
          aria-expanded={guide.open}
          aria-controls={guideId}
          aria-label="Какво правят жокерите?"
          title="Какво правят жокерите?"
          className={clsx(
            'focus-ring grid size-11 shrink-0 place-items-center rounded-xl border transition-colors',
            guide.open ? 'border-white/25 bg-white/10 text-fg' : 'border-line text-fg-3 hover:bg-white/5 hover:text-fg',
          )}
        >
          <CircleHelp className="size-5" />
        </button>
      </div>

      <div id={guideId}>
        <AnimatePresence initial={false}>
          {listed.length > 0 && (
            <motion.div
              key={guide.open ? 'all' : 'intro'}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <JokerList jokers={listed} blockedBy={blockedBy} onDismiss={guide.open ? null : guide.dismissIntro} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <span className="text-xs text-fg-3">
        {game.powerupThisQuestion
          ? 'Вече игра жокер на този въпрос — можеш пак на следващия.'
          : `Всеки жокер е по веднъж на мач и по един на въпрос.${
              game.start.powerups.includes('time') ? ` „Още време“ дава +${TIME_BONUS_MS / 1000} с.` : ''
            }`}
      </span>
    </motion.div>
  );
}

/** The descriptions: all of them (from "?"), or just the new ones, with a way to put the intro away. */
function JokerList({
  jokers,
  blockedBy,
  onDismiss,
}: {
  jokers: PowerupDef[];
  blockedBy: (p: PowerupDef) => string | null;
  onDismiss: (() => void) | null;
}) {
  const intro = !!onDismiss;
  return (
    <div
      className={clsx(
        'rounded-2xl border p-3',
        intro ? 'border-amber-300/35 bg-amber-400/[0.07]' : 'border-line bg-white/[0.03]',
      )}
    >
      {intro && <p className="mb-2 t-eyebrow text-amber-300">{jokers.length === 1 ? 'Нов жокер' : 'Нови жокери'}</p>}
      <ul className="space-y-2">
        {jokers.map((p) => {
          const blocked = intro ? null : blockedBy(p);
          return (
            <li key={p.id} className="flex gap-2.5 text-sm">
              <span className="text-base leading-snug" aria-hidden>
                {p.icon}
              </span>
              <span className="min-w-0 text-fg-2">
                <span className="font-bold text-fg">{p.name}</span> — {p.description}
                {blocked && <span className="ml-1 text-xs text-fg-3">({blocked})</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {onDismiss && (
        <div className="mt-1 flex justify-end">
          <button
            type="button"
            onClick={onDismiss}
            className="focus-ring -mr-1 -mb-1 h-11 rounded-xl px-3 text-sm font-bold text-amber-200 hover:bg-amber-400/10"
          >
            Разбрах
          </button>
        </div>
      )}
    </div>
  );
}
