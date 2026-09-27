// What the binarizer calls ink when a plan's dark class is too large to be
// line work. The fill-aware split sets a mid tone aside as tinted room fill;
// on a plan whose walls are drawn in that tone it set the walls aside, and the
// tracer found nothing but fixtures (CubiCasa5K: 38 of 48 listing plans the
// split fired on). Built so the split fires in both cases here: a mid tone
// covering more than 14% of the page, with black line work under it.
import { describe, expect, it } from 'vitest';
import { binarizeToWorkingScale } from '../raster.js';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import {
  createImage, fillRect, wall, wallRect, outerFaceRect, polygonIou,
} from './synthetic.js';

// A drawn tone is never one grey, and a rendered edge is anti-aliased. With
// flat levels and hard edges the histogram has gaps, Otsu lands its threshold
// on a level itself, and that level reads as the class above it — black at
// exactly 0 leaves nothing below the split, and a grey at the top of its class
// is pocked with holes. So each tone gets a spread, and a 3x3 box blur gives
// the edges the in-between tones a renderer does.
const spread = (img, value, width) => {
  for (let i = 0, p = 0; i < img.data.length; i += 4, p += 1) {
    if (img.data[i] !== value) continue;
    const v = value + ((p % img.width) * 7 + ((p / img.width) | 0) * 13) % width;
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
  }
};

const soften = (img) => {
  const { width, height, data } = img;
  const src = new Uint8ClampedArray(width * height);
  for (let p = 0; p < src.length; p += 1) src[p] = data[p * 4];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let sum = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const xx = x + dx;
          const yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
          sum += src[yy * width + xx];
          count += 1;
        }
      }
      const i = (y * width + x) * 4;
      data[i] = Math.round(sum / count);
      data[i + 1] = data[i];
      data[i + 2] = data[i];
    }
  }
  return img;
};

// Black fixtures inside the rooms: the line work the split keeps.
const fixtures = (img) => {
  for (const [x, y] of [[250, 250], [450, 100], [600, 420], [110, 420], [420, 380]]) {
    fillRect(img, x, y, x + 40, y + 25, 1);
  }
  spread(img, 1, 30);
};

// Twelve rooms behind 16 px walls on a 740 px page, about 2% of it — the
// proportion of the green and grey walls on the CubiCasa plans this was found
// on — drawn in a grey the split sets aside.
const greyWalledHouse = () => {
  const img = createImage(740, 540);
  const t = 16;
  for (const y of [20, 180, 340, 520]) wall(img, 20, y, 720, y, t, 100);
  for (const x of [20, 195, 370, 545, 720]) wall(img, x, 20, x, 520, t, 100);
  spread(img, 100, 20);
  fixtures(img);
  return { img: soften(img), truth: outerFaceRect(20, 20, 720, 520, t) };
};

const tintedRoomsHouse = () => {
  const img = createImage(740, 540);
  fillRect(img, 30, 30, 365, 510, 190);
  fillRect(img, 375, 30, 710, 510, 190);
  spread(img, 190, 20);
  wallRect(img, 20, 20, 720, 520, 10, 1);
  wall(img, 370, 20, 370, 520, 10, 1);
  fixtures(img);
  return { img: soften(img), truth: outerFaceRect(20, 20, 720, 520, 10) };
};

const inkAt = (scaled, x, y) => scaled.ink[y * scaled.width + x];

describe('a plan whose dark class is too large to be line work', () => {
  it('keeps walls drawn in the tone the fill-aware split sets aside', () => {
    const scaled = binarizeToWorkingScale(greyWalledHouse().img);
    expect(inkAt(scaled, 100, 20)).toBe(1);
    expect(inkAt(scaled, 370, 300)).toBe(1);
    expect(inkAt(scaled, 100, 100)).toBe(0);
  });

  it('traces the house those walls draw', () => {
    const { img, truth } = greyWalledHouse();
    const traced = traceFloorplanBoundaryCore(img);
    expect(polygonIou(traced.outer.polygon, truth)).toBeGreaterThan(0.95);
  });

  it('still sets tinted room fills aside', () => {
    const scaled = binarizeToWorkingScale(tintedRoomsHouse().img);
    expect(inkAt(scaled, 200, 150)).toBe(0);
    expect(inkAt(scaled, 550, 300)).toBe(0);
    expect(inkAt(scaled, 20, 150)).toBe(1);
  });
});
