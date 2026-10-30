import { expect, playMatch, signUp, startAsGuest, startSolo, test, uniqueName } from './support';

test('„Моят алманах“ keeps the facts a run taught, and the missed questions wait for „Поправителен“', async ({
  page,
}) => {
  await startAsGuest(page);
  // Every Geography question in the sample bank has a fact.
  await startSolo(page, 'География');
  await playMatch(page);
  const line = await page.getByText(/ точки · \d+ от 10 верни$/).textContent();
  const right = Number(line!.match(/(\d+) от 10 верни/)![1]);
  if (right > 0) await expect(page.getByRole('link', { name: `+${right} в алманаха ти` })).toBeVisible();

  await page.goto('/almanac');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(new RegExp(`^${right} от \\d+ факта$`));
  // Every miss waits, except a final's number guessed half-way close or nearer (nearly known).
  const missed = 10 - right;
  const waiting = page.getByText(
    /(сгрешен въпрос чака|сгрешени въпроса чакат): следващият се връща|^Сгрешеното се връща/,
  );
  await expect(waiting).toBeVisible();
  const queued = Number((await waiting.textContent())!.match(/^(\d+) /)?.[1] ?? 0);
  expect(queued).toBeLessThanOrEqual(missed);
  expect(queued).toBeGreaterThanOrEqual(missed - 1);
  await page.getByRole('link', { name: /^География/ }).click();
  await expect(page).toHaveURL(/\/almanac\/geography$/);
  await expect(page.getByText(new RegExp(`^${right} от \\d+ факта`))).toBeVisible();
  await expect(page.getByRole('main').getByRole('listitem')).toHaveCount(right);
});

test('a group: made with an account, joined from its invite link by someone signed out', async ({
  page: teacher,
  newPlayer,
}) => {
  await signUp(teacher, uniqueName('Учител'), 'parola-123');
  await teacher.goto('/friends');
  await teacher.getByRole('link', { name: 'Създай група →' }).click();
  await teacher.getByRole('textbox', { name: 'Име на групата' }).fill('10 Б клас');
  await teacher.getByRole('button', { name: 'Създай', exact: true }).click();
  await expect(teacher.getByRole('heading', { name: '10 Б клас', level: 1 })).toBeVisible();
  const invite = (await teacher.getByText(/\/groups\/join\//).textContent())!.trim();

  // Someone with the link and no account: what it's for, then in as a guest, then into the group.
  const pupil = await newPlayer();
  await pupil.goto(new URL(invite).pathname);
  await expect(pupil.getByText(/Имаш покана за групата „10 Б клас“ \(1 член\)/)).toBeVisible();
  await pupil.getByRole('button', { name: 'Влез като гост' }).first().click();
  await pupil.getByRole('button', { name: 'Влез в групата' }).click();
  await expect(pupil.getByRole('heading', { name: '10 Б клас', level: 1 })).toBeVisible();
  await expect(pupil.getByText(/^2 членове · създадена от /)).toBeVisible();

  // The one who made it sees them; nobody has played this week yet.
  await teacher.reload();
  await expect(teacher.getByRole('heading', { name: 'Още не са играли' })).toBeVisible();
  await expect(teacher.getByRole('button', { name: /^Премахни .* от групата$/ })).toHaveCount(1);
  await teacher.goto('/groups');
  await expect(teacher.getByRole('link', { name: /10 Б клас.*тази седмица още нямаш точки.*2 членове/ })).toBeVisible();
});
