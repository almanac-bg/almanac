// What a screen asks the server: each thing once a visit. A part that loads its data as it's made, made again by a
// render that runs again, asks again each time (the chapters' tiles asking for the player's stats); a page that
// loads itself anew asks for all of it again. Counted here over the ways a player goes round Днес and the chapters, a
// deploy among them: a visit that asks for anything twice fails, and so does a deploy that loads the page more than once.
import { expect, type Page, type Request, test } from "@playwright/test";
import { playRun, startDay } from "./play.ts";

/** What the page asks the server (GETs of the API) while `go` opens a screen, until it's quiet: none in flight, and
 * none for a moment. */
async function visit(page: Page, go: () => Promise<unknown>): Promise<string[]> {
  const asked: string[] = [];
  let pending = 0;
  let last = Date.now();
  const sent = (r: Request) => {
    pending++;
    last = Date.now();
    const u = new URL(r.url());
    if (r.method() === "GET" && u.pathname.startsWith("/api/")) asked.push(u.pathname);
  };
  const done = () => {
    pending = Math.max(0, pending - 1);
    last = Date.now();
  };
  page.on("request", sent);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  try {
    await go();
    await expect.poll(() => pending === 0 && Date.now() - last > 700, { timeout: 15_000 }).toBe(true);
  } finally {
    page.off("request", sent);
    page.off("requestfinished", done);
    page.off("requestfailed", done);
  }
  return asked;
}

/** The paths asked more than once. */
const twice = (asked: string[]) => [...new Set(asked.filter((p, i) => asked.indexOf(p) !== i))];

/** Opens a screen and checks that it asked for nothing twice; returns what it asked. */
async function once(page: Page, what: string, go: () => Promise<unknown>): Promise<string[]> {
  const asked = await visit(page, go);
  expect(twice(asked), `${what} asked twice: ${asked.join(", ")}`).toEqual([]);
  return asked;
}

const tab = (page: Page, href: string) =>
  page.locator(`nav.places-foot a[href='${href}'], .bar a.bar-me[href='${href}']`).first().click();

test("each screen asks the server for each thing once a visit, and a deploy loads the page once", async ({ page }) => {
  test.slow();
  await page.goto("/");
  // A player with the day played: Днес asks for all it shows.
  await startDay(page);
  await playRun(page);
  await expect(page.locator(".summary")).toBeVisible();

  const home = (asked: string[]) => {
    expect(asked.filter((p) => /^\/api\/runs\/\d+\/review$/.test(p)).length).toBeLessThanOrEqual(1);
  };
  home(await once(page, "Днес, loaded", () => page.reload()));
  await once(page, "Приятели", () => tab(page, "/friends"));
  await once(page, "Алманах", () => tab(page, "/almanac"));
  await once(page, "Профил", () => tab(page, "/me"));
  home(await once(page, "Днес, from Профил", () => tab(page, "/")));
  // Днес tapped on Днес opens it afresh: once more, not more than that.
  home(await once(page, "Днес, tapped again", () => tab(page, "/")));
  // A chapter, its game's count backed out of: back on the chapter.
  await once(page, "a chapter", () => page.goto("/almanac/history"));
  await once(page, "a chapter", async () => {
    await page.getByRole("link", { name: "Играй 10 въпроса" }).click();
    await expect(page.getByRole("heading", { name: "Приготви се" })).toBeVisible();
  });
  await once(page, "a chapter, the count backed out of", async () => {
    await page.getByRole("button", { name: "Отказ", exact: true }).click();
    await expect(page).toHaveURL(/\/almanac\/history$/);
  });
  await once(page, "a chapter, loaded", () => page.goto("/play/music"));
  await once(page, "the Алманах", () => page.goto("/almanac"));
  home(await once(page, "Днес, from the Алманах", () => tab(page, "/")));

  // A deploy: the next screen comes with the page loaded anew, once.
  await page.route("**/api/**", async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, headers: { ...res.headers(), "x-almanac-version": "next" } });
  });
  await once(page, "Приятели, the server's version another", () => tab(page, "/friends"));
  let loads = 0;
  page.on("load", () => loads++);
  home(await once(page, "Днес, after a deploy", () => tab(page, "/")));
  await page.waitForTimeout(1500); // a page that went on loading itself would have by now
  expect(loads).toBe(1);
});
