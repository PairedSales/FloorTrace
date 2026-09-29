// What an annotator writes (scripts/lib/keySpec.mjs): a malformed spec is
// refused with the place and the reason before anything is written, and every
// outline file the tool reads comes out as `[{type, v}]` with its refs resolved.
import { describe, expect, it } from 'vitest';
import { outlinesOfJson, resolveRefs, validateSpec } from '../keySpec.mjs';

const rect = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const good = () => ({
  author: 'a-x',
  notes: 'n',
  outlines: [
    { type: 'gla', v: rect(0, 0, 100, 100), name: 'first floor', fix: [1], R: 14, tilt: false },
    { type: 'garage', v: [['ref', 0, 1], [200, 0], [200, 100], ['ref', 0, 2]], in: [3] },
  ],
  waive: [{ label: 'd3', reason: 'storage opens into the garage' }],
  stated: [{ sqft: 1250, of: 'first floor', explained: 'excludes walls' }],
});

describe('a valid spec', () => {
  it('passes, refs and all', () => {
    expect(validateSpec(good())).toBeTruthy();
    expect(validateSpec({ outlines: [{ type: 'porch', v: rect(0, 0, 10, 10), bridge: 6 }] })).toBeTruthy();
  });

  it('may say it is an existing draft (realPipeline import-existing writes that mark), and only as a boolean', () => {
    expect(validateSpec({ ...good(), existingDraft: true })).toBeTruthy();
    expect(() => validateSpec({ ...good(), existingDraft: 'yes' })).toThrow(/existingDraft: must be true or false/);
  });
});

describe('an invalid spec is refused with the place and the reason', () => {
  const cases = [
    ['not an object', [], /must be a JSON object/],
    ['no outlines', { outlines: [] }, /non-empty array/],
    ['an unknown key', { ...good(), outline: [] }, /outline: unknown key/],
    ['an unknown outline key', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), fixes: [0] }] }, /outlines\[0\]\.fixes: unknown key/],
    ['a bad type', { outlines: [{ type: 'house', v: rect(0, 0, 9, 9) }] }, /outlines\[0\]\.type: must be one of gla, below-grade, garage, porch, unfinished/],
    ['a missing type', { outlines: [{ v: rect(0, 0, 9, 9) }] }, /outlines\[0\]\.type/],
    ['two vertices', { outlines: [{ type: 'gla', v: [[0, 0], [9, 9]] }] }, /at least 3 vertices/],
    ['a non-numeric vertex', { outlines: [{ type: 'gla', v: [[0, 0], [9, 'x'], [9, 9]] }] }, /outlines\[0\]\.v\[1\]: must be \[x, y\]/],
    ['a NaN vertex', { outlines: [{ type: 'gla', v: [[0, 0], [9, NaN], [9, 9]] }] }, /outlines\[0\]\.v\[1\]/],
    ['a ref to a missing outline', { outlines: [{ type: 'gla', v: [['ref', 3, 0], [9, 0], [9, 9]] }] }, /refers to outline 3, which does not exist/],
    ['a ref to its own outline', { outlines: [{ type: 'gla', v: [['ref', 0, 1], [9, 0], [9, 9]] }] }, /refers to its own outline/],
    ['a ref to a missing vertex', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }, { type: 'garage', v: [['ref', 0, 7], [20, 0], [20, 9]] }] }, /outline 0 has no vertex 7/],
    ['a malformed ref', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }, { type: 'garage', v: [['ref', 0], [20, 0], [20, 9]] }] }, /a reference is \["ref", outline, vertex\]/],
    ['refs in a loop', { outlines: [{ type: 'gla', v: [['ref', 1, 0], [9, 0], [9, 9]] }, { type: 'garage', v: [['ref', 0, 0], [20, 0], [20, 9]] }] }, /loop/],
    ['a fix edge out of range', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), fix: [4] }] }, /edge 4 is out of range \(0\.\.3\)/],
    ['a fix that is not a list', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), fix: 1 }] }, /outlines\[0\]\.fix: must be an array/],
    ['an edge in both fix and in', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), fix: [1], in: [1] }] }, /edge 1 is in both fix and in/],
    ['an R out of range', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), R: 900 }] }, /R: must be a number of pixels from 2 to 60/],
    ['a tilt that is not a boolean', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), tilt: 'yes' }] }, /tilt: must be true or false/],
    ['a bridge out of range', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9), bridge: 40 }] }, /bridge: must be a gap of 0 to 20 px/],
    ['coincident vertices', { outlines: [{ type: 'gla', v: [[0, 0], [9, 0], [9, 0], [9, 9]] }] }, /vertices 1 and 2 coincide/],
    ['a waiver without a reason', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }], waive: [{ label: 'd1', reason: ' ' }] }, /waive\[0\]\.reason: a waiver needs its reason/],
    ['a waiver without a label', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }], waive: [{ reason: 'x' }] }, /waive\[0\]\.label/],
    ['a stated area of zero', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }], stated: [{ sqft: 0 }] }, /stated\[0\]\.sqft: must be a positive number/],
    ['an unknown stated key', { outlines: [{ type: 'gla', v: rect(0, 0, 9, 9) }], stated: [{ sqft: 5, area: 5 }] }, /stated\[0\]\.area: unknown key/],
  ];
  for (const [what, spec, message] of cases) {
    it(what, () => {
      expect(() => validateSpec(spec)).toThrow(message);
    });
  }

  it('reports several problems on one line', () => {
    try {
      validateSpec({ outlines: [{ type: 'x', v: [[0, 0]] }, { type: 'gla', v: rect(0, 0, 9, 9), R: 1 }] });
      expect.unreachable();
    } catch (error) {
      expect(error.message).not.toContain('\n');
      expect(error.message).toMatch(/outlines\[0\]\.type.*outlines\[0\]\.v.*outlines\[1\]\.R/);
    }
  });
});

