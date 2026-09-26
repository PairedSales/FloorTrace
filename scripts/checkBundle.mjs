/**
 * Asserts the shape of the entry after `npm run build`: `dist/index.html` must
 * modulepreload exactly the `interop` and `react` chunks.
 *
 * Everything else — konva, the OCR graph, tesseract, OpenCV — is meant to be
 * reached only through a dynamic import. `manualChunks` in `vite.config.js`
 * decides which file that code lands in, not whether it is deferred, so a
 * single static import from the eager shell puts a chunk back on the critical
 * path while every name in the config still looks right. The modulepreload
 * list is where that shows, and it used to be checked by eye.
 *
 * Usage:  npm run build && npm run check:bundle
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPECTED = ['interop', 'react'];

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const html = join(ROOT, 'dist', 'index.html');

if (!existsSync(html)) {
  console.error('dist/index.html not found. Run `npm run build` first.');
  process.exit(1);
}

// Output names are `assets/[name].[hash].js` (vite.config.js).
const preloaded = [...readFileSync(html, 'utf8').matchAll(/<link\b[^>]*>/g)]
  .map(([tag]) => tag)
  .filter((tag) => /\brel=["']modulepreload["']/.test(tag))
  .map((tag) => /\bhref=["']([^"']+)["']/.exec(tag)?.[1] ?? '')
  .map((href) => basename(href).replace(/\.[\w-]+\.js$/, ''))
  .sort();

console.log(`modulepreload: ${preloaded.join(', ') || '(none)'}`);

if (preloaded.join() !== EXPECTED.join()) {
  console.error(
    `Expected exactly: ${EXPECTED.join(', ')}. A chunk that should load lazily is ` +
    'now in the entry\'s static import graph — find the static import that pulled ' +
    'it in rather than changing this list.',
  );
  process.exit(1);
}
