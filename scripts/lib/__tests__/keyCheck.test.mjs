// The automatic checks on a final key (scripts/lib/keyCheck.mjs), each with a
// case that passes and one that fails, on a synthetic house and garage drawn as
// black wall bands of known thickness on white.
import { describe, expect, it } from 'vitest';
import { checkKey, statedFromLabels } from '../keyCheck.mjs';

const W = 460;
const H = 300;
const blank = () => ({ width: W, height: H, data: new Uint8ClampedArray(W * H * 4).fill(255) });
const fillRect = (image, x0, y0, x1, y1) => {
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = (y * W + x) * 4;
      image.data[i] = 0;
      image.data[i + 1] = 0;
      image.data[i + 2] = 0;
    }
  }
};
// The house's outer faces on (100, 80)-(300, 220); the garage's on
// (300, 80)-(400, 220), sharing the house's right wall. Walls 8 px thick.
const plan = () => {
  const image = blank();
  fillRect(image, 100, 80, 400, 88);
  fillRect(image, 100, 212, 400, 220);
  fillRect(image, 100, 80, 108, 220);
  fillRect(image, 292, 80, 300, 220);
  fillRect(image, 392, 80, 400, 220);
  return image;
};
const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const HOUSE = { type: 'gla', v: rect(100, 80, 300, 220) };
const GARAGE = { type: 'garage', v: rect(300, 80, 400, 220) };
// The garage's left edge (edge 3) runs along the house's right wall.
const SPEC = {
  outlines: [
    { type: 'gla', v: rect(100, 80, 300, 220), name: 'first floor' },
    { type: 'garage', v: [['ref', 0, 1], [400, 80], [400, 220], ['ref', 0, 2]], in: [3] },
  ],
};
const SCALE = { x: 0.1, y: 0.1 };
const label = (id, kind, cx, cy, text = 'x') => ({
  id, kind, text, bbox: { x: cx - 20, y: cy - 10, width: 40, height: 20 },
});
const run = (over = {}) => checkKey({
  outlines: [HOUSE, GARAGE], spec: SPEC, labels: [], image: plan(), scale: SCALE, ...over,
});
const only = (result, check, status) => result.items.filter((i) => i.check === check && (!status || i.status === status));

describe('a sound key', () => {
  it('passes every check, with areas in square feet at the plan\'s scale', () => {
    const result = run({ labels: [label('d0', 'room', 200, 150), label('e0', 'nonGla', 350, 150), label('a0', 'level', 200, 260)] });
    expect(result.failures).toBe(0);
    expect(result.warnings).toBe(0);
    expect(only(result, 'closed', 'pass')).toHaveLength(1);
    expect(only(result, 'labels', 'pass')).toHaveLength(1);
    expect(only(result, 'faces', 'pass').length).toBeGreaterThan(0);
    // 200 x 140 px at 0.1 ft/px each way is 280 sq ft; the garage 140.
    expect(result.areas.totals.gla.sqft).toBeCloseTo(280, 5);
    expect(result.areas.totals.garage.sqft).toBeCloseTo(140, 5);
    expect(result.areas.perOutline[0].name).toBe('first floor');
  });
});

describe('closed, and not crossing itself', () => {
  it('fails a bow-tie', () => {
    const bowTie = { type: 'gla', v: [[100, 80], [300, 220], [300, 80], [100, 220]] };
    const result = run({ outlines: [bowTie, GARAGE] });
    const fail = only(result, 'closed', 'fail');
    expect(fail).toHaveLength(1);
    expect(fail[0].detail).toMatch(/edge 0 crosses edge 2/);
    expect(result.failures).toBeGreaterThan(0);
  });

  it('fails an outline of two distinct vertices and a repeated vertex', () => {
    expect(only(run({ outlines: [{ type: 'gla', v: [[100, 80], [300, 80], [300, 80]] }, GARAGE] }), 'closed', 'fail')).toHaveLength(1);
    expect(only(run({ outlines: [{ type: 'gla', v: [[100, 80], [300, 80], [300, 80], [300, 220], [100, 220]] }, GARAGE] }), 'closed', 'fail')[0].detail).toMatch(/zero length/);
  });

  it('does not judge faces or labels of an outline that is not a polygon', () => {
    const bowTie = { type: 'gla', v: [[100, 80], [300, 220], [300, 80], [100, 220]] };
    const result = run({ outlines: [bowTie, GARAGE], labels: [label('d0', 'room', 200, 150)] });
    expect(only(result, 'faces', 'warn')[0].detail).toMatch(/not a simple polygon/);
    expect(only(result, 'labels', 'warn')).toHaveLength(1);
  });
});

