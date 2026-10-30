import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, gameMs, playMatch, startAsGuest, startSolo, test } from './support';

/**
 * The screens most players see, checked by axe against WCAG 2.1 A and AA in both themes: names, roles, labels,
 * contrast, landmarks. (e2e/contrast.spec.ts measures every accent itself; this catches what nobody thought to list.)
 */
async function check(page: Page, screen: string) {
  const scan = async () => {
    await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'));
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    return violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  };
  // Measured again until it holds: text still fading in (the drawn landing's entrance, a question's answers coming in,
  // slower in a loaded engine) reads as too faint for a moment, while a real problem stays.
  await expect.poll(scan, { message: screen, timeout: 10_000, intervals: [500, 1_000] }).toEqual([]);
}

for (const colorScheme of ['dark', 'light'] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    test(`axe finds nothing on the landing, the lobby, a question, the results and Settings (${colorScheme})`, async ({
      page,
    }) => {
      await page.goto('/');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await check(page, 'landing');

      await startAsGuest(page);
      await check(page, 'lobby');

      await startSolo(page, 'Микс', 'Без часовник');
      await expect(page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false }).first()).toBeVisible({
        timeout: gameMs(15_000),
      });
      await check(page, 'question');
      await playMatch(page);
      await check(page, 'results');

      await page.goto('/settings');
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      await check(page, 'settings');
    });
  });
}
