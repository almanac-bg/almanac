// Relative import: the config is loaded by Node, which can't resolve the shared package's TS sources.

import { createHash } from 'node:crypto';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { BRAND, LEGAL } from '../../packages/shared/src/brand.ts';
import { PUBLIC_PAGES } from '../../packages/shared/src/routes.ts';

const server = process.env.API_URL ?? 'http://localhost:3001';

const origin = `https://${BRAND.domain}`;

/** For search engines: the public pages (the rest of the game is noindex), and where the sitemap is. */
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.keys(PUBLIC_PAGES)
  .map(
    (path) => `  <url><loc>${origin}${path}</loc>${path === '/' ? '' : `<lastmod>${LEGAL.updatedIso}</lastmod>`}</url>`,
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
    'Куиз битки в реално време: дуели, Роял за 8, дневно предизвикателство и линкове, с които предизвикваш приятели.',
  lang: 'bg',
  id: '/',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#07060d',
  theme_color: '#07060d',
  categories: ['games', 'education', 'entertainment'],
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    // Launchers crop these to their own shape; the bolt sits inside the safe zone.
    { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
});

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'brand',
      transformIndexHtml: (html) =>
        html.replaceAll('%BRAND_NAME%', BRAND.name).replaceAll('%BRAND_DOMAIN%', BRAND.domain),
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
      // The page is in Bulgarian: the Cyrillic cuts of both fonts are needed for the first screen, but the browser
      // only finds them after the CSS has loaded. Fetched early, the text doesn't flash in a fallback font.
      name: 'preload-fonts',
      transformIndexHtml: {
        order: 'post',
        handler(html, ctx) {
          if (!ctx.bundle) return html;
          const fonts = Object.keys(ctx.bundle).filter((f) =>
            /^assets\/(onest|unbounded)-cyrillic-wght-normal-[\w-]+\.woff2$/.test(f),
          );
          const links = fonts.map((f) => `<link rel="preload" href="/${f}" as="font" type="font/woff2" crossorigin />`);
          return html.replace('</head>', `${links.join('\n    ')}\n  </head>`);
        },
      },
    },
  ],
  build: {
    // Public source maps: an error report then points at the real line of code (Sentry fetches them from the site).
    // The browser only downloads them when its developer tools are open.
    sourcemap: true,
    rolldownOptions: {
      output: {
        // Libraries change rarely: in their own files they stay cached across deploys of the app's code.
        codeSplitting: {
          groups: [
            { name: 'react', test: /node_modules[\\/](react|react-dom|react-router|scheduler)[\\/]/, priority: 3 },
            {
              name: 'motion',
              test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/,
              priority: 2,
            },
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
      '/socket.io': { target: server, ws: true },
    },
  },
});
