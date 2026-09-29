// How a real plan's outlines become truth masks, and how a trace is scored
// against them (lib/realScore.mjs, moved out of realBenchmark.mjs unchanged).
// Synthetic outlines on a blank grid, so it runs without the set.
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import {
  CELL, answerKey, answerKeyFromOutlines, decodeDataUrl, holeRing, scoreTrace, tracedMask,
} from '../realScore.mjs';

const SIZE = { width: 400, height: 300 };
const rect = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const pairs = (ring) => ring.map((p) => [p.x, p.y]);
const count = (mask) => mask.reduce((sum, v) => sum + v, 0);
// Cells a rectangle covers on the truth grid.
const cells = (w, h) => (w / CELL) * (h / CELL);

describe('the answer key of outlines', () => {
  it('puts the building, non-GLA space and undecided space on separate masks', () => {
    const key = answerKey([
      { type: 'gla', vertices: rect(20, 20, 220, 120) },
      { type: 'below-grade', vertices: rect(20, 140, 220, 200) },
      { type: 'garage', vertices: rect(240, 20, 340, 120) },
      { type: 'porch', vertices: rect(240, 140, 340, 200) },
      { type: 'unfinished', vertices: rect(20, 220, 120, 280) },
    ], SIZE);
    expect(key.grid).toEqual({ width: 200, height: 150, cell: CELL });
    expect(key.cells).toBe(cells(200, 100) + cells(200, 60));
    expect(count(key.footprint)).toBe(key.cells);
    expect(count(key.nonGla)).toBe(cells(100, 100) + cells(100, 60));
    expect(count(key.ignore)).toBe(cells(100, 60));
    expect(key.outlines.map((o) => o.type)).toEqual(['gla', 'below-grade', 'garage', 'porch', 'unfinished']);
  });

  it('takes an outline with no type as GLA', () => {
    const key = answerKey([{ vertices: rect(20, 20, 220, 120) }], SIZE);
    expect(key.cells).toBe(cells(200, 100));
    expect(key.outlines[0].type).toBe('gla');
  });

  it('subtracts a hole, in either form it is kept, unless it is stale', () => {
    const hole = rect(100, 60, 140, 100);
    const outer = rect(20, 20, 220, 120);
    expect(holeRing({ ring: hole, stale: false })).toBe(hole);
    expect(holeRing(hole)).toBe(hole);
    expect(answerKey([{ type: 'gla', vertices: outer, holes: [hole] }], SIZE).cells).toBe(cells(200, 100) - cells(40, 40));
    expect(answerKey([{ type: 'gla', vertices: outer, holes: [{ ring: hole }] }], SIZE).cells).toBe(cells(200, 100) - cells(40, 40));
    expect(answerKey([{ type: 'gla', vertices: outer, holes: [{ ring: hole, stale: true }] }], SIZE).cells).toBe(cells(200, 100));
    expect(answerKey([{ type: 'gla', vertices: outer, holes: [[{ x: 1, y: 1 }]] }], SIZE).cells).toBe(cells(200, 100));
  });

  it('has no cells for a plan with nothing to hold a trace against', () => {
    expect(answerKey([{ type: 'garage', vertices: rect(20, 20, 220, 120) }], SIZE).cells).toBe(0);
  });
});

describe('the answer key from an exported key', () => {
  const outer = rect(20, 20, 220, 120);
  const hole = rect(100, 60, 140, 100);

  it('is the same key whether the outlines are the app\'s or exported', () => {
    const app = answerKeyFromOutlines([
      { type: 'gla', closed: true, vertices: outer, holes: [hole] },
      { type: 'garage', closed: true, vertices: rect(240, 20, 340, 120) },
    ], SIZE);
    const exported = answerKeyFromOutlines([
      { type: 'gla', points: pairs(outer), holes: [pairs(hole)] },
      { type: 'garage', points: pairs(rect(240, 20, 340, 120)) },
    ], SIZE);
    expect(exported.cells).toBe(app.cells);
    expect(Buffer.from(exported.footprint).equals(Buffer.from(app.footprint))).toBe(true);
    expect(Buffer.from(exported.nonGla).equals(Buffer.from(app.nonGla))).toBe(true);
    expect(exported.cells).toBe(cells(200, 100) - cells(40, 40));
  });

  it('is the one bench:real builds from the saved outlines', () => {
    const traces = [{ type: 'gla', closed: true, vertices: outer }, { type: 'porch', closed: true, vertices: rect(240, 20, 340, 120) }];
    const direct = answerKey(traces, SIZE);
    const viaKey = answerKeyFromOutlines(traces, SIZE);
    expect(viaKey.grid).toEqual(direct.grid);
    expect(Buffer.from(viaKey.footprint).equals(Buffer.from(direct.footprint))).toBe(true);
    expect(Buffer.from(viaKey.nonGla).equals(Buffer.from(direct.nonGla))).toBe(true);
  });

  it('leaves out an outline that is not closed or has fewer than three points', () => {
    const key = answerKeyFromOutlines([
      { type: 'gla', points: pairs(outer) },
      { type: 'gla', closed: false, vertices: rect(240, 20, 340, 120) },
      { type: 'gla', points: [[1, 1], [2, 2]] },
    ], SIZE);
    expect(key.cells).toBe(cells(200, 100));
    expect(key.outlines).toHaveLength(1);
  });

  it('keeps an app outline only when it is closed, as bench:real does, and an exported one unless it says not', () => {
    const far = rect(240, 20, 340, 120);
    const outlines = [
      { type: 'gla', closed: true, vertices: outer },
      // The app's own shape with no `closed`: bench:real's loader drops it.
      { type: 'gla', vertices: far },
      { type: 'gla', closed: 0, vertices: far },
      // An exported key has no `closed`: keyOf lists closed outlines only.
      { type: 'garage', points: pairs(far) },
      { type: 'porch', closed: false, points: pairs(rect(20, 140, 120, 200)) },
    ];
    const key = answerKeyFromOutlines(outlines, SIZE);
    expect(key.outlines.map((o) => o.type)).toEqual(['gla', 'garage']);
    // The loader as bench:real writes it (realBenchPlan.loadProject) on the app-shaped ones.
    const loaded = answerKey(outlines.slice(0, 3).filter((t) => t.closed && t.vertices?.length >= 3), SIZE);
    expect(count(key.footprint)).toBe(count(loaded.footprint));
    expect(key.cells).toBe(cells(200, 100));
    expect(count(key.nonGla)).toBe(cells(100, 100));
  });

  it('names an outline that is neither shape, instead of failing inside the loop', () => {
    expect(() => answerKeyFromOutlines([null], SIZE)).toThrow(/outline 0 has neither vertices nor points/);
    expect(() => answerKeyFromOutlines([{ type: 'gla', points: pairs(outer) }, { type: 'gla' }], SIZE))
      .toThrow(/outline 1 has neither vertices nor points/);
    expect(() => answerKeyFromOutlines(['gla'], SIZE)).toThrow(/outline 0 has neither/);
    expect(() => answerKeyFromOutlines([{ type: 'gla', points: 'x' }], SIZE)).toThrow(/outline 0 has neither/);
    expect(() => answerKeyFromOutlines([{ type: 'gla', points: [[1, 2], [3, 'a'], [5, 6]] }], SIZE))
      .toThrow(/outline 0 holds a point that is not \[x, y\] or \{x, y\}/);
    expect(() => answerKeyFromOutlines([{ type: 'gla', closed: true, vertices: [{ x: 1 }, { x: 2 }, { x: 3 }] }], SIZE))
      .toThrow(/outline 0 holds a point/);
    expect(answerKeyFromOutlines([], SIZE).cells).toBe(0);
  });
});

