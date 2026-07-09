import { describe, expect, it } from 'vitest';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore, boundaryByMode } from '../pipeline.js';
import { rectilinearFit, polygonArea, polygonBounds } from '../polygon.js';

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

// Wall segment of a given thickness: horizontal if y0 === y1, else vertical.
const wall = (img, x0, y0, x1, y1, t = 5) => {
  const h = Math.floor(t / 2);
  if (y0 === y1) fillRect(img, x0, y0 - h, x1, y0 - h + t - 1);
  else fillRect(img, x0 - h, y0, x0 - h + t - 1, y1);
};

const bboxOf = (result) => [result.overlay.x1, result.overlay.y1, result.overlay.x2, result.overlay.y2];

describe('traceFloorplanBoundaryCore', () => {
  it('traces a simple rectangle at the outer wall face and insets the inner envelope', () => {
    const img = createImage(500, 400);
    wall(img, 50, 50, 450, 50, 10);
    wall(img, 50, 350, 450, 350, 10);
    wall(img, 50, 50, 50, 350, 10);
    wall(img, 450, 50, 450, 350, 10);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.outer).toBeTruthy();
    expect(traced?.inner).toBeTruthy();

    const ob = polygonBounds(traced.outer.polygon);
    // Outer face of a 10px wall centred on the drawn lines: ~45 / ~455.
    expect(ob.minX).toBeLessThanOrEqual(48);
    expect(ob.maxX).toBeGreaterThanOrEqual(452);
    expect(ob.minY).toBeLessThanOrEqual(48);
    expect(ob.maxY).toBeGreaterThanOrEqual(352);

    const ib = polygonBounds(traced.inner.polygon);
    expect(ib.minX).toBeGreaterThan(ob.minX + 5);
    expect(ib.maxX).toBeLessThan(ob.maxX - 5);
    expect(polygonArea(traced.inner.polygon)).toBeLessThan(polygonArea(traced.outer.polygon));
  });

  it('seals door gaps in the exterior wall instead of leaking', () => {
    const img = createImage(500, 400);
    wall(img, 50, 50, 450, 50, 8);
    wall(img, 50, 350, 450, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    // Right wall with a 36px entry-door gap.
    wall(img, 450, 50, 450, 180, 8);
    wall(img, 450, 216, 450, 350, 8);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.outer).toBeTruthy();
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxX).toBeGreaterThanOrEqual(448);
    // Footprint area must cover the enclosure, not just wall slivers.
    expect(polygonArea(traced.outer.polygon)).toBeGreaterThan(380 * 280);
  });

  it('preserves concave corners on L-shaped footprints', () => {
    const img = createImage(500, 400);
    wall(img, 60, 40, 440, 40, 6);      // top
    wall(img, 440, 40, 440, 200, 6);    // right upper
    wall(img, 240, 200, 440, 200, 6);   // step in
    wall(img, 240, 200, 240, 360, 6);   // step down
    wall(img, 60, 360, 240, 360, 6);    // bottom
    wall(img, 60, 40, 60, 360, 6);      // left

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.outer).toBeTruthy();
    const area = polygonArea(traced.outer.polygon);
    const b = polygonBounds(traced.outer.polygon);
    const bboxArea = (b.maxX - b.minX) * (b.maxY - b.minY);
    expect(area).toBeLessThan(bboxArea * 0.85); // concavity kept
    expect(area).toBeGreaterThan(bboxArea * 0.4);
  });

  it('handles double-line walls with sparse cross ties', () => {
    const img = createImage(500, 400);
    wall(img, 50, 50, 450, 50, 4);
    wall(img, 50, 350, 450, 350, 4);
    wall(img, 50, 50, 50, 350, 4);
    // Right wall drawn as two parallel thin lines plus cross ties.
    wall(img, 430, 50, 430, 350, 2);
    wall(img, 450, 50, 450, 350, 2);
    for (let y = 80; y < 350; y += 60) wall(img, 430, y, 450, y, 2);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.outer).toBeTruthy();
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxX).toBeGreaterThanOrEqual(448); // outer line, not inner
  });

  it('handles 1px-thin walls', () => {
    const img = createImage(400, 300);
    wall(img, 40, 40, 360, 40, 1);
    wall(img, 40, 260, 360, 260, 1);
    wall(img, 40, 40, 40, 260, 1);
    wall(img, 360, 40, 360, 260, 1);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.outer).toBeTruthy();
    const b = polygonBounds(traced.outer.polygon);
    expect(b.minX).toBeLessThanOrEqual(42);
    expect(b.maxX).toBeGreaterThanOrEqual(358);
  });

  it('returns null for a blank image', () => {
    expect(traceFloorplanBoundaryCore(createImage(300, 200))).toBeNull();
  });
});

