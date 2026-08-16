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
npm run bench:detection    # detection accuracy against fixtures/ (runs in CI)
npm run bench:ocr          # OCR accuracy/timing benchmark (Node, Tesseract path only)
npm run probe:exterior     # exterior tracer on synthetic scenarios with exact truth
```

Vitest tests live under `src/utils/**/__tests__/`. There is no browser/e2e test harness — UI changes need to be manually verified with `npm run dev`. Benchmark/test fixture floorplans (`ExampleFloorplanN.*` + `.truth.json` sidecars) live under `fixtures/`.

**Always run `npm run bench:detection` before and after a detection change.** It scores polygon shape and square feet, not just bounding boxes — a tracer that returns each building's bounding rectangle passes a box check while discarding every notch and wing. `npm run probe:exterior` prints the same scenarios `exterior-failures.test.js` asserts (wide openings, U-notches, dimension strings, courtyards, legends, garage doors, nested plans, mixed wall thickness) with IoU/area/confidence, which is the fastest way to see what a change did. `npm run probe:exterior draw` does the same for draw mode, re-tracing those scenarios from a synthetic sloppy brush stroke (`strokeAround` in `synthetic.js`) — jitter and brush width should not move the numbers.

## Architecture

### State: one Zustand store, snapshot-based undo/autosave

`src/store/appStore.js` holds nearly all app state as a flat "working state" object (image, calibration, perimeter traces, tool states, etc.), defined once in `WORKING_STATE_DEFAULTS` so undo/autosave/reset can't drift out of sync with each other.

- `SNAPSHOT_FIELDS` (working state minus transient UI/camera fields) is what `undoManager` snapshots on `undoManager.save()`. Callers call `undoManager.save()` themselves *before* mutating state for an undoable action — it is not automatic.
- `AUTOSAVE_FIELDS` is the similar-but-not-identical subset persisted on change to IndexedDB, falling back to localStorage if IndexedDB is unavailable (`draftStorage.js`).
- `PERSISTENT_FLOOR_FIELDS` (the `.floorplan` projection, re-exported by `projectSerializer.js`) is derived from the same declaration. Do not hand-maintain it: the hand-listed version is how `exteriorLabels` came to be autosaved but not exported, so reopening a project silently degraded every later trace.
- `rooms[]` accumulates every room the detector has placed (rect, per-side wall faces, implied px/ft). It is the boundary stage's containment evidence and the sample set for a robust multi-room scale — a single `roomOverlay` could be neither. Perimeter traces additionally carry `holes` (enclosed voids, subtracted from area), `quality` (detection confidence + warnings) and `wallFaces` (the detector's exterior/interior pair for *that* outline). `wallFaces` is per trace rather than re-derived from `tracedBoundaries` because that field holds only the most recent detection run: the exterior/interior switch (`setWallFaceMode`) is one setting for the whole canvas, so a plan traced in several passes has outlines the last run cannot describe.
- `src/store/undoManager.js` interns image data URLs into a hash-keyed pool (`hashDataUrl`) so repeated undo snapshots of an unchanged image share one copy in memory instead of deep-cloning multi-MB data URLs per step.
- `src/store/floorManager.js` (mixed into the store via `createFloorSlice`) manages multiple named "perimeter traces" (one polygon per floor/level) against a single shared calibration — this is the model backing multi-floor support. `selectPerimeterOverlay` / `selectCombinedArea` in `appStore.js` are memoized selectors (manual reference-equality caching, not reselect) — follow that pattern if adding similar derived state rather than introducing a new library.

### `App.jsx` is a thin orchestrator

`src/App.jsx` wires the store to components and owns cross-cutting workflow logic (mode transitions between `normal`/`manual`, calibration math from room dimensions + overlay, toast notifications). Most reusable interaction logic is factored into `src/hooks/*` (autosave, keyboard shortcuts, tool manager, project import/export, drag-and-drop) — new cross-component behavior should generally go in a hook, not directly in `App.jsx`.

### Two shells over one workflow

`useIsMobile()` (`src/hooks/useViewport.js`, `max-width: 819px`) picks the chrome; `useIsTouch()` (`pointer: coarse`) picks the *targets*. They are separate queries on purpose — a touchscreen laptop wants 44 px handles and pinch-zoom while keeping the docked desktop layout, and a narrow mouse-driven window wants the opposite.

`App.jsx` still owns every workflow decision. It builds the `<Canvas>` element once (`canvasElement`) and hands it to whichever shell renders: the five desktop bands, or `<MobileChrome>` (`src/components/mobile/`), which is a top bar, the plan, one thumb-height bar, and three sheets over a shared `BottomSheet`. Do not fork behaviour across the two — the mobile measurement sheet renders the *same* `MeasurementDock` with `mobile`, re-sized from outside by the `.touch-dense` scope in `index.css`, and the tool sheet reads the same `TOOL_GROUPS` (`components/toolCatalog.js`) the desktop rail does.

The mobile bar states **one** verb, derived from the pipeline `StageSpine` already models (plan → scale → outline → report), rather than the desktop's seven at equal weight.

**Touch on the canvas is not free.** Every drag-based tool (brush, eraser, crop, void rectangle, room overlay) was wired to `mousedown`/`mousemove`, and no browser synthesises those during a touch drag — so all of them were dead on a phone. `useToolRouter` now exposes `handleStageTouch{Start,Move,End}` that route into the same `dispatchPointerDown` a mouse does; one finger is a pointer, two are the camera (`usePinchZoom`, wired in `useCameraController`). Three rules that are load-bearing:

- **`e.evt.button !== 0` rejects touch.** A `TouchEvent` has no `button`, so the strict test silently killed double-tap vertex insertion and every room-overlay drag. The guard is `button != null && button !== 0`.
- **A gesture that grows a second finger commits, it does not cancel.** The ink already painted is real work; discarding it because the user then reached to zoom costs a whole stroke.
- **Hit area and drawn size are different numbers.** Vertex handles, room corners, protractor handles and OCR pills keep their drawn radius and get a `hitFunc` sized in `/scale` so the target is a constant ~44 screen px at any zoom. Inflating what is *drawn* buries the outline the handles annotate.

Right-click has no touch equivalent, so deleting a vertex is a 500 ms press-and-hold (cancelled by movement or release) in `PerimeterLayer`, and rotate-the-other-way becomes a second button in the tool sheet.

**Verifying mobile in the Browser pane:** the pane does not composite, so `document.hidden` is true — `requestAnimationFrame`, `ResizeObserver` and `MediaQueryList` change events all stop firing. That makes the Konva stage stick at its 800×600 default, the hit graph never paint (so nothing on the canvas is tappable), and the shell never switch breakpoints. None of it is a bug. Shim `requestAnimationFrame` with `setTimeout`, dispatch a `resize` event to drive the camera's `measure()`, and nudge a store field `App` subscribes to so `useSyncExternalStore` re-reads the query.

### Two independent, worker-backed CV pipelines

Both pipelines take a raw image and run expensive per-pixel work off the main thread, with an emphasis on real inner/outer wall geometry rather than fixed-size placeholders.

**1. Wall/boundary detection** (`src/utils/detection/`) — runs in `src/workers/detectionWorker.js`, invoked via `src/utils/detection/index.js` (`detectRoomFromClick`, `traceFloorplanBoundary`). Pure-JS cores (`detectRoomFromClickCore`, `traceFloorplanBoundaryCore` in `pipeline.js`) take a plain `{width, height, data}` object and run identically in the worker and in `scripts/detectionBenchmark.mjs` (Node, pngjs; ground truth via `<image>.truth.json` sidecars).

The exterior stage is a **hypothesise-and-score search**, the same shape as room detection and OCR — not a single sealing heuristic. Stages:

  - `raster.js` — Otsu binarize + OR-pool downscale, run-based morphology, components, flood fill, SATs
  - `analyze.js` — text/speck strip, structural stroke extraction (kills door arcs/curves), wall-thickness estimate. Produces `wallMask` (strict; rooms use this), `boundaryMask` (wallMask + rescued line-like residual ink; the tracer uses this) and `thickMask` (strokes thick enough to be structural)
  - `wallEvidence.js` — linework vectorised into axis-aligned **wall segments** (`faceLo`/`faceHi`/`lo`/`hi`/`thick`), plus graded per-point evidence: structural ink = 1, any wall stroke = 0.45, raw ink = 0.2, nothing = 0. `contourSupport` answers "is this outline actually drawn as wall?"
  - `candidates.js` — per wall network, footprints from two evidence variants (`all`, `structural`) × three connectivity policies (`weld` = colinear welding that refuses notch mouths, `raw`, `span` = wall lines painted across their full extent). `span` is a rescue that only runs when nothing enclosed the network. Every closing-ladder rung is a candidate, with a `completeness` measure relative to the largest enclosure the same evidence reached before it started annexing
  - `scoring.js` — scores each candidate on seal (does it close, and fill its own wall network), support (is the outline drawn as wall), coverage (does it enclose the wall that *was* drawn), economy (how much closing/bridging was invented), and any constraints the app supplies; emits a confidence and a `warnings[]` list
  - `boundary.js` — orchestrator: partition into wall networks (fragments of one outline rejoin only when their extents interleave and neither encloses itself), generate → score → pick per network, build floors, reject outlines that are not buildings, order them, and aggregate quality
  - `footprint.js` — per floor: outer contour, filament shave, non-GLA carve, enclosed voids as **holes**, and an interior envelope inset **per edge** by the wall measured behind that edge
  - `nonGla.js` — garage/porch/patio arbitration. Four detectors (OCR label votes, label floods, geometric garage evidence, shaded pockets) emit *candidate regions*; overlapping candidates merge into one region carrying both sources; one pass removes them under a cumulative bound, so the result cannot depend on detector order
  - `remediate.js` — **second-chance tracing**: when the winner is below `REMEDIATION_CONFIDENCE` (0.75) or excludes a known-inside constraint, the trace is searched again. `join` re-runs the wall networks surrounding a stranded room as one network (for the case where one drawing was partitioned into pieces — no closing radius reaches that); `escalate` forces every rescue and doubles the ladder over the same partition. Each attempt runs through `assembleFloors`, so it is scored, validated and aggregated by the same code as the first. Adjudication is on **effective** confidence — the detector's own number times `constraintFactor` — because inside the network that caused a miss the miss is invisible (`detectFloorNet` scopes constraints per network), which is why the base attempt can report 0.93 while the app shows 0.47. `escalate` is gated on the ladder ceiling having actually been reached (or nothing sealing, or a constraint being missed): the ladder is climbed from r=2 up and every rung is scored, so a winner that sealed well below the top already beat every wider rung that existed, and raising the top only appends rungs that score worse on `economy`. Ungated, that pass doubled the trace time of every merely-fair plan and was never once accepted on the fixtures. Never runs in draw mode: there the stroke is the intent
  - `validate.js` — post-hoc checks on the mapped result (self-intersection, floors overlapping, inner nesting, labelled regions outside the footprint) plus `scaleIsotropy` / `robustScale` for calibration. `exemptRegions` (OCR label bboxes, padded by their own size) and `carvedRegions` (the areas the carve actually removed, containment only) are separate on purpose — folding them together either exempted a real miss two rooms away or reported the garage the tracer had just carved as a label falling outside
  - `polygon.js` — Moore trace (Jacob's criterion) → RDP → de-skewed rectilinear fit; signed shoelace, ring-set area, point-in-polygon
  - `room.js` — rectangle growth from the label with wall-coverage stops (door gaps don't leak), thin-line candidates + label-aspect arbitration (closets/counters), open-plan virtual sides, then a final pass seating each chosen edge on its wall's **interior face** (measured in the unsmeared mask over the final span, never predicted from the smear trigger, and never on the centreline). Returns per-side wall faces (`{edge, cov, thick, kind, exterior}`) and the px/ft the room implies
  - `brush.js` — **draw mode**: the user's rough brush strokes as a constraint. Strokes rasterise into a `corridor` (the painted band, which *replaces* `partitionWallNetworks` — one painted loop is one building) and a `ribbon` (the centreline at wall width, fed to `createEvidence` as asserted wall). The tracer then searches only ink inside the corridor, which is why draw mode beats auto-detection on the plans auto-detection fails: legends, dimension strings and neighbouring plans are outside the band by construction. `regionFit` scores a candidate on *miss* and *spill* against the stroke, **not** IoU — the band is thick, and plain IoU flags every generous stroke as a mismatch
  - `cache.js` — memoises analysis and boundary per `(cacheKey, maxDimension)`. The worker passes the image hash, so N room clicks cost one trace instead of 2N

  **Quality is a first-class output.** `traceFloorplanBoundaryCore` returns `quality: {confidence, warnings[], usedFallback, source, …}`; the worker forwards a whitelist of debug fields (it must never blanket-null them again); traces carry their quality into the store; `App.jsx` reports a doubtful trace as doubtful. `src/utils/boundaryQuality.js` decides the wording.

  `quality.source` is `'auto'` or `'drawn'`, and several checks are deliberately gentler for `'drawn'` — a label outside a hand-drawn outline is usually a deliberate exclusion, so it warns instead of erroring (in both `scoring.js` and `validate.js`, which each raise their own `label-outside`), and OCR constraints lose most of their scoring weight. A trace the detector itself rates `poor` or `failed` drops the user straight into draw mode rather than handing over an answer.

  Constraints flow the other way too: `options.constraints` carries `rooms[]` (known-inside rectangles) and `interiorPoints` (parsed dimension labels) from the store, geometry that excludes them is scored down, and a winner that still excludes one is re-searched (`remediate.js`). **The benchmark runs each fixture twice** — once bare and once with the truth file's room clicks as constraints — because that second run is the path the app actually takes after a scan, and it is the only one that exercises remediation.

  Reference material (papers, annotated examples) for this pipeline lives in `Reference Data for Wall Detection System/`.

**2. Dimension OCR** (`src/utils/dimensions/`, entry point `src/utils/DimensionsOCR.js`) — a multi-pass hybrid pipeline documented in detail at the top of `src/utils/dimensions/pipeline.js`:
  1. Preprocess (grayscale, CLAHE via OpenCV or JS fallback, denoise, unsharp)
  2. Full-page sparse Tesseract pass (runs concurrently with spatial analysis)
  3. Spatial glyph-clustering to find horizontal/vertical text-line candidates the full-page pass misses
  4. Targeted zoomed single-line Tesseract re-reads on ROIs (including both 90° rotations for vertical labels)
  5. Optional PaddleOCR neural "rescue" pass over ROIs Tesseract couldn't parse (browser-only; skipped if the model isn't warmed up or the time budget — `budgetMs`, default 2600ms — is spent)
  6. Merge: overlap-based dedup, confidence scoring, dominant unit-format inference

  A scan is ~90% Tesseract inference, so the speed levers are all about the calls: `ocrTesseract.js` keeps a **worker pool** (`min(4, cores/2)`, preset-affine, torn down on an idle timer rather than after every scan) and phase 4 reads ROIs concurrently across it, while the speculative ROI tier (priority ≤6 — spatial clusters nothing corroborates) gets one zoom rung instead of the full ladder. `detectAllDimensions` memoises the last scan by image identity. Two things that look like free wins are **not**, and are benchmarked shut: running CLAHE before the pre-OCR upscale instead of after (bilinear zoom is what creates the gradients CLAHE exists to flatten — costs six detections), and lowering `UPSCALE_MAX`/`TARGET_GLYPH_PX` (flat detection rate, more false positives).

  This pipeline core (`detectDimensionsCore` in `pipeline.js`) is deliberately environment-agnostic: it takes an `env` adapter (`toOcrInput`, optional `refineRois`, `budgetMs`) so the identical code path runs in the browser (`DimensionsOCR.js`'s `browserEnv()`) and in the Node benchmark harness (`scripts/ocrBenchmark.mjs`, which stubs `toOcrInput` with a PNG encoder and skips the PaddleOCR step). When changing pipeline behavior, prefer running the benchmark script over `fixtures/ExampleFloorplan.png` to check detection rate/accuracy/timings before/after.

  PaddleOCR model weights are committed under `public/models/ocr-det` and `public/models/ocr-rec` (`model.json` + `chunk_N.dat`, 10.6 MB). They are checked in deliberately — the app must work offline and on first paint — but note that regenerating them adds another copy to git history, so replace rather than accumulate.

  Tesseract's runtime assets are self-hosted (no jsdelivr at runtime): the worker script and core WASM come straight from `node_modules` via Vite `?url` imports — see the `configureTesseract` block in `DimensionsOCR.js`, which also does the SIMD probe — so they track the installed tesseract.js version automatically. The language data lives at `public/tesseract/eng.traineddata.gz`; regenerate it by gzipping the `eng.traineddata` that a Node benchmark run caches in the repo root.

### Build

`vite.config.js` sets `base: '/FloorTrace/'` for GitHub Pages, hashes all output filenames for cache-busting, and assigns `tesseract.js`, `konva`/`react-konva`, React and rollup's CommonJS interop helper to named chunks.

**Splitting is not lazying.** The konva chunk existed for a long time while `App.jsx → Canvas.jsx → react-konva` kept it in the entry's *static* module graph, so `index.html` modulepreloaded it and the browser fetched and compiled all 320 kB before the app could run — the opposite of what the config appeared to say. What actually defers it is `Canvas.jsx`, which lazy-loads the whole `<Stage>` subtree (`CanvasStage.jsx`) behind `React.lazy`; the manual chunks only decide *which file* the deferred code lands in. Two entries are load-bearing for that: React and `commonjsHelpers` are pinned to their own chunks because, left unassigned, rollup folds the dependency shared by konva and the entry *into the konva chunk*, and the entry then statically imports konva to reach it. If you change `manualChunks`, check `dist/index.html` for a konva modulepreload afterwards — that link is the regression signal.

## Conventions

- No comment blocks/docstrings beyond a short "why" line — several files already model this well (`pipeline.js`, `appStore.js`); match that density, not the verbosity of one-off code you're editing near.
- `eslint.config.js` treats unused vars as an error except names matching `^[A-Z_]`.
- Prefer adding new cross-cutting interaction logic as a hook in `src/hooks/` rather than growing `App.jsx`.
- Detection results carry their own quality. Never drop a `warnings[]`/`confidence` on the way to the UI, and never report a trace as a plain success without consulting it — the failure mode this codebase is most prone to is a wrong answer that looks green.
