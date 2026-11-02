import { expect, gameMs, signUp, startSolo, test, uniqueName } from './support';

test('a solo match plays a picture (whose it is shows with the answer) and „Подреди“, tapped into place', async ({
  page,
}) => {
  // A new account: none of the sample bank's pictures or orders seen yet, so the match places two and one.
  await signUp(page, uniqueName('Картини'), 'parola-123');
  await startSolo(page, 'Микс');

  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const lock = page.getByRole('button', { name: 'Заключи', exact: true });
  const ordering = page.getByRole('list', { name: 'Твоят ред', exact: true });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  const done = new Set<number>();
  let pictures = 0;
  let orders = 0;
  await page.mouse.move(0, 0);

  for (;;) {
    await expect(open.or(lock).or(results).first()).toBeVisible({ timeout: gameMs(15_000) });
    if (await results.isVisible()) break;
    const index = Number((await counter.textContent())!.match(/\d+/)![0]);
    if (done.has(index)) continue;
    done.add(index);
    const picture = page.locator('main figure img');
    if (await ordering.isVisible()) {
      orders++;
      // Tapped: each one takes the next place; tapped again, it goes back.
      const items = ordering.getByRole('button');
      await items.nth(3).click();
      await expect(ordering.getByRole('button', { pressed: true })).toHaveCount(1);
      await ordering.getByRole('button', { pressed: true }).click();
      await expect(ordering.getByRole('button', { pressed: true })).toHaveCount(0);
      for (let i = 0; i < 4; i++) await ordering.getByRole('button', { pressed: false }).first().click();
      await lock.click();
      await expect(page.getByRole('list', { name: 'Правилният ред', exact: true })).toBeVisible({
        timeout: gameMs(5_000),
      });
      await expect(page.getByText(/^(\d от 4 на място|🎯 Всичко на място!)$/)).toBeVisible();
    } else if (await picture.isVisible()) {
      pictures++;
      expect(await picture.getAttribute('alt')).toBeTruthy();
      await expect(page.locator('main figcaption'), 'whose it is: not before the answer').toHaveCount(0);
      await open.first().click({ timeout: gameMs(2_500) });
      // Licence first, then the author (the sample's flags are Commons' own: „чрез Wikimedia Commons“ isn't said twice).
      await expect(page.locator('main figcaption')).toHaveText('обществено достояние · Wikimedia Commons', {
        timeout: gameMs(5_000),
      });
    }
  }
  expect(pictures).toBe(2);
  expect(orders).toBe(1);
});
