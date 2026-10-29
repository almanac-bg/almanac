import { expect, expectPressable, gameMs, playMatch, startAsGuest, startSolo, test } from './support';

test.describe('with motion on', () => {
  // Everything else runs with reduced motion (playwright.config.ts): here the animations play, from the lazily loaded
  // motion features (lib/motionFeatures.ts) to the results' confetti.
  test.use({ reducedMotion: 'no-preference' });

  test('a solo match plays to the end with every animation on', async ({ page }) => {
    await startAsGuest(page);
    // Without a clock: at the tests' speed a question lasts 2.25 s, and the animations would take a share of it.
    await startSolo(page, 'Микс', 'Без часовник');
    expect(await playMatch(page)).toEqual({ answered: 10, total: 10 });
    await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
  });
});

test('a whole match from the keyboard: Tab to the category, Enter, then 1–4 to answer', async ({
  page,
  browserName,
}) => {
  // Safari's Tab skips buttons and links unless Option is held (or the setting to include them is on).
  const tab = browserName === 'webkit' ? 'Alt+Tab' : 'Tab';
  await startAsGuest(page);
  await page.getByRole('button', { name: 'Играй Соло', exact: true }).focus();
  await page.keyboard.press('Enter');
  const picker = page.getByRole('dialog', { name: 'Избери категория', exact: true });
  await expect(picker).toBeVisible();
  // Focus stays in the dialog; Tab walks its buttons to the one wanted.
  const mix = picker.getByRole('button', { name: /Микс/ });
  for (let i = 0; !(await mix.evaluate((el) => el === document.activeElement)); i++) {
    expect(i, 'Tab never reached „Микс“').toBeLessThan(20);
    await page.keyboard.press(tab);
  }
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/game$/);

  // As playMatch (support.ts) waits for each question, but every answer is a key.
  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const lock = page.getByRole('button', { name: 'Заключи', exact: true });
  const ordering = page.getByRole('list', { name: 'Твоят ред', exact: true });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  await page.mouse.move(0, 0);
  const answered = new Set<number>();
  for (;;) {
    await expect(open.or(lock).or(ordering).or(results).first()).toBeVisible({ timeout: gameMs(15_000) });
    if (await results.isVisible()) break;
    const [index] = (await counter.textContent())!.match(/\d+/g)!.map(Number);
    if (answered.has(index)) {
      await expect(counter).not.toHaveText(new RegExp(`^Въпрос ${index} `), { timeout: gameMs(15_000) });
      continue;
    }
    if (await ordering.isVisible()) {
      await expectPressable(ordering);
      for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key);
      await page.keyboard.press('Enter');
      await expect(page.getByText('Редът е заключен.'), `order ${index}: the keys didn't lock it`).toBeAttached({
        timeout: gameMs(2_000),
      });
    } else if (await lock.isVisible()) {
      const slider = page.getByRole('slider', { name: 'Твоят отговор', exact: true });
      if (await slider.isVisible()) {
        // A small range is a slider: Tab to it, one step with an arrow, Enter to lock it.
        for (let i = 0; !(await slider.evaluate((el) => el === document.activeElement)); i++) {
          expect(i, 'Tab never reached the slider').toBeLessThan(15);
          await page.keyboard.press(tab);
        }
        await page.keyboard.press('ArrowRight');
      } else {
        // Else its range's low end, typed.
        const range = (await page.getByText(/^от .+ до .+$/).textContent())!;
        await page.keyboard.type(range.slice(3, range.indexOf(' до ')).replace(/[^\d,]/g, ''));
      }
      await page.keyboard.press('Enter');
      await expect(lock, `number ${index}: the keys didn't lock it`).toBeHidden({ timeout: gameMs(2_000) });
    } else {
      await page.keyboard.press('1');
      await expect(
        page.getByRole('button', { name: /— (верен отговор, )?твоят избор/ }),
        `question ${index}: the key didn't answer it`,
      ).toBeVisible({ timeout: gameMs(2_000) });
    }
    answered.add(index);
  }
  expect(answered.size).toBe(10);
});
