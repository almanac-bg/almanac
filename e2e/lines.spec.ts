import { expect, test } from "@playwright/test";

// A live game's line, given up on by the browser: a stream whose answer isn't one (a proxy's error page while the
// server is away, a portal's sign-in page) is never opened again by the browser itself. The screen opens it again, a
// moment later, and goes on, instead of saying the line is down (or the room gone) for good.

test("Роял's line answered by an error page is opened again, and the evening shows", async ({ page }) => {
  let refused = 0;
  await page.route(
    "**/api/royal/events",
    (route) => {
      refused++;
      return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
    },
    { times: 1 },
  );
  await page.goto("/royal");
  // Whatever the evening is doing (a Роял every half minute here), it shows: its heading, or a question's.
  await expect(page.locator("main h1").first()).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Връзката прекъсна")).toBeHidden();
  expect(refused).toBe(1);
});

test("a room's line answered by an error page is opened again: the room is there, not gone", async ({ page }) => {
  await page.goto("/room");
  await page.getByRole("button", { name: "Отвори стаята" }).click();
  await expect(page).toHaveURL(/\/r\/\d{6}$/);
  await expect(page.getByRole("heading", { name: "С какво име влизаш?" })).toBeVisible();
  let refused = 0;
  await page.route(
    "**/api/rooms/*/events",
    (route) => {
      refused++;
      return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
    },
    { times: 1 },
  );
  await page.getByRole("button", { name: "Влез" }).click();
  await expect(page.getByRole("heading", { name: /^Стая/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Няма такава стая")).toBeHidden();
  await expect(page.getByText("Връзката прекъсна")).toBeHidden();
  expect(refused).toBe(1);
});
