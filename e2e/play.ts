// Playing, as a player would: answer whatever question is showing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, type Page } from "@playwright/test";

/** Answers the question showing: the first option; „Вярно“; a number on the game's pad; an order, dragging the first
 * item to the end (by a finger in Chromium) and tapping it back (which checks that both ways work); a match, joining each left to the right beside it (a line
 * for each); or a split, swiping the first thing left and sending the rest left too. */
export async function answer(page: Page): Promise<void> {
  const q = page.locator("article.question");
  await expect(q.locator(".split, .options, .keypad, .tf-options, .match").first()).toBeVisible();
  if (await q.locator(".keypad").count()) {
    for (const k of "1900") await q.locator(".keypad").getByRole("button", { name: k, exact: true }).click();
    await expect(q.locator(".typed")).toHaveText("1900");
    await q.getByRole("button", { name: "Отговори" }).click();
  } else if (await q.locator(".sortable-list").count()) {
    await uncover(page);
    const rows = q.locator(".sortable-list .option");
    const text = (row: ReturnType<typeof rows.first>) => row.locator("span").nth(1);
    const first = (await text(rows.first()).textContent()) ?? "";
    // Dragged by hand, from where the rows are: the page held still (Playwright's own drag scrolls the page under a
    // button held down, in WebKit, and the row taken moves away from under it). On a phone in Chromium by a finger held
    // a moment on the words, as a player does (never only by the grip); elsewhere (a laptop too) by the mouse.
    const touch =
      page.context().browser()?.browserType().name() === "chromium" &&
      (await page.evaluate(() => navigator.maxTouchPoints > 0));
    const [from, to] = [await text(rows.first()).boundingBox(), await rows.last().boundingBox()];
    if (!from || !to) throw new Error("the rows aren't on the screen");
    const [x, y0, y1] = [from.x + from.width / 2, from.y + from.height / 2, to.y + to.height / 2];
    if (touch) await fingerDrag(page, x, y0, y1);
    else {
      await page.mouse.move(x, y0);
      await page.mouse.down();
      await page.mouse.move(to.x + to.width / 2, y1, { steps: 5 });
      await page.mouse.up();
    }
    await expect(text(rows.last())).toHaveText(first);
    // And by taps: the last picked up, put down in the first place.
    await rows.last().click();
    await expect(rows.last()).toHaveAttribute("aria-pressed", "true");
    await rows.first().click();
    await expect(text(rows.first())).toHaveText(first);
    await q.getByRole("button", { name: "Готово" }).click();
  } else if (await q.locator(".match").count()) {
    await uncover(page);
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

/** Rests a finger on a row of a list at (x, y0) till the row is taken up (a long press: as a player waits for it to
 * lift, however busy the phone), drags it straight down or up to y1 in steps, and lifts it: real touch events,
 * Chromium only (Playwright has a tap, not a drag, of a finger). */
async function fingerDrag(page: Page, x: number, y0: number, y1: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  const at = (y: number) => [{ x, y }];
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: at(y0) });
  await expect(page.locator(".sortable-list .option.dragging")).toHaveCount(1);
  for (let i = 1; i <= 6; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: at(y0 + ((y1 - y0) * i) / 6) });
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await cdp.detach();
}

/** Scrolls the page to its foot, as a player does to see all of a long answer: on a short screen „Готово“ stays at
 * the screen's foot over what scrolls under it, and at the page's foot it's below the last of it. Till the page holds
 * still there, as a player's hand goes on only then: the head sticks as the page moves past it (run.ts, stays), and a
 * page a little taller than the screen can come back a little as it does; what's under the hand is measured after. */
async function uncover(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const frame = () => new Promise((on) => requestAnimationFrame(on));
    const root = document.documentElement;
    let last = "";
    for (let still = 0, frames = 0; still < 3 && frames < 60; frames++) {
      if (scrollY < root.scrollHeight - innerHeight - 1) scrollTo(0, root.scrollHeight);
      await frame();
      const now = `${scrollY} ${root.scrollHeight}`;
      still = now === last ? still + 1 : 0;
      last = now;
    }
  });
}

/** Opens a game by its address, as a link from outside the game does (nothing starts by itself: „Започни“ first), and
 * starts it, cutting its count short. */
