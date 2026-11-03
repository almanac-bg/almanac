import {
  expect,
  expectLobby,
  expectNoSideScroll,
  gameMs,
  hiddenWhenFocused,
  type Page,
  playMatch,
  signUp,
  startAsGuest,
  startSolo,
  test,
  uniqueName,
} from './support';

/**
 * Nothing on the main screens may be wider than the screen (a page that scrolls sideways on a phone is broken):
 * the landing page, the lobby, a results screen and Settings, each at every size.
 */
async function checkScreens(page: Page, sizes: { width: number; height: number }[]) {
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expect(page.getByRole('button', { name: 'Играй като гост', exact: true }).first()).toBeVisible();
    await expectNoSideScroll(page, `landing page at ${size.width}px`);
  }

  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
  await expectLobby(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await page.goto('/');
    await expectLobby(page);
    await expect(page.getByRole('heading', { name: 'Задачи за деня', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `lobby at ${size.width}px`);

    await page.goto('/settings');
    await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `Settings at ${size.width}px`);
  }

  // One match; its results screen then goes through every size (it can't be reloaded: it lives in the page).
  await page.goto('/');
  await expectLobby(page);
  await startSolo(page, 'Микс');
  await playMatch(page);
  for (const size of sizes) {
    await page.setViewportSize(size);
    await expect(page.getByRole('heading', { name: 'Награди', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `results at ${size.width}px`);
  }
}

test('phones 320 and 375 px wide never scroll sideways', async ({ page }) => {
  await checkScreens(page, [
    { width: 320, height: 640 },
    { width: 375, height: 812 },
  ]);
});

test('a 1280×800 screen never scrolls sideways', { tag: '@desktop' }, async ({ page }) => {
  await checkScreens(page, [{ width: 1280, height: 800 }]);
});

// A request's card holds a name and two buttons: on a narrow phone the buttons go under the name.
// On a touch screen every button is at least 44 px wide: in a row of tabs that scrolls, that once let them shrink under
// their own text („Аватари 6/34амки 1/25…“) instead of scrolling.
test("the Collection's tabs keep their whole text on a phone, and the row scrolls", async ({ page }) => {
  await startAsGuest(page);
  await page.goto('/locker');
  const tabs = page.locator('button[aria-pressed]');
  await expect(tabs.first()).toBeVisible();
  const clipped = await tabs.evaluateAll((buttons) =>
    buttons.filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent),
  );
  expect(clipped).toEqual([]);
});

test('a friend request waiting fits the friends page on a 320 px phone', async ({ page, newPlayer }) => {
  const anna = uniqueName('Анна');
  await signUp(page, anna, 'parola-123');
  const boris = await newPlayer();
  await signUp(boris, uniqueName('Борис'), 'parola-123');
  await boris.goto('/friends');
  await boris.getByLabel('Потребителско име на приятел', { exact: true }).fill(anna);
  await boris.getByRole('button', { name: 'Добави', exact: true }).click();
  await expect(boris.getByText('Поканата е изпратена')).toBeVisible();

  for (const width of [320, 375]) {
    await page.setViewportSize({ width, height: 640 });
    await page.goto('/friends');
    await expect(page.getByRole('button', { name: 'Приеми', exact: true })).toBeVisible();
    await expectNoSideScroll(page, `friends page with a request at ${width}px`);
  }
  await page.getByRole('button', { name: 'Приеми', exact: true }).click();
  await expect(page.getByText('Вече сте приятели!')).toBeVisible();
});

// Playwright clicks only what a person could click: a link under an invisible layer fails here.
test('the legal links on the landing page open the legal pages', async ({ page }) => {
  for (const size of [
    { width: 375, height: 812 },
    { width: 1280, height: 800 },
  ]) {
    await page.setViewportSize(size);
    for (const [name, heading] of [
      ['Условия за ползване', 'Условия за ползване'],
      ['Политика за поверителност', 'Политика за поверителност'],
    ]) {
      await page.goto('/');
      await page.getByRole('link', { name, exact: true }).click();
      await expect(page.getByRole('heading', { name: heading, exact: true })).toBeVisible();
    }
  }
});

// A mistyped link says so — signed out it isn't the sign-up form, signed in it isn't a silent jump home.
test('a wrong address shows "page not found", signed out and signed in', async ({ page, pageProblems }) => {
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Тази страница не съществува', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Страницата не съществува — АЛМАНАХ');
  await signUp(page, uniqueName('Изгубен'), 'parola-123');
  await page.goto('/no-such-page');
  await expect(page.getByRole('heading', { name: 'Тази страница не съществува', exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Към началото', exact: true }).click();
  await expectLobby(page);
  // The browser logs the 404 itself: that's the point of this test, not a problem.
  const expected = (p: string) => p.includes('status of 404') && p.includes('/no-such-page');
  pageProblems.splice(0, pageProblems.length, ...pageProblems.filter((p) => !expected(p)));
});

// What a search engine that doesn't run scripts gets, or a slow phone before the code arrives: the page itself.
test('without JavaScript the landing page and the legal pages are there in full', async ({ browser }) => {
  // browser.newContext() picks up the config's `use` options (baseURL among them).
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /^АЛМАНАХ — онлайн викторина/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Играй като гост', exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Онлайн викторина с приятели и цяла България', exact: true }),
  ).toBeVisible();
  // A plain link without the app: the browser loads the next page, which comes drawn too.
  await page.getByRole('link', { name: 'Политика за поверителност', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Политика за поверителност', exact: true })).toBeVisible();
  await expect(page.getByText('Тест Тестов', { exact: true })).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Писмата до нас:' })).toHaveText(
    'Писмата до нас: Тест Поща — пощата, в която пристигат писмата, изпратени до адреса за контакт, и от която им отговаряме.',
  );
  await context.close();
});

// The whole question on one screen: on a 375×667 phone (iPhone SE/8), a 320×568 one and a phone held sideways, the four answers and
// the clock are all in view without scrolling — scrolling for "Г" costs the speed bonus.
test('the question, its four answers and the clock fit a small phone and a phone held sideways', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await startAsGuest(page);
  await startSolo(page, 'Микс');
  for (const size of [
    { width: 375, height: 667 },
    { width: 320, height: 568 },
    { width: 740, height: 360 },
  ]) {
    await page.setViewportSize(size);
    const last = page.locator('button[data-answer="3"]');
    await expect(last).toBeVisible({ timeout: gameMs(15_000) });
    for (const element of [last, page.getByRole('timer')]) {
      const box = await element.boundingBox();
      expect(box, `${size.width}×${size.height}`).not.toBeNull();
      expect(box!.y + box!.height, `bottom at ${size.width}×${size.height}`).toBeLessThanOrEqual(size.height);
    }
  }
});

