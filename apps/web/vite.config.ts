// Relative import: the config is loaded by Node, which can't resolve the shared package's TS sources.
import { BRAND } from '../../packages/shared/src/brand.ts';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.API_URL ?? 'http://localhost:3001';

/** "Add to Home Screen": the game opens full-screen with its own icon, like an app. */
const manifest = JSON.stringify({
  name: `${BRAND.name} — ${BRAND.tagline.toLowerCase()}`,
  short_name: BRAND.name,
  description: 'Куиз битки в реално време: дуели, Роял за 8, дневно предизвикателство и предизвикателства към приятели.',
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
      transformIndexHtml: (html) => html.replaceAll('%BRAND_NAME%', BRAND.name).replaceAll('%BRAND_DOMAIN%', BRAND.domain),
      // The web app manifest comes from the same brand settings: a file in the build, and served by the dev server.
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: manifest });
      },
      configureServer(dev) {
        dev.middlewares.use('/manifest.webmanifest', (_req, res) => {
          res.setHeader('content-type', 'application/manifest+json');
          res.end(manifest);
        });
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
            { name: 'motion', test: /node_modules[\\/](motion|motion-dom|motion-utils|framer-motion)[\\/]/, priority: 2 },
            { name: 'realtime', test: /node_modules[\\/](socket\.io-client|socket\.io-parser|engine\.io-client|engine\.io-parser|@socket\.io)[\\/]/, priority: 1 },
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