describe('building and non-GLA outlines overlapping', () => {
  it('passes outlines that share only a boundary', () => {
    const result = run();
    expect(only(result, 'overlap', 'pass')).toHaveLength(1);
    expect(only(result, 'overlap', 'fail')).toHaveLength(0);
  });

  it('passes a sliver a pixel wide along the shared wall', () => {
    const result = run({ outlines: [HOUSE, { type: 'garage', v: rect(299, 80, 400, 220) }], spec: null });
    expect(only(result, 'overlap', 'fail')).toHaveLength(0);
  });

  it('fails a garage that runs 20 px into the house', () => {
    const result = run({ outlines: [HOUSE, { type: 'garage', v: rect(280, 80, 400, 220) }], spec: null });
    const fail = only(result, 'overlap', 'fail');
    expect(fail).toHaveLength(1);
    expect(fail[0].detail).toMatch(/overlap by 28\d\d px2 \(allowed \d+, the larger of 2 px x the \d+ px they share and 0\.2% of the smaller outline\)/);
  });

  it('only warns of unfinished space over scored space, and of two building outlines on each other', () => {
    const eave = { type: 'unfinished', v: rect(100, 80, 300, 120) };
    expect(only(run({ outlines: [HOUSE, GARAGE, eave], spec: null }), 'overlap', 'warn')).toHaveLength(1);
    const twin = { type: 'gla', v: rect(100, 80, 300, 220) };
    const both = run({ outlines: [HOUSE, twin, GARAGE], spec: null });
    expect(only(both, 'overlap', 'warn')).toHaveLength(1);
    expect(only(both, 'overlap', 'fail')).toHaveLength(0);
  });

  it('lets unfinished space abut scored space', () => {
    const eave = { type: 'unfinished', v: rect(100, 40, 300, 80) };
    expect(only(run({ outlines: [HOUSE, GARAGE, eave], spec: null }), 'overlap', 'warn')).toHaveLength(0);
  });
});

describe('room and non-GLA labels', () => {
  it('fails a room label lying in the garage, and a non-GLA label lying in the house', () => {
    const result = run({ labels: [label('d5', 'room', 350, 150, "12' x 12'"), label('e1', 'nonGla', 200, 150, 'PORCH')] });
    const fails = only(result, 'labels', 'fail');
    expect(fails.map((f) => f.subject).sort()).toEqual(['d5', 'e1']);
    expect(fails[0].detail).toMatch(/lies in (garage|gla), expected/);
    expect(result.failures).toBe(2);
  });

  it('reports a waived label as waived, with its reason, instead of failing it', () => {
    const spec = { ...SPEC, waive: [{ label: 'd5', reason: 'storage that opens into the garage counts as garage' }] };
    const result = run({ spec, labels: [label('d5', 'room', 350, 150, "8' x 6'")] });
    const waived = only(result, 'labels', 'waived');
    expect(waived).toHaveLength(1);
    expect(waived[0].detail).toContain('storage that opens into the garage counts as garage');
    expect(result.failures).toBe(0);
    expect(result.waived).toBe(1);
  });

  it('warns of a label in no outline, and of a waiver that names nothing or is not needed', () => {
    const result = run({ labels: [label('d9', 'room', 30, 30)] });
    expect(only(result, 'labels', 'warn')).toHaveLength(1);
    expect(result.failures).toBe(0);
    const spec = { ...SPEC, waive: [{ label: 'd77', reason: 'x' }, { label: 'd0', reason: 'y' }] };
    const waivers = only(run({ spec, labels: [label('d0', 'room', 200, 150)] }), 'labels', 'warn');
    expect(waivers).toHaveLength(2);
    expect(waivers.map((w) => w.detail).join(' ')).toMatch(/scan read no label d77/);
    expect(waivers.map((w) => w.detail).join(' ')).toMatch(/not needed/);
  });

  it('takes unfinished space as a home for either kind of label, and ignores level names', () => {
    const closet = { type: 'unfinished', v: rect(120, 100, 160, 140) };
    const result = run({
      outlines: [{ type: 'unfinished', v: rect(100, 80, 300, 220) }, GARAGE, closet],
      spec: null,
      labels: [label('d0', 'room', 140, 120), label('e0', 'nonGla', 140, 120), label('a0', 'level', 500, 500)],
    });
    expect(only(result, 'labels', 'fail')).toHaveLength(0);
    expect(only(result, 'labels', 'warn')).toHaveLength(0);
  });
});

