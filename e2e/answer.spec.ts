// The moment of an answer on a phone, upright and on its side, and on a laptop: the answer comes into place in one
// movement (run.ts, settle). The head holds still while the page moves, the right answer is never under the panel
// docking at the screen's foot, and it ends between the two, in sight, its pop waiting for it to get there.

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test } from "@playwright/test";
import { answer, dealt, moveOn, startDay } from "./play.ts";

/** What watching an answer come into place saw: how many times the head changed size, in how many frames the right
 * answer was under the panel, and the right answer's way and pop: where it was drawn as the panel showed and where it
 * ended, its height then and at the end (`tall`: as laid out, the pop's scale aside), and how far its pop had run then
 * and a little later. */
interface Seen {
  flips: number;
  /** Of them, made in one frame: the head's count not gliding to its new size with the rest. */
  snaps: number;
  covered: number;
  /** Frames with the panel less than opaque: the answers under it showing through. */
  through: number;
  /** A choice's answers kept whole (the player's, the right one) that changed height from the question to its fact
   * (re-wrapped as their ends filled). */
  rewrapped: number;
  /** The tally's height as asked and as it ended (its line is kept before there's a row of right answers). */
  tally: number[];
  done: boolean;
  right?: { from: number; to: number; height: number; tall: number[]; pic: boolean; pop: number[] };
}

/** Watches the answer come into place, from the answer to its fact: how many times the head changed size (stuck or
 * not) once the panel showed, in how many frames the right answer (of a choice) was under the panel, and how its pop
 * ran. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: Seen };
    const tally = () => document.querySelector<HTMLElement>(".question-top .tally")?.offsetHeight ?? 0;
    const seen: Seen = { flips: 0, snaps: 0, covered: 0, through: 0, rewrapped: 0, tally: [tally()], done: false };
    w.seen = seen;
    const head = document.querySelector(".question-top");
    const shown = () => document.querySelector(".run-question .after:not([hidden])");
    const choices = [...document.querySelectorAll<HTMLElement>(".run-question .choices > .option")];
    const tall = choices.map((o) => o.offsetHeight);
    let stuck = head?.classList.contains("stuck");
    const changes = new MutationObserver(() => {
      const now = head?.classList.contains("stuck");
      if (now !== stuck && shown()) {
        seen.flips++;
        if (!head?.querySelector(".count")?.getAnimations().length) seen.snaps++;
      }
      stuck = now;
    });
    if (head) changes.observe(head, { attributes: true, attributeFilter: ["class"] });
    let from = 0;
    const frame = (t: number) => {
      const panel = shown();
      const right = document.querySelector(".run-question button.option.right");
      // Under the panel docked at the screen's foot (a phone's: beside the question on a laptop, it's never over it).
      const docked = panel && getComputedStyle(panel).position === "fixed";
      if (docked && right && right.getBoundingClientRect().bottom > panel.getBoundingClientRect().top + 1)
        seen.covered++;
      if (panel && Number(getComputedStyle(panel).opacity) < 1) seen.through++;
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
        // The rows that stay whole (the player's and the right one: the others go to a line each, as they should).
        seen.rewrapped = choices.filter((o, i) => o.matches(".right, .wrong") && o.offsetHeight !== tall[i]).length;
        seen.tally.push(tally());
        seen.done = true;
        changes.disconnect();
      } else requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

/** Where the right answer of a choice ended: between the head and the panel docked at the screen's foot (on a
 * laptop, the panel beside it: the screen's foot). */
