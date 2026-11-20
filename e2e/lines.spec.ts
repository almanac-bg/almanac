import { expect, test } from "@playwright/test";
import { meetAs } from "./play.ts";

// A live game's line, given up on by the browser: a stream whose answer isn't one (a proxy's error page while the
// server is away, a portal's sign-in page) is never opened again by the browser itself. The screen opens it again, a
// moment later, and goes on, instead of saying the line is down for good.

test("a live duel's line answered by an error page is opened again, and the search goes on", async ({ page }) => {
  let refused = 0;
  let asked = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/duels/live/events") asked++;
  });
  await page.route(
    "**/api/duels/live/events",
    (route) => {
      refused++;
      return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>502 Bad Gateway</h1>" });
    },
    { times: 1 },
  );
  await page.goto("/duel");
  await page.getByRole("button", { name: "Намери съперник" }).click();
  await meetAs(page);
  await expect.poll(() => asked, { timeout: 15_000 }).toBeGreaterThan(1);
  await expect(page.getByText("Връзката прекъсна")).toBeHidden();
  expect(refused).toBe(1);
});