test('on a phone the answer just tapped stays under the finger when the answer comes (UX-10)', async ({ page }) => {
  // No motion: what comes with the answer is in place at once, and the reveal lasts 0.6 s at the test speed.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 390, height: 844 });
  await startAsGuest(page);
  await startSolo(page, 'Микс');
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  const ordering = page.getByRole('list', { name: 'Твоят ред', exact: true });
  const moved: number[] = [];
  for (let n = 1; n <= 8 && moved.length < 3; n++) {
    await expect(counter).toHaveText(new RegExp(`^Въпрос ${n} от`), { timeout: gameMs(15_000) });
    // Г, the lowest: anything added under the answers pushed it up the most. A number or an order is let go by. An
    // order's items are lettered too, and a tap on one only places it: the answer would come when time ran out, with
    // the order's own reveal (CI's WebKit, slow to look, found the items pressable and measured that: 52, 68 px).
    const tile = page.getByRole('button', { name: /^Г\) /, disabled: false });
    if ((await ordering.isVisible()) || !(await tile.isVisible())) continue;
    const before = (await tile.boundingBox())!;
    await tile.click();
    // The answer is in once the result and the stop („Спри, за да прочета“ or „Пауза“) are there.
    await expect(page.locator('[data-hold]')).toBeVisible({ timeout: gameMs(3_000) });
    const after = (await page.getByRole('button', { name: /^Г\) / }).boundingBox())!;
    moved.push(Math.round(after.y - before.y));
  }
  expect(moved.length, 'questions with options measured').toBeGreaterThan(0);
  for (const dy of moved) expect(Math.abs(dy), `moved ${moved.join(', ')} px`).toBeLessThanOrEqual(2);
});

test('the bank’s letters are drawn in the game’s font, not the system’s (VD-13)', async ({ page, browserName }) => {
  // Which font drew a node is only reported by Chromium's DevTools protocol.
  test.skip(browserName !== 'chromium', 'Chromium only');
  await page.goto('/');
  // ѝ and Ѝ aren't in Onest: drawn from и, И and the combining grave, which its subset keeps.
  const letters = ['ѝ', 'Ѝ', 'Ж', 'Š', 'ș', 'ț', 'ă', 'ǎ', 'ć', 'ő', '„', '“', '—', '№'];
  await page.evaluate((letters) => {
    const box = document.createElement('div');
    box.style.fontFamily = 'var(--font-sans)';
    for (const [i, letter] of letters.entries()) {
      const span = document.createElement('span');
      span.id = `letter${i}`;
      span.textContent = letter;
      box.append(span);
    }
    document.body.append(box);
    return document.fonts.ready.then(() => undefined);
  }, letters);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.enable');
  await cdp.send('CSS.enable');
  const { root } = await cdp.send('DOM.getDocument', { depth: -1 });
  const drawnBy: Record<string, string> = {};
  for (const [i, letter] of letters.entries()) {
    const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: `#letter${i}` });
    const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
    drawnBy[letter] = fonts.map((f) => f.familyName).join(', ');
  }
  expect(Object.entries(drawnBy).filter(([, font]) => font !== 'Onest')).toEqual([]);
});

