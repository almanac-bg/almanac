import { expect, startAsGuest, test } from './support';

/**
 * Every page in the sitemap (PUBLIC_PAGES) comes drawn by the server and the app takes it over as it is: no hydration
 * error (React's #418 throws the drawn page away), no full-screen spinner between the two, and the title it was drawn
 * with stays (it's written for search). Signed out, as a search engine or a shared link opens it, and as a player.
 */
for (const who of ['signed out', 'a player'] as const)
  test(`every public page, ${who}: taken over as drawn, without a spinner, keeping its title`, async ({
    page,
    request,
  }) => {
    // Anything that spins while the page loads (the app's start-up spinner) leaves a mark.
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('.animate-spin')) document.documentElement.dataset.spun = '1';
      }).observe(document, { childList: true, subtree: true });
    });
    if (who === 'a player') await startAsGuest(page);
    const sitemap = await (await request.get('/sitemap.xml')).text();
    const paths = [...sitemap.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(paths.length, 'the sitemap lists the public pages').toBeGreaterThan(10);
    for (const path of paths) {
      // The landing is a different page for a player (the lobby); every other one reads the same for everyone.
      if (path === '/' && who === 'a player') continue;
      const drawn = await (await request.get(path)).text();
      const title = /<title>([^<]*)<\/title>/.exec(drawn)?.[1].replaceAll('&amp;', '&');
      await page.goto(path);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main h1').first(), path).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.dataset.spun), `${path}: a spinner`).toBeUndefined();
      await expect(page, path).toHaveTitle(title!);
    }
  });
