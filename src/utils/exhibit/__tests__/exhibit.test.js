import { describe, it, expect, beforeEach } from 'vitest';
import useAppStore from '../../../store/appStore';
import { buildExhibitModel, exhibitFilename, exhibitDateStamp } from '../model';
import { composeExhibit, wrapLines, planFrame, PAPER } from '../compose';
import { traceTypeColor } from '../../traceTypes';

// Widths proportional to character count. The composer only asks the context
// for `measureText`, so this is the whole surface it needs.
const fakeCtx = () => ({
  font: '',
  measureText(text) {
    // The px value, not `parseFloat` of the whole string — that reads the
    // weight, which is the very slip this file exists to catch.
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(this.font)?.[1]) || 12;
    return { width: String(text).length * size * 0.55 };
  },
});

const rect = (x1, y1, x2, y2) => [
  { x: x1, y: y1 }, { x: x2, y: y1 }, { x: x2, y: y2 }, { x: x1, y: y2 },
];

const trace = (overrides = {}) => ({
  id: 't1',
  name: '1st Floor',
  vertices: rect(0, 0, 100, 100),
  holes: [],
  closed: true,
  visible: true,
  locked: false,
  type: 'gla',
  colorSource: 'type',
  nameSource: 'auto',
  color: traceTypeColor('gla'),
  quality: null,
  ...overrides,
});

// 1 px = 1 ft, so a 100x100 rectangle is 10,000 sq ft and every figure below
// can be read straight off the geometry.
const setUp = (patch = {}) => {
  useAppStore.setState({
    image: 'data:image/png;base64,AAAA',
    unit: 'decimal',
    projectName: '',
    useInteriorWalls: false,
    canvasRotation: 0,
    rooms: [],
    detectedDimensions: [],
    measurementLines: [],
    customShapes: [],
    perimeterTraces: [trace()],
    activeTraceId: 't1',
    calibration: {
      calibrated: true,
      feetPerPixel: { x: 1, y: 1 },
      source: 'room-calibration',
      calibratedRoomId: null,
      createdAt: null,
      quality: null,
    },
    ...patch,
  });
  return useAppStore.getState();
};

const textOf = (layout) => layout.ops.filter((o) => o.op === 'text').map((o) => o.text);