export async function openGame(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await page.getByRole("button", { name: "Започни", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  await page.getByRole("button", { name: "Започни сега" }).click();
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
  // This answer's own button, and only it: the game moves on by itself a few seconds after it shows, and a tap that
  // comes later (a busy machine) must not wait for the next question's button and press that one, which would skip
  // the next question unanswered.
  const go = page.locator(".after").getByRole("button", { name: /^(Напред|Към резултата)$/ });
  const button = (await go.count()) ? await go.elementHandle({ timeout: 1000 }).catch(() => null) : null;
  await button?.click({ timeout: 5000 }).catch(() => {}); // gone already: the game moved on
  await button?.dispose();
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

/** Makes the day `back` days before today (in Bulgaria) a past issue, straight in the test server's database: its ten
 * are those of the last day drawn ahead; and `others` players who finished it then, the i-th with i right (of ten,
 * in turn), for it to be told against. Returns its day and number. */
export async function pastIssue(page: Page, back: number, others = 0): Promise<{ day: string; issue: number }> {
  const bulgaria = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" });
  const day = bulgaria.format(Date.now() - back * 24 * 60 * 60 * 1000);
  await inDB(page, (db) => {
    db.prepare(
      "INSERT OR IGNORE INTO days (day, questions) SELECT ?, questions FROM days ORDER BY day DESC LIMIT 1",
    ).run(day);
    const user = db.prepare("INSERT INTO users (name, tag, created_at, seen_at) VALUES (?, ?, 0, 0)");
    const run =
      db.prepare(`INSERT INTO runs (user_id, kind, day, questions, rights, points, ms, started_at, finished_at)
      VALUES (?, 'day', ?, '[{"id":""}]', ?, ?, 30000, 0, 1)`);
    for (let i = 0; i < others; i++) {
      const id = user.run(`Играч ${i + 1}`, `past${back}x${i}${Date.now() % 100000}`).lastInsertRowid;
      run.run(id, day, i % 11, (i % 11) * 500);
    }
  });
  // Its number, as the game counts them (play/issue.go).
  const issue = await page.evaluate(async (day) => {
    const r = (await (await fetch("/api/issues")).json()) as { issues: { day: string; issue: number }[] };
    return r.issues.find((i) => i.day === day)?.issue ?? 0;
  }, day);
  return { day, issue };
}

/** Deals the player (a guest, made now if there's none) a game of a topic with these questions, in this order,
 * straight in the test server's database: started now and not finished, it's the game the topic's next start goes on
 * with (play/runs.go, StartTopic). */
export async function dealt(page: Page, category: string, ids: string[]): Promise<void> {
  await inDB(page, (db, id) => {
    const picks = JSON.stringify(ids.map((q, i) => ({ id: q, seed: i + 1 })));
    db.prepare("INSERT INTO runs (user_id, kind, category, questions, started_at) VALUES (?, 'topic', ?, ?, ?)").run(
      id,
      category,
      picks,
      Date.now(),
    );
  });
}

/** Makes the player's games count as a person's for the others (a test plays quicker than a person: play/fair.go),
 * so that their friends see their day. */
export async function playedFair(page: Page): Promise<void> {
  await inDB(page, (db, id) => db.prepare("UPDATE runs SET shadow = 0 WHERE user_id = ?").run(id));
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

/** A player still with the name drawn for them, about to meet others for the first time on this device (a live duel,
 * Роял, a challenge: screens/name.ts), is asked for a name first: given `name`, or kept as drawn („Не сега“). */
export async function meetAs(page: Page, name?: string): Promise<void> {
  const sheet = page.getByRole("dialog", { name: "Как да те виждат останалите?" });
  if (!name) return sheet.getByRole("button", { name: "Не сега" }).click();
  await sheet.getByRole("textbox", { name: "Име" }).fill(name);
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toBeHidden();
}

/** Two players made friends the way an invite link does it: `a`'s link (a player is made for them the first time),
 * opened by `b`, who asks; then `a` says yes in Приятели. A link alone never makes a friend. */
export async function befriendByLink(a: Page, b: Page): Promise<void> {
  await a.goto("/friends");
  const make = a.locator(".friends").getByRole("button", { name: "Покани приятел" });
  if (await make.count()) await make.click();
  const link = await a.locator("[data-invite]").first().getAttribute("data-invite");
  await b.goto(link ?? "");
  await b.getByRole("button", { name: /^Добави .+ в приятели$/ }).click();
  await expect(b.getByText(/^Поканата е изпратена\. Щом .+ я приеме, ставате приятели\.$/)).toBeVisible();
  await a.reload();
  await a.locator(".invitation").getByRole("button", { name: "Приеми" }).click();
  await expect(a.locator(".friend")).not.toHaveCount(0);
}

/** The last sign-in code mailed to `email` (the test server writes its mail to files). */
export function mailedCode(email: string): string {
  try {
    return /\b(\d{6})\b/.exec(readFileSync(`test-results/mail/${email}.txt`, "utf8"))?.[1] ?? "";
  } catch {
    return ""; // not sent yet
  }
}
