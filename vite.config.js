import { defineConfig, configDefaults } from 'vitest/config'
import react from '@vitejs/plugin-react'
import os from 'node:os'

// Leave one core for the vitest host process. The detection tests are
// CPU-bound and synchronous — a single boundary trace blocks its worker for
// 1-3 s — so with one worker per core the host gets no CPU, and the
// worker->host `onTaskUpdate` RPC times out. That surfaces as
// `Error: [vitest-worker]: Timeout calling "onTaskUpdate"` and a non-zero exit
// *with every test passing*, which is what failed the build on a 4-vCPU
// runner. Capping workers is the fix rather than trimming tests, because the
// suite only grows.
const cores = os.availableParallelism?.() ?? os.cpus().length
const testWorkers = Math.max(1, cores - 1)

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
    maxWorkers: testWorkers,
  },
  build: {
    rollupOptions: {
      output: {
        // Add hash to filenames for cache busting
        entryFileNames: `assets/[name].[hash].js`,
        chunkFileNames: `assets/[name].[hash].js`,
        assetFileNames: `assets/[name].[hash].[ext]`,
        // Keep konva and tesseract out of the entry chunk. Both are reached
        // only through a dynamic import (Canvas.jsx lazy-loads the whole stage
        // subtree), so this is about *which* chunk they land in, not whether
        // they are deferred — the deferral is the dynamic import's doing.
        //
        // The function form matters. The array form (`konva: ['konva',
        // 'react-konva']`) let rollup hoist React itself into the konva chunk,
        // because react-konva depends on it — so the entry statically imported
        // the konva chunk to get `forwardRef`, konva was modulepreloaded in
        // index.html, and none of it was actually deferred. Naming the modules
        // by id assigns only those modules and leaves React where rollup's own
        // reachability analysis puts it: the entry.
        // React is pinned to its own chunk for the same reason: it is the
        // dependency konva and the entry share, and leaving it unassigned lets
        // rollup satisfy both by putting it in the konva chunk.
        manualChunks(id) {
          // Rollup's CommonJS interop helper is a single shared virtual module.
          // Left unassigned it gets folded into whichever manual chunk claims
          // it first — konva — and then *every* other chunk, the entry
          // included, statically imports konva to reach it. That one helper
          // was enough to keep 320 kB of konva on the critical path.
          if (id.includes('commonjsHelpers')) return 'interop';
          if (/node_modules[/\\](konva|react-konva)[/\\]/.test(id)) return 'konva';
          if (/node_modules[/\\]tesseract\.js[/\\]/.test(id)) return 'tesseract';
          if (/node_modules[/\\](react|react-dom|scheduler)[/\\]/.test(id)) return 'react';
          return undefined;
        }
      }
    }
  }
})
