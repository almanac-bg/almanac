import { expect, test } from "@playwright/test";
import { knows } from "./play.ts";

test("Моят Алманах in progress: Профил counts the facts, a topic says how many of its own", async ({ page }) => {
  // Every fact of the sample's „Кино и телевизия“, and one of „История“.
  await page.goto("/");
  await knows(page, ["mov-300", "mov-302", "mov-960", "mov-961", "mov-962", "mov-963", "mov-964", "his-002"]);

  await page.goto("/me");
  const line = page.getByRole("link", { name: /^8 факта в Алманаха/ });
  await expect(line).toBeVisible();
  await line.click();
  await expect(page).toHaveURL(/\/almanac$/);
  const head = page.locator(".almanac-head");
  await expect(head).toContainText("8научени факта");
  await page.getByRole("button", { name: /Кино и телевизия/ }).click();
  await expect(head).toContainText("7от 7 факта в „Кино и телевизия“");

  // „Цяла тема“: every fact of a topic, there for the taking (it's given with the next game's news).
  await page.goto("/rewards");
  await page.getByText(/^Всички постижения \(\d+\)$/).click();
  const whole = page.locator(".achievement", { hasText: "Цяла тема" }).last();
  await expect(whole).toContainText("Събери всички факти от една тема в Алманаха.");
  await expect(page.locator(".achievement", { hasText: "Сто факта" }).last()).toContainText("8 / 100");
});
