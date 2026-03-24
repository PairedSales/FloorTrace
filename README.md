# FloorTrace Web

FloorTrace is a browser-only floor plan area calculator. The application runs fully client-side and supports:

- OCR-assisted room dimension selection.
- Click-to-room enclosure placement from detected text locations.
- Automatic perimeter tracing with inside-wall vs outside-wall modes.
- Polygon area calculation and measurement overlays.

## Detection Pipeline (Client-Side)

The current detection system is a classical CV pipeline executed in a Web Worker:

1. Preprocess input image (grayscale, adaptive threshold, mask cleanup).
2. Estimate dominant wall orientations (including 30, 45, and 60 degree walls).
3. Build wall masks and connected free-space regions.
4. Extract room regions from click seeds.
5. Trace outer and inner floor boundaries for area calculation modes.

Heavy image processing runs off the main thread in `src/workers/detectionWorker.js`.

## Development

Install dependencies:

`npm install`

Run locally:

`npm run dev`

Run lint:

`npm run lint`

Run tests:

`npm run test`

## Notes

- Curved walls are approximated by polygonal boundaries.
- Best performance comes from scans where walls are clearly visible and mostly aligned to dominant plan angles.

## License

MIT
