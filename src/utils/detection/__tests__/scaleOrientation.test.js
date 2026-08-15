import { describe, expect, it } from 'vitest';
import { detectRoomFromClickCore } from '../pipeline.js';
import {
  orientDimsToBox, scaleIsotropy, resolveRoomScale, decideProjectScale,
} from '../validate.js';
import { scaleQualitySummary } from '../../boundaryQuality.js';

const createImage = (width, height, value = 255) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
    data[i + 3] = 255;
  }
  return { width, height, data };
};

const fillRect = (img, x0, y0, x1, y1, value = 0) => {
  for (let y = Math.max(0, y0); y <= Math.min(img.height - 1, y1); y += 1) {
    for (let x = Math.max(0, x0); x <= Math.min(img.width - 1, x1); x += 1) {
      const i = (y * img.width + x) * 4;
      img.data[i] = value;
      img.data[i + 1] = value;
      img.data[i + 2] = value;
    }
  }
};

const wall = (img, x0, y0, x1, y1, t = 5) => {
  const h = Math.floor(t / 2);
  if (y0 === y1) fillRect(img, x0, y0 - h, x1, y0 - h + t - 1);
  else fillRect(img, x0 - h, y0, x0 - h + t - 1, y1);
};

describe('orientDimsToBox', () => {
  it('keeps a label that is already the way the room is drawn', () => {
    expect(orientDimsToBox(14, 12, 400, 300)).toEqual({ width: 14, height: 12, swapped: false });
  });

  it('swaps a label read the other way round', () => {
    expect(orientDimsToBox(12, 14, 400, 300)).toEqual({ width: 14, height: 12, swapped: true });
  });

  it('never makes the two scales disagree more than the direct reading would', () => {
    const cases = [
      [12, 14, 400, 300], [14, 12, 400, 300], [10, 11, 300, 290],
      [8, 20, 250, 600], [20, 8, 250, 600], [12.5, 10, 480, 400],
    ];
    for (const [dw, dh, bw, bh] of cases) {
      const direct = scaleIsotropy(dw / bw, dh / bh).logDistance;
      const o = orientDimsToBox(dw, dh, bw, bh);
      expect(scaleIsotropy(o.width / bw, o.height / bh).logDistance).toBeLessThanOrEqual(direct + 1e-12);
    }
  });

  it('leaves a square room and degenerate input alone', () => {
    expect(orientDimsToBox(12, 12, 300, 300).swapped).toBe(false);
    expect(orientDimsToBox(12, 14, 300, 300).swapped).toBe(false);
    expect(orientDimsToBox(0, 14, 400, 300)).toEqual({ width: 0, height: 14, swapped: false });
    expect(orientDimsToBox(NaN, 14, 400, 300).swapped).toBe(false);
  });

  it('is idempotent — orienting an oriented pair changes nothing', () => {
    const once = orientDimsToBox(12, 14, 400, 300);
    const twice = orientDimsToBox(once.width, once.height, 400, 300);
    expect(twice).toEqual({ width: once.width, height: once.height, swapped: false });
  });

  it('does not let a sub-pixel change flip which axis carries which scale', () => {
    // 20x21 on a square-ish overlay: both readings are inside the isotropy
    // tolerance, so the pairing must not turn on the sign of a rounding error.
    expect(orientDimsToBox(20, 21, 300, 300).swapped).toBe(false);
    expect(orientDimsToBox(20, 21, 300, 299.9).swapped).toBe(false);
    expect(orientDimsToBox(20, 21, 299.9, 300).swapped).toBe(false);
  });
});