describe('traceFloorplanBoundaryCore excludeRegions (porch carving)', () => {
  // House (50..450 x 50..250, 8px walls) with a full-width porch attached
  // below it (thin 4px railing walls down to y=380). The house bottom wall at
  // y=250 is the shared exterior wall.
  const houseWithPorch = () => {
    const img = createImage(500, 460);
    wall(img, 50, 50, 450, 50, 8);
    wall(img, 50, 50, 50, 250, 8);
    wall(img, 450, 50, 450, 250, 8);
    wall(img, 50, 250, 450, 250, 8);
    wall(img, 60, 250, 60, 380, 4);
    wall(img, 440, 250, 440, 380, 4);
    wall(img, 60, 380, 440, 380, 4);
    return img;
  };

  it('carves a labelled porch and stops at the shared house wall', () => {
    const traced = traceFloorplanBoundaryCore(houseWithPorch(), {
      excludeRegions: [{ x: 210, y: 300, width: 80, height: 20 }],
    });
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(1);
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxY).toBeLessThanOrEqual(262); // outer face of the shared wall
    expect(b.maxY).toBeGreaterThanOrEqual(244);
    expect(b.minY).toBeLessThanOrEqual(48);  // rest of the house untouched
    expect(b.maxX).toBeGreaterThanOrEqual(450);
  });

  it('keeps the porch when no exclude region is given', () => {
    const traced = traceFloorplanBoundaryCore(houseWithPorch());
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxY).toBeGreaterThanOrEqual(375);
  });

  it('ignores an exclude region outside any enclosed cavity', () => {
    const traced = traceFloorplanBoundaryCore(houseWithPorch(), {
      excludeRegions: [{ x: 10, y: 420, width: 60, height: 20 }],
    });
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxY).toBeGreaterThanOrEqual(375);
  });

  it('refuses to carve when the label lands in the main interior', () => {
    const traced = traceFloorplanBoundaryCore(houseWithPorch(), {
      excludeRegions: [{ x: 200, y: 140, width: 100, height: 30 }],
    });
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxY).toBeGreaterThanOrEqual(375);
  });

  it('carves multiple exterior features independently', () => {
    // Add a balcony on the right side of the house as well.
    const img = createImage(620, 460);
    wall(img, 50, 50, 450, 50, 8);
    wall(img, 50, 50, 50, 250, 8);
    wall(img, 450, 50, 450, 250, 8);
    wall(img, 50, 250, 450, 250, 8);
    wall(img, 60, 250, 60, 380, 4);   // porch below
    wall(img, 440, 250, 440, 380, 4);
    wall(img, 60, 380, 440, 380, 4);
    wall(img, 450, 70, 580, 70, 4);   // balcony right
    wall(img, 580, 70, 580, 220, 4);
    wall(img, 450, 220, 580, 220, 4);

    const traced = traceFloorplanBoundaryCore(img, {
      excludeRegions: [
        { x: 210, y: 300, width: 80, height: 20 },
        { x: 490, y: 130, width: 60, height: 16 },
      ],
    });
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(2);
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxY).toBeLessThanOrEqual(262);
    expect(b.maxX).toBeLessThanOrEqual(462);
  });

  it('maps exclude regions from original px when downscaled', () => {
    const img = createImage(3000, 2760);
    wall(img, 300, 300, 2700, 300, 24);
    wall(img, 300, 300, 300, 1500, 24);
    wall(img, 2700, 300, 2700, 1500, 24);
    wall(img, 300, 1500, 2700, 1500, 24);
    wall(img, 360, 1500, 360, 2280, 12);
    wall(img, 2640, 1500, 2640, 2280, 12);
    wall(img, 360, 2280, 2640, 2280, 12);

    const traced = traceFloorplanBoundaryCore(img, {
      preprocess: { maxDimension: 1000 },
      excludeRegions: [{ x: 1260, y: 1800, width: 480, height: 120 }],
    });
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(1);
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxY).toBeLessThanOrEqual(1600);
    expect(b.maxY).toBeGreaterThanOrEqual(1450);
  });
});

