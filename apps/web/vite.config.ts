// Relative import: the config is loaded by Node, which can't resolve the shared package's TS sources.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { BRAND, LEGAL } from '../../packages/shared/src/brand.ts';
import { PUBLIC_PAGES } from '../../packages/shared/src/routes.ts';

const server = process.env.API_URL ?? 'http://localhost:3001';

const origin = `https://${BRAND.domain}`;

/**
 * For search engines: the public pages (the rest of the game is noindex), and where the sitemap is. A date only where
 * it's known, the legal pages': one date on every page said that a change of the terms changed them all (and a search
 * engine stops trusting dates that are always the same).
 */
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.keys(PUBLIC_PAGES)
  .map(
    (path) =>
      `  <url><loc>${origin}${path}</loc>${path === '/privacy' || path === '/terms' ? `<lastmod>${LEGAL.updatedIso}</lastmod>` : ''}</url>`,
  )
  .join('\n')}
</urlset>
`;
// /api/legal stays crawlable: the legal pages show who runs the site from it.
const robots = `User-agent: *
Allow: /
Disallow: /api/
Disallow: /socket.io/
Allow: /api/legal

Sitemap: ${origin}/sitemap.xml
`;

/** "Add to Home Screen": the game opens full-screen with its own icon, like an app. */
const manifest = JSON.stringify({
  name: `${BRAND.name} — ${BRAND.tagline.toLowerCase()}`,
  short_name: BRAND.name,
  description:
    'Онлайн викторина на български: 10 въпроса на деня за цяла България, предизвикателства по линк, дуели и Роял за 8.',
  lang: 'bg',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#07060d',
  theme_color: '#07060d',
  categories: ['games', 'education', 'entertainment'],
  // A long press on the installed app's icon.
  shortcuts: [
    { name: 'Въпросите на деня', url: '/daily', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Класации', url: '/leaderboard', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
    { name: 'Приятели', url: '/friends', icons: [{ src: '/icon-192.png', sizes: '192x192' }] },
  ],
  // Shown in the install dialog (Android, desktop Chrome) instead of a bare prompt.
  screenshots: [
    {
      src: '/screenshots/daily-phone.webp',
      sizes: '1080x1920',
      type: 'image/webp',
      form_factor: 'narrow',
      label: '10 въпроса на деня, едни и същи за цяла България',
    },
    {
      src: '/screenshots/question-phone.webp',
      sizes: '1080x1920',
      type: 'image/webp',
      form_factor: 'narrow',
      label: 'Научи нещо ново след всеки отговор',
    },
    {
      src: '/screenshots/lobby-phone.webp',
      sizes: '1080x1920',
      type: 'image/webp',
      form_factor: 'narrow',
      label: 'Соло, дуели, Роял и стаи с приятели',
    },
    {
      src: '/screenshots/landing-wide.webp',
      sizes: '1920x1080',
      type: 'image/webp',
      form_factor: 'wide',
      label: 'АЛМАНАХ',
    },
  ],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // Launchers crop these to their own shape; the bolt sits inside the safe zone.
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

// The preview picture's address changes with the picture: Facebook, Messenger and Viber keep one by its address, and a
// redrawn og.jpg under the old one would go on showing the old picture.
const ogVersion = createHash('sha256')
  .update(fs.readFileSync(path.join(import.meta.dirname, 'public', 'og.jpg')))
  .digest('base64url')
  .slice(0, 8);

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'brand',
      transformIndexHtml: (html) =>
        html
          .replaceAll('%BRAND_NAME%', BRAND.name)
          .replaceAll('%BRAND_DOMAIN%', BRAND.domain)
          .replaceAll('%OG_VERSION%', ogVersion)
          .replaceAll('%HOME_TITLE%', PUBLIC_PAGES['/'].title)
          .replaceAll('%HOME_DESCRIPTION%', PUBLIC_PAGES['/'].description),
      // The web app manifest comes from the same brand settings: a file in the build, and served by the dev server.
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });
        this.emitFile({ type: 'asset', fileName: 'sitemap.xml', source: sitemap });
        this.emitFile({ type: 'asset', fileName: 'robots.txt', source: robots });
      },
      configureServer(dev) {
        dev.middlewares.use('/manifest.webmanifest', (_req, res) => {
          res.setHeader('content-type', 'application/manifest+json');
          res.end(manifest);
        });
      },
    },
    {
      // The page names its build: the server reads it and tells open tabs, so one still running an older build
      // reloads after a deploy instead of talking to a newer server (see main.tsx). Built from the output file names,
      // which carry content hashes: a deploy that didn't change the app reloads nobody.
      name: 'build-id',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.bundle) return html;
          const files = Object.keys(ctx.bundle)
            .filter((f) => f.startsWith('assets/'))
            .sort();
          const id = createHash('sha256').update(files.join('\n')).digest('base64url').slice(0, 12);
          return html.replace('</head>', `<meta name="app-build" content="${id}" />\n  </head>`);
        },
      },
    },
    {
      // The service worker keeps the offline page under a name that changes with it: a fixed name meant an edited page
      // never reached installed apps (the worker only replaces its cache when its own file changes).
      name: 'offline-cache-name',
      apply: 'build',
      closeBundle() {
        const dist = path.join(import.meta.dirname, 'dist');
        const worker = path.join(dist, 'sw.js');
        if (!fs.existsSync(worker)) return;
        const hash = createHash('sha256')
          .update(fs.readFileSync(path.join(dist, 'offline.html')))
          .digest('base64url')
          .slice(0, 10);
        fs.writeFileSync(worker, fs.readFileSync(worker, 'utf8').replace("'offline-v1'", `'offline-${hash}'`));
      },
    },
    {
      // Brotli copies of the build's text files at the strongest setting, made once here instead of compressed on the
      // fly per request: the server sends them to browsers that take brotli (smaller than gzip by about a fifth).
      name: 'brotli',
      apply: 'build',
      closeBundle() {
        const dir = path.join(import.meta.dirname, 'dist', 'assets');
        if (!fs.existsSync(dir)) return;
        for (const name of fs.readdirSync(dir)) {
          if (!/\.(js|css|svg|json)$/.test(name)) continue;
          const file = path.join(dir, name);
          const data = fs.readFileSync(file);
          if (data.length < 1024) continue;
          fs.writeFileSync(
            `${file}.br`,
            zlib.brotliCompressSync(data, {
              params: {
                [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
                [zlib.constants.BROTLI_PARAM_SIZE_HINT]: data.length,
              },
            }),
          );
        }
      },
    },
    {
      // Both fonts are needed for the first screen, but the browser only finds them after the CSS has loaded. Fetched
      // early, the text doesn't flash in a fallback font.
      name: 'preload-fonts',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.bundle) return html;
          const fonts = Object.keys(ctx.bundle).filter((f) => /^assets\/(onest|unbounded)-[\w-]+\.woff2$/.test(f));
          const links = fonts.map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`);
          return html.replace('</head>', `${links.join('\n    ')}\n  </head>`);
        },
      },
    },
  ],
  build: {
    // No <link rel="modulepreload"> for the code, in the page or added before a lazy page's import: in WebKit a script
    // link whose fetch fails once stays failed for the tab, through every retry and reload (the server is never asked
    // again), so one lost second on an iPhone left the game without its match or its connection. A plain import that
    // fails is fetched anew the next time (the 31 October review, WEB-2; e2e/updates.spec.ts). The cost: a lazy page's
    // own imports are found when its file arrives, not with it; the lobby's background prefetch hides that.
    modulePreload: false,
    // The art (src/emoji) stays in files of its own, however small: inlined, 34 of them made 160 KB of base64 in the
    // first script (base64 hardly compresses), where each file is fetched only when shown and then cached for good.
    assetsInlineLimit: (file) => (file.includes('/emoji/') ? false : undefined),
    // Public source maps: an error report then points at the real line of code (Sentry fetches them from the site).
    // The browser only downloads them when its developer tools are open.
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Libraries change rarely: in their own files they stay cached across deploys of the app's code.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 3 },
            // Not motion: in one group, its lazily loaded features (lib/motionFeatures) came back into the first download.
            {
              name: 'realtime',
              test: /node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)[\\/]/,
              priority: 1,
            },
            // Icons are tiny; one file beats a dozen 300-byte requests.
            { name: 'icons', test: /node_modules[\\/]lucide-react[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/qimg': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