for (const [where, size] of [
  ['phone', { width: 390, height: 844 }],
  ['desktop', { width: 1280, height: 800 }],
] as const) {
  test(`the set editor never hides the focused field behind its save bar (2.4.11, ${where})`, async ({ page }) => {
    await page.setViewportSize(size);
    await signUp(page, uniqueName('Учител'), 'parola-123');
    await page.goto('/sets');
    await page.getByRole('button', { name: 'Нов набор' }).click();
    await expect(page).toHaveURL(/\/sets\/\d+$/);
    await page.getByRole('button', { name: /^Въпрос 1/ }).click();
    await page.getByLabel('Текст на въпрос 1').fill('Коя е столицата на България?');
    await page.getByRole('button', { name: /^Въпрос 2/ }).click();
    // From the top of the page, every stop of the keyboard through the editor: the name, the questions, their answers.
    await page.getByLabel('Име на набора').focus();
    expect(await hiddenWhenFocused(page, 30)).toEqual([]);
  });
}

test('the landing’s wordmark stays inside its column, on phones and a laptop (VD-9)', async ({ page }) => {
  // One page, resized: it's sized by its container, and Firefox aborts a load of the page it's already on.
  await page.goto('/');
  for (const width of [320, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(150); // refitted in the next frame (lib/fitWidth.ts)
    const over = await page.evaluate(() => {
      const h1 = document.querySelector('main h1')!;
      const column = h1.parentElement!;
      const edge = column.getBoundingClientRect().right - Number.parseFloat(getComputedStyle(column).paddingRight);
      return Math.round((h1.firstElementChild as HTMLElement).getBoundingClientRect().right - edge);
    });
    expect(over, `${width} px: past its column by`).toBeLessThanOrEqual(0);
  }
});

test('320 px with WCAG’s text spacing never scrolls sideways (1.4.12)', async ({ page }) => {
  // Line height 1.5, letter spacing 0.12 em, word spacing 0.16 em, 2 em after paragraphs: what a reader may set.
  const spacing =
    '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';
  // Set as a reader's stylesheet is: before the page draws.
  await page.addInitScript((css) => {
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent = css;
      document.head.append(style);
    });
  }, spacing);
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto('/');
  await expectNoSideScroll(page, 'the landing');
  // In from the landing as it is (loading it again, WebKit calls the second load an interrupted one).
  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
  await expectLobby(page);
  // The lobby as it opened (Firefox aborts a load of the page it's already on), then the others.
  await expectNoSideScroll(page, 'the lobby');
  for (const path of ['/achievements', '/leaderboard', '/locker', '/settings', '/knowledge', '/profile']) {
    // Settled before the next: Firefox aborts a load while the last page still fetches its parts.
    await page.waitForLoadState('networkidle');
    await page.goto(path);
    await expectNoSideScroll(page, path);
  }
});

test('a long page title never leaves a letter or two of a word alone on a line (UX-13)', async ({ page }) => {
  await page.goto('/privacy');
  for (const width of [320, 360, 390, 430]) {
    await page.setViewportSize({ width, height: 800 });
    // The longest word of „Политика за поверителност“: whole, or hyphenated where the language allows (Firefox
    // does „повери-/телност“), never „поверителнос/т“. How many of its letters each row holds.
    const rows = await page.locator('main h1').evaluate((h1) => {
      const text = h1.firstChild!;
      const word = 'поверителност';
      const at = text.textContent!.indexOf(word);
      const perRow = new Map<number, number>();
      for (let i = 0; i < word.length; i++) {
        const range = document.createRange();
        range.setStart(text, at + i);
        range.setEnd(text, at + i + 1);
        const top = Math.round(range.getBoundingClientRect().top);
        perRow.set(top, (perRow.get(top) ?? 0) + 1);
      }
      return [...perRow.values()];
    });
    expect(Math.min(...rows), `${width} px: ${rows.join(' + ')} letters a row`).toBeGreaterThanOrEqual(3);
  }
});

test('an iPhone’s status bar follows the theme: black on ink, white with dark text on paper (VD-16)', async ({
  page,
}) => {
  const style = () =>
    page.locator('meta[name="apple-mobile-web-app-status-bar-style"]').getAttribute('content', { timeout: 2_000 });
  await page.goto('/');
  expect(await style()).toBe('black');
  // Chosen once: set before the first paint from then on (public/theme.js), as iOS reads it as the app opens. (The
  // page settled first: WebKit fails a module still loading when the page reloads under it.)
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => localStorage.setItem('almanac:theme', 'light'));
  await page.reload();
  expect(await style()).toBe('default');
});
