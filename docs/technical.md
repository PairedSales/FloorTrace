# FloorTrace Technical Notes

## Detection Modules

- `raster.js`: binary raster primitives — Otsu binarization with OR-pool downscale (thin lines survive), run-based 1D/rect morphology, run-length opening in 4 directions, connected components, border flood fill, summed-area tables.
- `polygon.js`: Moore boundary trace, RDP simplification, rectilinear line fit (edges refit as axis-aligned lines and intersected; genuine diagonals kept), area/bounds helpers.
- `analyze.js`: shared analysis — binarize, strip small components (text/ticks/arrows), extract structural strokes (long straight runs + thick-opening survivors, which drops door arcs and curves), estimate dominant wall thickness, build coverage SATs.
- `boundary.js`: exterior tracing — partition the wall mask into disconnected wall networks (dilate + label; one network per floor outline, up to 5), then seal each network in isolation: bridge colinear gaps across the whole network (window spans; sub-flank ticks/dashes inside a gap neither bridge nor break it), run an escalating closing-radius ladder, and pick the smallest radius whose enclosed area is near the ladder maximum — leaks shrink the enclosed area, so a greedy "first radius that looks sealed" would accept partial footprints. Per floor: polygonize the footprint contour, sample exterior wall depth along the contour, erode by it for the inner envelope. Non-GLA regions are then carved out of the sealed footprint: `excludeRegions` (OCR garage/porch/patio/deck/balcony label bboxes) each seed the enclosed open cavity the label sits in, and the geometric garage detector (`garage.js`) adds cavities that read as garages even without OCR. Targeted cavities are cleared and a rect opening drops the orphaned wall/railing ring so the trace lands on the shared house wall's outer face. Guards skip labels that hit no cavity, a noise sliver, or a cavity large enough to be the main interior.
- `garage.js`: OCR-independent garage evidence — a garage is a large, near-rectangular enclosed cavity with one exterior-facing side drawn almost entirely as a thin garage-door stroke (low ink *and* the outward march exits the footprint within a few px — a window gap sits in a bridged full-thickness wall band, so it fails the exit-distance test) while the remaining sides are full-thickness walls (porch railings, thin all around, fail this guard). Disabled via `options.autoGarage === false`; the room-from-click path disables it so clicking a garage label still detects the garage room.
- `room.js`: room-from-label — grow a rectangle from the label; sides stop at columns/rows with high wall coverage across the current span (door gaps only dent coverage, so no leaks). Thin lines (counters, closet fronts, window glass) become stop *candidates*; a combinatorial search picks the per-side candidates whose rectangle best matches the parsed label aspect ratio. Sides with no wall at all (open plan) are placed from the scale implied by the wall-confirmed axis.
- `pipeline.js`: environment-agnostic cores (`detectRoomFromClickCore`, `traceFloorplanBoundaryCore`) taking `{width, height, data}`; coordinate mapping back to original pixel space; `boundaryByMode`.
- `index.js`: main-thread API and worker request/response lifecycle.

All stages are pure JS (no OpenCV/WASM dependency), so the identical code runs in the worker and in `scripts/detectionBenchmark.mjs` under Node.

## Worker Execution

Detection requests are sent to `detectionWorker.js`:

- `detectRoomFromClick`
- `traceFloorplanBoundary`

The worker decodes an image data URL, runs the detection cores, and returns geometry (debug metadata is stripped before posting).

## Geometry Contract

Room detection returns:

- `polygon`: room rectangle (4 corners) in original image coordinates.
- `overlay`: axis-aligned room bounds (`x1`, `y1`, `x2`, `y2`).
- `confidence`: 0..1 — per-side wall evidence (coverage x thickness), penalized for footprint clamps, aspect mismatch against the parsed label, and virtual (open-plan) sides.

Options: `labelBbox` (the OCR label's bbox, used as the grow seed) and `labelDims` (parsed feet, used for aspect arbitration) — both optional.

Boundary detection returns:

- `outer`: building footprint polygon + overlay (exterior face of exterior walls).
- `inner`: interior envelope polygon + overlay (footprint eroded by sampled exterior wall thickness).
- `floors`: one `{ outer, inner }` entry per disconnected floor outline, in page reading order (top-to-bottom, left-to-right); the top-level `outer`/`inner` stay the largest floor for single-boundary callers.
- `excludedRegions`: count of non-GLA cavities carved (label-seeded plus geometric garages; top-level, since the worker strips `debug`).
- `excludedGarages`: how many of those carves were garages (geometric hits plus `keyword`-matched garage labels) — the app words its toast with this.
- `debug`: working size/scale, wall thickness estimates, chosen seal radius, per-network seal-search traces.

Both come from the same analysis + footprint pass. `options.excludeRegions` takes non-GLA label bboxes (plus the matched `keyword`) in original image pixels (the app supplies `exteriorLabels` collected by the dimension OCR pass — see `src/utils/dimensions/exteriorLabels.js`).

## Benchmarking

`node scripts/detectionBenchmark.mjs [image.png|folder ...]` mirrors `ocrBenchmark.mjs`: PNGs load via pngjs, a `<image>.truth.json` sidecar supplies ground truth (wall-face rects, boundary bbox/polygon/areas, per-floor outer bboxes, optional `pixelsPerFoot` and per-room `minIou`), and the script reports per-check HIT/MISS and timings. With no arguments it runs ExampleFloorplan.png against measured built-in truth.

## Performance

- Binarization happens at full resolution; the mask is OR-pooled down to a ~1400px working scale.
- Full pipeline runs in ~200-300ms per request on a 2000px floorplan (pure JS, no WASM warm-up).
- The worker offloads all pixel loops; debug masks never cross the worker boundary.
