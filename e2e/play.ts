// Playing, as a player would: answer whatever question is showing.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type Browser, expect, type Locator, type Page } from "@playwright/test";
import { bankQuestions, type Q } from "./bank.ts";

/** A text as a player reads it: without the soft hyphens that let its long words break at their syllables (a name, a
 * fact: web/src/ui.ts, nameWords, textWords), its spaces (no-break ones too) as one. For `expect.poll`. */
export const readText = (l: Locator): Promise<string> =>
  l.evaluate((e) => (e.textContent ?? "").replaceAll("\u00ad", "").replace(/\s+/g, " ").trim());

/** Answers the question showing: the first option; a true-or-not rightly (the one answer a test plays knowing it:
 * every day's ten has one, so a day played is never none right, whatever ten a fresh database drew and in whatever
 * order their options were dealt, and its result is the same kind of result on every run); a number on the game's
 * pad; an order, dragging the first
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
    const asked = plain(await q.locator(".ask").textContent());
    const tf = trueOrNot().find((b) => plain(b.text) === asked);
    if (!tf) throw new Error(`a true-or-not the tests' bank hasn't: ${asked}`);
    await q.getByRole("button", { name: tf.answer === true ? "Вярно" : "Невярно", exact: true }).click();
  } else {
    await q.locator(".options .option").first().click();
  }
}

/** The tests' bank's true-or-not questions (read once). */
let tfs: Q[] | undefined;
const trueOrNot = () => {
  tfs ??= bankQuestions().filter((q) => q.type === "truefalse");
  return tfs;
};

/** A question's words as the bank has them, without what the screen adds to break them (soft hyphens). */
const plain = (s: string | null) => (s ?? "").replaceAll("­", "").replace(/\s+/g, " ").trim();

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
 * today, straight in the test server's database: a player on their next days, not a new one. The games are of
 * nothing, and bring nothing. */
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
 * so that their friends see their day, and their book has what they got right (play/ink.go: a script's game writes
 * nothing). */
export async function playedFair(page: Page): Promise<void> {
  await inDB(page, (db, id) => {
    db.prepare("UPDATE runs SET shadow = 0 WHERE user_id = ?").run(id);
    db.prepare("DELETE FROM facts WHERE user_id = ?").run(id);
    db.prepare(factsRule).run(id);
  });
}

/** The book's rule as the server writes it (play.factsRule, the same text: TestE2EFactsRule holds them equal). */
const factsRule = `WITH met AS (
		SELECT a.question_id, min(a.at) AS at FROM answers a JOIN runs r ON r.id = a.run_id
		WHERE r.user_id = ?1 GROUP BY a.question_id),
	meets AS (
		SELECT a.question_id, a.at, a.run_id, a.is_right AND r.kind = 'day' AND NOT r.pencil AND a.at = m.at AS ink
		FROM answers a JOIN runs r ON r.id = a.run_id JOIN met m ON m.question_id = a.question_id
		WHERE r.user_id = ?1 AND r.shadow <> 1 AND NOT coalesce(json_extract(r.questions, '$[' || a.n || '].void'), 0)),
	ranked AS (
		SELECT *, row_number() OVER (PARTITION BY question_id ORDER BY ink DESC, at, run_id) AS k FROM meets)
	INSERT INTO facts (user_id, question_id, ink, at, run_id)
	SELECT ?1, question_id, ink, at, run_id FROM ranked WHERE k = 1`;

/** Makes the player one who has answered these questions right (in a game of nothing), straight in the test server's
 * database: their facts are in the Алманах (play/ink.go), in grey, or in `ink`, written at a moment (`at`, ms; now
 * if not given). */
export async function knows(page: Page, ids: string[], at = Date.now(), ink = false): Promise<void> {
  await inDB(page, (db, id) => {
    const run = db
      .prepare(`INSERT INTO runs (user_id, kind, category, questions, started_at, finished_at)
        VALUES (?, 'topic', '', '[]', 0, 0)`)
      .run(id).lastInsertRowid;
    const add = db.prepare(`INSERT INTO answers (run_id, n, question_id, given, score, is_right, ms, at)
      VALUES (?, ?, ?, '{}', 1, 1, 3000, ?)`);
    const write = db.prepare(
      `INSERT OR IGNORE INTO facts (user_id, question_id, ink, at, run_id) VALUES (?, ?, ?, ?, ?)`,
    );
    for (const [n, q] of ids.entries()) {
      add.run(run, n, q, at + n);
      write.run(id, q, ink ? 1 : 0, at + n, run);
    }
  });
}

