import { expect, expectLobby, startAsGuest, test } from './support';

// The page's own requests, not the service worker's (page.route doesn't see those).
test.use({ serviceWorkers: 'block' });

// A piece of the frame around the pages (here the season's recap, which draws the server's data) crashing: before,
// the root boundary unmounted the whole app, and the socket with it (the 31 October review, WEB-8).
test('a piece of the frame that crashes goes quiet: the page and the connection stay', async ({
  page,
  pageProblems,
}) => {
  await startAsGuest(page);
  // A season's reward without its list of unlocks (a field gone from the data): the recap can't draw it.
  await page.route('**/api/me', async (route) => {
    const response = await route.fetch();
    const body = (await response.json()) as { user: Record<string, unknown> | null };
    if (body.user) body.user.seasonRewards = [{ season: '2026-10', tier: 'bronze', xp: 10, unlocks: null }];
    await route.fulfill({ response, json: body });
  });
  await page.reload();
  await expectLobby(page);
  await expect(page.getByRole('navigation').first()).toBeVisible();
  // The crash happened (and was reported); it's the only thing wrong in the browser.
  await expect.poll(() => pageProblems.length).toBeGreaterThan(0);
  // (Firefox logs React's report of it as a bare "Error" or "JSHandle@object" from React's file.)
  const others = pageProblems.filter(
    (p) =>
      !/length|null|SeasonRecap|frame/i.test(p) &&
      !/^console: (Error|JSHandle@object) \(.*\/assets\/react-[^/]+\.js\)$/.test(p),
  );
  expect(others).toEqual([]);
  pageProblems.length = 0;
});
