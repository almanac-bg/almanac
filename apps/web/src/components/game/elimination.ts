import type { LiveGame } from '@quiz/client';
import { knockoutsAfter } from '@quiz/shared';

/**
 * The next question after which someone is knocked out (1-based), or null when none is left. Once a question is
 * revealed, its knockout is behind us.
 */
export function nextElimination(game: LiveGame): number | null {
  const at = (game.question?.index ?? -1) + (game.phase === 'question' ? 1 : 2);
  return game.start.eliminationSchedule.find((n) => n >= at) ?? null;
}

/**
 * Who would go out if the next knockout were now: the last of those still in (in the evening Роял, the bottom few),
 * while more than two are — once anyone has points (before that, last place is only the order of the seats).
 */
export function inDropZone(game: LiveGame): Set<string> {
  const next = nextElimination(game);
  if (next === null) return new Set();
  const still = game.standings.filter((s) => s.eliminatedAt === null && !s.left);
  if (still.length <= 2 || still.every((s) => s.score === 0)) return new Set();
  const out = knockoutsAfter(game.start.mode, game.start.eliminationSchedule, next, still.length);
  return new Set(still.slice(still.length - out).map((s) => s.id));
}
