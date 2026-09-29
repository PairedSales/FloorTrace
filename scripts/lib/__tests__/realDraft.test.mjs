// A draft made the way the app's scan leaves a plan (scripts/lib/realDraft.mjs):
// the rooms that agree set the scale, the trace runs with them as evidence, the
// draft opens in the app, and an image that is not the one its key was drawn
// on is refused. The labels are the fixture's own, so no OCR runs here.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { beforeAll, describe, expect, it } from 'vitest';
import { importProject } from '../../../src/utils/projectSerializer.js';
import { loadPng } from '../benchUtils.mjs';
import { draftProject, loadSource, planState } from '../realDraft.mjs';
import { keyOf } from '../realKeys.mjs';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/', import.meta.url));
const FILE = path.join(FIXTURES, 'ExampleFloorplan8.png');
const truth = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'ExampleFloorplan8.truth.json'), 'utf8'));

// The fixture's printed room sizes, as a scan reports them.
const scan = {
  dimensions: truth.rooms.map((r) => ({
    width: r.dims[0],
    height: r.dims[1],
    text: r.name,
    format: 'inches',
    bbox: { x: r.labelBbox[0], y: r.labelBbox[1], width: r.labelBbox[2], height: r.labelBbox[3] },
  })),
  exteriorLabels: [],
  areaLabels: [],
  detectedFormat: 'inches',
  truncated: 0,
};

describe('a draft plan', () => {
  let state;
  beforeAll(() => {
    state = planState(loadPng(FILE), scan, { at: 1 });
  });

  it('is scaled by the rooms that agree and traced with them as evidence', () => {
    expect(state.rooms.length).toBeGreaterThan(0);
    const pixelsPerFoot = 1 / state.calibration.feetPerPixel.x;
    expect(Math.abs(Math.log(pixelsPerFoot / truth.scale.pixelsPerFoot))).toBeLessThan(truth.scale.tolerance);
    expect(state.calibration.quality.source).toBe('auto');
    expect(state.perimeterTraces).toHaveLength(1);
    expect(state.lastTraceOutcome).toMatchObject({ floors: 1, level: expect.any(String) });
    // Still the app's own trace: a draft is not an answer.
    expect(keyOf(state)).toBeNull();
  });

  it('opens in the app', () => {
    const project = draftProject({ name: 'example8', mime: 'image/png', bytes: fs.readFileSync(FILE), state });
    expect(() => importProject(JSON.stringify(project))).not.toThrow();
  });

  it('refuses an image other than the one its key was drawn on', async () => {
    await expect(loadSource({ file: 'ExampleFloorplan8.png', size: [600, 371] }, FIXTURES))
      .rejects.toThrow(/600x370/);
    const cropped = await loadSource({ file: 'ExampleFloorplan8.png', crop: [20, 26, 300, 200], size: [300, 200] }, FIXTURES);
    expect([cropped.image.width, cropped.image.height]).toEqual([300, 200]);
  });

  it('is held as the app holds it, and records the size it came out', async () => {
    // A crop keeps the plan's own type, as the app's crop tool does.
    const cropped = await loadSource({ file: 'ExampleFloorplan8.png', crop: [20, 26, 300, 200] }, FIXTURES);
    expect(cropped.mime).toBe('image/png');
    expect(cropped.source).toEqual({ file: 'ExampleFloorplan8.png', crop: [20, 26, 300, 200], size: [300, 200] });

    // A side over the app's cap is scaled to fit, and held as PNG.
    const canvas = await import('@napi-rs/canvas');
    const file = path.join(os.tmpdir(), `realDraft-wide-${process.pid}.jpg`);
    fs.writeFileSync(file, await canvas.createCanvas(4200, 300).encode('jpeg', 92));
    try {
      const fitted = await loadSource({ file }, FIXTURES);
      expect([fitted.image.width, fitted.image.height]).toEqual([4000, 286]);
      expect(fitted.mime).toBe('image/png');
      expect(fitted.source.size).toEqual([4000, 286]);
    } finally {
      fs.rmSync(file, { force: true });
    }
  });
});
