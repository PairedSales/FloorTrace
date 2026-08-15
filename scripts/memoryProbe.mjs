/**
 * Retention probe for the detection memo (sibling of detectionBenchmark.mjs).
 *
 * Usage:  node --expose-gc scripts/memoryProbe.mjs [image.png|folder ...]
 *         npm run probe:memory
 *
 * An uncached `traceFloorplanBoundaryCore` retains nothing; the same trace with
 * a `cacheKey` retains the whole boundary search — every closing-ladder rung of
 * every policy of every wall network, each holding a page-sized label array —
 * for as long as the image is open. The browser worker always passes a
 * cacheKey, so that is the production path, and it had no number defending it.
 *
 * Reports, per fixture: what an uncached trace retains, what a cached one
 * retains, what a warm replay costs, and what `clearDetectionCache` gives back.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { clearDetectionCache, getSearchCache } from '../src/utils/detection/cache.js';
import { loadPng } from './lib/benchUtils.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (typeof global.gc !== 'function') {
  console.error('memoryProbe needs --expose-gc (run it via `npm run probe:memory`).');
  process.exit(1);
}

const mb = (bytes) => (bytes / 1048576).toFixed(1);

// Retained bytes after the collector has had several passes: one gc() leaves
// freshly-dead typed arrays uncollected often enough to swamp the signal.
const settle = () => {
  for (let i = 0; i < 4; i += 1) global.gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};

const timed = (fn) => {
  const t = Date.now();
  const value = fn();
  return { value, ms: Date.now() - t };
};

const collectImages = (args) => {
  const targets = args.length ? args : [path.join(ROOT, 'fixtures')];
  const files = [];
  for (const target of targets) {
    const resolved = path.resolve(target);
    if (fs.statSync(resolved).isDirectory()) {
      files.push(...fs.readdirSync(resolved)
        .filter((f) => f.toLowerCase().endsWith('.png'))
        .sort()
        .map((f) => path.join(resolved, f)));
    } else {
      files.push(resolved);
    }
  }
  return files;
};

const probe = (file) => {
  const imageData = loadPng(file);
  // Between fixtures, or the later ones inherit the earlier ones' retention.
  clearDetectionCache();

  const base = settle();
  const uncached = timed(() => traceFloorplanBoundaryCore(imageData, {}));
  const afterUncached = settle();
  const cold = timed(() => traceFloorplanBoundaryCore(imageData, { cacheKey: file }));
  const afterCold = settle();
  const warm = timed(() => traceFloorplanBoundaryCore(imageData, { cacheKey: file }));
  const afterWarm = settle();
  // What the search *charged* itself, and whether that tripped the budget. A
  // memo that evicted reports a healthy retention figure and a warm replay
  // that costs full price, so the two numbers only mean something together.
  const searchCache = getSearchCache(file, 1400, undefined);
  const charged = searchCache.bytes ?? 0;
  const evicted = Boolean(searchCache.overBudget);
  clearDetectionCache();
  const afterClear = settle();

  const size = cold.value?.debug?.workingSize;
  console.log(`=== ${path.basename(file)} ===`);
  console.log(`   ${imageData.width}x${imageData.height}px source`
    + (size ? `, ${size.width}x${size.height} working` : ''));
  console.log(`   uncached retains  +${mb(afterUncached - base)} MB   (${uncached.ms}ms)`);
  console.log(`   cached   retains  +${mb(afterCold - afterUncached)} MB   (${cold.ms}ms cold)`);
  console.log(`   after warm replay +${mb(afterWarm - afterUncached)} MB   (${warm.ms}ms warm)`);
  console.log(`   search charged     ${mb(charged)} MB   ${evicted ? '** MEMO EVICTED **' : 'memo alive'}`);
  console.log(`   clearCache freed   ${mb(afterWarm - afterClear)} MB`);
  console.log('');
  return {
    file, retained: afterCold - afterUncached, coldMs: cold.ms, warmMs: warm.ms, charged, evicted,
  };
};

const files = collectImages(process.argv.slice(2));
if (!files.length) {
  console.error('No PNG images found.');
  process.exit(1);
}

let worst = null;
const evicted = [];
for (const file of files) {
  const result = probe(file);
  if (!worst || result.retained > worst.retained) worst = result;
  if (result.evicted) evicted.push(result);
}
console.log(`=== WORST: ${path.basename(worst.file)} retains ${mb(worst.retained)} MB ===`);
if (evicted.length) {
  console.log(`=== ${evicted.length}/${files.length} EVICTED: `
    + `${evicted.map((r) => `${path.basename(r.file)} (${mb(r.charged)} MB, warm ${r.warmMs}ms)`).join(', ')} ===`);
} else {
  console.log(`=== 0/${files.length} evicted — every fixture keeps its memo ===`);
}
