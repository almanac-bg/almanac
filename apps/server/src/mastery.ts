import { type CategoryId, type CategoryMastery, MASTERY, MASTERY_TIERS } from '@quiz/shared';
import { all, one, run } from './db';
import { playerSkill } from './skill';

/**
 * Category mastery (MASTERY_TIERS): a player's skill in a category against everyone ranked there. A tier, once reached,
 * is kept, like an achievement — it was earned against the field as it was then.
 */

/** Tiers' cut-offs move slowly: worked out at most this often, not at the end of every match. */
const CUTOFFS_FOR_MS = 10 * 60_000;
const cutoffCache = new Map<CategoryId, { at: number; cutoffs: number[] }>();

// MASTERY.minAnswers, written out: a bound parameter wouldn't use the index (player_skill_ranked) built for it.
const RANKED = `category = ? AND answers >= ${MASTERY.minAnswers}`;

/**
 * The skill each tier needs in a category: the best `top` share's lowest once MASTERY.population players are ranked
 * there, else the tier's `fixed` skill.
 */
export function masteryCutoffs(category: CategoryId, now = Date.now()): number[] {
  const cached = cutoffCache.get(category);
  if (cached && now - cached.at < CUTOFFS_FOR_MS) return cached.cutoffs;
  const ranked = one<{ n: number }>(`SELECT COUNT(*) AS n FROM player_skill WHERE ${RANKED}`, category)!.n;
  const cutoffs =
    ranked < MASTERY.population
      ? MASTERY_TIERS.map((t) => t.fixed)
      : MASTERY_TIERS.map(
          (t) =>
            one<{ rating: number }>(
              `SELECT rating FROM player_skill WHERE ${RANKED} ORDER BY rating DESC LIMIT 1 OFFSET ?`,
              category,
              Math.max(1, Math.ceil(t.top * ranked)) - 1,
            )!.rating,
        );
  cutoffCache.set(category, { at: now, cutoffs });
  return cutoffs;
}

/** Forgets the cut-offs worked out so far (tests). */
export const forgetMasteryCutoffs = () => cutoffCache.clear();

/** The tier a player's skill in a category is at now: null below the first, or not ranked there yet. */
export function currentTier(userId: number, category: CategoryId, now = Date.now()): number | null {
  const skill = playerSkill(userId, category);
  if (skill.answers < MASTERY.minAnswers) return null;
  const tier = masteryCutoffs(category, now).findLastIndex((cutoff) => skill.rating >= cutoff);
  return tier < 0 ? null : tier;
}

/** The tiers a player has earned, a category each. */
export const earnedMastery = (userId: number): CategoryMastery[] =>
  all<CategoryMastery>('SELECT category, tier FROM mastery WHERE user_id = ?', userId);

/**
 * After a match: in each category it touched, a tier above what the player had earned is theirs now. Returns the new
 * ones. Call inside the match's transaction, after its answers have moved the player's skill.
 */
export function settleMastery(userId: number, categories: Iterable<CategoryId>, now = Date.now()): CategoryMastery[] {
  const earned = new Map(earnedMastery(userId).map((m) => [m.category, m.tier]));
  const reached: CategoryMastery[] = [];
  for (const category of new Set(categories)) {
    const tier = currentTier(userId, category, now);
    if (tier === null || tier <= (earned.get(category) ?? -1)) continue;
    run(
      `INSERT INTO mastery (user_id, category, tier, earned_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, category) DO UPDATE SET tier = excluded.tier, earned_at = excluded.earned_at`,
      userId,
      category,
      tier,
      now,
    );
    reached.push({ category, tier });
  }
  return reached;
}

/** A player's best tier (between equal ones, where their skill is highest): what the match intro shows. */
export function bestMastery(userId: number): CategoryMastery | undefined {
  return one<CategoryMastery>(
    `SELECT m.category, m.tier FROM mastery m
     LEFT JOIN player_skill s ON s.user_id = m.user_id AND s.category = m.category
     WHERE m.user_id = ? ORDER BY m.tier DESC, s.rating DESC LIMIT 1`,
    userId,
  );
}