describe('edges on the wall face', () => {
  // The house redrawn as `v`, the garage as it was, on its own vertices.
  const withHouse = (v, fix) => ({
    outlines: [{ type: 'gla', v }, GARAGE],
    spec: { outlines: [{ type: 'gla', v, ...(fix ? { fix } : {}) }, { type: 'garage', v: GARAGE.v, in: [3] }] },
  });

  it('fails an edge 5 px off the face, which listing it in "fix" excuses', () => {
    const v = rect(100, 75, 300, 220);
    const fails = only(run(withHouse(v)), 'faces', 'fail');
    expect(fails.length).toBeGreaterThan(0);
    expect(fails[0].subject).toContain('edge 0');
    // Sampled every quarter pixel, so a face is read to about a tenth of one.
    expect(fails[0].detail).toMatch(/(4\.9|5\.0|5\.1) px beyond the wall face/);
    expect(only(run(withHouse(v, [0])), 'faces', 'fail')).toHaveLength(0);
  });

  it('says short of when the edge is inside the face', () => {
    const fail = only(run(withHouse(rect(100, 84, 300, 220))), 'faces', 'fail');
    expect(fail[0].detail).toMatch(/(3\.9|4\.0) px short of the wall face/);
  });

  it('tolerates 2 px and fails at 3 px', () => {
    const at = (dy) => only(run(withHouse(rect(100, 80 + dy, 300, 220))), 'faces', 'fail');
    expect(at(0)).toHaveLength(0);
    expect(at(-1.5)).toHaveLength(0);
    expect(at(1.5)).toHaveLength(0);
    expect(at(-3).length).toBeGreaterThan(0);
    expect(at(3).length).toBeGreaterThan(0);
  });

  it('fails an edge with no wall band near it unless it is in "fix"', () => {
    // A garage whose far side has no wall drawn at all.
    const image = plan();
    fillRect(image, 392, 80, 400, 220);
    for (let y = 80; y < 220; y += 1) for (let x = 392; x < 400; x += 1) { const i = (y * W + x) * 4; image.data[i] = 255; image.data[i + 1] = 255; image.data[i + 2] = 255; }
    const failing = run({ image });
    const fails = only(failing, 'faces', 'fail');
    expect(fails).toHaveLength(1);
    expect(fails[0].subject).toContain('edge 1');
    expect(fails[0].detail).toMatch(/no wall band/);
    const spec = { outlines: [SPEC.outlines[0], { ...SPEC.outlines[1], fix: [1] }] };
    expect(only(run({ image, spec }), 'faces', 'fail')).toHaveLength(0);
  });

  it('does not test edges shared by reference, and notes them', () => {
    const shared = only(run(), 'faces', 'pass').map((i) => i.detail).join(' ');
    expect(shared).toMatch(/shared by reference/);
  });

  it('warns when more than half of an outline\'s own edges are fixed', () => {
    const spec = { outlines: [{ ...SPEC.outlines[0], fix: [0, 1, 2] }, SPEC.outlines[1]] };
    const warn = only(run({ spec }), 'faces', 'warn');
    expect(warn.some((w) => /more than half of its own edges are fixed/.test(w.detail))).toBe(true);
  });

  it('fails a snapped key whose spec has another number of outlines', () => {
    const result = run({ spec: { outlines: [SPEC.outlines[0]] } });
    expect(only(result, 'faces', 'fail')[0].detail).toMatch(/spec has 1 outlines and the snapped key 2/);
  });

  it('warns that it re-snapped everything when there is no spec', () => {
    // Without the spec the garage's `in` edge is checked as an outer face.
    const result = run({ spec: null });
    expect(only(result, 'faces', 'warn')[0].detail).toMatch(/no spec found/);
  });
});

