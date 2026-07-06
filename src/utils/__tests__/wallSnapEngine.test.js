import { describe, it, expect } from 'vitest';
import { extractWallSegments, findSegmentSnap } from '../wallSnapEngine';

const W = 300;
const H = 300;
const OPTS = { minRun: 14, maxThickness: 24, bridgeGap: 40 };

const makeMask = () => new Uint8Array(W * H);

const drawVLine = (mask, x, y1, y2, thick = 2) => {
  for (let y = y1; y <= y2; y += 1) {
    for (let t = 0; t < thick; t += 1) mask[y * W + x + t] = 1;
  }
};

const drawHLine = (mask, y, x1, x2, thick = 2) => {
  for (let t = 0; t < thick; t += 1) {
    for (let x = x1; x <= x2; x += 1) mask[(y + t) * W + x] = 1;
  }
};

const fillRect = (mask, x1, y1, x2, y2) => {
  for (let y = y1; y <= y2; y += 1) {
    for (let x = x1; x <= x2; x += 1) mask[y * W + x] = 1;
  }
};

describe('extractWallSegments', () => {
  it('extracts a vertical wall with its faces and bridges a door-sized gap', () => {
    const mask = makeMask();
    drawVLine(mask, 100, 40, 140, 3);
    drawVLine(mask, 100, 170, 260, 3);

    const { vertical } = extractWallSegments(mask, W, H, OPTS);
    expect(vertical).toHaveLength(1);
    expect(vertical[0].faceLo).toBe(100);
    expect(vertical[0].faceHi).toBe(102);
    expect(vertical[0].lo).toBe(40);
    expect(vertical[0].hi).toBe(260);
  });

  it('extracts horizontal walls independently of vertical ones', () => {
    const mask = makeMask();
    drawVLine(mask, 100, 40, 260);
    drawHLine(mask, 200, 20, 280);

    const { vertical, horizontal } = extractWallSegments(mask, W, H, OPTS);
    expect(vertical).toHaveLength(1);
    expect(horizontal).toHaveLength(1);
    expect(horizontal[0].faceLo).toBe(200);
    expect(horizontal[0].faceHi).toBe(201);
    expect(horizontal[0].lo).toBe(20);
    expect(horizontal[0].hi).toBe(280);
  });

  it('keeps distinct parallel walls separate', () => {
    const mask = makeMask();
    drawVLine(mask, 100, 40, 260);
    drawVLine(mask, 150, 40, 260);

    const { vertical } = extractWallSegments(mask, W, H, OPTS);
    expect(vertical).toHaveLength(2);
    expect(vertical[0].faceLo).toBe(100);
    expect(vertical[1].faceLo).toBe(150);
  });

  it('ignores text-sized strokes and filled regions', () => {
    const mask = makeMask();
    fillRect(mask, 50, 50, 59, 59); // text-sized blob: runs shorter than minRun
    fillRect(mask, 180, 180, 250, 250); // filled block: wider than maxThickness

    const { vertical, horizontal } = extractWallSegments(mask, W, H, OPTS);
    expect(vertical).toHaveLength(0);
    expect(horizontal).toHaveLength(0);
  });

  it('does not bridge collinear walls separated by more than the gap limit', () => {
    const mask = makeMask();
    drawVLine(mask, 100, 20, 100);
    drawVLine(mask, 100, 200, 280);

    const { vertical } = extractWallSegments(mask, W, H, OPTS);
    expect(vertical).toHaveLength(2);
  });
});

describe('findSegmentSnap', () => {
  // A 4px-thick wall band: faces at 100 and 103.
  const segments = [{ faceLo: 100, faceHi: 103, lo: 40, hi: 260, thick: 4, weight: 880 }];

  it('snaps to the requested face, never the centerline', () => {
    expect(findSegmentSnap(segments, 106, 50, 250, 12, 'lo')).toBe(100);
    expect(findSegmentSnap(segments, 106, 50, 250, 12, 'hi')).toBe(103);
    expect(findSegmentSnap(segments, 97, 50, 250, 12, 'hi')).toBe(103);
  });

  it('measures tolerance against the requested face', () => {
    // 13px from faceLo but 10px from faceHi
    expect(findSegmentSnap(segments, 113, 50, 250, 12, 'lo')).toBeNull();
    expect(findSegmentSnap(segments, 113, 50, 250, 12, 'hi')).toBe(103);
  });

  it('returns null beyond tolerance', () => {
    expect(findSegmentSnap(segments, 120, 50, 250, 12, 'lo')).toBeNull();
  });

  it('returns null when the edge span misses the segment', () => {
    expect(findSegmentSnap(segments, 100, 300, 400, 12, 'lo')).toBeNull();
  });

  it('returns null when overlap is too small a share of both edge and segment', () => {
    expect(findSegmentSnap(segments, 100, 250, 800, 12, 'lo')).toBeNull();
  });

  it('accepts a reversed span', () => {
    expect(findSegmentSnap(segments, 95, 250, 50, 12, 'hi')).toBe(103);
  });

  it('prefers the nearest of several candidate walls', () => {
    const two = [
      { faceLo: 99, faceHi: 101, lo: 40, hi: 260, thick: 3, weight: 440 },
      { faceLo: 109, faceHi: 111, lo: 40, hi: 260, thick: 3, weight: 440 },
    ];
    expect(findSegmentSnap(two, 107, 50, 250, 12, 'lo')).toBe(109);
    expect(findSegmentSnap(two, 103, 50, 250, 12, 'lo')).toBe(99);
  });
});