async function inSight(page: Page): Promise<void> {
  const at = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const right = box(".run-question button.option.right");
    const panel = document.querySelector(".after");
    const foot =
      panel && getComputedStyle(panel).position === "fixed" ? panel.getBoundingClientRect().top : innerHeight;
    return right && { top: right.top, bottom: right.bottom, head: box(".question-top")?.bottom, panel: foot };
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
  {
    before,
    after,
    start = async () => {
      await page.goto("/");
      await startDay(page);
    },
  }: { before?: () => Promise<void>; after?: () => Promise<void>; start?: () => Promise<void> } = {},
): Promise<number> {
  test.slow(); // ten questions, each watched to its fact
  await start();
  let far = 0;
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    await before?.();
    await watch(page);
    await answer(page);
    await page.waitForFunction(() => (window as unknown as { seen: Seen }).seen.done);
    const seen = await page.evaluate(() => (window as unknown as { seen: Seen }).seen);
    expect(seen.flips, `question ${n + 1}: the head changed size as the answer came into place`).toBeLessThanOrEqual(1);
    expect(seen.snaps, `question ${n + 1}: the head changed size in one frame`).toBe(0);
    expect(seen.covered, `question ${n + 1}: the right answer was under the panel`).toBe(0);
    expect(seen.through, `question ${n + 1}: the answers showed through the panel`).toBe(0);
    expect(seen.rewrapped, `question ${n + 1}: answers re-wrapped as the answer showed`).toBe(0);
    expect(seen.tally[1], `question ${n + 1}: the head grew with the row`).toBe(seen.tally[0]);
    expect(seen.tally[0], `question ${n + 1}: the tally's line isn't kept`).toBeGreaterThan(0);
    const r = seen.right;
    // What shows on an answer later (how everyone answered) doesn't make it taller, out of the room it settled in.
    if (r) expect(r.tall[1], `question ${n + 1}: the right answer grew once in place`).toBe(r.tall[0]);
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
    // The choices' words as long as many of the bank's (the sample's are short), each about a line on a phone: what
    // the answer brings to their ends (✓ or ✕, how many gave it) never makes one wrap. The server judges the pick.
    const long = ["Шутър от първо лице", "Стратегия в реално време", "Платформър", "Ролева игра"];
    await page.route(/\/api\/(day$|runs\/)/, async (route) => {
      const res = await route.fetch();
      const s = await res.json().catch(() => null);
      const view = (s?.run ?? s?.state ?? s)?.question?.view;
      if (view?.type === "choice" && view.choices)
        view.choices = view.choices.map((c: string, i: number) => long[i] ?? c);
      await route.fulfill({ response: res, json: s });
    });
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
  await expect(page.locator(".places-foot")).toBeHidden();
  await expect(page.locator(".question-top")).toHaveClass(/stuck/);
  await expect(page.locator(".question-head .kicker").last()).toBeVisible();
  // Once the page has its fonts and the head its small size (a slow machine has the fallback's wider lines first).
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() =>
      page
        .locator(".answering .options .option")
        .evaluateAll((all) => Math.max(0, ...all.map((o) => o.getBoundingClientRect().top))),
    )
    .toBeLessThan(390);
  const rows = await page
    .locator(".answering :is(.sortable-list, .match) .option")
    .evaluateAll((all) => all.map((o) => getComputedStyle(o).minHeight));
  for (const row of rows) expect(row).toBe("48px");
}

