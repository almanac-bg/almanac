import { expect, gameMs, giveNumber, signUp, startSolo, test, uniqueName } from './support';

test('a solo match plays a picture (whose it is shows with the answer) and „Подреди“, tapped into place', async ({
  page,
}) => {
  // A new account: none of the sample bank's pictures or orders seen yet, so the match places two and one (one picture
  // when today's daily, made by another test, holds one of the sample's three back and another clashes). Without a
  // clock, so each answer waits for „Продължи“: nothing to catch in a 0.6-second reveal.
  await signUp(page, uniqueName('Картини'), 'parola-123');
  await startSolo(page, 'Микс', 'Без часовник');

  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const lock = page.getByRole('button', { name: 'Заключи', exact: true });
  const ordering = page.getByRole('list', { name: 'Твоят ред', exact: true });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  const goOn = page.getByRole('button', { name: 'Продължи', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  const done = new Set<number>();
  let pictures = 0;
  let orders = 0;
  await page.mouse.move(0, 0);

  for (;;) {
    await expect(open.or(lock).or(ordering).or(goOn).or(results).first()).toBeVisible({ timeout: gameMs(15_000) });
    if (await results.isVisible()) break;
    // Only once the new question takes an answer: until then the last one's reveal (and its picture) may be on screen.
    const answerable = (await open.first().isVisible()) || (await lock.isVisible()) || (await ordering.isVisible());
    if (!answerable) {
      await goOn.click({ timeout: gameMs(2_000) }).catch(() => {});
      continue;
    }
    const index = Number((await counter.textContent())!.match(/\d+/)![0]);
    expect(done.has(index), `question ${index} offered twice`).toBe(false);
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
    } else if (await lock.isVisible()) {
      await giveNumber(page);
    } else {
      await open.first().click({ timeout: gameMs(2_500) });
    }
  }
  expect(pictures).toBeGreaterThanOrEqual(1);
  expect(orders).toBe(1);
});
