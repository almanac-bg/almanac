import { expect, me, signIn, startAsGuest, test, uniqueName } from './support';

// Both ways a guest gets to "Запази прогреса": the "Гост" button in the header, and Settings.
for (const via of ['header', 'settings'] as const) {
  test(`a guest saves the account (from ${via}) and signs in with it on another device`, async ({
    page,
    newPlayer,
  }) => {
    const username = uniqueName('Иван');
    const password = 'zapazi-me-42';

    await startAsGuest(page);
    const guest = await me(page);
    expect(guest.isGuest).toBe(true);

    if (via === 'header') {
      await page.getByRole('button', { name: 'Гост — запази прогреса', exact: true }).click();
    } else {
      await page.getByRole('link', { name: 'Настройки', exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
      await expect(page.getByText(`Профил на гост ${guest.username}`)).toBeVisible();
      await page.getByRole('button', { name: 'Запази профила', exact: true }).click();
    }

    const dialog = page.getByRole('dialog', { name: 'Запази прогреса си', exact: true });
    await dialog.getByLabel('Потребителско име', { exact: true }).fill(username);
    await dialog.getByLabel('Парола', { exact: true }).fill(password);
    await dialog.getByRole('button', { name: 'Запази профила', exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Профилът е запазен!')).toBeVisible();
    // No longer a guest: the reminder is gone, and it's the same account under its new name.
    await expect(page.getByRole('button', { name: 'Гост — запази прогреса', exact: true })).toHaveCount(0);
    if (via === 'settings') await expect(page.getByText(`Профил ${username}`, { exact: true })).toBeVisible();
    expect(await me(page)).toMatchObject({ id: guest.id, username, isGuest: false });

    // Another device: the name and password lead into that same account.
    const elsewhere = await newPlayer();
    await signIn(elsewhere, username, password);
    await expect(elsewhere.getByRole('heading', { level: 1, name: username, exact: true })).toBeVisible();
    expect(await me(elsewhere)).toMatchObject({ id: guest.id, username, isGuest: false });
  });
}
