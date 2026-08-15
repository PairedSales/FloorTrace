import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/FloorTrace/',
  // Honor an externally assigned port (e.g. parallel dev sessions); Vite
  // ignores the PORT env var by default.
  server: globalThis.process?.env?.PORT
    ? { port: Number(globalThis.process.env.PORT) }
    : undefined,
  test: {
    // Nested git worktrees carry their own copies of the suite; collecting them
    // makes a stale worktree fail master's tests. eslint ignores .claude too.
    exclude: [...configDefaults.exclude, '**/.claude/**'],
    // These tests run the real CV pipeline over fixture PNGs, so they are
    // seconds each, not milliseconds. The slowest is ~3.2s locally against
    // vitest's 5000ms default — enough headroom to pass here and to time out
    // on a slower CI runner, which is exactly what happened on master
    // (run 31852340215: floorplan-image.test.js timed out and blocked a
    // deploy). Raised rather than set per-test so a new fixture test does not
    // have to rediscover this.
    testTimeout: 20000,
  },
  build: {
    rollupOptions: {
      output: {
        // Add hash to filenames for cache busting
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
        // Split heavy dependencies into separate chunks for faster initial load
        manualChunks: {
          'tesseract': ['tesseract.js'],
          'konva': ['konva', 'react-konva'],
        }
      }
    }
  }
})
