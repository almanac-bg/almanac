/** Answer letters and accent colors: the same in the match, the review afterwards, the question editor and admin. */
export const LETTERS = ['А', 'Б', 'В', 'Г'];
export const OPTION_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6'];

/**
 * An accent colour (an option's, a category's, a rank's) as text: as it is on the dark theme, mixed towards the ink on
 * the light one (`--accent-ink`), where a pale amber or cyan wouldn't read on paper.
 */
export const accentText = (color: string) => `color-mix(in oklab, ${color} var(--accent-ink), var(--color-fg))`;
