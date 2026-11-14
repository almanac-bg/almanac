import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

// The test server runs a Роял every half minute (playwright.config.ts). The three engines' runs of this test may well
// meet in the same one, as players do.
test("Роял: in from the lobby, live to the first wrong answer (or through all fifteen), then the standings", async ({
  page,
}) => {
  test.setTimeout(360_000);
  await page.goto("/royal");
  // A game under way (another engine's) ends before the next lobby opens.
  await page.getByRole("button", { name: "Влизам" }).click({ timeout: 240_000 });
  await expect(page.getByRole("button", { name: "Излез" })).toBeVisible();
  await expect(page.getByText("Вътре си.")).toBeVisible();

  const standings = page.getByRole("heading", { name: "Класиране" });
  for (let n = 0; n < 15; n++) {
    const asked = page.locator(".question-head").filter({ hasText: `${n + 1} от 15` });
    await expect(asked.or(standings).first()).toBeVisible({ timeout: 60_000 });
    if (await standings.isVisible()) break;
    await answer(page);
    // The answer shows once everyone still in has answered.
    await expect(page.locator(".verdict")).toBeVisible({ timeout: 40_000 });
    if (await page.locator(".verdict").getByText("Отпадаш").isVisible()) {
      // Out: the rest is watched to the end.
      await expect(page.getByText("Гледаш.").or(standings).first()).toBeVisible({ timeout: 60_000 });
      break;
    }
  }
  await expect(standings).toBeVisible({ timeout: 180_000 });
  await expect(page.locator(".royal-table .row.me")).toBeVisible();
  await expect(page.getByText(/Следващият Роял:/)).toBeVisible();
});