test.describe("on a laptop", () => {
  test.use({ viewport: { width: 1366, height: 650 }, isMobile: false, hasTouch: false });

  test("„Готово“ and „Отговори“ stay in sight while the clock runs, and the answer comes beside the question", async ({
    page,
  }) => {
    await playWatching(page, {
      before: async () => {
        const send = page.locator(".answering .btn.primary.big").first();
        if (!(await send.count())) return;
        const box = await send.boundingBox();
        expect(box && box.y + box.height).toBeLessThanOrEqual(650);
      },
      after: () => beside(page),
    });
  });

  test("every kind of question has its answer beside it, the fact whole in sight, a day's line and the longest fact too", async ({
    page,
  }) => {
    // A game of one of each kind (the sample's day has no choice of pictures, and a split or clues, not both): its
    // first choice shown as pictures, as the bank's are, and two answers given a day's line and the longest fact the
    // bank takes (bank/check.go: 100 and 200 letters), as a question dealt on its own date has.
    const ids = oneOfEach();
    const flags = ["f0f6ec7e0b258f30", "703d76f0fe3c120e", "dc6a9216ca85cb89", "087b5a8d2e985d04"];
    const [pictured, dated] = [1, [6, 9]];
    await page.route(/\/api\/runs\//, async (route) => {
      const res = await route.fetch();
      const s = await res.json().catch(() => null);
      const answered = route.request().postDataJSON()?.n;
      if (s?.reveal && answered === pictured) s.reveal.names = ["Литва", "Боливия", "Босна и Херцеговина", "Габон"];
      if (s?.reveal && dated.includes(answered)) {
        s.reveal.day = "През 1878 г. в Сан Стефано е подписан мирният договор, с който България се връща на картата.";
        s.reveal.fact =
          "Договорът е подписан в предградие на Цариград, а датата му става национален празник едва през 1990 г., " +
          "след дълги спорове в Народното събрание, и оттогава се чества всяка година с голямо внимание.";
      }
      const question = (s?.run ?? s?.state ?? s)?.question;
      if (question?.n === pictured && question.view?.choices) {
        delete question.view.choices;
        question.view.pictures = flags.map((f) => ({
          src: `/qimg/${f}-600.webp`,
          srcset: `/qimg/${f}-600.webp 600w, /qimg/${f}.webp 1200w`,
          w: 1200,
          h: 720,
          alt: "Знаме",
        }));
      }
      if (dated.includes(question?.n)) question.onThisDay = true;
      await route.fulfill({ response: res, json: s });
    });
    const kinds = new Set<string>();
    await playWatching(page, {
      start: async () => {
        await page.goto("/");
        await dealt(page, "history", ids);
        // The topic's game is under way (dealt), so its page goes on with it.
        await page.goto("/play/history");
        await page.getByRole("button", { name: "Продължи", exact: true }).click();
        await page.getByRole("button", { name: "Започни сега" }).click();
      },
      before: async () => {
        kinds.add(
          await page.evaluate(() => {
            const q = document.querySelector(".run-question");
            const kind = ["pic-options", "picture", "keypad", "sortable-list", "match", "split", "clues", "tf-options"];
            return kind.find((k) => q?.querySelector(`.${k}`)) ?? "choice";
          }),
        );
      },
      after: () => beside(page),
    });
    expect([...kinds].sort()).toEqual(
      ["choice", "clues", "keypad", "match", "pic-options", "picture", "sortable-list", "split", "tf-options"].sort(),
    );
  });
});

/** The sample bank's questions, one of each kind, in the order a game deals them here: a choice, a choice (shown as
 * pictures), a choice under a picture, „Вярно или невярно“, an order, pairs, groups, clues, a number and a choice. */
function oneOfEach(): string[] {
  const dir = resolve(import.meta.dirname, "../bank/sample/questions");
  const all = readdirSync(dir).flatMap(
    (f) => JSON.parse(readFileSync(resolve(dir, f), "utf8")) as { id: string; type: string; image?: unknown }[],
  );
  const of = (type: string, image = false, skip = 0) =>
    all.filter((q) => q.type === type && !!q.image === image)[skip]?.id ?? "";
  return [
    of("choice"),
    of("choice", false, 1),
    of("choice", true),
    of("truefalse"),
    of("order"),
    of("match"),
    of("split"),
    of("clues"),
    of("number"),
    of("choice", false, 2),
  ];
}

/** Where the answer ended, on a laptop: on the left page under the question, what answered it on the right; the
 * verdict, the fact whole and „Напред“ in sight on the screen, nothing over them. */
async function beside(page: Page): Promise<void> {
  const at = await page.evaluate(() => {
    const box = (s: string) => document.querySelector(s)?.getBoundingClientRect();
    const seen = (s: string, x: number, y: number) =>
      y >= 0 && y <= innerHeight && !!document.elementFromPoint(x, y)?.closest(s);
    const fact = box(".after .fact");
    const go = box(".after .up-next-go");
    const verdict = box(".after .verdict");
    return {
      answers: box(".run-question .answering")?.left ?? 0,
      panel: box(".after")?.right ?? Number.POSITIVE_INFINITY,
      verdict: !!verdict && seen(".verdict", verdict.left + 8, verdict.top + verdict.height / 2),
      fact: !fact || (seen(".fact", fact.left + 8, fact.top + 4) && seen(".fact", fact.left + 8, fact.bottom - 4)),
      go: !!go && seen(".up-next-go", go.left + go.width / 2, go.top + 4) && go.bottom <= innerHeight,
    };
  });
  expect(at.panel, "the answer is beside what answered it").toBeLessThan(at.answers);
  expect(at.verdict, "the verdict is in sight").toBe(true);
  expect(at.fact, "the fact is in sight, whole").toBe(true);
  expect(at.go, "„Напред“ is in sight").toBe(true);
}
