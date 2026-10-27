import { actions, type LiveGame } from '@quiz/client';
import { POWERUPS, type PowerupDef, type PowerupId } from '@quiz/shared';
import clsx from 'clsx';
import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { myTeamOf } from './teams';

/**
 * A key per коз, where there's a keyboard: left to right as in the bar, under 1–4 for the answers. Matched by the key's
 * place (`KeyboardEvent.code`), so a Bulgarian layout plays the same keys.
 */
export const POWERUP_KEYS: Record<PowerupId, string> = { fifty: 'Q', freeze: 'W', retry: 'E', time: 'R', double: 'T' };

/** A key's letter on screen: only for a mouse and a keyboard (a touch screen has no keys to press). */
export function KeyHint({ children, className }: { children: string; className?: string }) {
  return (
    <kbd
      aria-hidden
      className={clsx(
        'hidden min-w-5 place-items-center rounded-md border border-white/15 px-1 font-sans text-[11px] leading-5 font-semibold text-fg-3 pointer-fine:inline-grid',
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
 * read once they've been on it `readMs`. Shown where there's time to read (waiting for players, the countdown), never
 * under the clock.
 */
export function useNewPowerups(ids: readonly PowerupId[], readMs = 3000): PowerupDef[] {
  const [fresh] = useState(() => {
    const explained = readExplained();
    return POWERUPS.filter((p) => ids.includes(p.id) && !explained.includes(p.id));
  });
  useEffect(() => {
    if (!fresh.length) return;
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
              {p.icon}
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
 * The same, for a countdown: a glance, not a read. One new коз keeps its description; more get their names (what each
 * does is in "Колекция").
 */
export function PowerupNotesLine({ powerups, className }: { powerups: PowerupDef[]; className?: string }) {
  if (!powerups.length) return null;
  const [only] = powerups;
  return (
    <div className={clsx('text-sm text-balance text-fg-2', className)}>
      <p className="mb-1.5 t-eyebrow text-amber-300">{powerups.length === 1 ? 'Нов коз' : 'Нови козове'}</p>
      {powerups.length === 1 ? (
        <p>
          <span aria-hidden>{only.icon}</span> <span className="font-bold text-fg">{only.name}</span> —{' '}
          {only.description}
        </p>
      ) : (
        <p className="flex flex-wrap justify-center gap-x-3 gap-y-1 font-semibold text-fg">
          {powerups.map((p) => (
            <span key={p.id}>
              <span aria-hidden>{p.icon}</span> {p.name}
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

// ─── The bar ───────────────────────────────────────────────────────────────

/** Is there an opponent still in the match (someone "Леден удар" can hit)? */
function hasFreezeTarget(game: LiveGame): boolean {
  const youId = game.start.youId;
  const myTeam = myTeamOf(game);
  return game.start.players.some((p) => {
    if (p.id === youId || game.eliminated.includes(p.id)) return false;
    if (game.standings.find((s) => s.id === p.id)?.left) return false;
    return !game.start.teams || p.team !== myTeam;
  });
}

/** Why a коз can't be played right now, if it can't (the server has the final word). */
function blockedBy(game: LiveGame, p: PowerupDef): string | null {
  if (game.usedPowerups.includes(p.id)) return 'вече е изигран';
  if (game.powerupThisQuestion) return 'само един коз на въпрос';
  if (p.notOnEasy && game.question?.difficulty === 'easy') return 'само на среден и труден въпрос';
  if (p.id === 'freeze') {
    if (game.question && game.question.index >= game.start.totalQuestions - 1) return 'няма следващ въпрос';
    if (!hasFreezeTarget(game)) return 'няма кого да замразиш';
  }
  return null;
}

/** Chips for козове already working on this question. */
export function ActivePowerups({ game }: { game: LiveGame }) {
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

const FREEZE_LOOK =
  'border-cyan-300/40 bg-cyan-400/10 text-cyan-100 hover:bg-cyan-400/20 hover:shadow-[0_0_20px_-6px_rgb(34_211_238/0.9)]';

/**
 * The козове, while the question is open. Nothing to read here: what they do was said before the match (and on the
 * results that unlocked them); here a tap, or a key.
 */
export function PowerupBar({ game, offline }: { game: LiveGame; offline: boolean }) {
  if (game.start.powerups.length === 0) return null;
  const powerups = POWERUPS.filter((p) => game.start.powerups.includes(p.id));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="flex w-full flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <ActivePowerups game={game} />
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
              disabled={!!blocked || offline}
              onClick={() => actions.powerup(p.id)}
              title={blocked ? `${p.name} — ${blocked}` : `${p.name} (${POWERUP_KEYS[p.id]}): ${p.description}`}
              aria-label={`${p.name}: ${p.description}${blocked ? ` (${blocked})` : ''}`}
              aria-keyshortcuts={POWERUP_KEYS[p.id]}
              className={clsx(
                'focus-ring relative inline-flex h-11 items-center gap-2 rounded-xl border px-3.5 text-sm font-bold transition-all max-sm:min-w-10 max-sm:max-w-14 max-sm:flex-1 max-sm:justify-center max-sm:px-0 flat:w-12 flat:justify-center flat:px-0',
                used
                  ? 'border-line text-fg-3 line-through opacity-50'
                  : blocked
                    ? 'border-line text-fg-3 opacity-60'
                    : p.id === 'freeze'
                      ? FREEZE_LOOK
                      : 'border-amber-300/30 bg-amber-400/10 text-amber-200 hover:bg-amber-400/20 hover:shadow-[0_0_20px_-6px_rgb(251_191_36/0.8)]',
              )}
            >
              <span className="text-base leading-none max-sm:text-lg flat:text-lg" aria-hidden>
                {p.icon}
              </span>
              <span className="max-sm:hidden flat:hidden">{p.name}</span>
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

/** "Леден удар" once you've answered: it hits the next question, so the choice can wait until your answer is in. */
export function FreezeAfterAnswer({ game, offline }: { game: LiveGame; offline: boolean }) {
  const freeze = POWERUPS.find((p) => p.id === 'freeze')!;
  if (!game.start.powerups.includes('freeze') || blockedBy(game, freeze)) return null;
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      data-powerup="freeze"
      disabled={offline}
      onClick={() => actions.powerup('freeze')}
      title={`${freeze.name} (${POWERUP_KEYS.freeze}): ${freeze.description}`}
      aria-label={`${freeze.name}: ${freeze.description}`}
      aria-keyshortcuts={POWERUP_KEYS.freeze}
      className={clsx(
        'focus-ring relative inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-bold transition-all disabled:opacity-50',
        FREEZE_LOOK,
      )}
    >
      <span aria-hidden>{freeze.icon}</span> {freeze.name}
      <KeyHint className="absolute -top-2 -right-1.5 bg-ink-2 leading-4">{POWERUP_KEYS.freeze}</KeyHint>
    </motion.button>
  );
}
