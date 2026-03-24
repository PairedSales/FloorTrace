# FloorTrace Technical Notes

## Detection Modules

- `preprocess.js`: grayscale conversion, blur, adaptive threshold, image normalization.
- `orientation.js`: dominant angle estimation and edge-angle snapping bins.
- `wallMask.js`: morphological close/open and wall mask cleanup.
- `vectorize.js`: connected components, contour point extraction, hull/simplification.
- `pipeline.js`: room-from-click and boundary tracing orchestration.
- `index.js`: main-thread API and worker request/response lifecycle.

## Worker Execution

Detection requests are sent to `detectionWorker.js`:

- `detectRoomFromClick`
- `traceFloorplanBoundary`

The worker decodes an image data URL, runs CV processing, and returns geometry and debug metadata.

## Geometry Contract

Room detection returns:

- `polygon`: room polygon in image coordinates.
- `overlay`: axis-aligned room bounds (`x1`, `y1`, `x2`, `y2`).
- `confidence`: 0..1 confidence score.

Boundary detection returns:

- `inner`: inner-wall polygon + overlay.
- `outer`: outer-wall polygon + overlay.
- `debug`: dominant angles and normalized processing size.

## Performance

- Normalization downscales large images prior to analysis.
- Worker offloads expensive pixel loops.
- Debug overlays are optional and disabled by default.