describe('exhibit model', () => {
  beforeEach(() => {
    useAppStore.getState().restart();
  });

  it('reports the area the app reports', () => {
    const model = buildExhibitModel(setUp());
    expect(model.headline.label).toBe('Gross Living Area');
    expect(model.headline.value).toBe('10,000');
    expect(model.headline.suffix).toBe('ft²');
    expect(model.outlines).toHaveLength(1);
    expect(model.outlines[0].areaText).toBe('10,000 ft²');
  });

  it('prints a total its own breakdown adds up to', () => {
    // Each area rounds down on its own: 100.4 + 200.4 + 300.4. Per row that is
    // 100 + 200 + 300 = 600, but rounding the raw 601.2 separately printed 601
    // directly beneath rows reaching 600 — on a workfile exhibit a reviewer
    // adds up by hand, that reads as an error in the measurement.
    const model = buildExhibitModel(setUp({
      perimeterTraces: [
        trace({ id: 'a', type: 'gla', vertices: rect(0, 0, 1, 100.4) }),
        trace({ id: 'b', type: 'garage', vertices: rect(0, 0, 1, 200.4) }),
        trace({ id: 'c', type: 'porch', vertices: rect(0, 0, 1, 300.4) }),
      ],
      activeTraceId: 'a',
    }));
    const asNumber = (text) => Number(String(text).replace(/,/g, ''));
    const rowSum = model.rows.reduce((n, r) => n + asNumber(r.value), 0);
    expect(model.rows).toHaveLength(3);
    expect(rowSum).toBe(600);
    expect(asNumber(model.total)).toBe(rowSum);
    expect(model.total).toBe('600');
  });

  it('states the wall face the area was measured to', () => {
    expect(buildExhibitModel(setUp()).headline.caption).toContain('exterior wall face');
    expect(buildExhibitModel(setUp({ useInteriorWalls: true })).headline.caption)
      .toContain('interior wall face');
  });

  it('deducts a void and says how much it took off', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [trace({
        holes: [{ id: 'h1', ring: rect(10, 10, 20, 20), source: 'user' }],
      })],
    }));
    expect(model.outlines[0].areaText).toBe('9,900 ft²');
    expect(model.outlines[0].voids).toContain('−1 void');
  });

  it('says a stale void is not deducted, and flags it', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [trace({
        holes: [{ id: 'h1', ring: rect(10, 10, 20, 20), source: 'user', stale: true }],
      })],
    }));
    expect(model.outlines[0].areaText).toBe('10,000 ft²');
    expect(model.flags.some((f) => /not deducted/.test(f.text))).toBe(true);
  });

  it('carries a doubtful outline onto the page rather than dropping it', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [trace({
        quality: {
          source: 'auto',
          confidence: 0.42,
          warnings: [{ code: 'unsealed', severity: 'error', message: 'the outline never closed' }],
        },
      })],
    }));
    expect(model.outlines[0].quality.percent).toBe(42);
    const flag = model.flags.find((f) => f.text.startsWith('1st Floor'));
    expect(flag.severity).toBe('error');
    expect(flag.text).toContain('42% confidence');
    expect(flag.text).toContain('never closed');
  });

  it('flags a garage counted twice inside the living area', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [
        trace(),
        trace({ id: 't2', name: 'Garage', type: 'garage', vertices: rect(10, 10, 40, 40) }),
      ],
    }));
    expect(model.flags.some((f) => /counted twice/.test(f.text))).toBe(true);
    // Both subtotals are reported as they stand. The double count is stated,
    // never silently corrected — which of the two outlines is wrong is the
    // user's call, and the exhibit is where that has to be visible.
    expect(model.rows.map((r) => r.label)).toEqual(['GLA', 'Garage']);
    expect(model.total).toBe('10,900');
    // "Garage / Garage" would spend a whole line saying nothing.
    expect(model.outlines[1].typeLabel).toBeNull();
    expect(model.outlines[0].typeLabel).toBe('GLA');
  });

  it('reports an uncalibrated plan as having no area rather than a wrong one', () => {
    const model = buildExhibitModel(setUp({
      calibration: {
        calibrated: false, feetPerPixel: { x: 1, y: 1 },
        source: null, calibratedRoomId: null, createdAt: null, quality: null,
      },
    }));
    expect(model.headline.value).toBe('—');
    expect(model.outlines[0].areaText).toBe('—');
    expect(model.scale.value).toBe('Not set');
    expect(model.scale.provenance).toContain('not to scale');
  });

  it('drops hidden outlines, as the panel does', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [trace(), trace({ id: 't2', name: '2nd Floor', visible: false })],
    }));
    expect(model.outlines).toHaveLength(1);
    expect(model.headline.value).toBe('10,000');
  });

  it('omits wall lengths and annotations when they are switched off', () => {
    const state = setUp({
      measurementLines: [{ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }],
    });
    const on = buildExhibitModel(state);
    expect(on.plan.traces[0].edges).toHaveLength(4);
    expect(on.plan.lines).toHaveLength(1);

    const off = buildExhibitModel(state, {
      options: { sideLengths: false, annotations: false, outlineLabels: false },
    });
    expect(off.plan.traces[0].edges).toHaveLength(0);
    expect(off.plan.lines).toHaveLength(0);
    expect(off.plan.traces[0].badge).toBeNull();
  });

  // The screen puts wall lengths on the inside of the outline, and the export
  // copies that rather than improving on it. What must hold either way is that
  // every label goes to the *same* side — a set that alternates is the failure
  // the winding rule exists to prevent, and it survives a sign slip silently.
  it('puts every wall length on the inward side, as the canvas does', () => {
    for (const vertices of [
      [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
      [{ x: 0, y: 0 }, { x: 0, y: 100 }, { x: 100, y: 100 }, { x: 100, y: 0 }],
    ]) {
      const model = buildExhibitModel(setUp({ perimeterTraces: [trace({ vertices })] }));
      expect(model.plan.traces[0].edges).toHaveLength(4);
      for (const edge of model.plan.traces[0].edges) {
        // Positive means the normal points away from the centre at (50, 50).
        const outward = (edge.x - 50) * edge.nx + (edge.y - 50) * edge.ny;
        expect(outward).toBeLessThan(0);
      }
    }
  });
});

describe('filenames', () => {
  it('names the file after the subject and the local date', () => {
    const now = new Date(2026, 7, 16, 21, 30).getTime();
    expect(exhibitDateStamp(now)).toBe('2026-08-16');
    expect(exhibitFilename({ title: '123 Main St' }, now)).toBe('123 Main St 2026-08-16.png');
  });

  it('strips characters a filesystem rejects', () => {
    const now = new Date(2026, 0, 2).getTime();
    expect(exhibitFilename({ title: 'Unit 4/B: rear*' }, now)).toBe('Unit 4 B rear 2026-01-02.png');
  });

  it('falls back when nothing was typed', () => {
    const now = new Date(2026, 0, 2).getTime();
    expect(exhibitFilename({ title: '' }, now)).toBe('Floor plan 2026-01-02.png');
  });
});