describe('scoring a trace', () => {
  const key = () => answerKey([{ type: 'gla', vertices: rect(20, 20, 220, 120) }], SIZE);
  const traced = (ring, quality = { confidence: 0.912345, warnings: [] }) => ({ outer: { polygon: ring }, holes: [], quality });

  it('covers the cells of each floor\'s outer polygon less its holes', () => {
    const truth = key();
    expect(count(tracedMask(traced(rect(20, 20, 220, 120)), truth).mask)).toBe(cells(200, 100));
    const withHole = { outer: { polygon: rect(20, 20, 220, 120) }, holes: [rect(100, 60, 140, 100)] };
    expect(count(tracedMask(withHole, truth).mask)).toBe(cells(200, 100) - cells(40, 40));
    const floors = { floors: [{ outer: { polygon: rect(20, 20, 120, 120) } }, { outer: null }, { outer: { polygon: rect(140, 20, 220, 120) }, holes: [] }] };
    const two = tracedMask(floors, truth);
    expect(two.floors).toHaveLength(2);
    expect(count(two.mask)).toBe(cells(100, 100) + cells(80, 100));
    expect(tracedMask(null, truth).floors).toEqual([]);
  });

  it('calls the trace of the key perfect, and records what the app shows', () => {
    const scored = scoreTrace(traced(rect(20, 20, 220, 120), {
      confidence: 0.912345,
      warnings: [{ code: 'a', severity: 'warn' }, { code: 'a', severity: 'warn' }, { code: 'note', severity: 'info' }, { code: 'b', severity: 'error' }],
    }), key(), 1234);
    expect(scored).toMatchObject({
      verdict: 'perfect', iou: 1, areaErr: 0, floors: 1, confidence: 0.912, warnings: ['a', 'b'], ms: 1234,
    });
    expect(scored.rings).toEqual([[[20, 20], [220, 20], [220, 120], [20, 120]]]);
  });

  it('calls a trace that took in the porch near-perfect and names the cause', () => {
    // A strip thinner than a few cells would be read as the outline sitting on
    // another face of the wall, not as a region to fix.
    const truth = answerKey([
      { type: 'gla', vertices: rect(20, 20, 220, 220) },
      { type: 'porch', vertices: rect(20, 220, 220, 250) },
    ], SIZE);
    const scored = scoreTrace(traced(rect(20, 20, 220, 250)), truth, 1);
    expect(scored.verdict).toBe('near');
    expect(scored.regions[0].cause).toBe('nonGla');
    expect(scored.overNonGla).toBe(0.15);
  });

  it('calls no trace wrong, not perfect', () => {
    const scored = scoreTrace(null, key(), 1);
    expect(scored).toMatchObject({ verdict: 'wrong', floors: 0, confidence: 0, rings: [] });
  });
});

describe('the saved image', () => {
  it('decodes a PNG data URL to its pixels', async () => {
    const png = new PNG({ width: 3, height: 2 });
    png.data.fill(255);
    const url = `data:image/png;base64,${PNG.sync.write(png).toString('base64')}`;
    const image = await decodeDataUrl(url);
    expect([image.width, image.height, image.data.length]).toEqual([3, 2, 24]);
  });

  it('is an error when the project holds none', () => {
    expect(() => decodeDataUrl(undefined)).toThrow(/holds no image/);
    expect(() => decodeDataUrl('not a data url')).toThrow(/holds no image/);
  });
});
