// Relative import: the config is loaded by Node, which can't resolve the shared package's TS sources.
import { BRAND } from '../../packages/shared/src/brand';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const server = process.env.API_URL ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    { name: 'brand', transformIndexHtml: (html) => html.replaceAll('%BRAND_NAME%', BRAND.name) },
  ],
  server: {
    port: 5173,
    proxy: {
      '/api': server,
      '/socket.io': { target: server, ws: true },
    },
  },
});
