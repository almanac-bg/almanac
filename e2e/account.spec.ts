import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

test("a guest keeps their game with a code by email, and can sign out", async ({ page }, info) => {
  const email = `player-${info.project.name}-${Date.now()}@example.com`;
  await page.goto("/play/music");
  await page.getByRole("button", { name: "Започни сега" }).click();
  await expect(page.locator(".question-head")).toContainText("1 от 10"); // playing made a guest
  await page.goto("/settings");
  await page.getByLabel("Имейл").fill(email);
  await page.getByRole("button", { name: "Прати ми код" }).click();
  await expect(page.getByText(`Пратихме код на ${email}`)).toBeVisible();
  const code = /\b(\d{6})\b/.exec(readFileSync(`test-results/mail/${email}.txt`, "utf8"))?.[1] ?? "";
  await page.getByLabel("Код").fill(code);
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByText(`Влизаш с ${email}`)).toBeVisible();
  await page.getByRole("button", { name: "Излез" }).click();
  await expect(page.getByRole("button", { name: "Прати ми код" })).toBeVisible();
});
