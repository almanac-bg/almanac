import { expect, test } from "@playwright/test";
import { answer, playRun } from "./play.ts";

// The test server runs a Роял every half minute (playwright.config.ts). The three engines' runs of this test may well
// meet in the same one, as players do. A wrong answer puts nobody out: the game always runs its fifteen questions,
// cut after some of them to those ahead, and those cut watch to the end.
test("Роял: in from the lobby, live to the fifteenth question (or a cut), then the standings", async ({ page }) => {
  test.setTimeout(480_000);
  await page.goto("/royal");
  // A game under way (another engine's) ends before the next lobby opens.
  await page.getByRole("button", { name: "Влез" }).click({ timeout: 300_000 });
  await expect(page.getByRole("button", { name: "Излез" })).toBeVisible();
  await expect(page.getByText("Вътре си.")).toBeVisible();

  const standings = page.getByRole("heading", { name: "Класиране" });
  const watching = page.getByText("Гледаш до края.");
  for (let n = 0; n < 15; n++) {
    const asked = page.locator(".question-head").filter({ hasText: `${n + 1} от 15` });
    await expect(asked.or(watching).first()).toBeVisible({ timeout: 60_000 });
    if (await watching.isVisible()) break;
    if (n === 0) {
      await expect(page.locator(".royal-left")).toHaveText(/^В играта: \d+ от \d+$|^В турнира си само ти: /);
    }
    await answer(page);
    // The answer shows once everyone still in has answered, with the standings.
    await expect(page.locator(".verdict")).toBeVisible({ timeout: 40_000 });
    await expect(page.locator(".royal-table .row.me")).toBeVisible();
  }
  // The end: the standings of all, after the fifteenth question.
  await expect(page.locator(".intro").getByText(/верни\./)).toBeVisible({ timeout: 360_000 });
  await expect(standings).toBeVisible();
  await expect(page.locator(".royal-table .row.me")).toBeVisible();
  await expect(page.getByText(/Следващият Роял:/)).toBeVisible();
});

test("Роял: „Ще дойда“ before the lobby, and Начало's card while it's open", async ({ page }) => {
  test.setTimeout(360_000);
  // Начало shows the ways to play with others once a first game is finished.
  await page.goto("/play/history");
  await playRun(page);
  await page.goto("/royal");
  // „Ще дойда“ shows until the next lobby opens: before it, and under the standings of an evening over (which show a
  // while, here into the next evenings).
  await expect(async () => {
    await page.reload();
    const come = page.getByRole("button", { name: "Ще дойда" });
    const said = page.getByText(/^Ще дойдеш\./);
    await expect(come.or(said)).toBeVisible({ timeout: 30_000 });
    if (await come.isVisible()) await come.click();
    await expect(said).toBeVisible({ timeout: 2_000 });
    await expect(page.getByText(/^Тази вечер ще дойд(е|ат) \d+\.$/)).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 240_000 });

  // While the lobby is open, Начало's Роял card says how soon it starts and how many are in.
  await page.goto("/");
  const royal = page.locator(".mode.tone-gold .mode-about");
  await expect(async () => {
    await page.reload();
    await expect(royal).toHaveText(/^Започва след \d+\sмин( · \d+\sвътре)?$/, { timeout: 3_000 });
  }).toPass({ timeout: 60_000 });
});