/** The book's ten chapters (the bank's topics). */
export const chapters = [
  "general",
  "science",
  "history",
  "geography",
  "movies",
  "music",
  "sports",
  "technology",
  "literature",
  "nature",
];

/** Makes the player (a guest, made now if there's none) one with a seal of `level` in every chapter (2 Страница, 3
 * Тетрадка …), its rank told, straight in the test server's database: Профил's seals, a long name („Изкуство и
 * литература“) among them. */
export async function ranked(page: Page, level = 3): Promise<void> {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Sofia" }).format(new Date());
  await inDB(page, (db, id) => {
    const add = db.prepare(`INSERT OR REPLACE INTO ranks (user_id, chapter, level, quarter, ink, day, told)
      VALUES (?, ?, ?, 1, ?, ?, ?)`);
    for (const c of chapters) add.run(id, c, level, [0, 1, 5, 15, 40][level] ?? 15, day, level);
  });
}

/** Makes the player (a guest, made now if there's none) an admin, straight in the test server's database. */
export async function admin(page: Page): Promise<void> {
  await inDB(page, (db, id) => {
    db.prepare("UPDATE users SET admin = 1 WHERE id = ?").run(id);
  });
}

/** Plays a run of ten through the API, each question given up (none right), as the player of `page`. */
export async function givenUp(page: Page, run: number): Promise<void> {
  for (let n = 0; n < 10; n++) {
    await page.request.post(`/api/runs/${run}/show`, { data: {} });
    await page.request.post(`/api/runs/${run}/start`, { data: { n } });
    expect((await page.request.post(`/api/runs/${run}/answer`, { data: { n, answer: null } })).ok()).toBe(true);
  }
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

/** A player still with the name drawn for them, about to meet others for the first time on this device (a duel sent to
 * a friend: screens/name.ts), is asked for a name first: given `name`, or kept as drawn („Не сега“). */
export async function meetAs(page: Page, name?: string): Promise<void> {
  const sheet = page.getByRole("dialog", { name: "Как да те виждат останалите?" });
  if (!name) return sheet.getByRole("button", { name: "Не сега" }).click();
  await sheet.getByRole("textbox", { name: "Име" }).fill(name);
  await sheet.getByRole("button", { name: "Готово" }).click();
  await expect(sheet).toBeHidden();
}

/** Two players made friends the one way there is: `b` asks `a` by `a`'s username (each made a player first, if not
 * yet, and `b` one who has finished a game, as a guest asks only then), and `a` says yes in Приятели. */
export async function befriend(a: Page, b: Page): Promise<void> {
  for (const p of [a, b]) {
    await p.goto("/friends");
    const make = p.locator(".friends").getByRole("button", { name: "Добави приятел" });
    if (await make.count()) await make.click();
    await expect(p.getByLabel("Потребителско име или имейл на приятел")).toBeVisible();
  }
  await playedBefore(b, 1);
  const tag = await a.evaluate(async () => (await (await fetch("/api/me")).json()).user.tag as string);
  await b.getByLabel("Потребителско име или имейл на приятел").fill(`@${tag}`);
  await b.getByRole("button", { name: "Добави", exact: true }).click();
  await expect(b.getByText(/^Поканата до .+ е изпратена\.$/)).toBeVisible();
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

/** A player kept a while, as their places show them: a seal in every chapter, a friend of a long name with seals too,
 * a duel with the friend played to its end, the keys to /admin. Returns the friend's username and the duel. */
export async function keptPlayer(page: Page, browser: Browser): Promise<{ tag: string; duel: number }> {
  const other = await (await browser.newContext()).newPage();
  await page.goto("/");
  await ranked(page);
  await admin(page);
  await befriend(page, other);
  await ranked(other);
  const name = (p: Page, to: string) =>
    p.evaluate(
      (to) =>
        fetch("/api/me", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: to }),
        }),
      to,
    );
  await name(page, "Константинова-Христозова");
  await name(other, "Maximilian von Bulgarien");
  const friend = await other.evaluate(
    async () => (await (await fetch("/api/me")).json()).user as { id: number; tag: string },
  );
  const made = await (await page.request.post("/api/duels", { data: { friend: friend.id } })).json();
  const duel = made.duel as { id: number; runId?: number };
  const mine =
    duel.runId ?? (await (await page.request.post(`/api/duels/${duel.id}/play`, { data: {} })).json()).duel.runId;
  await givenUp(page, mine);
  const theirs = (await (await other.request.post(`/api/duels/${duel.id}/play`, { data: {} })).json()).duel.runId;
  await givenUp(other, theirs);
  await other.context().close();
  return { tag: friend.tag, duel: duel.id };
}