describe('references between outlines', () => {
  it('resolve to the vertex named, through a chain', () => {
    const outlines = [
      { type: 'gla', v: rect(0, 0, 100, 100) },
      { type: 'garage', v: [['ref', 0, 1], [200, 0], [200, 100], ['ref', 0, 2]] },
      { type: 'porch', v: [['ref', 1, 1], [300, 0], [300, 50]] },
    ];
    const flat = resolveRefs(outlines);
    expect(flat[1].v[0]).toEqual([100, 0]);
    expect(flat[1].v[3]).toEqual([100, 100]);
    expect(flat[2].v[0]).toEqual([200, 0]);
    // The input is untouched.
    expect(outlines[1].v[0]).toEqual(['ref', 0, 1]);
  });
});

describe('outline files, whichever way they are written', () => {
  const ring = rect(0, 0, 50, 40);
  it('reads a spec or snapped file, an array of outlines, and bare rings', () => {
    expect(outlinesOfJson({ outlines: [{ type: 'garage', v: ring }] })).toEqual([{ type: 'garage', v: ring }]);
    expect(outlinesOfJson([{ type: 'porch', points: ring }])).toEqual([{ type: 'porch', v: ring }]);
    expect(outlinesOfJson(ring)).toEqual([{ type: 'gla', v: ring }]);
    expect(outlinesOfJson([ring, rect(60, 0, 90, 40)])).toHaveLength(2);
    expect(outlinesOfJson([{ vertices: ring.map(([x, y]) => ({ x, y })) }])[0].v).toEqual(ring);
  });

  it('resolves refs, and says what is wrong with a file that is not outlines', () => {
    const out = outlinesOfJson({ outlines: [{ type: 'gla', v: ring }, { type: 'garage', v: [['ref', 0, 1], [90, 0], [90, 40]] }] });
    expect(out[1].v[0]).toEqual([50, 0]);
    expect(() => outlinesOfJson({ nothing: 1 }, 'x.json')).toThrow(/x\.json holds no outlines/);
    expect(() => outlinesOfJson([{ type: 'gla', v: [[0, 0], [1, 1]] }], 'x.json')).toThrow(/outline 0 has no ring of at least 3/);
    expect(() => outlinesOfJson([{ type: 'shed', v: ring }], 'x.json')).toThrow(/type "shed"/);
    expect(() => outlinesOfJson([], 'x.json')).toThrow(/holds no outlines/);
  });
});
