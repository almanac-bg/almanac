import { randomInt } from 'node:crypto';
import { type BrowserContext, test as base, expect, type Page } from '@playwright/test';

export type { Page };
export { expect };

interface Fixtures {
  /** Another person: a fresh browser context (no cookies, no storage) on the same kind of device. */
  newPlayer: () => Promise<Page>;
  /**
   * What went wrong inside the pages: uncaught exceptions and console errors (failed requests among them). Any of it
   * fails the test when it ends.
   */
  pageProblems: string[];
}

function watch(context: BrowserContext, problems: string[]) {
  context.on('weberror', (error) => problems.push(`uncaught: ${error.error().message}`));
  context.on('console', (message) => {
    if (message.type() !== 'error') return;
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
  await expect(page.getByText('Няма връзка — свързване…')).toHaveCount(0);
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

/** Signs up through the landing page's "Регистрация" form. */
export async function signUp(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Регистрация', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Създай профил', exact: true })).toBeVisible();
  await page.getByLabel('Потребителско име', { exact: true }).fill(username);
  await page.getByLabel('Парола', { exact: true }).fill(password);
  await page.getByRole('button', { name: /^Създай профил/ }).click();
  await expectLobby(page);
}

/** Signs in through the landing page's "Вход" form. */
export async function signIn(page: Page, username: string, password: string) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Вход', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Здравей отново!', exact: true })).toBeVisible();
  await page.getByLabel('Потребителско име или имейл').fill(username);
  await page.getByLabel('Парола', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Влез', exact: true }).click();
  await expectLobby(page);
}

/** Starts a solo match from the lobby in the given category ("Микс", "История"…). */
export async function startSolo(page: Page, category: string) {
  await page.getByRole('button', { name: 'Играй Соло', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Избери категория', exact: true });
  await picker.getByRole('button', { name: category }).click();
  await expect(page).toHaveURL(/\/game$/);
}

export interface MatchSummary {
  /** Questions this player answered (each one confirmed on screen). */
  answered: number;
  /** "Въпрос N / M" as the match showed it. */
  total: number;
}

/**
 * Plays the match on screen to the end: every question gets an answer (the first one still open — the answers are
 * "А) …", "Б) …", "В) …", "Г) …"). Returns once the results are up.
 */
export async function playMatch(page: Page): Promise<MatchSummary> {
  const open = page.getByRole('button', { name: /^[АБВГ]\) /, disabled: false });
  const results = page.getByRole('heading', { name: 'Награди', exact: true });
  const counter = page.getByText(/^Въпрос \d+ от \d+$/);
  const answered = new Set<number>();
  let total = 0;
  // The pointer stays clear of the answers: one resting on an answer's bottom edge makes it bob up and down without
  // end (the hover lift moves it off the pointer and back), and a click waits for the button to hold still.
  const parkPointer = () => page.mouse.move(0, 0);
  await parkPointer();

  for (;;) {
    // Between questions there's the countdown or the reveal; a 15-second question lasts 2.25 s at the test speed.
    await expect(open.or(results).first()).toBeVisible({ timeout: 15_000 });
    if (await results.isVisible()) break;
    const [index, of] = (await counter.textContent())!.match(/\d+/g)!.map(Number);
    total = of;
    expect(answered.has(index), `question ${index} offered twice`).toBe(false);
    // No longer than the question lasts: a click that waited on would land on the next question.
    await open.first().click({ timeout: 2_500 });
    await parkPointer();
    // The pick shows as "твоят избор" at once and stays until the next question comes up.
    const picked = page.getByRole('button', { name: /— (верен отговор, )?твоят избор/ });
    await expect(picked, `answer to question ${index} not taken`).toBeVisible({ timeout: 2_000 });
    answered.add(index);
  }
  return { answered: answered.size, total };
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