/** A player's name as a link, one rule everywhere (web/src/app.css, .name-words): never underlined at rest, as no
 * row of players is. A link's underline never reaches a word held whole (an inline block), so an underlined name was
 * underlined only in part („Таралеж 840“ with „840“ alone underlined). Each such link, named. */
export async function linkedNames(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("a")]
      .filter((a) => a.querySelector(".name-words") && getComputedStyle(a).textDecorationLine !== "none")
      .map((a) => `a name underlined: „${(a.textContent ?? "").replaceAll("­", "").trim()}“`),
  );
}

/** What of a page is cut or runs into its neighbour: a name clipped where its row has room, a word past its card, the
 * @username where no two friends share a name, two seals over each other. */
export async function cutOrOverlapping(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    // An element by its tag and class attribute (an SVG's className is an object, not its words), and its words.
    const say = (el: Element) =>
      `${el.tagName.toLowerCase()}.${el.getAttribute("class") ?? ""}: „${(el.textContent ?? "").trim().slice(0, 40)}“`;
    // A name in a wide row whole: never clipped or ended with „…“. A name set inline (its words wrapping in its row)
    // has no box of its own to be cut in: its row's box is the one measured (and an inline box's own widths are
    // nothing to go by: Chromium has none, Firefox its words' run against a clientWidth of 0).
    for (const el of document.querySelectorAll(
      ".friend-name, .duel-name, .duel-row .who-label, .me-who h1, .rk-words b",
    )) {
      let box: Element = el;
      while (box.parentElement && getComputedStyle(box).display === "inline") box = box.parentElement;
      const style = getComputedStyle(box);
      if (box.scrollWidth > box.clientWidth + 1 || (style.textOverflow === "ellipsis" && style.overflowX !== "visible"))
        out.push(`cut ${say(el)}`);
    }
    // A friend's @username only where two share a name.
    for (const el of document.querySelectorAll(".friend-tag:not(.same)"))
      if ((el as HTMLElement).offsetParent !== null) out.push(`a tag shown ${say(el)}`);
    // Inside its card: a seal's name, a friend's day, a chapter's words.
    for (const card of document.querySelectorAll(".rk, .friend, .duel-row, .ch-stand, .entry, .way, .card-leaf")) {
      const box = card.getBoundingClientRect();
      for (const el of card.querySelectorAll("*")) {
        const r = el.getBoundingClientRect();
        if (r.width && (r.right > box.right + 1 || r.left < box.left - 1)) {
          out.push(`past its card ${card.getAttribute("class")}: ${say(el)}`);
          break;
        }
      }
    }
    // The seals side by side, never over each other.
    const seals = [...document.querySelectorAll(".seal-list > li")].map((li) => li.getBoundingClientRect());
    for (const [i, a] of seals.entries())
      for (const b of seals.slice(i + 1))
        if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1)
          out.push("two seals over each other");
    // A ladder of ranks: its names apart („СтраницаТетрадка“ once), each inside the ladder, and the reached seal's
    // ring (5.5px outside it) inside its own column, clear of the next seal.
    for (const ladder of document.querySelectorAll(".ladder")) {
      const box = ladder.getBoundingClientRect();
      const named = [...ladder.querySelectorAll(".ladder-name")]
        .filter((n) => getComputedStyle(n).visibility !== "hidden")
        .map((n) => ({ n, r: n.getBoundingClientRect() }));
      for (const [i, a] of named.entries()) {
        if (a.r.left < box.left - 1 || a.r.right > box.right + 1) out.push(`a rank's name past its ladder ${say(a.n)}`);
        for (const b of named.slice(i + 1))
          if (a.r.left < b.r.right + 2 && b.r.left < a.r.right + 2 && a.r.top < b.r.bottom && b.r.top < a.r.bottom)
            out.push(`two ranks' names run together: „${a.n.textContent}${b.n.textContent}“`);
      }
      const now = ladder.querySelector(".now");
      const ring = now?.querySelector(".seal")?.getBoundingClientRect();
      const column = now?.getBoundingClientRect();
      if (ring && column && (ring.left - 5.5 < column.left - 0.5 || ring.right + 5.5 > column.right + 0.5))
        out.push("the reached seal's ring past its column");
    }
    return out;
  });
}
