import { randomInt } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import { type BrowserContext, test as base, expect, type Locator, type Page } from '@playwright/test';

export type { Page };
export { expect };

/**
 * A wait as long as the game's own clocks: the times written in the tests are for the default speed (E2E_TIME_SCALE
 * 0.15: a 15-second question lasts 2.25 s), and a slower one (the other engines' 0.5 in CI) stretches them as much.
 */
export function gameMs(ms: number): number {
  return Math.round(ms * Math.max(1, Number(process.env.E2E_TIME_SCALE ?? '0.15') / 0.15));
}

interface Fixtures {
  /** Another person: a fresh browser context (no cookies, no storage) on the same kind of device. */
  newPlayer: () => Promise<Page>;
  /**
   * What went wrong inside the pages: uncaught exceptions and console errors (failed requests among them). Any of it
   * fails the test when it ends.
   */
  pageProblems: string[];
}

/**
 * WebKit's word for a request the page dropped (a navigation cut it short): "… due to access control checks", even for
 * the page's own server, which no access control applies to. What made the request handles the failure.
 */
const WEBKIT_DROPPED = /^Fetch API cannot load .* due to access control checks\.$|^\S+ due to access control checks\.$/;

/**
 * Firefox's own console line when a navigation cuts short something the page started (the service worker's
 * registration, which the app catches): the browser's report, in its "[JavaScript Error: …]" form, not the page's.
 */
const FIREFOX_NAVIGATED_AWAY = /^\[JavaScript Error: "InvalidStateError: Navigated away from page"\]$/;

function watch(context: BrowserContext, problems: string[]) {
  context.on('weberror', (error) => {
    const message = error.error().message;
    if (!WEBKIT_DROPPED.test(message)) problems.push(`uncaught: ${message}`);
  });
  context.on('console', (message) => {
    if (message.type() !== 'error' || FIREFOX_NAVIGATED_AWAY.test(message.text())) return;
    const { url } = message.location();
    problems.push(`console: ${message.text()}${url ? ` (${url})` : ''}`);
  });
}

