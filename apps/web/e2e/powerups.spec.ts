import { expect, gameMs, playMatch, startAsGuest, startSolo, test } from './support';

test('козове: 50/50 by its key takes two answers away, one коз a question says why when tapped, „Втори шанс“ arms', async ({
  page,
}) => {
  await startAsGuest(page);
  // Without a clock: time to look at the bar between the moves (each answer then waits for „Продължи“).
  await startSolo(page, 'Микс', 'Без часовник');
  const options = page.getByRole('button', { name: /^[АБВГ]\) / });
  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const fifty = page.locator('[data-powerup="fifty"]');
  const retry = page.locator('[data-powerup="retry"]');
  await expect(open.first()).toBeVisible({ timeout: gameMs(15_000) });
  await expect(page.locator('[data-powerup]')).toHaveCount(3);

  // Q: two wrong answers gone, the коз spent.
  await page.keyboard.press('q');
  await expect(open).toHaveCount(2);
  await expect(options).toHaveCount(4);
  await expect(fifty).toBeDisabled();
  // One коз a question: tapping another says why instead of doing nothing.
  await expect(retry).toHaveAttribute('aria-disabled', 'true');
  // A finger reaches it (Playwright's own checks would wait for aria-disabled to go).
  await retry.click({ force: true });
  await expect(page.getByRole('status').filter({ hasText: 'Втори шанс: само един коз на въпрос' })).toBeAttached();
  await open.first().click();
  await page.getByRole('button', { name: 'Продължи', exact: true }).click();

  // The next question: „Втори шанс“ by its key, shown as on until it's needed.
  await expect(open.first()).toBeVisible({ timeout: gameMs(15_000) });
  await expect(retry).not.toHaveAttribute('aria-disabled', 'true');
  await page.keyboard.press('w');
  await expect(page.getByText('„Втори шанс“ е активен')).toBeVisible();
  await expect(retry).toBeDisabled();
  await expect(fifty).toBeDisabled();
  // A wrong first answer leaves the others open for a second try; a right one ends it as usual.
  await open.first().click();
  const again = page.getByText('Грешно! Имаш още един опит');
  const goOn = page.getByRole('button', { name: 'Продължи', exact: true });
  await expect(again.or(goOn).first()).toBeVisible({ timeout: gameMs(5_000) });
  if (await again.isVisible()) {
    await expect(open).toHaveCount(3);
    await open.first().click();
  }
  await goOn.click();

  // The rest of the run as usual.
  const { answered, total } = await playMatch(page);
  expect(answered).toBe(total - 2);
});
