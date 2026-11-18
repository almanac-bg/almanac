// The moment of an answer on a phone, upright and on its side, and on a laptop: the answer comes into place in one
// movement (run.ts, settle). The head holds still while the page moves, the right answer is never under the panel
// docking at the screen's foot, and it ends between the two, in sight, its pop waiting for it to get there.
import { expect, type Page, test } from "@playwright/test";
import { answer, moveOn, startDay } from "./play.ts";

/** What watching an answer come into place saw: how many times the head changed size, in how many frames the right
 * answer was under the panel, and the right answer's way and pop: where it was drawn as the panel showed and where it
 * ended, its height then and at the end (`tall`: as laid out, the pop's scale aside), and how far its pop had run then
 * and a little later. */
interface Seen {
  flips: number;
  covered: number;
  done: boolean;
  right?: { from: number; to: number; height: number; tall: number[]; pic: boolean; pop: number[] };
}

/** Watches the answer come into place, from the answer to its fact: how many times the head changed size (stuck or
 * not) once the panel showed, in how many frames the right answer (of a choice) was under the panel, and how its pop
 * ran. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: Seen };
    const seen: Seen = { flips: 0, covered: 0, done: false };
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
      if (panel && right) {
        const box = right.getBoundingClientRect();
        const pop = right.getAnimations().find((a) => a instanceof CSSAnimation && a.animationName === "pop");
        const ran = Number(pop?.currentTime ?? -1);
        const tall = (right as HTMLElement).offsetHeight;
        if (!seen.right)
          seen.right = {
            from: box.top,
            to: box.top,
            height: box.height,
            tall: [tall, tall],
            pic: right.classList.contains("pic-option"),
            pop: [ran],
          };
        else if (t - from > 100 && t - from < 200 && seen.right.pop.length === 1) seen.right.pop.push(ran);
        seen.right.to = box.top;
        seen.right.tall[1] = tall;
      }
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

/** Where the fact ended, on a phone: its first line in sight in the panel, not under „Напред“ nor below the screen. */
async function factInSight(page: Page): Promise<void> {
  const seen = await page.evaluate(() => {
    const line = document.querySelector(".after .fact p")?.getBoundingClientRect();
    if (!line) return null;
    const y = line.top + 10;
    return y < innerHeight && !!document.elementFromPoint(line.left + 8, y)?.closest(".fact");
  });
  if (seen !== null) expect(seen, "the fact's first line is in sight").toBe(true);
}

/** Plays the day's ten, checking each answer's moment; `before` checks each question as it's asked, `after` each
 * answer where it ended. Returns how many right answers came from far (more than half their height): their pop
 * waited until they were there. */
async function playWatching(
  page: Page,
  { before, after }: { before?: () => Promise<void>; after?: () => Promise<void> } = {},
): Promise<number> {
  test.slow(); // ten questions, each watched to its fact
  await page.goto("/");
  await startDay(page);
  let far = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await before?.();
    await watch(page);
    await answer(page);
    await page.waitForFunction(() => (window as unknown as { seen: Seen }).seen.done);
    const seen = await page.evaluate(() => (window as unknown as { seen: Seen }).seen);
    expect(seen.flips, `question ${n + 1}: the head changed size as the answer came into place`).toBeLessThanOrEqual(1);
    expect(seen.covered, `question ${n + 1}: the right answer was under the panel`).toBe(0);
    const r = seen.right;
    // What shows on a picture later (how everyone answered) doesn't make it taller, out of the room it settled in.
    if (r?.pic) expect(r.tall[1], `question ${n + 1}: the right answer grew once in place`).toBe(r.tall[0]);
    if (r && Math.abs(r.to - r.from) > r.height / 2 && r.pop.length === 2) {
      far++;
      expect(r.pop[1], `question ${n + 1}: the right answer popped on its way`).toBe(r.pop[0]);
    }
    await inSight(page);
    await after?.();
    await moveOn(page);
  }
  return far;
}

test.describe("upright", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("an answer comes into place in one movement, the right one in sight between the head and the panel", async ({
    page,
  }) => {
    const far = await playWatching(page, { after: () => factInSight(page) });
    // Some right answers come from far: the panel docks where they were.
    expect(far).toBeGreaterThan(0);
  });
});

test.describe("turned", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true });
  test.skip(({ browserName }) => browserName === "firefox", "a computer's Firefox has no touch screen");

  test("a phone turned mid-question has the head small on its side, and its size back upright", async ({ page }) => {
    await page.goto("/");
    await startDay(page);
    const head = page.locator(".question-top");
    await expect(page.locator(".question-head")).toContainText("1 от 10");
    await expect(head).not.toHaveClass(/stuck/);
    await page.setViewportSize({ width: 844, height: 390 });
    await expect(head).toHaveClass(/stuck/);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(head).not.toHaveClass(/stuck/);
    await expect(head).toHaveCSS("margin-bottom", "0px");
  });
});

