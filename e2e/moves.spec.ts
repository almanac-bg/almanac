// Moving between screens on a slow line, frame by frame (DESIGN.md, Waiting): the screen before stays until the next
// can draw what it's for, or after a moment the next comes with its waits drawn in its shape; never an empty page, and
// never „…“. A place opened again is drawn at once from what it showed last. Back and forward too, and back comes to
// a page scrolled where it was. web/src/loading.test.ts holds the same of the code: no „…“ anywhere in the client.
import { expect, type Page, test } from "@playwright/test";
import { playedBefore } from "./play.ts";

/** What a frame showed: an empty page, „…“, waits drawn, or a screen (`screen`: which one, by its first element). */
interface Frame {
  t: number;
  blank: boolean;
  dots: boolean;
  loading: boolean;
  screen: number;
  path: string;
}

/** Watches every frame the page paints from now on (each animation frame: what's on the screen then), and the moment
 * of the next move: a click, or back or forward. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { frames_: Frame[]; moved_: number; watching_: boolean };
    const ids = new WeakMap<Element, number>();
    let n = 0;
    w.frames_ = [];
    w.moved_ = 0;
    w.watching_ = true;
    const moved = () => {
      w.moved_ ||= performance.now();
    };
    addEventListener("click", moved, { capture: true, once: true });
    addEventListener("popstate", moved, { capture: true, once: true });
    const seen = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && Number(s.opacity) > 0;
    };
    const look = () => {
      const main = document.getElementById("main");
      if (main) {
        const first = main.firstElementChild;
        if (first && !ids.has(first)) ids.set(first, ++n);
        const texts: string[] = [];
        const walk = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
        for (let t = walk.nextNode(); t; t = walk.nextNode()) {
          const text = (t.textContent ?? "").trim();
          if (text && t.parentElement && seen(t.parentElement) && !t.parentElement.closest(".sr")) texts.push(text);
        }
        const loading = [...main.querySelectorAll(".loading")].some(seen);
        const pictures = [...main.querySelectorAll("img, svg, canvas")].some(seen);
        w.frames_.push({
          t: performance.now(),
          blank: !texts.length && !loading && !pictures,
          dots: texts.some((x) => x === "…" || x === "..."),
          loading,
          screen: first ? (ids.get(first) ?? 0) : 0,
          path: location.pathname,
        });
      }
      if (w.watching_) requestAnimationFrame(look);
    };
    look(); // the screen as it is now, before the move
  });
}

/** The frames since watch, once the screen at `path` is whole: none empty, none with „…“. Returns whether any showed
 * waits, and how long after the click the screen at `path` came (ms). */
async function frames(page: Page, path: string, what: string): Promise<{ waited: boolean; after: number }> {
  await expect(page).toHaveURL(new RegExp(`${path}(#.*)?$`));
  // The screen in place and whole: nothing on its way (the line along the top), nothing of it loading.
  await expect(page.locator(".arriving.on")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator("main .loading")).toHaveCount(0, { timeout: 15_000 });
  await page.waitForTimeout(200); // a few frames more: what comes after it's whole
  const { list, moved } = await page.evaluate(() => {
    const w = window as unknown as { frames_: Frame[]; moved_: number; watching_: boolean };
    w.watching_ = false;
    return { list: w.frames_, moved: w.moved_ };
  });
  expect(list.length, `${what}: frames seen`).toBeGreaterThan(3);
  const blank = list.find((f) => f.blank);
  expect(blank, `${what}: an empty page ${blank ? Math.round(blank.t - moved) : 0}ms after the move`).toBeUndefined();
  const dots = list.find((f) => f.dots);
  expect(dots, `${what}: „…“ on the page`).toBeUndefined();
  const came = list.find((f) => f.screen !== list[0]?.screen);
  expect(came, `${what}: the screen came`).toBeDefined();
  return { waited: list.some((f) => f.loading), after: (came?.t ?? 0) - moved };
}

/** Taps a link to `path` where the player would: the bar of places, Профил's places, Настройки. */
async function tap(page: Page, path: string): Promise<void> {
  const link = page.locator(`nav a[href="${path}"], a.me-settings[href="${path}"]`).first();
  await link.click();
}

/** Every answer of the server's and every file of the game's slowed down, as on a poor line. */
async function slowLine(page: Page): Promise<void> {
  await page.route(/\/(api|assets)\//, async (route) => {
    await new Promise((r) => setTimeout(r, 450));
    await route.continue().catch(() => {}); // the page gone meanwhile
  });
}

async function movesAround(page: Page): Promise<void> {
  test.setTimeout(120_000);
  await page.goto("/");
  await playedBefore(page, 3); // a player on their fourth day: the league, the level and the boards are theirs
  await slowLine(page);
  await page.reload();
  await expect(page.locator(".masthead")).toBeVisible({ timeout: 15_000 });

  // Every place, and Профил's own, opened for the first time: the screen before, then waits at most, then the place.
  const first: [string, string][] = [
    ["/friends", "Приятели"],
    ["/ranks", "Класации"],
    ["/me", "Профил"],
    ["/rewards", "Награди"],
    ["/wardrobe", "Гардероб"],
    ["/almanac", "Алманах"],
    ["/me", "Профил again"],
    ["/settings", "Настройки"],
    ["/", "Начало"],
  ];
  for (const [path, what] of first) {
    await watch(page);
    await tap(page, path);
    await frames(page, path, what);
  }

  // The places opened again: drawn at once from what they showed last, never waited for.
  for (const [path, what] of [
    ["/friends", "Приятели"],
    ["/ranks", "Класации"],
    ["/me", "Профил"],
    ["/", "Начало"],
  ] as const) {
    await watch(page);
    await tap(page, path);
    const { waited, after } = await frames(page, path, `${what}, opened again`);
    expect(waited, `${what}, opened again: drawn at once, not waited for`).toBe(false);
    expect(after, `${what}, opened again: drawn at once`).toBeLessThan(250);
  }

  // Back and forward, and back to a page scrolled where it was left.
  const y = await page.evaluate(() => {
    scrollTo(0, Math.min(400, document.documentElement.scrollHeight - innerHeight));
    return scrollY;
  });
  await page.waitForTimeout(400); // kept in its entry a moment after it stops
  await watch(page);
  // (Tapped where it is: a click that scrolled to a link in the header first would leave the page at its top.)
  await page.locator(`nav a[href="/ranks"]`).first().dispatchEvent("click");
  await frames(page, "/ranks", "Класации, from Начало scrolled");
  await watch(page);
  await page.goBack();
  await frames(page, "/", "back to Начало");
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(y);
  await watch(page);
  await page.goForward();
  await frames(page, "/ranks", "forward to Класации");
}

test("moving between every place on a phone, on a slow line: never an empty page or „…“", async ({ page }) => {
  await movesAround(page);
});

test.describe("on a computer", () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test("moving between every place, on a slow line: never an empty page or „…“", async ({ page }) => {
    await movesAround(page);
  });
});
