# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FloorTrace is a single-page React app that lets a user upload a floorplan sketch, auto-detects room dimension labels via OCR, traces interior/exterior wall boundaries via classical computer vision, and computes area. Everything runs client-side in the browser — no server, no data collection. Deployed to GitHub Pages at `pairedsales.github.io/FloorTrace`.

## Commands

```
npm run dev        # start Vite dev server
npm run build       # production build (vite build)
npm run preview     # preview production build
npm run lint        # eslint .
npm test            # vitest run (all tests)
npx vitest run <path/to/file.test.js>   # run a single test file
node scripts/ocrBenchmark.mjs [image.png ...]   # OCR accuracy/timing benchmark (Node, Tesseract path only)
```

Vitest tests live under `src/utils/**/__tests__/`. There is no browser/e2e test harness — UI changes need to be manually verified with `npm run dev`.

## Architecture

### State: one Zustand store, snapshot-based undo/autosave

`src/store/appStore.js` holds nearly all app state as a flat "working state" object (image, calibration, perimeter traces, tool states, etc.), defined once in `WORKING_STATE_DEFAULTS` so undo/autosave/reset can't drift out of sync with each other.

- `SNAPSHOT_FIELDS` (working state minus transient UI/camera fields) is what `undoManager` snapshots on `undoManager.save()`. Callers call `undoManager.save()` themselves *before* mutating state for an undoable action — it is not automatic.
- `AUTOSAVE_FIELDS` is the similar-but-not-identical subset persisted to localStorage (`draftStorage.js`) on change.
- `src/store/undoManager.js` interns image data URLs into a hash-keyed pool (`hashDataUrl`) so repeated undo snapshots of an unchanged image share one copy in memory instead of deep-cloning multi-MB data URLs per step.
- `src/store/floorManager.js` (mixed into the store via `createFloorSlice`) manages multiple named "perimeter traces" (one polygon per floor/level) against a single shared calibration — this is the model backing multi-floor support. `selectPerimeterOverlay` / `selectCombinedArea` in `appStore.js` are memoized selectors (manual reference-equality caching, not reselect) — follow that pattern if adding similar derived state rather than introducing a new library.

### `App.jsx` is a thin orchestrator

`src/App.jsx` wires the store to components and owns cross-cutting workflow logic (mode transitions between `normal`/`manual`, calibration math from room dimensions + overlay, toast notifications). Most reusable interaction logic is factored into `src/hooks/*` (autosave, keyboard shortcuts, tool manager, project import/export, drag-and-drop) — new cross-component behavior should generally go in a hook, not directly in `App.jsx`.

### Two independent, worker-backed CV pipelines

Both pipelines take a raw image and run expensive per-pixel work off the main thread; both were rebuilt from scratch (see `docs/status.md`, `tasks/tasks.md`) with an emphasis on real inner/outer wall geometry rather than fixed-size placeholders.

**1. Wall/boundary detection** (`src/utils/detection/`) — runs in `src/workers/detectionWorker.js`, invoked via `src/utils/detection/index.js` (`detectRoomFromClick`, `traceFloorplanBoundary`). Pipeline stages, in `src/utils/detection/pipeline.js` and siblings:
  - `preprocess.js` — grayscale/blur/adaptive threshold/normalize
  - `orientation.js` — dominant wall-angle estimation for snapping
  - `wallMask.js` — morphological cleanup of the wall mask
  - `vectorize.js` — connected components → contours → simplified polygon
  - Produces both `inner` and `outer` boundary candidates from one mask/topology pass; `useInteriorWalls` (UI toggle) just selects which candidate is active (`getBoundaryForMode` in `detection/index.js`). See `docs/architecture.md` / `docs/technical.md` for the geometry contract (`polygon`, `overlay`, `confidence` for rooms; `inner`/`outer`/`debug` for boundaries).
  - Reference material (papers, annotated examples) for this pipeline lives in `Reference Data for Wall Detection System/`.

**2. Dimension OCR** (`src/utils/dimensions/`, entry point `src/utils/DimensionsOCR.js`) — a multi-pass hybrid pipeline documented in detail at the top of `src/utils/dimensions/pipeline.js`:
  1. Preprocess (grayscale, CLAHE via OpenCV or JS fallback, denoise, unsharp)
  2. Full-page sparse Tesseract pass (runs concurrently with spatial analysis)
  3. Spatial glyph-clustering to find horizontal/vertical text-line candidates the full-page pass misses
  4. Targeted zoomed single-line Tesseract re-reads on ROIs (including both 90° rotations for vertical labels)
  5. Optional PaddleOCR neural "rescue" pass over ROIs Tesseract couldn't parse (browser-only; skipped if the model isn't warmed up or the time budget — `budgetMs`, default 2600ms — is spent)
  6. Merge: overlap-based dedup, confidence scoring, dominant unit-format inference

  This pipeline core (`detectDimensionsCore` in `pipeline.js`) is deliberately environment-agnostic: it takes an `env` adapter (`toOcrInput`, optional `refineRois`, `budgetMs`) so the identical code path runs in the browser (`DimensionsOCR.js`'s `browserEnv()`) and in the Node benchmark harness (`scripts/ocrBenchmark.mjs`, which stubs `toOcrInput` with a PNG encoder and skips the PaddleOCR step). When changing pipeline behavior, prefer running the benchmark script over `ExampleFloorplan.png` to check detection rate/accuracy/timings before/after.

  PaddleOCR model weights are downloaded into `public/models/ocr-det` and `public/models/ocr-rec` (not committed as source, fetched via the commands recorded in `.claude/settings.local.json`).

### Build

`vite.config.js` sets `base: '/FloorTrace/'` for GitHub Pages, hashes all output filenames for cache-busting, and manually splits `tesseract.js` and `konva`/`react-konva` into their own chunks (both are large and not needed on first paint before an image is loaded).

## Conventions

- No comment blocks/docstrings beyond a short "why" line — several files already model this well (`pipeline.js`, `appStore.js`); match that density, not the verbosity of one-off code you're editing near.
- `eslint.config.js` treats unused vars as an error except names matching `^[A-Z_]`.
- Prefer adding new cross-cutting interaction logic as a hook in `src/hooks/` rather than growing `App.jsx`.