describe('resolveRoomScale', () => {
  it('returns one scale when the room disagrees with itself', () => {
    const { x, y, resolved } = resolveRoomScale(20, 10, 240, 100);
    expect(resolved).toBe(true);
    expect(x).toBe(y);
    // The geometric mean: the isotropic scale preserving the stated area.
    expect(x).toBeCloseTo(Math.sqrt((20 / 240) * (10 / 100)), 12);
  });

  it('prefers the median of the rooms already measured', () => {
    const samples = [0.05, 0.05, 0.051, 0.049, 0.05];
    const { x, y } = resolveRoomScale(20, 10, 240, 100, samples);
    expect(x).toBe(y);
    expect(x).toBeCloseTo(0.05, 3);
  });

  it('leaves a room that agrees with itself alone', () => {
    const { x, y, resolved } = resolveRoomScale(16, 12, 400, 300);
    expect(resolved).toBe(false);
    expect(x).toBeCloseTo(0.04, 12);
    expect(y).toBeCloseTo(0.04, 12);
  });

  it('gives the same answer either way the label is written', () => {
    const a = resolveRoomScale(16, 12, 400, 300);
    const b = resolveRoomScale(12, 16, 400, 300);
    expect(b.x).toBeCloseTo(a.x, 12);
    expect(b.y).toBeCloseTo(a.y, 12);
  });
});

describe('decideProjectScale', () => {
  // 0.04 ft/px = 25 px/ft. Three rooms measured at that scale.
  const settled = [0.04, 0.04, 0.0405, 0.0398, 0.0402, 0.0401];

  it('says nothing when the room agrees with itself and with the others', () => {
    const d = decideProjectScale({
      dimWidth: 16, dimHeight: 12, boxWidth: 400, boxHeight: 300, otherSamples: settled,
    });
    expect(d.level).toBe('ok');
    expect(d.adopted).toBe(true);
    expect(d.scale.x).toBeCloseTo(0.04, 6);
    expect(scaleQualitySummary(d)).toBeNull();
  });

  it('notes a small internal disagreement without alarm', () => {
    // 8% apart: normal for nominal printed dimensions.
    const d = decideProjectScale({
      dimWidth: 16, dimHeight: 13, boxWidth: 400, boxHeight: 300,
    });
    expect(d.level).toBe('note');
    expect(d.reason).toBe('room-internal');
    expect(scaleQualitySummary(d).level).toBe('note');
  });

  it('warns when a room’s outline and label disagree outright', () => {
    // 34% apart: one of the two is simply wrong.
    const d = decideProjectScale({
      dimWidth: 16, dimHeight: 12, boxWidth: 400, boxHeight: 400,
    });
    expect(d.level).toBe('check');
    expect(d.reason).toBe('room-internal');
    expect(d.scale.x).toBe(d.scale.y);
    expect(scaleQualitySummary(d).short).toMatch(/off by ~3\d%/);
  });

  it('refuses to rescale the project from one contradicting room', () => {
    // Same 400x300 rectangle, but a label read from the room next door.
    const d = decideProjectScale({
      dimWidth: 24, dimHeight: 18, boxWidth: 400, boxHeight: 300, otherSamples: settled,
    });
    expect(d.adopted).toBe(false);
    expect(d.level).toBe('check');
    expect(d.reason).toBe('room-vs-project');
    expect(d.scale.x).toBeCloseTo(0.04, 3); // the settled rooms still rule
    expect(d.roomCount).toBe(3);
    expect(scaleQualitySummary(d).short).toMatch(/Kept the scale/);
  });

  it('takes the new room when only one earlier room disagrees', () => {
    const d = decideProjectScale({
      dimWidth: 24, dimHeight: 18, boxWidth: 400, boxHeight: 300, otherSamples: [0.04, 0.04],
    });
    expect(d.adopted).toBe(true);
    expect(d.level).toBe('check');
    expect(d.reason).toBe('room-vs-project');
    expect(d.scale.x).toBeCloseTo(0.06, 6);
    expect(scaleQualitySummary(d).short).toMatch(/disagrees with the last one/);
  });

  it('accepts a room inside the plan’s natural room-to-room spread', () => {
    // 13.97-16.36 px/ft across one real plan: 15% apart is the drawing being
    // normal, not a room being wrong.
    const d = decideProjectScale({
      dimWidth: 16, dimHeight: 12, boxWidth: 348, boxHeight: 261, otherSamples: settled,
    });
    expect(d.adopted).toBe(true);
    expect(d.level).toBe('ok');
  });

  it('has nothing to compare against for the first room', () => {
    const d = decideProjectScale({
      dimWidth: 16, dimHeight: 12, boxWidth: 400, boxHeight: 300,
    });
    expect(d.level).toBe('ok');
    expect(d.projectScale).toBeNull();
    expect(d.roomCount).toBe(0);
  });
});

