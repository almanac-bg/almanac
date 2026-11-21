// The look fits (DESIGN.md, Fit): at a 320 × 568 phone, Safari's 375 × 600 and 390 × 664, and a 1366 × 900 laptop,
// by day and by night, nothing scrolls sideways; Днес shows „Започни“ whole high on the screen; every kind of question
// (the longest the sample bank has) has what answers it and its action whole in sight, nothing under the action, and
// once answered (right, wrong, close) the player's row, the right one and „Напред“, nothing showing under „Напред“;
// a row's sign never on a line of its own, nor a punctuation mark; and Днес keeps its budget, in the HTML's order.
//
// FIT_SHOTS=<folder> keeps a picture of each question before and after its answer, to look at.
import { expect, type Page, test } from "@playwright/test";
import { answerAs, closeable, flaws, kinds, panelFlaws, unseenAnswers } from "./kinds.ts";
import { cutOrOverlapping, dealt, keptPlayer, knows } from "./play.ts";

const sizes = [
  { width: 320, height: 568, go: 500 },
  { width: 375, height: 600, go: 540 },
  { width: 390, height: 664, go: 664 },
  { width: 1366, height: 900, go: 900 },
];

/** Whether the page is wider than the screen. */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 0.5);

/** The bottom of an element as it's drawn, and the screen's height. */
async function bottomOf(page: Page, selector: string): Promise<{ bottom: number; top: number; screen: number }> {
  return page
    .locator(selector)
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { bottom: r.bottom, top: r.top, screen: innerHeight };
    });
}

