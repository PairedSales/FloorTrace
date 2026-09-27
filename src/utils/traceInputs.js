// What the rest of the app already knows about a plan, handed to the exterior
// tracer. Out of App.jsx so that scripts/realBenchmark.mjs replays a saved
// project with exactly the inputs the app gave the tracer, rather than a copy
// of them that drifts.

import { roomIsNonGla } from './dimensions/exteriorLabels.js';

// OCR non-GLA labels -> tracer exclude regions (keyword kept so garages can
// be reported distinctly from porch/patio carves).
export const nonGlaExcludeRegions = (state) =>
  (state.exteriorLabels ?? []).map((l) => ({ ...l.bbox, keyword: l.keyword }));

// Rooms are inside by construction; a parsed dimension label is inside by
// definition — geometry that excludes either is provably wrong, and the
// detector had no way to be told so.
export const boundaryConstraints = (state) => {
  const nonGla = (state.exteriorLabels ?? []).map((l) => l.bbox);
  const overlapsNonGla = (bbox) => nonGla.some((n) =>
    bbox.x < n.x + n.width && n.x < bbox.x + bbox.width
    && bbox.y < n.y + n.height && n.y < bbox.y + bbox.height);
  return {
    // A garage is inside the drawing but is exactly what the tracer is being
    // asked to carve out, so asserting it as known-inside is wrong input even
    // where it happens not to change the answer (candidates are scored before
    // the carve — see floorplan-image.test.js). Same rule the interior points
    // below have always followed; `rooms` only escaped it while it held the one
    // room the user had clicked.
    rooms: (state.rooms ?? [])
      .filter((r) => r.rect && !roomIsNonGla(r, nonGla))
      .map((r) => ({ name: r.name ?? null, rect: r.rect })),
    interiorPoints: (state.detectedDimensions ?? [])
      .filter((d) => d.bbox && !overlapsNonGla(d.bbox))
      .map((d) => ({
        x: d.bbox.x + d.bbox.width / 2,
        y: d.bbox.y + d.bbox.height / 2,
        name: d.text ?? null,
      })),
  };
};