describe('page composition', () => {
  beforeEach(() => {
    useAppStore.getState().restart();
  });

  it('wraps to the width it is given', () => {
    const measure = (t) => t.length * 10;
    expect(wrapLines(measure, 'one two three four', 100)).toEqual(['one two', 'three four']);
    expect(wrapLines(measure, '', 100)).toEqual([]);
  });

  it('never enlarges the plan, and fits an oversized one', () => {
    expect(planFrame(400, 300, 0, 2400).scale).toBe(1);
    const big = planFrame(4800, 3000, 0, 2400);
    expect(big.scale).toBe(0.5);
    expect(big.width).toBe(2400);
  });

  it('grows the box to hold a rotated plan', () => {
    const frame = planFrame(400, 200, 90, 2400);
    expect(Math.round(frame.width)).toBe(200);
    expect(Math.round(frame.height)).toBe(400);
  });

  it('prints the headline, the scale and the disclaimer', () => {
    const model = buildExhibitModel(setUp({ projectName: '123 Main St' }));
    const layout = composeExhibit(fakeCtx(), model, { imageWidth: 800, imageHeight: 600 });
    const strings = textOf(layout);
    expect(strings).toContain('123 Main St');
    expect(strings).toContain('10,000');
    expect(strings).toContain('GROSS LIVING AREA');
    expect(strings).toContain('SCALE');
    expect(strings.join(' ')).toContain('not a certified survey');
    expect(layout.height).toBeGreaterThan(600);
  });

  it('drops the summary but keeps the plan when the summary is off', () => {
    const model = buildExhibitModel(setUp(), { options: { summary: false } });
    const layout = composeExhibit(fakeCtx(), model, { imageWidth: 800, imageHeight: 600 });
    expect(textOf(layout)).not.toContain('GROSS LIVING AREA');
    expect(layout.ops.some((o) => o.op === 'image')).toBe(true);
  });

  it('draws the flag panel behind the flag text, not over it', () => {
    const model = buildExhibitModel(setUp({
      perimeterTraces: [trace({
        quality: { source: 'auto', confidence: 0.3, warnings: [{ code: 'unsealed', severity: 'error' }] },
      })],
    }));
    const layout = composeExhibit(fakeCtx(), model, { imageWidth: 800, imageHeight: 600 });
    const panel = layout.ops.findIndex((o) => o.op === 'roundRect' && o.w > 400);
    const dot = layout.ops.findIndex((o) => o.op === 'dot');
    expect(panel).toBeGreaterThanOrEqual(0);
    expect(dot).toBeGreaterThan(panel);
  });

  // `parseFloat('500 13px …')` is 500, so deriving a label pill's height from
  // its font string once produced a 775px-tall bar per wall length — five black
  // stripes down the whole page, over the plan the exhibit exists to show.
  it('sizes label pills from the text, not from the font weight', () => {
    const model = buildExhibitModel(setUp());
    const layout = composeExhibit(fakeCtx(), model, { imageWidth: 800, imageHeight: 600 });
    const pills = layout.ops.filter((o) => o.op === 'roundRect' && o.fill === PAPER.pill);
    expect(pills.length).toBeGreaterThanOrEqual(5); // four walls plus the badge
    for (const p of pills) {
      expect(p.h).toBeLessThan(50);
      expect(p.w).toBeLessThan(layout.width / 2);
      expect(p.w).toBeGreaterThan(p.h);
    }
  });

  it('places overlays through the same transform as the image under them', () => {
    const model = buildExhibitModel(setUp());
    const layout = composeExhibit(fakeCtx(), model, { imageWidth: 800, imageHeight: 600 });
    const image = layout.ops.find((o) => o.op === 'image');
    const poly = layout.ops.find((o) => o.op === 'poly' && o.close);
    // The trace spans 0..100 of an 800x600 image drawn at scale 1, so its
    // corners must land on the image's own top-left corner.
    expect(poly.points[0].x).toBeCloseTo(image.x, 5);
    expect(poly.points[0].y).toBeCloseTo(image.y, 5);
    expect(poly.points[2].x).toBeCloseTo(image.x + 100 * image.scale, 5);
  });
});
