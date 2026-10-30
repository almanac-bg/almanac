import { CATEGORIES, type CategoryId, categoryById } from './categories';

/**
 * Category mastery: how well a player knows a category next to everyone else, from their skill in it (the server's
 * skill model, measured by every answer). Earned once and kept, like an achievement, with a title to wear for each
 * („Майстор · История“). A tier is an index into MASTERY_TIERS (0 = Познавач).
 */
export const MASTERY_TIERS = [
  { id: 'knower', name: 'Познавач', icon: '🥉', top: 0.5, fixed: 1100 },
  { id: 'expert', name: 'Експерт', icon: '🥈', top: 0.2, fixed: 1250 },
  { id: 'master', name: 'Майстор', icon: '🥇', top: 0.05, fixed: 1400 },
] as const;

export const MASTERY = {
  /**
   * Answers in a category before a player is ranked in it (and counted among those ranked). A tier is kept for good, so
   * not from a first lucky streak: skill moves fast over the first answers.
   */
  minAnswers: 60,
  /**
   * Players ranked in a category before its tiers go by share (`top`: the best half, fifth, twentieth); until then a
   * fixed skill (`fixed`) decides, since a share of a handful of players means little.
   */
  population: 50,
} as const;

/** A player's tier in one category, as the profile and the match intro show it. */
export interface CategoryMastery {
  category: CategoryId;
  tier: number;
}

export const masteryName = (m: CategoryMastery) =>
  `${MASTERY_TIERS[m.tier].name} · ${categoryById(m.category)?.name ?? ''}`;

export const masteryTitleId = (m: CategoryMastery) => `${m.category}_${MASTERY_TIERS[m.tier].id}`;

/** The titles mastery earns: one per category and tier. */
export const MASTERY_TITLES = CATEGORIES.flatMap((c) =>
  MASTERY_TIERS.map((_, tier) => ({
    id: masteryTitleId({ category: c.id, tier }),
    name: masteryName({ category: c.id, tier }),
    mastery: { category: c.id as CategoryId, tier },
  })),
);
