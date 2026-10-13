import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Verification servers must not rewrite the live editor's dependency cache.
  cacheDir: process.env.COMIA_VITE_CACHE_DIR ?? 'node_modules/.vite',
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: false,
    // Verification copies contain their own index.html/tsconfig; observing them
    // would reload the live editor when a clean-install build writes evidence.
    watch: { ignored: ['**/output/**', '**/docs/implementation/audit/**'] },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 4096,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    setupFiles: ['tests/setup.ts'],
    css: false,
  } as never,
});