export const test = base.extend<Fixtures>({
  // biome-ignore lint/correctness/noEmptyPattern: Playwright requires an object pattern here, even an empty one
  pageProblems: async ({}, use) => {
    const problems: string[] = [];
    await use(problems);
    expect(problems, 'errors in the browser').toEqual([]);
  },
  context: async ({ context, pageProblems }, use) => {
    watch(context, pageProblems);
    await use(context);
  },
  newPlayer: async ({ browser, pageProblems }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async () => {
      // browser.newContext() picks up the config's `use` options (viewport, touch, baseURL, tracing…).
      const context = await browser.newContext();
      contexts.push(context);
      watch(context, pageProblems);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

/** A name nobody has yet: the prefix, then random digits (which never spell a blocked word). At most 20 characters. */
export function uniqueName(prefix: string): string {
  return `${prefix}_${String(randomInt(1e8)).padStart(8, '0')}`;
}

/** A score as the app shows it ("1234 т." or "1 234 т.", however the locale groups it). */
export const points = (n: number) => new RegExp(`^${[...String(n)].join('\\s?')} т\\.$`);

export interface Me {
  id: number;
  username: string;
  isGuest: boolean;
  roomGuest: boolean;
  xp: number;
}

/** The signed-in account of this page's browser context, straight from the API (same cookies). */
export async function me(page: Page): Promise<Me> {
  const res = await page.request.get('/api/me');
  expect(res.ok()).toBe(true);
  const { user } = (await res.json()) as { user: Me | null };
  expect(user, 'signed in').not.toBeNull();
  return user!;
}

/** The lobby, ready to play: rendered, and the realtime connection is up (matches start over it). */
export async function expectLobby(page: Page) {
  await expect(page.getByRole('heading', { name: 'Избери битка', exact: true })).toBeVisible();
  await expect(page.locator('[data-connection="up"]')).toHaveCount(1);
}

/**
 * The landing page's "Играй като гост" (the card's: the page repeats it under the game's description): a guest
 * account, straight into the lobby.
 */
export async function startAsGuest(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Играй като гост', exact: true }).first().click();
  await expectLobby(page);
}

/**
 * The landing page's form on that tab. A new device opens on the day's questions, with the form a tap away; one that
 * has signed in before opens on the form.
 */
export async function openForm(page: Page, tab: 'Регистрация' | 'Вход') {
  const first = page.getByRole('button', {
    name: tab === 'Вход' ? 'Имам профил — вход' : 'Създай профил',
    exact: true,
  });
  await expect(first.or(page.getByRole('button', { name: tab, exact: true })).first()).toBeVisible();
  if (await first.isVisible()) await first.click();
  else await page.getByRole('button', { name: tab, exact: true }).click();
}

/** Signs up through the landing page's "Регистрация" form. */
export async function signUp(page: Page, username: string, password: string) {
  await page.goto('/');
  await openForm(page, 'Регистрация');
  await expect(page.getByRole('heading', { name: 'Създай профил', exact: true })).toBeVisible();
  await page.getByLabel('Потребителско име', { exact: true }).fill(username);
  await page.getByLabel('Парола', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^Създай профил/ }).click();
  await expectLobby(page);
}

/** Signs in through the landing page's "Вход" form. */
export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await openForm(page, 'Вход');
  await expect(page.getByRole('heading', { name: 'Здравей отново!', exact: true })).toBeVisible();
  await page.getByLabel('Потребителско име или имейл').fill(username);
  await page.getByLabel('Парола', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Влез', exact: true }).click();
  await expectLobby(page);
}

/** Starts a solo match from the lobby in the given category ("Микс", "История"…), at a pace ("Без часовник"…). */
export async function startSolo(page: Page, category: string, pace?: '15 с' | '30 с' | 'Без часовник') {
  await page.getByRole('button', { name: 'Играй Соло', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Избери категория', exact: true });
  if (pace) await picker.getByRole('button', { name: pace, exact: true }).click();
  await picker.getByRole('button', { name: category }).click();
  await expect(page).toHaveURL(/\/game$/);
  // Gone, not just going: its title is a round's „Избери категория“ to playMatch, which would answer the first
  // question as a pick (WebKit takes a moment longer to close it).
  await expect(picker).toBeHidden();
}

/**
 * Waits until a „Подреди“ question's items take a key or a tap: on its way in, behind the last question's reveal, they
 * are aria-disabled, and the match's keys skip them (GamePage → useMatchKeys).
 */
export async function expectPressable(ordering: Locator) {
  await expect(ordering.locator('button[data-answer]').first()).not.toHaveAttribute('aria-disabled', {
    timeout: gameMs(5_000),
  });
}

export interface MatchSummary {
  /** Questions this player answered (each one confirmed on screen). */
  answered: number;
  /** "Въпрос N / M" as the match showed it. */
  total: number;
}

/**
 * Plays the match on screen to the end: every question gets an answer — the first option still open ("А) …", "Б) …",
 * "В) …", "Г) …"), or on a number question a number in its range, typed on the keypad or slid to — and a round's
 * category, when this player is asked to pick one, the first on offer. Returns once the results are up.
 */
export async function playMatch(page: Page, opts: { moment?: 'pass' | 'keep' } = {}): Promise<MatchSummary> {
  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const lock = page.getByRole('button', { name: 'Заключи', exact: true });
  const pick = page.getByRole('heading', { name: 'Избери категория', exact: true });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  // Соло without a clock: each answer waits for „Продължи“.
  const goOn = page.getByRole('button', { name: 'Продължи', exact: true });
  const ordering = page.getByRole('list', { name: 'Твоят ред', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  const answered = new Set<number>();
  let total = 0;
  // The pointer stays clear of the answers: one resting on an answer's bottom edge makes it bob up and down without
  // end (the hover lift moves it off the pointer and back), and a click waits for the button to hold still.
  const parkPointer = () => page.mouse.move(0, 0);
  await parkPointer();

  for (;;) {
    // Between questions there's the countdown, the reveal or a round's pick; a 15-second question lasts 2.25 s at the
    // test speed.
    await expect(open.or(lock).or(pick).or(results).or(goOn).first()).toBeVisible({ timeout: gameMs(15_000) });
    if (await results.isVisible()) break;
    // Only with no question open: a held reveal fading out keeps its button for a moment beside the next question.
    const answerable = (await open.first().isVisible()) || (await lock.isVisible()) || (await ordering.isVisible());
    if (!answerable && (await goOn.isVisible())) {
      // It may go by itself meanwhile (a hold's own end): that's no failure.
      await goOn.click({ timeout: gameMs(2_000) }).catch(() => {});
      await expect(goOn).toBeHidden({ timeout: gameMs(5_000) });
      continue;
    }
    if (await pick.isVisible()) {
      await page.locator('[data-answer="0"]').click({ timeout: gameMs(2_000) });
      await expect(pick).toBeHidden({ timeout: gameMs(5_000) });
      continue;
    }
    const [index, of] = (await counter.textContent())!.match(/\d+/g)!.map(Number);
    total = of;
    expect(answered.has(index), `question ${index} offered twice`).toBe(false);
    if (await ordering.isVisible()) {
      // „Подреди“: А, Б, В, Г in that order (1–4, as for options), Enter locks it — once its items can be pressed (a
      // key on a question still on its way in does nothing, as a tap wouldn't).
      await expectPressable(ordering);
      for (const key of ['1', '2', '3', '4']) await page.keyboard.press(key);
      await page.keyboard.press('Enter');
      // Locked in — or already revealed as given: alone, the reveal follows the lock at once, so the line that says
      // it's locked can come and go between two looks (or never be drawn at all).
      const taken = page.getByText('Редът е заключен.').or(page.getByText(/(Всичко на място!|\d от \d на място)$/));
      await expect(taken.first(), `order for question ${index} not taken`).toBeAttached({ timeout: gameMs(2_000) });
    } else if (await lock.isVisible()) {
      await giveNumber(page);
      // Locked in: the number stays on show, with nothing left to press.
      await expect(lock, `number for question ${index} not taken`).toBeHidden({ timeout: gameMs(2_000) });
    } else {
      // No longer than the question lasts: a click that waited on would land on the next question.
      await open.first().click({ timeout: gameMs(2_500) });
      await parkPointer();
      // The pick shows as "твоят избор" at once and stays until the next question comes up.
      const picked = page.getByRole('button', { name: /— (верен отговор, )?твоят избор/ });
      await expect(picked, `answer to question ${index} not taken`).toBeVisible({ timeout: gameMs(2_000) });
    }
    answered.add(index);
  }
  if (opts.moment !== 'keep') await passRewardMoment(page);
  return { answered: answered.size, total };
}

/**
 * The rewards' moment before the results page (a new level, a new avatar: RewardMoment), when the match brought one:
 * gone with Escape, as a player skips it. Returns whether there was one.
 */
export async function passRewardMoment(page: Page): Promise<boolean> {
  const moment = page.getByRole('dialog', { name: 'Ново от този мач', exact: true });
  const shown = await moment
    .waitFor({ state: 'visible', timeout: 1_500 })
    .then(() => true)
    .catch(() => false);
  if (!shown) return false;
  await page.keyboard.press('Escape');
  await expect(moment).toBeHidden();
  return true;
}

/**
 * A number question's answer, locked in: on a slider one step up; else its range's low end, its first digit tapped on
 * the keypad and the rest typed (the clock is short at the tests' speed), Enter to lock it.
 */
async function giveNumber(page: Page) {
  const more = page.getByRole('button', { name: 'Повече', exact: true });
  if (await more.isVisible()) {
    await more.click();
    await page.getByRole('button', { name: 'Заключи', exact: true }).click({ timeout: gameMs(2_000) });
    return;
  }
  // "от 1000 до 2026", "от 0,1 млн. до 50 млн.": the low end's digits (and comma), without its unit.
  const range = (await page.getByText(/^от .+ до .+$/).textContent())!;
  const low = range.slice(3, range.indexOf(' до ')).replace(/[^\d,]/g, '');
  await page.getByRole('button', { name: low[0], exact: true }).click();
  await page.keyboard.type(low.slice(1));
  await page.keyboard.press('Enter');
}

/**
 * Fails when the page is wider than the screen (it would scroll sideways), naming the elements that stick out.
 * Polled briefly, so a transition that's still running doesn't count.
 */
export async function expectNoSideScroll(page: Page, where: string) {
  const width = page.viewportSize()!.width;
  const overflow = () =>
    page.evaluate((width) => {
      const scrollWidth = document.documentElement.scrollWidth;
      if (scrollWidth <= width) return null;
      const describe = (el: Element) => {
        const classes = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 4).join('.') : '';
        const text = el.textContent?.trim().slice(0, 40) ?? '';
        const right = Math.round(el.getBoundingClientRect().right);
        return `<${el.tagName.toLowerCase()}${classes ? `.${classes}` : ''}> "${text}" right=${right}`;
      };
      // What can widen the page: not something clipped by an ancestor, nor anything fixed (that only follows the page).
      const canWiden = (el: Element) => {
        for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
          const style = getComputedStyle(node);
          if (style.position === 'fixed') return false;
          if (node !== el && style.overflowX !== 'visible') return false;
        }
        return true;
      };
      const sticking = [...document.body.querySelectorAll('*')].filter(
        (el) => el.getBoundingClientRect().right > width + 0.5 && canWiden(el),
      );
      // The innermost ones are the culprits; their ancestors only stick out because of them.
      const culprits = sticking.filter((el) => !sticking.some((other) => other !== el && el.contains(other)));
      return { scrollWidth, culprits: culprits.slice(0, 5).map(describe) };
    }, width);
  await expect.poll(overflow, { message: `${where}: wider than the ${width}px screen`, timeout: 3_000 }).toBeNull();
}

/** A PNG of the given size (a gradient: a picture a canvas has something to encode), for a file input. */
export function png(w: number, h: number): Buffer {
  const rows = Array.from({ length: h }, (_, y) =>
    Buffer.from([0, ...Array.from({ length: w }, (_, x) => [(x * 255) / w, (y * 255) / h, 128]).flat()]),
  );
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(w, 0);
  header.writeUInt32BE(h, 4);
  header[8] = 8; // bits per channel
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