test.describe("on its side", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });
  // A phone on its side is a touch screen (a coarse pointer): Playwright's Firefox is a computer's.
  test.skip(({ browserName }) => browserName === "firefox", "a computer's Firefox has no touch screen");

  test("a phone on its side has the question and its answers in the screen's height, and the right one in sight", async ({
    page,
  }) => {
    await playWatching(page, { before: () => sideways(page), after: () => factInSight(page) });
  });

  test("on its side, a choice of pictures is a row, the right one over the panel and the fact in it", async ({
    page,
  }) => {
    // The sample's day has no choice of pictures: its choices are shown as pictures (the server's answer the same),
    // wherever a question comes from (the day started, a run's next, an answer's), and answered with their names and
    // how everyone answered, as a picture choice of the bank's is.
    const flags = ["f0f6ec7e0b258f30", "703d76f0fe3c120e", "dc6a9216ca85cb89", "087b5a8d2e985d04"];
    const pictured = new Set<number>();
    await page.route(/\/api\/(day$|runs\/)/, async (route) => {
      const res = await route.fetch();
      const s = await res.json().catch(() => null);
      if (s?.reveal && pictured.has(route.request().postDataJSON()?.n)) {
        s.reveal.names = ["Литва", "Боливия", "Босна и Херцеговина", "Габон"];
        s.reveal.crowd = { answers: 40, right: 0.4, picks: [0.1, 0.4, 0.3, 0.2], today: true };
      }
      const question = (s?.run ?? s?.state ?? s)?.question;
      const view = question?.view;
      if (view?.type !== "choice" || !view.choices) return route.fulfill({ response: res, json: s });
      pictured.add(question.n);
      delete view.choices;
      view.pictures = flags.map((f) => ({
        src: `/qimg/${f}-600.webp`,
        srcset: `/qimg/${f}-600.webp 600w, /qimg/${f}.webp 1200w`,
        w: 1200,
        h: 720,
        alt: "Знаме",
      }));
      await route.fulfill({ response: res, json: s });
    });
    let pictures = 0;
    await playWatching(page, {
      before: async () => {
        await sideways(page);
        if (await page.locator(".pic-options").count()) {
          pictures++;
          const tops = await page
            .locator(".pic-options .option")
            .evaluateAll((all) => all.map((o) => o.getBoundingClientRect().top));
          expect(new Set(tops).size, "the pictures are a row").toBe(1);
        }
      },
      after: () => factInSight(page),
    });
    expect(pictures).toBeGreaterThan(0);
  });
});

/** A question on a phone on its side: the header and the bar of places step aside, as upright; the head is small,
 * the topic still in it; a choice's answers start on the screen; rows of a list are a phone's on its side. */
async function sideways(page: Page): Promise<void> {
  await expect(page.locator(".tabs")).toBeHidden();
  await expect(page.locator(".question-top")).toHaveClass(/stuck/);
  await expect(page.locator(".question-head .kicker").last()).toBeVisible();
  const tops = await page
    .locator(".answering .options .option")
    .evaluateAll((all) => all.map((o) => o.getBoundingClientRect().top));
  for (const top of tops) expect(top).toBeLessThan(390);
  const rows = await page
    .locator(".answering :is(.sortable-list, .match) .option")
    .evaluateAll((all) => all.map((o) => getComputedStyle(o).minHeight));
  for (const row of rows) expect(row).toBe("48px");
}

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1366, height: 650 }, isMobile: false, hasTouch: false });

  test("„Готово“ and „Отговори“ stay in sight while the clock runs, and the answer comes into place in one movement", async ({
    page,
  }) => {
    await playWatching(page, {
      before: async () => {
        const send = page.locator(".answering .btn.primary.big").first();
        if (!(await send.count())) return;
        const box = await send.boundingBox();
        expect(box && box.y + box.height).toBeLessThanOrEqual(650);
      },
      // The answer shows under the question, its first line still in sight under the head; the verdict too, over
      // „Напред“ at the screen's foot.
      after: async () => {
        const at = await page.evaluate(() => {
          const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
          return {
            ask: box(".run-question .ask")?.top ?? 0,
            head: box(".question-top")?.bottom ?? 0,
            verdict: box(".after .verdict")?.bottom ?? 0,
            go: box(".after .up-next-go")?.top ?? 0,
          };
        });
        expect(at.verdict, "the verdict is over „Напред“").toBeLessThanOrEqual(Math.min(at.go, 650) + 1);
        // The question's first line goes under the head only where the verdict wouldn't show otherwise.
        if (at.verdict < at.go - 16)
          expect(at.ask, "the question's first line is under the head").toBeGreaterThanOrEqual(at.head - 1);
      },
    });
  });
});
