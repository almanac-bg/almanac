import fs from 'node:fs';
import path from 'node:path';
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

/**
 * A drawn page names the code it needs to come alive beyond the app's first file and its imports, and fetches it as it
 * starts (public/early.js, apps/server/src/index.ts → pageCode): the app's imports find it in the browser's cache
 * instead of asking for each file only once the one before has run (the 31 October review, WEB-6). Everything named
 * runs, nothing it runs comes unnamed, and nothing is a preload link, which WebKit keeps failed for the tab (WEB-2).
 * Never twice: WebKit, whose imports wouldn't take the fetched files, fetches nothing early.
 */
test('every public page fetches the code it runs as it starts, and runs the code it fetched', async ({
  page,
  request,
  browserName,
}) => {
  const listed = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, '../dist/.vite/page-code.json'), 'utf8'),
  ) as { entry: string[] };
  const entry = listed.entry.map((f) => `/${f}`);
  const sitemap = await (await request.get('/sitemap.xml')).text();
  const paths = [...sitemap.matchAll(/<loc>https?:\/\/[^/<]+(\/[^<]*)<\/loc>/g)].map((m) => m[1]);
  for (const path of paths) {
    const drawn = await (await request.get(path)).text();
    expect(drawn, path).not.toMatch(/rel="(module)?preload" as="script"|rel="modulepreload"/);
    const named = /<script async src="\/early\.js" data-code="([^"]+)"><\/script>/.exec(drawn)?.[1].split(' ') ?? [];
    expect(named.length, `${path}: its code named`).toBeGreaterThan(0);
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expect(page.locator('main h1').first(), path).toBeVisible();
    const scripts = await page.evaluate(() =>
      performance
        .getEntriesByType('resource')
        .map((r) => ({ path: new URL(r.name).pathname, by: (r as PerformanceResourceTiming).initiatorType }))
        .filter((r) => r.path.startsWith('/assets/') && r.path.endsWith('.js')),
    );
    const fetched = scripts.filter((s) => s.by === 'fetch').map((s) => s.path);
    const ran = scripts.filter((s) => s.by !== 'fetch').map((s) => s.path);
    // (Not in WebKit, which would download it twice: public/early.js.)
    expect(new Set(fetched), `${path}: fetched as it started`).toEqual(new Set(browserName === 'webkit' ? [] : named));
    expect(new Set(ran), `${path}: the code it ran`).toEqual(new Set([...entry, ...named]));
  }
});

// The installed app's icons and every notification's are PNGs drawn from favicon.svg (scripts/icons.mjs): drawn side
// by side here, they must match it. A broken export (cut off, a second copy below it) is far off on average; the
// engines' own smoothing is not.
test('the app icons are the mark as favicon.svg draws it, whole', async ({ page }) => {
  await page.goto('/privacy');
  for (const [file, size] of [
    ['/icon-192.png', 192],
    ['/icon-512.png', 512],
  ] as const) {
    const meanDiff = await page.evaluate(
      async ({ file, size }) => {
        const pixels = async (src: string) => {
          const img = new Image(size, size);
          img.src = src;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = canvas.height = size;
          const context = canvas.getContext('2d')!;
          context.drawImage(img, 0, 0, size, size);
          return context.getImageData(0, 0, size, size).data;
        };
        const [png, svg] = await Promise.all([pixels(file), pixels('/favicon.svg')]);
        let sum = 0;
        for (let i = 0; i < png.length; i++) sum += Math.abs(png[i] - svg[i]);
        return sum / png.length;
      },
      { file, size },
    );
    expect(meanDiff, `${file}: mean difference from favicon.svg, per channel (0–255)`).toBeLessThan(3);
  }
});
