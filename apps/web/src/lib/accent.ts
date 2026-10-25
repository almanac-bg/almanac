import type { ModeDef } from '@quiz/shared';
import type { CSSProperties } from 'react';

/**
 * A chip or button filled with a mode's colors, with text on it. The accents are light (white on them is as low as
 * 1.5:1), so the text is dark; and the fill goes only halfway to the second color, which in some modes (Соло, Дуел,
 * Трио) is too dark for dark text. That keeps the text above 5:1 across the whole fill, in every mode.
 */
export function accentFill(mode: ModeDef): CSSProperties {
  const [a, b] = mode.accent;
  return { background: `linear-gradient(90deg, ${a}, color-mix(in srgb, ${a}, ${b}))`, color: 'var(--color-ink)' };
}
