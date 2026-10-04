---
paths:
  - "src/utils/dimensions/**"
  - "src/utils/DimensionsOCR.js"
  - "src/utils/ocrLazy.js"
  - "src/utils/traceClassification.js"
  - "src/hooks/useEnhancedOcr.js"
  - "src/hooks/useOcrWarmup.js"
  - "scripts/ocrBenchmark.mjs"
  - "public/models/**"
  - "public/tesseract/**"
---

# Dimension OCR (`src/utils/dimensions/`)

The phases are documented at the top of `dimensions/pipeline.js`. `detectDimensionsCore` is environment-agnostic: it takes an `env` adapter (`toOcrInput`, optional `refineRois`, `budgetMs`), so the same code runs in the browser's scan worker (`src/workers/ocrWorker.js`), on the page where that worker cannot run (`dimensions/scanOnPage.js`), and in `scripts/ocrBenchmark.mjs` (Tesseract only). Keep it that way, and keep it free of the DOM.

## Verify

- `npm run bench:ocr` over all fixtures in one process, in a fixed order — JIT warm-up swings phase timings about 2× between a cold first fixture and later ones, so split runs are not comparable. `OCR_DEBUG=1` prints ROI reads.
- Individual Tesseract tile reads are not stable across queue-order changes. Compare aggregates; don't chase one label.
- Tune parse quality against both a tiny-text plan (`ExampleFloorplan4`, ~7 px glyphs) and the hyphen format (`ExampleFloorplan5`, `13-2x17-2`). Improvements to one have repeatedly regressed the other.
- Also run `npm run bench:scale`: it shares `toOcrInput`/`detectDimensionsCore`, and it is the CI gate that gets forgotten.

## Invariants

- **The time budget is wall clock** (`budgetMs`, default 2600). Anything competing for CPU during a scan makes it return fewer dimensions with nothing saying so — a worse scale, and area goes as scale squared. That is why `scanQueue.js` serialises scans (it also de-duplicates concurrent requests and keeps a four-entry LRU keyed by data-URL identity). Never memoise a failure.
- **The scan runs in a worker, not on the page** (`workers/ocrWorker.js`; `dimensions/ocrHost.js` is the page's half). Its image work is 1.3–1.8 s a plan, and on the page's thread that was stretches of up to 800 ms in which nothing repainted and Stop could not be pressed (`docs/page-responsiveness.md`). The worker decodes the image, starts the Tesseract pool as its own workers and loads OpenCV; the page keeps the scan queue, the asset URLs and PaddleOCR (WebGL and an `<img>`), which the worker reaches by message. A worker that cannot start or dies hands the scan back (`hostUnavailable`) and it is run on the page; a scan that fails on its own merits is not retried there. Both paths read the same pixels and return the same sizes on every fixture — check that again (`scanOnPage` against `detectAllDimensions`, in the dev page) if either decode changes.
- **The Tesseract pool size is a memory decision**: `max(1, min(cap, cores/2))`, with a cap of 8 only when there are ≥16 cores and ≥8 GB `deviceMemory` (unknown counts as not enough), else 4. Reads are identical at any pool size.
- **Benchmarked shut — don't retry without new numbers**: CLAHE before the pre-OCR upscale, lower `UPSCALE_MAX` or `TARGET_GLYPH_PX`, reading pass 1 as parallel strips. Numbers in `docs/ocr-performance.md`.
- **OpenCV stays** (settled 2026-08-22): across the fixtures it is worth +1 detection and −2 false positives, and a false positive is a sample the scale pools. Reproduce with `FLOORTRACE_NO_OPENCV=1 node scripts/ocrBenchmark.mjs fixtures/ExampleFloorplan*.png`. It is reached only through `await import()` in `loadOpenCv`, so it costs the first scan, not first paint.
- **`App.jsx` and the two OCR hooks import from `utils/ocrLazy.js`, never `DimensionsOCR.js`.** One direct import puts the whole dimension graph (45 kB) back in the entry chunk. `terminateOcrWorker` runs in an unmount cleanup and must stay synchronous.
- **Two keyword collections with opposite effects.** `exteriorLabels` (`exteriorLabels.js`) carve their region out of the footprint. `areaLabels` (`areaLabels.js`) type the whole outline they sit in (`traceClassification.js`, `classifyTraceTypes`), so a basement stops counting as GLA. Keep the area vocabulary to level names: a GARAGE label typed as an area would move a whole storey out of GLA. `matchAreaLabel` refuses pointers ("DN TO BSMT") and schedule rows.
- **Classification**: labels inside an outline outrank a caption outside it, and a caption two outlines could equally claim is dropped. `typeSource: 'user'` is never overwritten; `'detected'` is withdrawn when its label disappears.
- **Assets are self-hosted.** Tesseract's worker and core come from `node_modules` through `?url` imports (`configureTesseract`). Language data is `public/tesseract/eng.traineddata.gz` — regenerate it by gzipping the `eng.traineddata` a Node benchmark run caches in the repo root. PaddleOCR weights under `public/models/` are committed on purpose (offline use): replace them, never add copies. Paddle's WebGL init takes ~10 s on the main thread, which is why it is deferred.
