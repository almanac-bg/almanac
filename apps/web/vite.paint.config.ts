import { defineConfig } from 'vite';

/**
 * The server's renderer of the pages it sends already drawn (src/paint.tsx → dist-ssr/paint.mjs). One file with its
 * libraries inside: the server's image has no node_modules (nor a package.json saying the file is a module: .mjs).
 */
export default defineConfig({
  publicDir: false,
  ssr: { noExternal: true },
  // React's production build only (the server runs in production; development has the plain page).
  define: { 'process.env.NODE_ENV': '"production"' },
  build: {
    ssr: 'src/paint.tsx',
    outDir: 'dist-ssr',
    sourcemap: true,
    rolldownOptions: {
      output: { codeSplitting: false, entryFileNames: 'paint.mjs' },
      // Libraries' "use client" lines are for frameworks with server components: nothing to warn about here.
      onLog(level, log, handler) {
        if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
      },
    },
  },
});
