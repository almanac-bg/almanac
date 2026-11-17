import { expect, test } from "@playwright/test";
import { answer } from "./play.ts";

test("a host leads a room from a big screen and doesn't play", async ({ browser }) => {
  test.setTimeout(120_000);
  const host = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const guest = await (await browser.newContext()).newPage();
  await host.goto("/room");
  await host.getByRole("radio", { name: "5", exact: true }).click();
  await host.getByRole("radio", { name: "Само водя (за голям екран)" }).click();
  await host.getByRole("button", { name: "Всички теми" }).click();
  await expect(host).toHaveURL(/\/r\/\d{6}$/);
  const code = host.url().slice(-6);
  // Leading, not playing: no name to ask for.

  // The lobby: the code, the link as a QR code drawn by the server, and nobody yet (the host isn't a player).
  await expect(host.getByText(`/r/${code} или насочете камерата към кода.`)).toBeVisible();
  const qr = host.getByRole("img", { name: /QR код/ });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth > 0)).toBe(true);
  await expect(host.getByText("Още никой не е влязъл.")).toBeVisible();

  await guest.goto(`/r/${code}`);
  await guest.getByLabel("Име").fill("Бояна");
  await guest.getByRole("button", { name: "Влез" }).click();
  // The players wait for „водещия“, not for the host's drawn name.
  await expect(guest.getByText("Чакаме водещия да започне.")).toBeVisible();
  await expect(host.locator(".players li")).toHaveCount(1);
  await host.getByRole("button", { name: "Започни" }).click();

  // The question large, how many have answered; held, the answer waits for „Напред“.
  await expect(guest.locator(".question-head")).toContainText("1 от 5");
  await expect(host.locator(".question-head")).toContainText("1 от 5");
  await expect(host.getByText("Отговориха 0 от 1")).toBeVisible();
  await host.getByRole("button", { name: "Задръж" }).click();
  await expect(host.getByRole("button", { name: "Задръж" })).toHaveAttribute("aria-pressed", "true");
  await answer(guest);
  await expect(guest.getByText("Водещият ще продължи.")).toBeVisible();
  await expect(host.getByText("Следващият въпрос — с „Напред“.")).toBeVisible();
  await expect(host.locator(".board .row")).toHaveCount(1);
  await host.getByRole("button", { name: "Напред" }).click();
  await expect(guest.locator(".question-head")).toContainText("2 от 5");

  // „Напред“ on a question shows its answer at once; „Край“, asked twice, ends the game where it is.
  await host.getByRole("button", { name: "Напред" }).click();
  await expect(guest.locator(".verdict")).toBeVisible();
  await host.getByRole("button", { name: "Край" }).click();
  await host.getByRole("button", { name: "Да, край" }).click();
  await expect(host.getByRole("heading", { name: "Бояна печели" })).toBeVisible();
  await expect(host.locator(".podium li.p1")).toContainText("Бояна");
  await expect(guest.getByRole("heading", { name: "Бояна печели" })).toBeVisible();
  await guest.getByRole("button", { name: "Прегледай въпросите" }).click();
  await expect(guest.locator(".reviewed")).toHaveCount(2);
});
