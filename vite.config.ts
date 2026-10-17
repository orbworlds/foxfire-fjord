import { defineConfig } from 'vite';

export default defineConfig({
  // only the page itself is an entry (tools/package.mjs writes a packaged copy to out/)
  optimizeDeps: { entries: ['index.html'] },
  server: {
    host: '127.0.0.1',
    hmr: { overlay: false },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2000,
  },
});
