// The moment of an answer on a phone, upright and on its side: the answer comes into place in one movement (run.ts,
// settle). The head holds still while the page moves, the right answer is never under the panel docking at the
// screen's foot, and it ends between the two, in sight.
import { expect, type Page, test } from "@playwright/test";
import { answer, moveOn, startDay } from "./play.ts";

/** Watches the answer come into place, from the answer to its fact: how many times the head changed size (stuck or
 * not) once the panel showed, and in how many frames the right answer (of a choice) was under the panel. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: { flips: number; covered: number; done: boolean } };
    const seen = { flips: 0, covered: 0, done: false };
    w.seen = seen;
    const head = document.querySelector(".question-top");
    const shown = () => document.querySelector(".run-question .after:not([hidden])");
    let stuck = head?.classList.contains("stuck");
    const changes = new MutationObserver(() => {
      const now = head?.classList.contains("stuck");
      if (now !== stuck && shown()) seen.flips++;
      stuck = now;
    });
    if (head) changes.observe(head, { attributes: true, attributeFilter: ["class"] });
    let from = 0;
    const frame = (t: number) => {
      const panel = shown();
      const right = document.querySelector(".run-question button.option.right");
      if (panel && right && right.getBoundingClientRect().bottom > panel.getBoundingClientRect().top + 1)
        seen.covered++;
      if (panel && !from) from = t;
      if (from && t - from > 1000) {
        seen.done = true;
        changes.disconnect();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Where the right answer of a choice ended: between the head and the panel. */
async function inSight(page: Page): Promise<void> {
  const at = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const right = box(".run-question button.option.right");
    return (
      right && { top: right.top, bottom: right.bottom, head: box(".question-top")?.bottom, panel: box(".after")?.top }
    );
  });
  if (!at) return;
  expect(at.top).toBeGreaterThanOrEqual((at.head ?? 0) - 1);
  expect(at.bottom).toBeLessThanOrEqual((at.panel ?? 0) + 1);
}

/** Plays the day's ten, checking each answer's moment; `before` checks each question as it's asked. */
async function playWatching(page: Page, before?: () => Promise<void>): Promise<void> {
  test.slow(); // ten questions, each watched to its fact
  await page.goto("/");
  await startDay(page);
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await before?.();
    await watch(page);
    await answer(page);
    await page.waitForFunction(() => (window as unknown as { seen: { done: boolean } }).seen.done);
    const seen = await page.evaluate(() => (window as unknown as { seen: { flips: number; covered: number } }).seen);
    expect(seen.flips, `question ${n + 1}: the head changed size as the answer came into place`).toBeLessThanOrEqual(1);
    expect(seen.covered, `question ${n + 1}: the right answer was under the panel`).toBe(0);
    await inSight(page);
    await moveOn(page);
  }
}

test.describe("upright", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an answer comes into place in one movement, the right one in sight between the head and the panel", async ({
    page,
  }) => {
    await playWatching(page);
  });
});

test.describe("on its side", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });
  // A phone on its side is a touch screen (a coarse pointer): Playwright's Firefox is a computer's.
  test.skip(({ browserName }) => browserName === "firefox", "a computer's Firefox has no touch screen");

  test("a phone on its side has the question and its answers in the screen's height, and the right one in sight", async ({
    page,
  }) => {
    await playWatching(page, async () => {
      // The header and the bar of places step aside, as upright, and a choice's answers start on the screen.
      await expect(page.locator(".tabs")).toBeHidden();
      const tops = await page
        .locator(".answering .options .option")
        .evaluateAll((all) => all.map((o) => o.getBoundingClientRect().top));
      for (const top of tops) expect(top).toBeLessThan(390);
    });
  });
});

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1366, height: 650 }, isMobile: false, hasTouch: false });

  test("„Готово“ and „Отговори“ stay in sight while the clock runs, and the answer comes into place in one movement", async ({
    page,
  }) => {
    await playWatching(page, async () => {
      const send = page.locator(".answering .btn.primary.big").first();
      if (!(await send.count())) return;
      const box = await send.boundingBox();
      expect(box && box.y + box.height).toBeLessThanOrEqual(650);
    });
  });
});
