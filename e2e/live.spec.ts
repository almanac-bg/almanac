import { expect, type Page, test } from "@playwright/test";
import { meetAs } from "./play.ts";

// A live duel's screens, as the server's stream draws them: the stream is played here (a stand-in for the browser's
// EventSource), so that each moment is the one under test, whatever two players would have done. The duel itself,
// matched and played, is the server's tests' (internal/live).

/** The page's live stream, played by the test: `push` sends the duel as this player sees it. */
async function liveStream(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { streams: EventTarget[]; push: (data: unknown) => void };
    w.streams = [];
    class Stream extends EventTarget {
      static CLOSED = 2;
      readyState = 1;
      constructor(readonly url: string) {
        super();
        w.streams.push(this);
      }
      close() {
        this.readyState = 2;
      }
    }
    (window as unknown as { EventSource: unknown }).EventSource = Stream;
    w.push = (data) => {
      for (const s of w.streams)
        if ((s as Stream).readyState !== 2)
          s.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(data) }));
    };
  });
}

const push = (page: Page, view: unknown) =>
  page.evaluate((v) => (window as unknown as { push: (d: unknown) => void }).push(v), view);

const side = (name: string, points: number, more: Record<string, unknown> = {}) => ({
  name,
  rating: 1000,
  division: "bronze",
  points,
  rights: points ? 1 : 0,
  trail: [{ points, right: points > 0 }],
  online: true,
  answered: false,
  ...more,
});
const question = {
  category: "history",
  view: { type: "choice", text: "Кой е първият български цар?", choices: ["Симеон", "Борис", "Петър", "Крум"] },
  limitMs: 20_000,
  leftMs: 15_000,
};

/** Into a live duel from Дуел, as a player does: the stream is open, waiting for its first view. */
async function into(page: Page): Promise<void> {
  await liveStream(page);
  await page.route("**/api/playing", (r) => r.fulfill({ json: { playing: null } }));
  await page.goto("/duel");
  await page.getByRole("button", { name: "Намери съперник" }).click();
  await meetAs(page);
  await page.waitForFunction(() => (window as unknown as { streams: unknown[] }).streams.length > 0);
}

test("the other gone for good while the player leads: take the win now, or play on, asked once", async ({ page }) => {
  await into(page);
  let claimed = 0;
  await page.route("**/api/duels/live/7/claim", (r) => {
    claimed++;
    return r.fulfill({ json: { ok: true } });
  });
  const offer = page.locator(".live-claim");
  // Here, the other is only thinking: nothing to take.
  await push(page, {
    id: 7,
    phase: "question",
    n: 1,
    total: 10,
    you: side("Ти", 1000),
    them: side("Котка 713", 0),
    question,
  });
  await expect(page.locator(".live-doing")).toHaveText("Мисли…");
  await expect(offer).toHaveCount(0);
  // The leader's points are gold, the other's plain.
  await expect(page.locator(".live-side.me")).toHaveClass(/ahead/);
  await expect(page.locator(".live-side.them")).not.toHaveClass(/ahead/);
  // Gone, and behind: the win is the player's to take.
  const gone = { online: false, gone: true };
  await push(page, {
    id: 7,
    phase: "question",
    n: 1,
    total: 10,
    you: side("Ти", 1000),
    them: side("Котка 713", 0, gone),
    question,
  });
  await expect(offer).toContainText("Котка 713 излезе. Победата е твоя.");
  // Played on: not asked again, on this question or the next.
  await offer.getByRole("button", { name: "Изиграй докрай" }).click();
  await expect(offer).toHaveCount(0);
  await push(page, {
    id: 7,
    phase: "question",
    n: 2,
    total: 10,
    you: side("Ти", 1000),
    them: side("Котка 713", 0, gone),
    question,
  });
  await expect(page.locator(".question-head")).toContainText("3 от 10");
  await expect(offer).toHaveCount(0);
  expect(claimed).toBe(0);
});

test("the win taken: one tap ends the duel", async ({ page }) => {
  await into(page);
  let claimed = 0;
  await page.route("**/api/duels/live/7/claim", (r) => {
    claimed++;
    return r.fulfill({ json: { ok: true } });
  });
  const gone = { online: false, gone: true };
  await push(page, {
    id: 7,
    phase: "question",
    n: 1,
    total: 10,
    you: side("Ти", 1000),
    them: side("Котка 713", 0, gone),
    question,
  });
  await page.locator(".live-claim").getByRole("button", { name: "Вземи победата" }).click();
  await expect.poll(() => claimed).toBe(1);
  // The other back (or the lead gone): it's no longer offered.
  await push(page, {
    id: 7,
    phase: "question",
    n: 1,
    total: 10,
    you: side("Ти", 1000),
    them: side("Котка 713", 0),
    question,
  });
  await expect(page.locator(".live-claim")).toHaveCount(0);
});