describe('traceFloorplanBoundaryCore geometric garage exclusion', () => {
  // House (50..450 x 50..350, 10px walls) with a garage wing attached on the
  // right (450..640 x 150..330): real walls on top/bottom, shared house wall
  // on the left, and the garage door drawn as a 2px stroke at x=640.
  const houseWithGarage = (doorThickness = 2) => {
    const img = createImage(700, 460);
    wall(img, 50, 50, 450, 50, 10);
    wall(img, 50, 350, 450, 350, 10);
    wall(img, 50, 50, 50, 350, 10);
    wall(img, 450, 50, 450, 350, 10);
    wall(img, 450, 150, 640, 150, 10);
    wall(img, 450, 330, 640, 330, 10);
    wall(img, 640, 150, 640, 330, doorThickness);
    return img;
  };

  it('carves the garage with no OCR label at all', () => {
    const traced = traceFloorplanBoundaryCore(houseWithGarage());
    expect(traced?.outer).toBeTruthy();
    expect(traced.excludedRegions).toBe(1);
    expect(traced.excludedGarages).toBe(1);
    const b = polygonBounds(traced.outer.polygon);
    expect(b.maxX).toBeLessThanOrEqual(470); // stops at the shared house wall
    expect(b.maxX).toBeGreaterThanOrEqual(448);
    expect(b.minX).toBeLessThanOrEqual(48);  // rest of the house untouched
  });

  it('keeps the garage when autoGarage is disabled', () => {
    const traced = traceFloorplanBoundaryCore(houseWithGarage(), {
      boundary: { autoGarage: false },
    });
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxX).toBeGreaterThanOrEqual(635);
  });

  it('does not treat a fully-walled wing as a garage', () => {
    const traced = traceFloorplanBoundaryCore(houseWithGarage(10));
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxX).toBeGreaterThanOrEqual(635);
  });

  it('carves a fully-walled wing from a garage OCR label instead', () => {
    const traced = traceFloorplanBoundaryCore(houseWithGarage(10), {
      excludeRegions: [{ x: 510, y: 230, width: 70, height: 18, keyword: 'garage' }],
    });
    expect(traced.excludedRegions).toBe(1);
    expect(traced.excludedGarages).toBe(1);
    expect(polygonBounds(traced.outer.polygon).maxX).toBeLessThanOrEqual(470);
  });

  it('does not fire on a porch ringed by thin railings', () => {
    // Same wing but every non-shared side is a thin railing stroke.
    const img = createImage(700, 460);
    wall(img, 50, 50, 450, 50, 10);
    wall(img, 50, 350, 450, 350, 10);
    wall(img, 50, 50, 50, 350, 10);
    wall(img, 450, 50, 450, 350, 10);
    wall(img, 450, 150, 640, 150, 2);
    wall(img, 450, 330, 640, 330, 2);
    wall(img, 640, 150, 640, 330, 2);
    const traced = traceFloorplanBoundaryCore(img);
    expect(traced.excludedRegions).toBe(0);
    expect(polygonBounds(traced.outer.polygon).maxX).toBeGreaterThanOrEqual(635);
  });
});