describe('room scale from a transposed label', () => {
  // Walls on a 400x300 centreline path at thickness 8, so the interior the
  // room detector should report is 392x292 — a rect that measured 400x300
  // would be sitting on the wall centrelines, not on their faces.
  // Labelled 12 x 16: the 16 runs across the page, so the label reads the
  // other way round from how the room is drawn.
  const room = () => {
    const img = createImage(600, 500);
    wall(img, 50, 50, 450, 50, 8);
    wall(img, 50, 350, 450, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    wall(img, 450, 50, 450, 350, 8);
    return img;
  };

  it('implies one scale, not two', () => {
    const detected = detectRoomFromClickCore(room(), { x: 250, y: 200 }, {
      labelDims: { width: 12, height: 16 },
    });
    expect(detected).toBeTruthy();
    const ppf = detected.pixelsPerFoot;
    // Not exactly equal: the rect is whole working-scale pixels.
    expect(scaleIsotropy(1 / ppf.x, 1 / ppf.y).ok).toBe(true);
    expect(detected.overlay.x2 - detected.overlay.x1).toBeCloseTo(392, -1);
    expect(detected.overlay.y2 - detected.overlay.y1).toBeCloseTo(292, -1);
  });

  it('agrees with the same label written the other way round', () => {
    const asDrawn = detectRoomFromClickCore(room(), { x: 250, y: 200 }, {
      labelDims: { width: 16, height: 12 },
    });
    const transposed = detectRoomFromClickCore(room(), { x: 250, y: 200 }, {
      labelDims: { width: 12, height: 16 },
    });
    // Same walls, same room: the label's reading order must not move an edge.
    expect(transposed.overlay).toEqual(asDrawn.overlay);
    expect(transposed.pixelsPerFoot.x).toBeCloseTo(asDrawn.pixelsPerFoot.x, 6);
    expect(transposed.pixelsPerFoot.y).toBeCloseTo(asDrawn.pixelsPerFoot.y, 6);
  });

  // Every real room has a door, and a wall with a door in it reads well short
  // of solid — which is why the fully-walled case above passed while the open
  // plan rescue was still cutting doored rooms down to a transposed label.
  it('does not invent a wall in a room whose walls have a door gap', () => {
    const doorRoom = () => {
      const img = createImage(600, 500);
      wall(img, 50, 50, 450, 50, 8);
      wall(img, 50, 350, 450, 350, 8);
      wall(img, 50, 50, 50, 350, 8);
      wall(img, 450, 50, 450, 170, 8);
      wall(img, 450, 230, 450, 350, 8);
      return img;
    };
    const click = { x: 150, y: 200 };
    const asDrawn = detectRoomFromClickCore(doorRoom(), click, {
      labelDims: { width: 16, height: 12 },
    });
    const transposed = detectRoomFromClickCore(doorRoom(), click, {
      labelDims: { width: 12, height: 16 },
    });
    expect(transposed.overlay).toEqual(asDrawn.overlay);
    expect(transposed.sides.right.kind).not.toBe('virtual');
    // The whole room (~393px between wall faces), not the ~226px the
    // transposed aspect would have cut it to.
    expect(transposed.overlay.x2 - transposed.overlay.x1).toBeGreaterThan(380);
    expect(scaleIsotropy(1 / transposed.pixelsPerFoot.x, 1 / transposed.pixelsPerFoot.y).ok)
      .toBe(true);
  });
});
