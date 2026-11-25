// Yesterday's issue, left half-way before midnight, offered first on Днес while the game lets it be finished
// (play.DayGrace): said to be yesterday's, with until when; then the way on to today's, and Днес today's once its time
// is over; and Днес drawn before midnight, begun after it. The server's clock can't be set back here, so its day says it
// has yesterday's: today's own run, standing in.

import { playRun } from "./play.ts";
import { expect, type Page, test } from "./test.ts";

/** Днес as the server would draw it just after midnight, with a day's run (today's, begun, standing in for
 * yesterday's) still to be finished until `until` (ms): asked for again, as Днес does after its first draw. */
async function yesterdayWaits(
  page: Page,
  until: number,
  change: (t: Record<string, unknown>) => void = () => {},
): Promise<void> {
  await page.goto("/");
  await page.evaluate(async () => {
    await fetch("/api/guest", { method: "POST", body: "{}" });
    await fetch("/api/day", { method: "POST", body: "{}" });
  });
  await page.goto("/almanac");
  await page.route(/\/api\/day$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const t = await res.json();
    const day = new Date(`${t.day}T12:00:00Z`);
    day.setUTCDate(day.getUTCDate() - 1);
    t.yesterday = { day: day.toISOString().slice(0, 10), issue: t.issue - 1, chapters: t.chapters, run: t.run, until };
    t.run = null;
    change(t);
    await route.fulfill({ response: res, json: t });
  });
  await page.locator("nav.places-foot").getByRole("link", { name: "Днес" }).click();
}

test("yesterday's issue at 00:05, with no day left to forgive: the cover promises nothing of today's issue", async ({
  page,
}) => {
  // Five past midnight in Bulgaria (the stake line's hour), whatever the machine's clock: the page's timers run on.
  await page.clock.setFixedTime(new Date("2027-01-15T00:05:00+02:00"));
  await yesterdayWaits(page, Date.now() + 10 * 60_000, (t) => {
    t.streak = 12;
    t.spare = false;
  });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Десет въпроса от вчера");
  await expect(page.locator(".today-streak .status-n")).toHaveText("12");
  // Only yesterday's, finished in its time, keeps the streak: its own line says until when, and nothing says that
  // today's makes it 13.
  await expect(page.locator(".issue-meta")).toHaveText(/^Вчерашният брой\. Довърши го до \d\d:\d\d\.$/);
  await expect(page.locator(".day-stake")).toHaveCount(0);
});

test("Днес drawn before midnight and begun after it: the new day's issue, drawn again and said, never the old one's name", async ({
  page,
}) => {
  await page.goto("/");
  await page.evaluate(() => fetch("/api/guest", { method: "POST", body: "{}" }));
  await page.goto("/almanac");
  // Днес as it was drawn a minute before midnight: the day before the server's, its issue the one before.
  let before = true;
  let issue = 0;
  await page.route(/\/api\/day$/, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    const res = await route.fetch();
    const t = await res.json();
    issue = t.issue;
    if (before) {
      const day = new Date(`${t.day}T12:00:00Z`);
      day.setUTCDate(day.getUTCDate() - 1);
      Object.assign(t, { day: day.toISOString().slice(0, 10), issue: t.issue - 1, run: null });
    }
    await route.fulfill({ response: res, json: t });
  });
  const drawn = page.waitForResponse((r) => r.url().endsWith("/api/day") && r.request().method() === "GET");
  await page.locator("nav.places-foot").getByRole("link", { name: "Днес" }).click();
  await drawn;
  await expect(page.locator(".issue-n")).toHaveText(`Брой ${issue - 1}`);
  // Midnight passes: „Започни“ deals the server's day, today's.
  before = false;
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await page.getByRole("button", { name: "Веднага" }).click();
  await expect(page.locator(".notice")).toHaveText(`Брой\u00a0${issue - 1} вече мина. Ето днешния.`);
  await expect(page.locator(".issue-n")).toHaveText(`Брой ${issue}`);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Десет въпроса за днес");
  // Begun from it, the run is the issue on the screen.
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await page.getByRole("button", { name: "Веднага" }).click();
  await expect(page.locator(".question-head")).toContainText(`Брой ${issue}`);
});

test("yesterday's issue is said to be yesterday's, with until when, begun or not; its time over, Днес is today's", async ({
  page,
}) => {
  await yesterdayWaits(page, Date.now() + 3000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Десет въпроса от вчера");
  await expect(page.locator(".issue-meta")).toHaveText(/^Вчерашният брой\. Довърши го до \d\d:\d\d\.$/);
  await page.unrouteAll();
  // Its time over: Днес asks for the day again, by itself.
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Десет въпроса за днес", { timeout: 10_000 });
});

test("yesterday's issue finished: the way on to today's asks for the day again", async ({ page }) => {
  test.setTimeout(120_000);
  await yesterdayWaits(page, Date.now() + 10 * 60_000);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Десет въпроса от вчера");
  await page.getByRole("button", { name: /^(Започни|Продължи)$/ }).click();
  const now = page.getByRole("button", { name: "Веднага" });
  if (await now.isVisible().catch(() => false)) await now.click();
  await playRun(page);
  const on = page.locator(".tomorrow");
  await expect(on).toContainText("вече излезе.");
  await page.unrouteAll();
  await on.getByRole("button", { name: "Към днешния брой" }).click();
  // Today's, as the server has it now: the run played is today's here, so its result, and no way on any more.
  await expect(page.locator(".summary .score-n")).toBeVisible();
  await expect(page.locator(".tomorrow")).toHaveCount(0);
});
