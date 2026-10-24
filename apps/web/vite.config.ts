// Relative import: the config is loaded by Node, which can't resolve the shared package's TS sources.
import { BRAND } from '../../packages/shared/src/brand.ts';
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
  build: {
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
