import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import {
  expect,
  gameMs,
  hiddenWhenFocused,
  playMatch,
  signUp,
  startAsGuest,
  startSolo,
  test,
  uniqueName,
} from './support';

/**
 * The screens most players see, checked by axe against WCAG 2.2 A and AA in both themes, on a phone and on a laptop:
 * names, roles, labels, contrast, landmarks, target sizes, and a name that starts with what's on screen (2.5.3, an
 * experimental rule, run on its own). (e2e/contrast.spec.ts measures colours on their real surfaces; this catches what
 * nobody thought to list.) The 31 October review found it checked WCAG 2.1 on five phone screens only (A11Y-12).
 */
async function check(page: Page, screen: string) {
  const scan = async () => {
    // At rest, as far as it comes to rest: a big screen's clock runs all question long (and slower engines play the
    // match slower), and a loop never ends. Whatever is still fading is measured again by the poll below.
    await page
      .waitForFunction(
        () =>
          document
            .getAnimations()
            .every((a) => a.playState !== 'running' || a.effect?.getTiming().iterations === Number.POSITIVE_INFINITY),
        undefined,
        { timeout: 2_000 },
      )
      .catch(() => {});
    const { violations } = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    const named = await new AxeBuilder({ page }).withRules(['label-content-name-mismatch']).analyze();
    return [...violations, ...named.violations].map(
      (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`,
    );
  };
  // Measured again until it holds: text still fading in (the drawn landing's entrance, a question's answers coming in,
  // slower in a loaded engine) reads as too faint for a moment, while a real problem stays.
  await expect.poll(scan, { message: screen, timeout: 10_000, intervals: [500, 1_000] }).toEqual([]);
}

/** From the page's first focusable, no stop of the keyboard is hidden under a pinned bar or off the screen (2.4.11). */
async function tabWalk(page: Page, screen: string, steps = 25) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  expect(await hiddenWhenFocused(page, steps), `${screen}: focus hidden`).toEqual([]);
}

for (const device of ['phone', 'desktop'] as const)
  for (const colorScheme of ['dark', 'light'] as const) {
    // Untagged tests run on the phone project, @desktop ones on the laptop's (playwright.config.ts).
    const tag = device === 'desktop' ? { tag: '@desktop' } : {};
    test.describe(`${colorScheme} theme, ${device}`, () => {
      test.use({ colorScheme });

      test(
        `axe finds nothing on the landing, the lobby, a question, the results and Settings (${colorScheme}, ${device})`,
        tag,
        async ({ page }) => {
          await page.goto('/');
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          await check(page, 'landing');

          await startAsGuest(page);
          await check(page, 'lobby');
          await tabWalk(page, 'lobby');

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
          await tabWalk(page, 'settings', 40);
        },
      );

      test(
        `axe finds nothing in the set editor, a room and its big screen (${colorScheme}, ${device})`,
        tag,
        async ({ page: teacher, newPlayer }) => {
          test.setTimeout(90_000);
          await signUp(teacher, uniqueName('Учител'), 'parola-123');
          await teacher.goto('/sets');
          await teacher.getByRole('button', { name: 'Нов набор' }).click();
          await expect(teacher).toHaveURL(/\/sets\/\d+$/);
          await teacher.getByLabel('Име на набора').fill('Достъпност');
          await teacher.getByRole('button', { name: /^Въпрос 1/ }).click();
          await teacher.getByLabel('Текст на въпрос 1').fill('Коя е столицата на България?');
          for (const [letter, text] of [
            ['А', 'София'],
            ['Б', 'Пловдив'],
            ['В', 'Варна'],
            ['Г', 'Бургас'],
          ])
            await teacher.getByLabel(`Отговор ${letter}`).fill(text);
          await teacher.getByRole('button', { name: 'Запази' }).click();
          await expect(teacher.getByText('1 от 50 въпроса · запазено')).toBeVisible();
          await check(teacher, 'set editor');
          await teacher.getByLabel('Име на набора').focus();
          expect(await hiddenWhenFocused(teacher, 25), 'set editor: focus hidden').toEqual([]);

          // A room on it, run from the big screen, with a pupil in it.
          await teacher.goto('/');
          await teacher.getByRole('button', { name: /^Създай (своя )?стая$/ }).click();
          await expect(teacher).toHaveURL(/\/room$/);
          const sets = teacher.getByLabel('Въпроси', { exact: true });
          const set = sets.locator('option', { hasText: 'Достъпност (1)' });
          await expect(set).toHaveCount(1, { timeout: 15_000 });
          await sets.selectOption((await set.getAttribute('value'))!);
          await teacher.getByRole('switch', { name: 'Само водя' }).click();
          const code = (await teacher
            .getByRole('button', { name: /^\d{6} — копирай/ })
            .first()
            .textContent())!.match(/\d{6}/)![0];
          const pupil = await newPlayer();
          await pupil.goto(`/join/${code}`);
          await pupil.getByRole('button', { name: 'Влез като гост' }).first().click();
          await pupil.getByLabel('Име в стаята').fill('Мария 7Б');
          await pupil.getByRole('button', { name: 'Влез в стаята' }).click();
          await expect(teacher.getByText('Мария 7Б')).toBeVisible();
          await check(teacher, 'room');

          await teacher
            .getByRole('button', { name: /^Започни/ })
            .filter({ visible: true })
            .first()
            .click();
          await expect(teacher.getByRole('heading', { name: 'Коя е столицата на България?' })).toBeVisible({
            timeout: gameMs(10_000),
          });
          await check(teacher, 'big screen');
        },
      );
    });
  }
