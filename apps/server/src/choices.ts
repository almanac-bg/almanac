import { CHOICE_EVERY, choiceKey, choiceOffers, LEVEL_CHOICES, type PendingChoice, type UnlockRef } from '@quiz/shared';
import { all, run } from './db';

/**
 * The level milestones' rewards (LEVEL_CHOICES): every CHOICE_EVERY levels a player picks one of two, and keeps what
 * they picked (`level_choices`). What they left can be picked at a later milestone instead of its own pair.
 */

/** Each milestone's pick, by its level (choiceKey). */
export function picksOf(userId: number): Map<number, string> {
  return new Map(
    all<{ level: number; kind: string; item_id: string }>(
      'SELECT level, kind, item_id FROM level_choices WHERE user_id = ?',
      userId,
    ).map((r) => [r.level, `${r.kind}:${r.item_id}`]),
  );
}

/** The milestones reached and not yet decided, lowest first, with what each offers. */
export function pendingChoices(userId: number, level: number, picks = picksOf(userId)): PendingChoice[] {
  return LEVEL_CHOICES.filter((c) => c.level <= level && !picks.has(c.level)).map((c) => ({
    level: c.level,
    ...choiceOffers(c.level, picks),
  }));
}

/** Picks a milestone's reward: its own, or one left at a milestone decided before it. */
export function chooseReward(
  userId: number,
  playerLevel: number,
  milestone: number,
  item: UnlockRef,
): { ok: true } | { ok: false; error: string } {
  if (milestone % CHOICE_EVERY !== 0 || !LEVEL_CHOICES.some((c) => c.level === milestone))
    return { ok: false, error: 'На това ниво няма награда за избор.' };
  if (milestone > playerLevel) return { ok: false, error: 'Това ниво още не е стигнато.' };
  const picks = picksOf(userId);
  if (picks.has(milestone)) return { ok: false, error: 'Наградата за това ниво вече е избрана.' };
  const { options, earlier } = choiceOffers(milestone, picks);
  if (![...options, ...earlier].some((o) => choiceKey(o) === choiceKey(item)))
    return { ok: false, error: 'Тази награда не е сред избора за това ниво.' };
  // The primary key (one pick a milestone) and the unique item (once each) hold under two quick taps.
  const added = run(
    `INSERT INTO level_choices (user_id, level, kind, item_id, chosen_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT DO NOTHING`,
    userId,
    milestone,
    item.kind,
    item.id,
    Date.now(),
  ).changes;
  return added ? { ok: true } : { ok: false, error: 'Наградата за това ниво вече е избрана.' };
}
