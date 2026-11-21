// The look fits (DESIGN.md, Fit): at a 320 × 568 phone, Safari's 375 × 600 and 390 × 664, and a 1366 × 900 laptop,
// by day and by night, nothing scrolls sideways; Днес shows „Започни“ whole high on the screen; a question has what
// answers it and its action in sight, and once answered the player's row, the right one and „Напред“; and Днес keeps
// its budget, in the HTML's order.
import { expect, type Page, test } from "@playwright/test";
import { dealt, knows } from "./play.ts";

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

      // Each with its fact, as the bank's questions have (one without moves on 3 s after its answer, before a slow
      // engine has looked at it all).
      for (const [kind, id] of [
        ["a choice", "his-002"],
        ["the longest number", "gen-305"],
        ["an order", "his-901"],
        ["true or not", "his-961"],
      ] as const)
        test(`${kind}: what answers it in sight, then the answer and „Напред“`, async ({ page }) => {
          await page.goto("/");
          await dealt(page, id.startsWith("gen") ? "general" : "history", [id]);
          await page.goto(id.startsWith("gen") ? "/play/general" : "/play/history");
          await page.getByRole("button", { name: "Продължи", exact: true }).click();
          await page.getByRole("button", { name: "Започни сега" }).click();
          await expect(page.locator("article.question h1.ask")).toBeVisible();
          await page.waitForTimeout(400);
          expect(await sideways(page)).toBe(false);
          const q = page.locator("article.question");
          // What answers it: every answer, or the pad and its action, whole on the screen.
          const parts = await q
            .locator(".choices > .option, .tf-options > .option, .keypad .key, .answering .btn.primary")
            .evaluateAll((all) => all.map((el) => el.getBoundingClientRect().bottom));
          for (const bottom of parts) expect(bottom).toBeLessThanOrEqual(size.height + 0.5);
          // Answered: the right row (and the player's) and „Напред“ in sight.
          if (await q.locator(".keypad").count()) {
            await q.locator(".key", { hasText: "7" }).click();
            await q.getByRole("button", { name: "Отговори" }).click();
          } else if (await q.locator(".sortable-list").count()) await q.getByRole("button", { name: "Готово" }).click();
          // A choice missed: the player's row and the right one both kept in sight, the right one said in words.
          else if (await q.locator(".choices").count())
            await q.locator(".choices > .option").filter({ hasNotText: "Васил Левски" }).first().click();
          else await q.locator(".options .option, .tf-options .option").first().click();
          const go = page.locator(".after .up-next-go");
          await expect(go).toBeVisible();
          await page.waitForTimeout(500);
          expect(await sideways(page)).toBe(false);
          const on = await bottomOf(page, ".after .up-next-go");
          expect(on.bottom).toBeLessThanOrEqual(size.height + 0.5);
          for (const row of await q.locator("button.option:is(.right, .wrong)").all()) {
            const box = await row.evaluate((el) => {
              const r = el.getBoundingClientRect();
              const panel = document.querySelector(".after")?.getBoundingClientRect();
              const head = document.querySelector(".question-top")?.getBoundingClientRect();
              const docked = getComputedStyle(document.querySelector(".after") as Element).position === "fixed";
              return {
                top: r.top,
                bottom: r.bottom,
                foot: docked ? (panel?.top ?? innerHeight) : innerHeight,
                head: head?.bottom ?? 0,
              };
            });
            expect(box.top, "the row is under the head").toBeGreaterThanOrEqual(box.head - 1);
            expect(box.bottom, "the row is over the panel").toBeLessThanOrEqual(box.foot + 1);
          }
          // The question stays whole under the head: the page doesn't move it away for the answer.
          if (await q.locator(".choices").count()) {
            const sheet = await q.locator(".q-leaf").evaluate((el) => ({
              top: el.getBoundingClientRect().top,
              head: document.querySelector(".question-top")?.getBoundingClientRect().bottom ?? 0,
            }));
            expect(sheet.top, "the question is whole under the head").toBeGreaterThanOrEqual(sheet.head - 1);
            await expect(page.locator(".after .right-said")).toHaveText("Вярно е: Васил Левски.");
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