describe('traceFloorplanBoundaryCore multi-floor', () => {
  // Two disconnected floor outlines on one page (1st/2nd floor sheet). The
  // left floor (370x320 outline) is larger than the right (390x260).
  const twoFloorPlan = () => {
    const img = createImage(1000, 420);
    wall(img, 50, 50, 420, 50, 8);
    wall(img, 50, 370, 420, 370, 8);
    wall(img, 50, 50, 50, 370, 8);
    wall(img, 420, 50, 420, 370, 8);
    wall(img, 560, 80, 950, 80, 8);
    wall(img, 560, 340, 950, 340, 8);
    wall(img, 560, 80, 560, 340, 8);
    wall(img, 950, 80, 950, 340, 8);
    return img;
  };

  it('traces both disconnected floors, left to right', () => {
    const traced = traceFloorplanBoundaryCore(twoFloorPlan());
    expect(traced?.floors?.length).toBe(2);

    const [left, right] = traced.floors;
    expect(left.outer).toBeTruthy();
    expect(right.outer).toBeTruthy();
    const lb = polygonBounds(left.outer.polygon);
    const rb = polygonBounds(right.outer.polygon);
    expect(lb.maxX).toBeLessThan(500);
    expect(rb.minX).toBeGreaterThan(500);

    // Each floor also gets its own inner envelope.
    expect(left.inner).toBeTruthy();
    expect(right.inner).toBeTruthy();
    expect(polygonArea(left.inner.polygon)).toBeLessThan(polygonArea(left.outer.polygon));

    // Top-level boundary stays the largest floor for single-boundary callers.
    expect(traced.outer.polygon).toEqual(left.outer.polygon);
  });

  it('reports a single floor for a single-outline plan', () => {
    const img = createImage(500, 400);
    wall(img, 50, 50, 450, 50, 10);
    wall(img, 50, 350, 450, 350, 10);
    wall(img, 50, 50, 50, 350, 10);
    wall(img, 450, 50, 450, 350, 10);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.floors?.length).toBe(1);
    expect(traced.floors[0].outer.polygon).toEqual(traced.outer.polygon);
  });

  it('does not promote small sealed boxes (legends) to floors', () => {
    const img = createImage(700, 400);
    wall(img, 50, 50, 450, 50, 8);
    wall(img, 50, 350, 450, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    wall(img, 450, 50, 450, 350, 8);
    // Small sealed legend box far from the floor outline.
    wall(img, 560, 60, 660, 60, 3);
    wall(img, 560, 120, 660, 120, 3);
    wall(img, 560, 60, 560, 120, 3);
    wall(img, 660, 60, 660, 120, 3);

    const traced = traceFloorplanBoundaryCore(img);
    expect(traced?.floors?.length).toBe(1);
  });

  it('clamps room detection to the floor under the click', () => {
    // Click inside the smaller right floor: before multi-floor support the
    // footprint clamp only covered the largest floor and this returned null.
    const room = detectRoomFromClickCore(twoFloorPlan(), { x: 750, y: 210 });
    expect(room).toBeTruthy();
    const [x1, y1, x2, y2] = bboxOf(room);
    expect(x1).toBeGreaterThanOrEqual(550);
    expect(x2).toBeLessThanOrEqual(960);
    expect(y1).toBeGreaterThanOrEqual(70);
    expect(y2).toBeLessThanOrEqual(350);
  });

  it('carves a labelled porch only from the floor it belongs to', () => {
    const img = twoFloorPlan();
    // Porch attached below the right floor (thin railing walls).
    wall(img, 580, 340, 580, 410, 3);
    wall(img, 930, 340, 930, 410, 3);
    wall(img, 580, 410, 930, 410, 3);

    const traced = traceFloorplanBoundaryCore(img, {
      excludeRegions: [{ x: 720, y: 365, width: 70, height: 20 }],
    });
    expect(traced?.floors?.length).toBe(2);
    expect(traced.excludedRegions).toBe(1);
    const [left, right] = traced.floors;
    // Right floor trimmed back to the shared wall; left floor untouched.
    expect(polygonBounds(right.outer.polygon).maxY).toBeLessThanOrEqual(352);
    expect(polygonBounds(left.outer.polygon).maxY).toBeGreaterThanOrEqual(368);
  });
});

