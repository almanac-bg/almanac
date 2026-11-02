import { CATEGORIES, MODES, RANK_TIERS, RARITIES, TEAMS } from '@quiz/shared';
import { accentText, OPTION_COLORS } from '../src/components/game/answers';
import { PRESENCE } from '../src/components/presence';
import { expect, startAsGuest, test } from './support';

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

/**
 * Text as it sits in the game, not on flat ink: on a card, a chip, an accent's own tint, and over the backdrop's
 * brightest glow (Background.tsx: violet-600 at 25%), each surface painted as the browser layers it. The 31 October
 * review measured the pixels there at 3.6–4.4:1 (muted labels over the glow, the answers' letter badges, „+500“, the
 * streak and the daily-bonus chips: A11Y-3) while the flat check above passed them.
 */
const GLOW = ['var(--color-violet-600)', 0.25] as const;
type Layer = string | readonly [string, number];
const surfaces = (theme: 'dark' | 'light'): Record<string, Layer[]> => ({
  page: ['var(--color-ink)'],
  card: theme === 'light' ? ['#fff'] : ['var(--color-ink)', ['#fff', 0.055]],
  'the glow': ['var(--color-ink)', GLOW],
  'a card over the glow': theme === 'light' ? ['#fff'] : ['var(--color-ink)', GLOW, ['#fff', 0.055]],
  'a chip over the glow': ['var(--color-ink)', GLOW, ['var(--color-tint)', 0.05]],
});
/** Text on its own tinted chip, on a card: [text, the chip's colour, its alpha]. */
const onTints: [string, string, number][] = [
  ...OPTION_COLORS.map((c): [string, string, number] => [accentText(c), c, 0x22 / 255]),
  ['var(--color-amber-300)', 'var(--color-amber-400)', 0.15],
  ['var(--color-orange-300)', 'var(--color-orange-500)', 0.15],
];

for (const theme of ['dark', 'light'] as const)
  test(`muted text, chips and badges read on the surfaces they sit on, ${theme} theme`, async ({ page }) => {
    await page.goto('/privacy');
    const failures = await page.evaluate(
      ({ theme, surfaces, onTints, card }) => {
        if (theme === 'light') document.documentElement.dataset.theme = 'light';
        else delete document.documentElement.dataset.theme;
        const root = getComputedStyle(document.documentElement);
        const resolve = (css: string) =>
          css.replace(/var\((--[\w-]+)\)/g, (_, name) => root.getPropertyValue(name).trim());
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true })!;
        /** Layers painted one over the other (a colour, or a colour at an alpha), read back as the eye gets them. */
        const paint = (layers: (string | readonly [string, number])[]) => {
          context.clearRect(0, 0, 1, 1);
          for (const layer of layers) {
            const [color, alpha] = typeof layer === 'string' ? [layer, 1] : layer;
            context.globalAlpha = alpha;
            context.fillStyle = '#000';
            context.fillStyle = resolve(color);
            context.fillRect(0, 0, 1, 1);
          }
          context.globalAlpha = 1;
          return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
        };
        const luminance = (c: number[]) =>
          c
            .map((v) => v / 255)
            .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
        const ratio = (text: string, under: (string | readonly [string, number])[]) => {
          const [hi, lo] = [luminance(paint([text])), luminance(paint(under))].sort((x, y) => y - x);
          return (hi + 0.05) / (lo + 0.05);
        };
        const out: string[] = [];
        for (const [where, layers] of Object.entries(surfaces))
          for (const text of ['var(--color-fg-3)', 'var(--color-fg-2)']) {
            const r = ratio(text, layers);
            if (r < 4.5) out.push(`${text} on ${where}: ${r.toFixed(2)}`);
          }
        for (const [text, chip, alpha] of onTints) {
          const r = ratio(text, [...card, [chip, alpha]]);
          if (r < 4.5) out.push(`${text} on its ${chip} tint: ${r.toFixed(2)}`);
        }
        return out;
      },
      { theme, surfaces: surfaces(theme), onTints, card: surfaces(theme).card },
    );
    expect(failures).toEqual([]);
  });

for (const theme of ['dark', 'light'] as const)
  test(`an open dialog's text reads on it, ${theme} theme (VD-4)`, async ({ page }) => {
    await startAsGuest(page);
    await page.evaluate((theme) => {
      if (theme === 'light') document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
    }, theme);
    await page.getByRole('button', { name: 'Играй Соло', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Избери категория' });
    await expect(dialog).toBeVisible();
    await page.waitForTimeout(500); // in, at rest
    const failures = await dialog.evaluate((box, theme) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 1;
      const context = canvas.getContext('2d', { willReadFrequently: true })!;
      // The page, the scrim and the dialog as the browser stacks them.
      const scrim = box.parentElement!;
      context.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--color-ink').trim();
      context.fillRect(0, 0, 1, 1);
      for (const layer of [scrim, box]) {
        context.fillStyle = getComputedStyle(layer).backgroundColor;
        context.fillRect(0, 0, 1, 1);
      }
      const under = [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      const out: string[] = [];
      // Paper on the light theme: at 80% over a dark scrim it came out grey, and looked dirty and disabled.
      if (theme === 'light' && under.join() !== '255,255,255')
        out.push(`the dialog is rgb(${under.join(' ')}), not white`);
      const rgb = (css: string) => {
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = css;
        context.fillRect(0, 0, 1, 1);
        return [...context.getImageData(0, 0, 1, 1).data.slice(0, 3)];
      };
      const luminance = (c: number[]) =>
        c
          .map((v) => v / 255)
          .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
          .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
      // Every bit of text right on the dialog (not on a tile or a button of its own).
      for (const el of box.querySelectorAll<HTMLElement>('p, legend, span'))
        if (el.closest('button') === null && el.textContent?.trim() && el.offsetParent !== null) {
          const [hi, lo] = [luminance(rgb(getComputedStyle(el).color)), luminance(under)].sort((x, y) => y - x);
          const ratio = (hi + 0.05) / (lo + 0.05);
          if (ratio < 4.5) out.push(`„${el.textContent.trim().slice(0, 30)}“: ${ratio.toFixed(2)}`);
        }
      return out;
    }, theme);
    expect(failures).toEqual([]);
  });
