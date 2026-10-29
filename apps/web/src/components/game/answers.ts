/** Answer letters and accent colors: the same in the match, the review afterwards, the question editor and admin. */
export const LETTERS = ['А', 'Б', 'В', 'Г'];
export const OPTION_COLORS = ['#a78bfa', '#22d3ee', '#fbbf24', '#f472b6'];

/**
 * An accent colour (an option's, a category's, a rank's) as text: its hue as it is, its lightness kept where it reads
 * on the theme's backgrounds (`--accent-l-min`, `--accent-l-max`): a pale amber or cyan darkened on paper, a deep violet
 * lightened on ink. A browser without relative colours reads it as invalid and keeps the text colour.
 */
export const accentText = (color: string) =>
  `oklch(from ${color} clamp(var(--accent-l-min), l, var(--accent-l-max)) c h)`;
