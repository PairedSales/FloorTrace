# FloorTrace Architecture

## System Overview

FloorTrace is a single-page React app with all image processing in-browser. The architecture separates UI interaction from compute-heavy geometry extraction:

- `src/App.jsx`: application state orchestration and workflow control.
- `src/components/*`: rendering and interactions (toolbar, panels, canvas overlays).
- `src/utils/DimensionsOCR.js`: public API for room-dimension extraction (detect, warm-up, parser re-exports).
- `src/utils/dimensions/*`: the dimension-OCR engine — text parsing (`parse.js`), raster preprocessing (`raster.js`), glyph-cluster spatial analysis (`regions.js`), Tesseract/PaddleOCR/OpenCV wrappers, and the multi-pass pipeline (`pipeline.js`). PaddleOCR models are served locally from `public/models/`. `scripts/ocrBenchmark.mjs` runs the pipeline in Node against ground-truth images.
- `src/utils/detection/*`: wall/region/boundary extraction pipeline.
- `src/workers/detectionWorker.js`: off-main-thread execution for detection tasks.

## Detection Flow

1. User loads floor plan image.
2. OCR detects dimension text candidates.
3. User clicks a detected dimension.
4. Worker computes room enclosure polygon from click seed.
5. App stores room overlay, calculates scale from user dimensions.
6. User runs perimeter trace.
7. Worker returns both inner and outer boundary candidates.
8. App chooses active boundary based on wall mode toggle, computes area.

## Wall Mode Model

- `inner`: area traced from inside wall envelope (interior-use scenario).
- `outer`: area traced from outside wall envelope (building footprint scenario).

Both are produced from the same mask/topology pass and switched at UI state level.
