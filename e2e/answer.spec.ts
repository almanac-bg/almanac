// The moment of an answer on a phone, upright and on its side, and on a laptop: the answer comes into place in one
// movement (run.ts, settle). The head holds still while the page moves, the right answer is never under the panel
// docking at the screen's foot, and it ends between the two, in sight, its pop waiting for it to get there. Where
// every kind of question ends at each size is layout.spec.ts's.

import { expect, type Page, test } from "@playwright/test";
import { beside } from "./kinds.ts";
import { answer, moveOn, startDay } from "./play.ts";

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
  /** A choice's answers kept whole (the player's, the right one) that changed height from the panel's showing to the
   * fact (re-wrapped as their shares came): what the answer brings to a row comes in place once, with the panel. */
  rewrapped: number;
  done: boolean;
  right?: { from: number; to: number; height: number; tall: number[]; pic: boolean; pop: number[] };
}

/** Watches the answer come into place, from the answer to its fact: how many times the head changed size (stuck or
 * not) once the panel showed, in how many frames the right answer (of a choice) was under the panel, and how its pop
 * ran. */
async function watch(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as { seen: Seen };
    const seen: Seen = { flips: 0, snaps: 0, covered: 0, through: 0, rewrapped: 0, done: false };
    w.seen = seen;
    const head = document.querySelector(".question-top");
    const shown = () => document.querySelector(".run-question .after:not([hidden])");
    const choices = [...document.querySelectorAll<HTMLElement>(".run-question .choices > .option")];
    let tall: number[] | null = null;
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
      if (panel && !tall) tall = choices.map((o) => o.offsetHeight);
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
        seen.rewrapped = choices.filter((o, i) => o.matches(".right, .wrong") && o.offsetHeight !== tall?.[i]).length;
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

/** The flags the sample bank has pictures of, and their names: a day's first choice shown as pictures, as a picture
 * choice of the bank's is (the sample's day has none). */
const flags = ["f0f6ec7e0b258f30", "703d76f0fe3c120e", "dc6a9216ca85cb89", "087b5a8d2e985d04"];
const flagNames = ["Литва", "Боливия", "Босна и Херцеговина", "Габон"];

/** Shows the day's first choice as pictures (the server's answer the same), wherever a question comes from (the day
 * started, a run's next, an answer's), answered with their names and how everyone answered; and, given `dated`, those
 * questions (by their place) dealt on their own date, their answers with a day's line and the longest fact the bank
 * takes (bank/check.go: 100 and 200 letters); given `full`, every answer as full as a panel gets: how everyone answered,
 * and a right one's fact written in ink (a right answer of the issue, met there first), or „Вярно е“ on a miss. The rest as
 * they are. */
async function aPictureChoice(page: Page, { dated = [] as number[], full = false } = {}): Promise<void> {
  let pictured: number | null = null;
  await page.route(/\/api\/(day$|runs\/)/, async (route) => {
    const res = await route.fetch();
    const s = await res.json().catch(() => null);
    const answered = route.request().postDataJSON()?.n;
    if (s?.reveal && answered === pictured) {
      s.reveal.names = flagNames;
      s.reveal.crowd = { answers: 40, right: 0.4, picks: [0.1, 0.4, 0.3, 0.2], today: true };
    }
    if (s?.reveal && full) {
      s.ink = s.right === true; // the server writes ink only for a right answer; a miss has „Вярно е“ instead
      s.reveal.crowd ??= { answers: 40, right: 0.4, today: true };
    }
    if (s?.reveal && dated.includes(answered)) {
      s.reveal.day = "През 1878 г. в Сан Стефано е подписан мирният договор, с който България се връща на картата.";
      s.reveal.fact =
        "Договорът е подписан в предградие на Цариград, а датата му става национален празник едва през 1990 г., " +
        "след дълги спорове в Народното събрание, и оттогава се чества всяка година с голямо внимание.";
    }
    const question = (s?.run ?? s?.state ?? s)?.question;
    if (question && dated.includes(question.n)) question.onThisDay = true;
    const view = question?.view;
    if (view?.type === "choice" && view.choices && (pictured ?? question.n) === question.n) {
      pictured = question.n;
      delete view.choices;
      view.pictures = flags.map((f) => ({
        src: `/qimg/${f}-600.webp`,
        srcset: `/qimg/${f}-600.webp 600w, /qimg/${f}.webp 1200w`,
        w: 1200,
        h: 720,
        alt: "Знаме",
      }));
    }
    await route.fulfill({ response: res, json: s });
  });
}

test.describe("on its side", () => {
  test.use({ viewport: { width: 844, height: 390 }, hasTouch: true });
  // A phone on its side is a touch screen (a coarse pointer): Playwright's Firefox is a computer's.
  test.skip(({ browserName }) => browserName === "firefox", "a computer's Firefox has no touch screen");

  test("a phone on its side has the question and its answers in the screen's height, the right one in sight, and a choice of pictures in a row", async ({
    page,
  }) => {
    await aPictureChoice(page, { full: true });
    let [pictures, words] = [0, 0];
    await playWatching(page, {
      before: async () => {
        await sideways(page);
        if (await page.locator(".pic-options").count()) {
          pictures++;
          const tops = await page
            .locator(".pic-options .option")
            .evaluateAll((all) => all.map((o) => o.getBoundingClientRect().top));
          expect(new Set(tops).size, "the pictures are a row").toBe(1);
        } else if (await page.locator(".answering .choices > .option").count()) words++;
      },
      after: () => factInSight(page),
    });
    expect(pictures, "a choice of pictures").toBeGreaterThan(0);
    expect(words, "a choice of words").toBeGreaterThan(0);
  });
});

/** A question on a phone on its side: the header and the bar of places step aside, as upright; the head is small,
 * the topic still in it; a choice's answers start on the screen; rows of a list are a phone's on its side (a list of
 * eight goes on below it: the sample's planets). */
async function sideways(page: Page): Promise<void> {
  await expect(page.locator(".places-foot")).toBeHidden();
  await expect(page.locator(".question-top")).toHaveClass(/stuck/);
  await expect(page.locator(".question-head .kicker").last()).toBeVisible();
  // Once the page has its fonts and the head its small size (a slow machine has the fallback's wider lines first).
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect
    .poll(() =>
      page
        .locator(".answering :is(.choices, .pic-options, .tf-options) > .option")
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

  test("„Готово“ and „Отговори“ stay in sight while the clock runs, and the answer comes beside the question: a picture's, a day's line and the longest fact too", async ({
    page,
  }) => {
    await aPictureChoice(page, { dated: [6, 9] });
    await playWatching(page, {
      before: async () => {
        const send = page.locator(".answering .btn.primary.big").first();
        if (!(await send.count())) return;
        const box = await send.boundingBox();
        expect(box && box.y + box.height).toBeLessThanOrEqual(650);
      },
      after: async () => expect(await beside(page)).toEqual([]),
    });
  });
});