for (const scheme of ["light", "dark"] as const)
  for (const size of sizes)
    test.describe(`${size.width}×${size.height}, ${scheme}`, () => {
      test.use({ viewport: { width: size.width, height: size.height }, colorScheme: scheme });

      test("Днес: its budget in order, „Започни“ whole and high", async ({ page }) => {
        await page.goto("/");
        await expect(page.locator(".issue")).toBeVisible();
        expect(await sideways(page)).toBe(false);
        // The budget (DESIGN.md, Днес): the issue, then its action, then (for a player) the streak; nothing else.
        const parts = await page
          .locator("section.today > *")
          .evaluateAll((all) =>
            all
              .filter((el) => (el as HTMLElement).offsetParent !== null || el.childElementCount)
              .map((el) => el.className),
          );
        expect(parts.filter((c) => !c.includes("notices"))).toEqual(["issue day page-1", "today-side page-2"]);
        const go = await bottomOf(page, ".issue-go");
        expect(go.top).toBeGreaterThanOrEqual(0);
        expect(go.bottom, "„Започни“ is whole, high enough on the screen").toBeLessThanOrEqual(size.go);
      });

      // Every kind, at its longest, each with its fact as the bank's questions have; close only where an answer can
      // be (a number, an order, pairs, groups).
      for (const how of ["right", "wrong", "close"] as const)
        test(`every kind of question, answered ${how}: what answers it, then the answer and „Напред“`, async ({
          page,
        }) => {
          test.setTimeout(120_000);
          const all = kinds().filter((k) => how !== "close" || closeable(k.q));
          await page.goto("/");
          await dealt(
            page,
            "history",
            all.map((k) => k.q.id),
          );
          await page.goto("/play/history");
          await page.getByRole("button", { name: "Продължи", exact: true }).click();
          await page.getByRole("button", { name: "Започни сега" }).click();
          const shot = async (name: string) => {
            const dir = process.env.FIT_SHOTS;
            if (dir) await page.screenshot({ path: `${dir}/${name}-${size.width}x${size.height}-${scheme}.png` });
          };
          for (const [n, { name, q }] of all.entries()) {
            const where = `${name} (${q.id})`;
            await expect(page.locator(".question-head")).toContainText(`${n + 1} от ${all.length}`, {
              timeout: 10_000,
            });
            await expect(page.locator("article.question .answering")).toBeVisible();
            await page.waitForTimeout(400); // its picture in, and sized
            if (how === "right") await shot(`${name}-before`);
            expect.soft(await flaws(page), `${where}, asked`).toEqual([]);
            expect.soft(await unseenAnswers(page), `${where}, asked`).toEqual([]);

            await answerAs(page, q, how);
            await expect(page.locator(".after .up-next-go")).toBeVisible({ timeout: 10_000 });
            await page.waitForTimeout(500); // in its place
            await shot(`${name}-after-${how}`);
            expect.soft(await flaws(page), `${where}, answered ${how}`).toEqual([]);
            expect.soft(await panelFlaws(page), `${where}, answered ${how}`).toEqual([]);
            // The player's row and the right one under the head, over the panel.
            const rows = await page.locator("article.question button.option:is(.right, .wrong)").evaluateAll((all) =>
              all.map((el) => {
                const r = el.getBoundingClientRect();
                const after = document.querySelector(".after") as Element;
                const docked = getComputedStyle(after).position === "fixed";
                return {
                  top: r.top,
                  bottom: r.bottom,
                  foot: docked ? after.getBoundingClientRect().top : innerHeight,
                  head: document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0,
                };
              }),
            );
            for (const row of rows) {
              expect.soft(row.top, `${where}: the row is under the head`).toBeGreaterThanOrEqual(row.head - 1);
              expect.soft(row.bottom, `${where}: the row is over the panel`).toBeLessThanOrEqual(row.foot + 1);
            }
            if (q.type === "choice" || q.type === "clues") {
              // The question stays whole under the head: the page doesn't move it away for the answer, unless the
              // panel at its least would cover the rows, and then only as far as they need (DESIGN.md, Play).
              const sheet = await page.locator("article.question .q-leaf").evaluate((el) => {
                const after = document.querySelector(".after") as Element;
                const docked = getComputedStyle(after).position === "fixed";
                const rows = [...document.querySelectorAll("article.question button.option:is(.right, .wrong)")];
                return {
                  top: el.getBoundingClientRect().top,
                  head: document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0,
                  rows: Math.max(...rows.map((r) => r.getBoundingClientRect().bottom)),
                  foot: docked ? after.getBoundingClientRect().top : innerHeight,
                };
              });
              if (sheet.top < sheet.head - 1)
                expect
                  .soft(sheet.rows, `${where}: the question went under the head, further than the rows needed`)
                  .toBeGreaterThan(sheet.foot - 24);
              // A miss says the right answer in words, right under how many got it.
              if (how === "wrong") await expect(page.locator(".after .right-said")).toHaveText(`Вярно е: ${q.answer}.`);
            }
            await page
              .locator(".after .up-next-go")
              .dispatchEvent("click")
              .catch(() => {}); // moved on by itself
          }
        });

      test("the places: nothing sideways, with a long name and facts in the book", async ({ page }) => {
        await page.goto("/");
        await knows(page, ["his-002", "mov-001"], Date.now(), true);
        const named = await page.evaluate(async () => {
          const r = await fetch("/api/me", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Константинова-Христозова" }),
          });
          return r.ok;
        });
        expect(named).toBe(true);
        for (const path of ["/almanac", "/almanac/history", "/friends", "/me"]) {
          await page.goto(path);
          await expect(page.locator("h1").first()).toBeVisible();
          expect(await sideways(page), path).toBe(false);
        }
      });
    });

test("a player's places at every size, by day and by night: nothing sideways, no name cut, nothing over another", async ({
  page,
  browser,
}) => {
  test.setTimeout(300_000);
  const kept = await keptPlayer(page, browser);
  const places = [
    "/me",
    `/players/${kept.tag}`,
    "/friends",
    "/almanac",
    "/almanac/literature",
    `/duel/${kept.duel}`,
    "/admin",
    "/settings",
  ];
  for (const size of sizes)
    for (const scheme of ["light", "dark"] as const) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.emulateMedia({ colorScheme: scheme });
      for (const path of places) {
        const where = `${path} at ${size.width}×${size.height}, ${scheme}`;
        await page.goto(path);
        await expect(page.locator("h1").first(), where).toBeVisible();
        await page.waitForTimeout(300);
        expect(await sideways(page), where).toBe(false);
        expect(await cutOrOverlapping(page), where).toEqual([]);
      }
      // A duel's result: its ways on of one width.
      await page.goto(`/duel/${kept.duel}`);
      await expect(page.locator(".duel-side .actions .btn").first()).toBeVisible();
      const widths = await page
        .locator(".duel-side .actions .btn")
        .evaluateAll((all) => all.map((b) => Math.round(b.getBoundingClientRect().width)));
      expect(new Set(widths).size, `the duel's ways on, ${size.width}`).toBe(1);
    }
});
