# FloorTrace Architecture

## System Overview

FloorTrace is a single-page React app with all image processing in-browser. The architecture separates UI interaction from compute-heavy geometry extraction:

- `src/App.jsx`: application state orchestration and workflow control.
- `src/components/*`: rendering and interactions (toolbar, panels, canvas overlays).
- `src/utils/DimensionsOCR.js`: public API for room-dimension extraction (detect, warm-up, parser re-exports).
- `src/utils/dimensions/*`: the dimension-OCR engine — text parsing (`parse.js`), raster preprocessing (`raster.js`), glyph-cluster spatial analysis (`regions.js`), Tesseract/PaddleOCR/OpenCV wrappers, and the multi-pass pipeline (`pipeline.js`). PaddleOCR models are served locally from `public/models/`. `scripts/ocrBenchmark.mjs` runs the pipeline in Node against ground-truth images.
- `src/utils/detection/*`: wall/region/boundary extraction pipeline (pure-JS cores shared by the worker and the Node benchmark `scripts/detectionBenchmark.mjs`; see `docs/technical.md` for the stage breakdown).
- `src/workers/detectionWorker.js`: off-main-thread execution for detection tasks. Its transport is a **whitelist**: the pipeline's quality signals must reach the UI.

## Detection Flow

1. User loads floor plan image.
2. OCR detects dimension text candidates.
3. User clicks a detected dimension.
4. Worker grows the room rectangle outward from the label (wall-coverage stops; the label's bbox and parsed feet are passed through as hints).
5. App stores room overlay, calculates scale from user dimensions.
6. User runs perimeter trace (also triggered automatically after a room is placed), with the rooms placed so far and the parsed dimension labels passed in as constraints.
7. Worker generates several candidate footprints per wall network, scores them against wall evidence and those constraints, and returns the winner with `quality: {confidence, warnings[]}` alongside the inner and outer polygons and any enclosed voids.
8. App chooses active boundary based on wall mode toggle, computes area, and reports the trace at its measured confidence — a doubtful outline is announced as one to check, with a one-click **Draw Exterior** fallback.

## Quality Model

Exterior detection is a hypothesise-and-score search, not a single heuristic, so every result carries how much to trust it:

- **Candidates** come from two evidence variants (every stroke / only structural strokes) crossed with three connectivity policies (welding that refuses notch mouths, no welding, wall-line spanning), plus every rung of the closing ladder.
- **Scoring** measures seal, wall support along the outline, coverage of the wall that was actually drawn, economy of invented closing, completeness relative to what the same evidence could enclose, and agreement with known rooms and labels.
- **Confidence and warnings** travel with the result into the store, onto each perimeter trace, and into the UI. Codes include `unsealed`, `weak-wall-support`, `bridged-opening`, `heavy-closing`, `annexation`, `wall-left-outside`, `incomplete-enclosure`, `label-outside`, `room-outside`, `self-intersecting`, `floors-overlap`, `no-inner`, `thin-structure-excluded`.
- **Failure is visible.** A trace that cannot be produced returns a `no-boundary` reason rather than nothing, and neither case fires a success toast.

## Wall Mode Model

- `inner`: area traced from inside wall envelope (interior-use scenario).
- `outer`: area traced from outside wall envelope (building footprint scenario).

Both are produced from the same mask/topology pass and switched at UI state level.
