// Playing, as a player would: answer whatever question is showing.
import { expect, type Page } from "@playwright/test";

/** Answers the question showing: the first option, a number, or the items in the order shown. */
export async function answer(page: Page): Promise<void> {
  const q = page.locator("article.question");
  await expect(q.locator(".options, .number").first()).toBeVisible();
  if (await q.locator(".number:not([hidden])").count()) {
    await q.locator(".number-input input").fill("1900");
    await q.getByRole("button", { name: "Отговори" }).click();
  } else if (await q.locator("[aria-pressed]").count()) {
    for (const item of await q.locator(".options .option").all()) await item.click();
    await q.getByRole("button", { name: "Готово" }).click();
  } else {
    await q.locator(".options .option").first().click();
  }
}

/** Plays a run's ten questions, solo: answer, read the answer, go on. */
export async function playRun(page: Page): Promise<void> {
  for (let n = 0; n < 10; n++) {
    await expect(page.locator(".question-head")).toContainText(`${n + 1} от 10`);
    await answer(page);
    await page.locator(".after .btn.next").click();
  }
  await expect(page.locator(".summary")).toBeVisible();
}