describe('a stated area', () => {
  const stated = (list, over = {}) => run({ spec: { ...SPEC, stated: list }, ...over });

  it('passes within 5% and fails beyond, unless explained', () => {
    // The key's GLA is 280 sq ft.
    expect(only(stated([{ sqft: 285 }]), 'stated', 'pass')).toHaveLength(1);
    expect(only(stated([{ sqft: 294 }]), 'stated', 'pass')).toHaveLength(1);
    const fail = stated([{ sqft: 320 }]);
    expect(only(fail, 'stated', 'fail')).toHaveLength(1);
    expect(only(fail, 'stated', 'fail')[0].detail).toMatch(/-12\.5%.*not explained/);
    expect(fail.failures).toBe(1);
  });

  it('turns a gap into a warning when the spec says why', () => {
    const explained = stated([{ sqft: 320, explained: 'the stated figure includes the garage' }]);
    expect(only(explained, 'stated', 'fail')).toHaveLength(0);
    const warn = only(explained, 'stated', 'warn');
    expect(warn).toHaveLength(1);
    expect(warn[0].detail).toContain('the stated figure includes the garage');
    expect(explained.failures).toBe(0);
  });

  it('compares "of" against the outline it names, a type, or total GLA', () => {
    expect(only(stated([{ sqft: 140, of: 'garage' }]), 'stated', 'pass')).toHaveLength(1);
    expect(only(stated([{ sqft: 280, of: 'First Floor' }]), 'stated', 'pass')[0].detail).toContain('outline "First Floor"');
    expect(only(stated([{ sqft: 280, of: 'total GLA' }]), 'stated', 'pass')[0].detail).toContain('total GLA');
    // An "of" that names nothing is compared with total GLA, and says so.
    expect(only(stated([{ sqft: 280, of: 'second floor' }]), 'stated', 'pass')[0].detail).toMatch(/names no outline/);
  });

  it('reads a sq ft figure a level label carries, and warns instead of comparing when there is no scale', () => {
    const labels = [{
      id: 'a0', kind: 'level', keyword: 'first floor', text: 'FIRST FLOOR 1,250 SQ FT', bbox: { x: 0, y: 0, width: 5, height: 5 },
    }, label('a1', 'level', 1, 1, 'BASEMENT')];
    expect(statedFromLabels(labels)).toEqual([{ sqft: 1250, of: 'first floor', from: 'scan label a0' }]);
    expect(only(run({ labels }), 'stated', 'fail')).toHaveLength(1);
    const none = run({ labels, scale: null });
    expect(only(none, 'stated', 'warn')[0].detail).toMatch(/no scale/);
    expect(none.failures).toBe(0);
    expect(none.areas.totals.gla.sqft).toBeNull();
  });
});

