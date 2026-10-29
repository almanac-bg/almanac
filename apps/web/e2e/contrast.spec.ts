import { CATEGORIES, MODES, RANK_TIERS, RARITIES, TEAMS } from '@quiz/shared';
import { accentText, OPTION_COLORS } from '../src/components/game/answers';
import { PRESENCE } from '../src/components/presence';
import { expect, test } from './support';

/**
 * Every accent colour the game writes text in (a category's, a mode's, a rank's, a rarity's, a team's, an answer's, a
 * friend's presence) reads on both themes' backgrounds through accentText, and the dark text on every bright fill
 * (text-on-fill) reads on it: WCAG's 4.5:1. The light theme once turned that dark text near-white and left pale accents
 * on paper at 1.3–2.6:1. Measured in the browser, which mixes the colours as players see them.
 */
const asText = [
  ...CATEGORIES.map((c) => c.color),
  ...Object.values(MODES).flatMap((m) => m.accent),
  ...RANK_TIERS.map((t) => t.color),
  ...Object.values(RARITIES).map((r) => r.color),
  ...TEAMS.map((t) => t.color),
  ...OPTION_COLORS,
  ...Object.values(PRESENCE).map((p) => p.color),
];
/** Fills under text-on-fill: answers, the modes' (both ends of accentFill), the level badge, the right answer. */
const underDarkText = [
  ...OPTION_COLORS,
  ...Object.values(MODES).flatMap((m) => [m.accent[0], `color-mix(in srgb, ${m.accent[0]}, ${m.accent[1]})`]),
  '#a855f7',
  '#22d3ee',
  'var(--color-emerald-400)',
];

for (const theme of ['dark', 'light'] as const)
  test(`colours as text and text on colours read on the ${theme} theme`, async ({ page }) => {
    await page.goto('/privacy');
    const failures = await page.evaluate(
      ({ theme, texts, fills }) => {
        if (theme === 'light') document.documentElement.dataset.theme = 'light';
        else delete document.documentElement.dataset.theme;
        const root = getComputedStyle(document.documentElement);
        const resolve = (css: string) =>
          css.replace(/var\((--[\w-]+)\)/g, (_, name) => root.getPropertyValue(name).trim());
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        const rgb = (css: string) => {
          context.clearRect(0, 0, 1, 1);
          context.fillStyle = '#000';
          context.fillStyle = resolve(css);
          context.fillRect(0, 0, 1, 1);
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const luminance = (c: number[]) =>
          c
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (a: string, b: string) => {
          const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const out: string[] = [];
        // A browser that couldn't read the colour would leave the canvas black: every light-theme check would pass.
        if (rgb(texts[0][0]).join() === '0,0,0') out.push(`the browser can't read ${texts[0][0]}`);
        for (const [text, original] of texts)
          for (const background of ['var(--color-ink)', 'var(--color-ink-2)']) {
            const r = ratio(text, background);
            if (r < 4.5) out.push(`${original} as text on ${background}: ${r.toFixed(2)}`);
          }
        for (const fill of fills) {
          const r = ratio('var(--color-on-fill)', fill);
          if (r < 4.5) out.push(`text-on-fill on ${fill}: ${r.toFixed(2)}`);
        }
        return out;
      },
      { theme, texts: [...new Set(asText)].map((c) => [accentText(c), c]), fills: underDarkText },
    );
    expect(failures).toEqual([]);
  });
