import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

test("Роял: in a tournament, out at the first wrong answer (or through all fifteen)", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/royal");
  await page.getByRole("button", { name: "Влез в турнир" }).click();
  const result = page.getByRole("heading", { name: /Отпадна на въпрос \d+|Стигна до края!/ });
  for (let n = 0; n < 15 && !(await result.isVisible()); n++) {
    // A question, or the result; not the Роял page's own heading while the tournament is being joined.
    await expect(page.locator("article.question").or(result).first()).toBeVisible({ timeout: 10_000 });
    if (await result.isVisible()) break;
    await expect(page.locator(".question-head")).toContainText("от 15");
    await answer(page);
    await expect(page.locator(".verdict")).toBeVisible();
    await expect(page.locator(".verdict, .intro").first()).toBeVisible();
    await page.waitForTimeout(100);
    await expect(result.or(page.locator(".question-head").filter({ hasText: `${n + 2} от 15` }))).toBeVisible({
      timeout: 10_000,
    });
  }
  await expect(result).toBeVisible();
  await expect(page.locator(".royal-table .row.me")).toBeVisible();
});