describe('edges the snap flagged when it ran', () => {
  // The key is on the wall faces, so a second snap finds nothing to say. What the
  // first snap flagged is in the snapped file, and it is all that says an edge
  // was captured by a thin line beside the wall.
  const flag = (edge, flags, extra = {}, outline = 0) => ({ outline, edge, flags, moved: 0, ...extra });
  const warnsOf = (result) => only(result, 'faces', 'warn').filter((w) => /the snap flagged it/.test(w.detail));

  it('warns of an edge flagged far, with how far it moved, and still passes', () => {
    const result = run({ flagged: [flag(0, ['far'], { moved: -11.5 })] });
    const warns = warnsOf(result);
    expect(warns).toHaveLength(1);
    expect(warns[0].subject).toBe('outline 0 gla edge 0');
    expect(warns[0].detail).toMatch(/far \(moved 11\.5 px onto the band it found, which may not be the wall/);
    expect(warns[0].detail).toMatch(/probe the ink.*list it in "fix"/);
    expect(result.failures).toBe(0);
  });

  it('warns of reaches-end, ink-beyond and unstable as well, all of an edge in one line', () => {
    const result = run({
      flagged: [
        flag(1, ['reaches-end']),
        flag(2, ['ink-beyond'], { beyond: 6.5 }),
        flag(3, ['unstable', 'far'], { moved: 4.4, residual: 2.6 }, 0),
      ],
    });
    const warns = warnsOf(result);
    expect(warns.map((w) => w.subject)).toEqual(['outline 0 gla edge 1', 'outline 0 gla edge 2', 'outline 0 gla edge 3']);
    expect(warns[0].detail).toMatch(/reaches-end \(the band it found ran to the end of the search\)/);
    expect(warns[1].detail).toMatch(/ink-beyond \(another band began 6\.5 px beyond the face it used/);
    expect(warns[2].detail).toMatch(/far \(moved 4\.4 px.*; unstable \(its face moved 2\.6 px more when read again/);
    expect(result.failures).toBe(0);
  });

  it('says nothing of an edge in "fix", where the annotator took the edge where it was drawn', () => {
    const spec = { outlines: [{ ...SPEC.outlines[0], fix: [0] }, SPEC.outlines[1]] };
    const result = run({ spec, flagged: [flag(0, ['far'], { moved: -11.5 })] });
    expect(warnsOf(result)).toHaveLength(0);
  });

  it('does not say it twice when the second snap read the same flag, and says nothing of an edge it failed', () => {
    // Another band 6 px beyond the house's top wall: the second snap sees it too.
    const image = plan();
    fillRect(image, 100, 71, 300, 74);
    const result = run({ image, flagged: [flag(0, ['ink-beyond'], { beyond: 6 })] });
    expect(only(result, 'faces', 'warn').filter((w) => w.subject.endsWith('edge 0'))).toHaveLength(1);
    expect(warnsOf(result)).toHaveLength(0);
    // An edge 5 px off its wall fails as it is: the flag adds nothing to that line.
    const v = rect(100, 75, 300, 220);
    const off = run({
      outlines: [{ type: 'gla', v }, GARAGE],
      spec: { outlines: [{ type: 'gla', v }, { type: 'garage', v: GARAGE.v, in: [3] }] },
      flagged: [flag(0, ['far'], { moved: 5 })],
    });
    expect(only(off, 'faces', 'fail').length).toBeGreaterThan(0);
    expect(warnsOf(off)).toHaveLength(0);
  });

  it('reads a flagged list from an older snap, and ignores what does not name an outline or flags', () => {
    const result = run({
      flagged: [{ outline: 0, edge: 1, flags: ['ink-beyond'] }, { outline: 9, edge: 0, flags: ['far'] }, { outline: 0, edge: 1 }, null, flag(2, ['no-band'])],
    });
    const warns = warnsOf(result);
    expect(warns).toHaveLength(1);
    expect(warns[0].subject).toBe('outline 0 gla edge 1');
    expect(warns[0].detail).toMatch(/ink-beyond \(another band began beyond the face it used/);
  });

  it('leaves the flags alone when the spec is another key\'s: its "fix" lists say nothing of these edges', () => {
    const result = run({ spec: { outlines: [SPEC.outlines[0]] }, flagged: [flag(0, ['far'], { moved: 9 })] });
    expect(only(result, 'faces', 'fail')[0].detail).toMatch(/spec has 1 outlines and the snapped key 2/);
    expect(warnsOf(result)).toHaveLength(0);
  });

  it('no flags, no warning: a key snapped clean adds nothing', () => {
    expect(warnsOf(run({ flagged: [] }))).toHaveLength(0);
    expect(run({ flagged: [] }).warnings).toBe(0);
  });
});
