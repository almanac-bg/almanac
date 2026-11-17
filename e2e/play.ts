// Playing, as a player would: answer whatever question is showing.
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, type Page } from "@playwright/test";

/** Answers the question showing: the first option; „Вярно“; a number on the game's pad; an order, dragging the first
 * item to the end and tapping it back (which checks that both ways work); a match, joining each left to the right beside it (a line
 * for each); or a split, swiping the first thing left and sending the rest left too. */
export async function answer(page: Page): Promise<void> {
  const q = page.locator("article.question");
  await expect(q.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
  if (await q.locator(".keypad").count()) {
    for (const k of "1900") await q.locator(".keypad").getByRole("button", { name: k, exact: true }).click();
    await expect(q.locator(".typed")).toHaveText("1900");
    await q.getByRole("button", { name: "Отговори" }).click();
  } else if (await q.locator(".sortable-list").count()) {
    const rows = q.locator(".sortable-list .option");
    const text = (row: ReturnType<typeof rows.first>) => row.locator("span").nth(1);
    const first = (await text(rows.first()).textContent()) ?? "";
    await rows.first().dragTo(rows.last());
    await expect(text(rows.last())).toHaveText(first);
    // And by taps: the last picked up, put down in the first place.
    await rows.last().click();
    await expect(rows.last()).toHaveAttribute("aria-pressed", "true");
    await rows.first().click();
    await expect(text(rows.first())).toHaveText(first);
    await q.getByRole("button", { name: "Готово" }).click();
  } else if (await q.locator(".match").count()) {
    const [left, right] = [q.locator(".match-col").first(), q.locator(".match-col").last()];
    for (let i = 0; i < 4; i++) {
      await left.locator(".match-item").nth(i).click();
      await right.locator(".match-item").nth(i).click();
    }
    await expect(q.locator(".match-lines line")).toHaveCount(4);
    await q.getByRole("button", { name: "Готово" }).click();
  } else if (await q.locator(".split").count()) {
    // Sends the first by a swipe (which checks that dragging works), the rest by their group's button.
    const card = q.locator(".split-card.top");
    const box = await card.boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2, { steps: 6 });
      await page.mouse.up();
    }
    await expect(q.locator(".split-pips b.done")).toHaveCount(1);
    for (let i = 1; i < 6; i++) await q.locator(".split-side").first().click();
  } else if (await q.locator(".tf-options").count()) {
    await q.getByRole("button", { name: "Вярно", exact: true }).click();
  } else {
    await q.locator(".options .option").first().click();
  }
}

/** Starts the day's ten from Начало (or the rest of them: „Продължи“), cutting its count short. */
export async function startDay(page: Page, button = "Започни"): Promise<void> {
  await page.getByRole("button", { name: button, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Започни сега" }).click();
}

/** Plays a run's ten questions, solo: answer, see the answer (and its fact), and move on. Each question opens at the
 * top of the page, wherever the answer before it was scrolled to. */
export async function playRun(page: Page): Promise<void> {
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`, { timeout: 10_000 });
    expect(await page.evaluate(() => scrollY)).toBe(0);
    await answer(page);
    await moveOn(page);
  }
  await expect(page.locator(".summary, .screen h1").first()).toBeVisible({ timeout: 10_000 });
}

/** After an answer: its verdict shows; with a fact to read, a tap moves on (as a quick reader would), else the game
 * moves on by itself. */
export async function moveOn(page: Page): Promise<void> {
  await expect(page.locator(".verdict")).toBeVisible();
  // The answer shows in steps: the way on comes with the fact, a moment after the verdict.
  await expect(page.locator(".after .up-next").or(page.locator(".summary"))).toBeVisible();
  const go = page.locator(".after").getByRole("button", { name: /^(Напред|Към резултата)$/ });
  if (await go.isVisible()) await go.click().catch(() => {}); // gone already: the game moved on
}

/** Makes the player (a guest, made now if there's none) one who finished a game on each of the `days` days before
 * today, straight in the test server's database: a player on their next days, who has met what those open
 * (play/unfold.go). The games are of nothing, and earn nothing. */
export async function playedBefore(page: Page, days: number): Promise<void> {
  await inDB(page, (db, id) => {
    const add = db.prepare(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
      VALUES (?, 'topic', '', '[{"id":""}]', ?, ?)`);
    for (let d = 1; d <= days; d++) {
      const at = Date.now() - d * 24 * 60 * 60 * 1000;
      add.run(id, at, at);
    }
  });
}

/** Makes the player (a guest, made now if there's none) one who has earned an achievement not told yet, straight in the
 * test server's database: the next game's news tells it, with what it unlocks (its XP left out, so that no level comes
 * with it). */
export async function earnedUntold(page: Page, achievement: string): Promise<void> {
  await inDB(page, (db, id) =>
    db
      .prepare("INSERT INTO achievements (user_id, id, at, seen, xp) VALUES (?, ?, ?, 0, 0)")
      .run(id, achievement, Date.now()),
  );
}

/** Makes the player (a guest, made now if there's none) one who finished the day's ten on each of these days, counted
 * back from today in Bulgaria (1: yesterday), straight in the test server's database: games of nothing, for the
 * streak only. */
export async function daysPlayed(page: Page, ...back: number[]): Promise<void> {
  const bulgaria = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" });
  await inDB(page, (db, id) => {
    const add = db.prepare(`INSERT INTO runs (user_id, kind, day, questions, started_at, finished_at)
      VALUES (?, 'day', ?, '[{"id":""}]', ?, ?)`);
    for (const d of back) {
      const at = Date.now() - d * 24 * 60 * 60 * 1000;
      add.run(id, bulgaria.format(at), at, at);
    }
  });
}

/** Makes the player's games count as a person's for the others (a test plays quicker than a person: play/fair.go),
 * so that their friends see their day. */
export async function playedFair(page: Page): Promise<void> {
  await inDB(page, (db, id) => db.prepare("UPDATE runs SET scripted = 0 WHERE user_id = ?").run(id));
}

/** Makes the player one who has answered these questions right (in a game of nothing), straight in the test server's
 * database: their facts are in the Алманах, learned at a moment (`at`, ms; now if not given). */
export async function knows(page: Page, ids: string[], at = Date.now()): Promise<void> {
  await inDB(page, (db, id) => {
    const run = db
      .prepare(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
        VALUES (?, 'topic', '', '[]', 0, 0)`)
      .run(id).lastInsertRowid;
    const add = db.prepare(`INSERT INTO answers (run_id, n, question_id, given, score, points, is_right, ms, at)
      VALUES (?, ?, ?, '{}', 1, 0, 1, 3000, ?)`);
    for (const [n, q] of ids.entries()) add.run(run, n, q, at + n);
  });
}

/** Does something to the player (a guest, made now if there's none) straight in the test server's database. */
async function inDB(page: Page, f: (db: DatabaseSync, id: number) => void): Promise<void> {
  const id = await page.evaluate(async () => {
    const r = await fetch("/api/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return ((await r.json()) as { user: { id: number } }).user.id;
  });
  const db = new DatabaseSync(resolve(import.meta.dirname, "..", process.env.E2E_DB || "test-results/e2e.db"));
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    f(db, id);
  } finally {
    db.close();
  }
}