test("the result keeps „Реванш“ in sight; the other asking shows over it, with their seconds; gone, another duel", async ({
  page,
}) => {
  await into(page);
  const marks = Array.from({ length: 10 }, (_, i) => ({ points: i % 2 ? 0 : 900, right: i % 2 === 0, ms: 4000 }));
  const them = {
    name: "Котка 713",
    tag: "kotka713",
    points: 900,
    rights: 1,
    ms: 60_000,
    done: true,
    marks: marks.map((m, i) => (i ? { ...m, points: 0, right: false } : m)),
  };
  const duel = {
    id: 7,
    kind: "live",
    state: "won",
    opponent: them,
    you: { name: "Мечка", points: 4500, rights: 5, ms: 50_000, done: true, marks },
    createdAt: Date.now(),
    expiresAt: Date.now(),
    endedAt: Date.now(),
    decided: 1,
    invite: "http://127.0.0.1/f/abcdefgh",
  };
  await page.route("**/api/duels/7", (r) => r.fulfill({ json: { duel } }));
  const end = (more: Record<string, unknown>) => ({
    id: 7,
    phase: "end",
    n: 9,
    total: 10,
    you: side("Мечка", 4500),
    them: side("Котка 713", 900, more),
  });
  await push(page, end({}));
  await expect(page.getByRole("heading", { name: "Победа" })).toBeVisible();
  await page.keyboard.press("Shift"); // the moment, to its end
  const dock = page.locator(".duel-dock");
  await expect(dock.getByRole("button", { name: "Реванш" })).toBeInViewport();
  await expect(dock.getByRole("button", { name: "Реванш" })).toHaveClass(/primary/);
  // A win is shared, plain beside it.
  await expect(page.getByRole("button", { name: "Сподели" })).not.toHaveClass(/primary/);
  // The other asks: who, and the seconds they wait, over a gold yes.
  await push(page, end({ rematch: true, rematchMs: 12_000 }));
  await expect(dock.locator(".rematch-asks")).toContainText("Котка 713 иска реванш");
  // The seconds counting down from what the server says is left (12), not from the whole wait (15).
  const left = Number((await dock.getByRole("timer").getAttribute("aria-label"))?.split(" ")[0]);
  expect(left).toBeGreaterThan(0);
  expect(left).toBeLessThanOrEqual(12);
  await expect(dock.getByRole("button", { name: "Да, реванш" })).toBeInViewport();
  // Their ask run out and their screen gone: no rematch can come about, another duel is the gold way.
  await push(page, end({ online: false }));
  await expect(dock.getByRole("button", { name: "Още един дуел" })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole("button", { name: "Реванш" })).toHaveCount(0);
});

// A question is drawn once its pictures are in, and the server told then: the player's time runs from the moment the
// question is on their screen, so that a slow line or a picture coming in costs no time (play/seen.go). Until then, a
// line says it's coming, and nothing of the question shows (review 2026-11-18, M1).
test("a question shows once its picture is in, and the server is told the moment it does", async ({ page }) => {
  await into(page);
  const seen: unknown[] = [];
  await page.route("**/api/duels/live/7/seen", (r) => {
    seen.push(r.request().postDataJSON());
    return r.fulfill({ json: { ok: true } });
  });
  // The picture comes in only when the test lets it.
  let letIn = () => {};
  const held = new Promise<void>((done) => {
    letIn = done;
  });
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  await page.route("**/test-flag.png*", async (r) => {
    await held;
    await r.fulfill({ body: png, contentType: "image/png" });
  });
  const flag = { src: "/test-flag.png", srcset: "/test-flag.png 1200w", w: 1200, h: 800, alt: "" };
  const duel = (n: number, view: unknown, them = {}) => ({
    id: 7,
    phase: "question",
    n,
    total: 10,
    you: side("Ти", 0),
    them: side("Котка 713", 0, them),
    question: { ...question, view, leftMs: 20_000 },
  });
  await push(page, duel(0, { ...question.view, text: "Чие е това знаме?", image: flag }));
  await expect(page.locator(".coming")).toHaveText("Въпросът идва…");
  await expect(page.locator(".ask")).toHaveCount(0);
  await page.waitForTimeout(300);
  expect(seen).toEqual([]);
  letIn();
  await expect(page.locator(".ask")).toHaveText("Чие е това знаме?");
  await expect(page.locator(".coming")).toHaveCount(0);
  await expect.poll(() => seen).toEqual([{ n: 0 }]);

  // One with no pictures shows at once, and says so once, however often the view comes.
  await push(page, duel(1, question.view));
  await expect(page.locator(".ask")).toHaveText("Кой е първият български цар?");
  await expect.poll(() => seen).toEqual([{ n: 0 }, { n: 1 }]);
  await push(page, duel(1, question.view, { answered: true }));
  await page.waitForTimeout(300);
  expect(seen).toHaveLength(2);
});
