// Playing, as a player would: answer whatever question is showing.
import { expect, type Page } from "@playwright/test";

/** Answers the question showing: the first option; „Вярно“; a number on the game's pad; an order, dragging the first
 * item to the end (which checks that dragging works); a match, joining each left to the right beside it (a line
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
  const go = page.locator(".after").getByRole("button", { name: /^(Напред|Към резултата)$/ });
  if (await go.isVisible()) await go.click().catch(() => {}); // gone already: the game moved on
}
