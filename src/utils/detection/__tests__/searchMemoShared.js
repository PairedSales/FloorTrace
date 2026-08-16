// Shared fixtures and comparison helper for the search-memo suites.
//
// Not a `.test.js`, so vitest does not collect it. The memo suites live in
// three files rather than one because vitest's worker->host RPC has a 60 s
// timeout (`DEFAULT_TIMEOUT = 6e4` in its birpc setup): a single file whose
// tests total ~55 s runs right at that edge and intermittently fails the build
// with `Timeout calling "onTaskUpdate"` and every test passing. Files run in
// separate workers, so splitting keeps each one far below the window without
// dropping a single case.

import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';

export const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');

export const loadPng = (filePath) => {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  return { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };
};

// Everything a caller can observe about a trace's geometry. Deliberately not a
// tolerance comparison: warm and cold run the same code over the same rasters,
// so any difference at all is a memo bug.
export const geometryOf = (result) => ({
  outer: result.outer?.polygon ?? null,
  inner: result.inner?.polygon ?? null,
  holes: result.holes ?? [],
  innerHoles: result.innerHoles ?? [],
  excludedRegions: result.excludedRegions,
  excludedGarages: result.excludedGarages,
  floors: (result.floors ?? []).map((f) => ({
    outer: f.outer?.polygon ?? null,
    inner: f.inner?.polygon ?? null,
    holes: f.holes,
    innerHoles: f.innerHoles,
    confidence: f.confidence,
    excluded: f.excluded,
    excludedGarages: f.excludedGarages,
    candidate: f.candidate,
  })),
  quality: {
    confidence: result.quality.confidence,
    usedFallback: result.quality.usedFallback,
    source: result.quality.source,
    floorCount: result.quality.floorCount,
    candidate: result.quality.candidate,
    areaPx: result.quality.areaPx,
    warnings: result.quality.warnings.map((w) => ({ code: w.code, severity: w.severity })),
  },
});

export const FIXTURES = [
  'ExampleFloorplan.png',
  'ExampleFloorplan2.png',
  'ExampleFloorplan4.png',
  'ExampleFloorplan5.png',
  'ExampleFloorplan7.png',
];

export const loadFixtures = (names = FIXTURES) => {
  const images = new Map();
  for (const name of names) images.set(name, loadPng(path.join(ROOT, 'fixtures', name)));
  return images;
};
