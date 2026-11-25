// An order's rows dragged on a phone's width, where a long thing to order takes two or three lines and its row is
// taller than the rest: the rows it passes make room as tall as it is, never one of a one-line row's, and none runs
// over another (questions.ts, order).

import { bankQuestions } from "./bank.ts";
import { dealt } from "./play.ts";
import { expect, type Page, test } from "./test.ts";

test.use({ viewport: { width: 360, height: 800 }, isMobile: false, hasTouch: false });

/** Opens an order question with one row made three lines tall: the one at `tall`. */
async function anOrder(page: Page, tall: number): Promise<void> {
  const q = bankQuestions().find((q) => q.type === "order" && !q.retired && !q.image);
  if (!q) throw new Error("the tests' bank has no order");
  await page.goto("/");
  await dealt(page, "history", [q.id]);
  await page.goto("/play/history");
  await page.getByRole("button", { name: "Продължи", exact: true }).click();
  await page.getByRole("button", { name: "Веднага" }).click();
  const rows = page.locator(".sortable-list > .option");
  await expect(rows.first()).toBeVisible();
  await rows.nth(tall).evaluate((row) => {
    const words = row.children[1] as HTMLElement;
    words.textContent = `${words.textContent} ${words.textContent} и още много думи, колкото на три реда`;
  });
  const [short, long] = [await rows.nth(tall === 0 ? 1 : 0).boundingBox(), await rows.nth(tall).boundingBox()];
  expect(long?.height ?? 0, "the tall row").toBeGreaterThan((short?.height ?? 0) * 1.5);
}

/** What's wrong with the rows as one is dragged: the others run over each other or out of the list, or the room left
 * for the one dragged is less than its height. */
const overlaps = (page: Page): Promise<string[]> =>
  page.locator(".sortable-list").evaluate((list) => {
    const out: string[] = [];
    const box = list.getBoundingClientRect();
    const dragged = list.querySelector(".dragging")?.getBoundingClientRect();
    if (!dragged) return ["no row is being dragged"];
    const rest = [...list.querySelectorAll(":scope > .option:not(.dragging)")]
      .map((r) => r.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);
    let room = 0;
    let at = box.top;
    for (const r of rest) {
      if (r.top < at - 0.5)
        out.push(`a row at ${Math.round(r.top)} runs over the one above, down to ${Math.round(at)}`);
      room = Math.max(room, r.top - at);
      at = r.bottom;
    }
    if (at > box.bottom + 0.5)
      out.push(`the rows run out of the list, to ${Math.round(at)} past ${Math.round(box.bottom)}`);
    room = Math.max(room, box.bottom - at);
    if (room < dragged.height - 1) out.push(`room of ${Math.round(room)} for a row ${Math.round(dragged.height)} tall`);
    return out;
  });

/** Drags the row at place `from` by the mouse to over the row at place `to`, checks the rows mid-drag, and lets go. */
async function drag(page: Page, from: number, to: number): Promise<void> {
  const rows = page.locator(".sortable-list > .option");
  const words = (await rows.nth(from).locator(":scope > span").nth(1).textContent()) ?? "";
  const [a, b] = [await rows.nth(from).boundingBox(), await rows.nth(to).boundingBox()];
  if (!a || !b) throw new Error("the rows aren't on the screen");
  // From the row's middle to where its edge would be past the far row's middle: its top for one above, its bottom
  // for one below.
  const y = to < from ? b.y + b.height / 2 - 4 + a.height / 2 : b.y + b.height / 2 + 4 - a.height / 2;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2, y, { steps: 8 });
  await expect.poll(() => overlaps(page)).toEqual([]);
  await page.mouse.up();
  await expect(rows.nth(to).locator(":scope > span").nth(1)).toHaveText(words);
}

test("a one-line row dragged under a tall one: the rows it passes don't run over the tall one", async ({ page }) => {
  await anOrder(page, 0);
  const n = await page.locator(".sortable-list > .option").count();
  await drag(page, 1, n - 1);
});

test("a tall row dragged to the top: the rows it passes make room as tall as it is", async ({ page }) => {
  await anOrder(page, 2);
  await drag(page, 2, 0);
});

test("a tall row dragged to the foot: it goes all the way, and the rows it passes make room for it", async ({
  page,
}) => {
  await anOrder(page, 1);
  const n = await page.locator(".sortable-list > .option").count();
  await drag(page, 1, n - 1);
});