describe('detectRoomFromClickCore', () => {
  // Two rooms sharing a wall with a door gap; outer shell solid.
  const twoRooms = () => {
    const img = createImage(600, 400);
    wall(img, 50, 50, 550, 50, 8);
    wall(img, 50, 350, 550, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    wall(img, 550, 50, 550, 350, 8);
    // Shared wall at x=300 with a 40px door gap in the middle.
    wall(img, 300, 50, 300, 180, 8);
    wall(img, 300, 220, 300, 350, 8);
    return img;
  };

  it('finds the enclosing room rectangle', () => {
    const room = detectRoomFromClickCore(twoRooms(), { x: 170, y: 200 });
    expect(room).toBeTruthy();
    const [x1, y1, x2, y2] = bboxOf(room);
    expect(x1).toBeGreaterThanOrEqual(48);
    expect(x1).toBeLessThanOrEqual(70);
    expect(y1).toBeGreaterThanOrEqual(48);
    expect(y1).toBeLessThanOrEqual(70);
    expect(y2).toBeGreaterThanOrEqual(330);
    expect(y2).toBeLessThanOrEqual(355);
    expect(room.confidence).toBeGreaterThan(0.5);
    // Right edge stops at the shared wall despite its door gap.
    expect(x2).toBeGreaterThanOrEqual(280);
    expect(x2).toBeLessThanOrEqual(305);
  });

  it('does not leak through the door gap into the neighbouring room', () => {
    const room = detectRoomFromClickCore(twoRooms(), { x: 450, y: 200 });
    expect(room).toBeTruthy();
    const [x1] = bboxOf(room);
    expect(x1).toBeGreaterThanOrEqual(295); // stayed right of the shared wall
  });

  it('passes thin fixture lines and stops at the thick wall', () => {
    const img = createImage(600, 400);
    wall(img, 50, 50, 550, 50, 8);
    wall(img, 50, 350, 550, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    wall(img, 550, 50, 550, 350, 8);
    // Thin counter line spanning the room 80px inside the right wall.
    wall(img, 470, 60, 470, 340, 2);

    const room = detectRoomFromClickCore(img, { x: 250, y: 200 });
    expect(room).toBeTruthy();
    const [, , x2] = bboxOf(room);
    expect(x2).toBeGreaterThanOrEqual(530); // reached the real wall
  });

  it('extends past a closet front wall when the label aspect calls for it', () => {
    const img = createImage(600, 500);
    wall(img, 50, 50, 550, 50, 8);
    wall(img, 50, 450, 550, 450, 8);
    wall(img, 50, 50, 50, 450, 8);
    wall(img, 550, 50, 550, 450, 8);
    // Closet front wall at y=330 with a wide door gap; closet back is the
    // room's true bottom wall at y=450.
    wall(img, 50, 330, 240, 330, 8);
    wall(img, 320, 330, 550, 330, 8);

    // Without label dims: stops at the closet front.
    const plain = detectRoomFromClickCore(img, { x: 300, y: 180 });
    expect(plain).toBeTruthy();
    expect(plain.overlay.y2).toBeLessThan(360);

    // Square label: room must include the closet band (500x400 interior).
    const withDims = detectRoomFromClickCore(img, { x: 300, y: 180 }, {
      labelDims: { width: 12.5, height: 10 },
    });
    expect(withDims).toBeTruthy();
    expect(withDims.overlay.y2).toBeGreaterThan(420);
  });

  it('ignores label text inside the room', () => {
    const img = createImage(600, 400);
    wall(img, 50, 50, 550, 50, 8);
    wall(img, 50, 350, 550, 350, 8);
    wall(img, 50, 50, 50, 350, 8);
    wall(img, 550, 50, 550, 350, 8);
    // Fake text glyphs near the click point (below the speck-strip threshold).
    for (let gx = 0; gx < 6; gx += 1) fillRect(img, 200 + gx * 16, 192, 209 + gx * 16, 204);

    const room = detectRoomFromClickCore(img, { x: 250, y: 200 });
    expect(room).toBeTruthy();
    const [x1, y1, x2, y2] = bboxOf(room);
    expect((x2 - x1) * (y2 - y1)).toBeGreaterThan(400 * 250);
  });

  it('returns null when clicked outside the building', () => {
    const img = createImage(600, 400);
    wall(img, 150, 100, 450, 100, 8);
    wall(img, 150, 300, 450, 300, 8);
    wall(img, 150, 100, 150, 300, 8);
    wall(img, 450, 100, 450, 300, 8);
    expect(detectRoomFromClickCore(img, { x: 30, y: 30 })).toBeNull();
  });

  it('maps results back to original pixel space when downscaled', () => {
    const img = createImage(3000, 2000);
    wall(img, 300, 300, 2700, 300, 24);
    wall(img, 300, 1700, 2700, 1700, 24);
    wall(img, 300, 300, 300, 1700, 24);
    wall(img, 2700, 300, 2700, 1700, 24);

    const room = detectRoomFromClickCore(img, { x: 1500, y: 1000 }, {
      preprocess: { maxDimension: 1000 },
    });
    expect(room).toBeTruthy();
    const [x1, y1, x2, y2] = bboxOf(room);
    expect(x1).toBeGreaterThan(250);
    expect(x1).toBeLessThan(400);
    expect(x2).toBeGreaterThan(2600);
    expect(x2).toBeLessThan(2750);
    expect(y1).toBeGreaterThan(250);
    expect(y2).toBeLessThan(1750);
  });
});

describe('boundaryByMode', () => {
  const result = {
    outer: { polygon: [{ x: 0, y: 0 }], overlay: { x1: 0, y1: 0, x2: 1, y2: 1 } },
    inner: { polygon: [{ x: 1, y: 1 }], overlay: { x1: 1, y1: 1, x2: 2, y2: 2 } },
  };

  it('selects by mode and falls back to the other side', () => {
    expect(boundaryByMode(result, 'outer')).toBe(result.outer);
    expect(boundaryByMode(result, 'inner')).toBe(result.inner);
    expect(boundaryByMode({ ...result, inner: null }, 'inner')).toBe(result.outer);
    expect(boundaryByMode({ ...result, outer: null }, 'outer')).toBe(result.inner);
    expect(boundaryByMode(null, 'outer')).toBeNull();
  });
});

describe('rectilinearFit', () => {
  it('snaps a jittered rectangle ring to 4 axis-aligned corners', () => {
    const ring = [
      { x: 10, y: 10 }, { x: 150, y: 11 }, { x: 300, y: 9 },
      { x: 301, y: 100 }, { x: 299, y: 200 },
      { x: 150, y: 201 }, { x: 10, y: 199 },
      { x: 9, y: 100 },
    ];
    const fit = rectilinearFit(ring);
    expect(fit.length).toBe(4);
    const xs = [...new Set(fit.map((p) => Math.round(p.x)))].sort((a, b) => a - b);
    const ys = [...new Set(fit.map((p) => Math.round(p.y)))].sort((a, b) => a - b);
    expect(xs.length).toBe(2);
    expect(ys.length).toBe(2);
  });

  it('keeps genuine diagonal edges', () => {
    const ring = [
      { x: 60, y: 10 }, { x: 300, y: 10 }, { x: 300, y: 200 },
      { x: 10, y: 200 }, { x: 10, y: 60 },
    ];
    const fit = rectilinearFit(ring);
    expect(fit.length).toBe(5); // chamfer corner preserved
  });
});
