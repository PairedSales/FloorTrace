import { describe, it, expect } from 'vitest';
import { classifyTraces } from '../traceClassification.js';

const rect = (id, x, y, w, h) => ({
  id,
  vertices: [
    { x, y }, { x: x + w, y },
    { x: x + w, y: y + h }, { x, y: y + h },
  ],
});

const label = (type, keyword, x, y, w = 60, h = 12) => ({
  type,
  keyword,
  text: keyword.toUpperCase(),
  bbox: { x, y, width: w, height: h },
});

describe('classifyTraces', () => {
  it('types an outline from a label printed inside it', () => {
    const traces = [rect('a', 0, 0, 400, 400)];
    const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 100, 200)]);

    expect(verdicts).toEqual([
      { id: 'a', type: 'below-grade', from: 'inside', keyword: 'basement', text: 'BASEMENT' },
    ]);
  });

  it('leaves an outline with no labels of its own alone', () => {
    const traces = [rect('a', 0, 0, 400, 400), rect('b', 600, 0, 400, 400)];
    const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 100, 200)]);

    expect(verdicts.map((v) => v.id)).toEqual(['a']);
  });

  // The storey's own name beats a mention of somewhere else on the same page.
  it('lets the majority of a storey\'s labels decide it', () => {
    const traces = [rect('a', 0, 0, 400, 400)];
    const verdicts = classifyTraces(traces, [
      label('below-grade', 'basement', 100, 100),
      label('below-grade', 'basement', 100, 200),
      label('gla', 'floor 1', 100, 300),
    ]);

    expect(verdicts[0].type).toBe('below-grade');
  });

  it('refuses to decide when the labels inside one outline tie', () => {
    const traces = [rect('a', 0, 0, 400, 400)];
    const verdicts = classifyTraces(traces, [
      label('below-grade', 'basement', 100, 100),
      label('gla', '2nd floor', 100, 300),
    ]);

    expect(verdicts).toEqual([]);
  });

  it('gives a label to the innermost outline that contains it', () => {
    const traces = [rect('outer', 0, 0, 400, 400), rect('inner', 50, 50, 100, 100)];
    const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 70, 80, 40, 10)]);

    expect(verdicts.map((v) => v.id)).toEqual(['inner']);
  });

  describe('titles printed outside the outline', () => {
    it('types an outline from a caption below it', () => {
      const traces = [rect('a', 0, 0, 400, 400)];
      const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 160, 430)]);

      expect(verdicts).toEqual([
        { id: 'a', type: 'below-grade', from: 'title', keyword: 'basement', text: 'BASEMENT' },
      ]);
    });

    it('types an outline from a caption above it', () => {
      const traces = [rect('a', 0, 100, 400, 400)];
      const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 160, 60)]);

      expect(verdicts[0]?.from).toBe('title');
    });

    // The trap fixtures/ExampleFloorplan2 walks into: "FLOOR 2" is printed
    // nearer to the plan below it than to the one it belongs to, so a
    // nearest-wins tiebreak captions the wrong outline.
    it('drops a caption that two outlines are equally entitled to', () => {
      const traces = [rect('above', 0, 0, 400, 300), rect('below', 0, 400, 400, 300)];
      const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 160, 330)]);

      expect(verdicts).toEqual([]);
    });

    it('ignores a caption set off to one side of the outline', () => {
      const traces = [rect('a', 0, 0, 400, 400)];
      const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 700, 430)]);

      expect(verdicts).toEqual([]);
    });

    it('ignores a caption too far away to be one', () => {
      const traces = [rect('a', 0, 0, 400, 400)];
      const verdicts = classifyTraces(traces, [label('below-grade', 'basement', 160, 600)]);

      expect(verdicts).toEqual([]);
    });

    // A sheet that captions the basement "FLOOR 1" is describing where it sits
    // in the stack, not what it is; the rooms drawn inside outrank it.
    it('is outranked by the outline\'s own labels', () => {
      const traces = [rect('a', 0, 0, 400, 400)];
      const verdicts = classifyTraces(traces, [
        label('below-grade', 'basement', 100, 200),
        label('gla', 'floor 1', 160, 430),
      ]);

      expect(verdicts).toEqual([
        { id: 'a', type: 'below-grade', from: 'inside', keyword: 'basement', text: 'BASEMENT' },
      ]);
    });
  });

  // The reported bug, on the page it was reported from. Both lists are what the
  // real pipeline produces for fixtures/ExampleFloorplan2.png: four plans on one
  // sheet, captioned underneath, with the basement drawn third in reading order
  // — which is why it arrived called "3rd Floor" and counted as living area.
  describe('fixtures/ExampleFloorplan2 (four plans on one sheet)', () => {
    const floors = [
      rect('floor-0', 33, 16, 393, 337),
      rect('floor-1', 653, 16, 384, 338),
      rect('floor-2', 33, 439, 345, 338),
      rect('floor-3', 512, 439, 495, 338),
    ];
    const scanned = [
      { ...label('gla', 'floor 2', 35, 401, 57, 11) },
      { ...label('gla', 'floor 4', 514, 400, 58, 11) },
      { ...label('below-grade', 'basement', 253, 601, 74, 10) },
      { ...label('below-grade', 'basement', 115, 651, 74, 10) },
      { ...label('gla', 'floor 1', 35, 825, 56, 11) },
      { ...label('gla', 'floor 3', 514, 825, 57, 11) },
    ];

    it('types the basement plan and nothing else', () => {
      const verdicts = classifyTraces(floors, scanned);
      const byId = new Map(verdicts.map((v) => [v.id, v]));

      expect(byId.get('floor-2')).toMatchObject({ type: 'below-grade', from: 'inside' });
      // The other three are living area either way — two have no caption they
      // can claim, and the one that does agrees with the default.
      expect(byId.get('floor-0')).toBeUndefined();
      expect(byId.get('floor-1')).toBeUndefined();
      expect(byId.get('floor-3')?.type ?? 'gla').toBe('gla');
    });

    // The sheet calls the basement plan "FLOOR 1". That says where it sits in
    // the stack, and the rooms drawn inside it say what it is.
    it('is not talked out of it by the caption under the plan', () => {
      const captionOnly = scanned.filter((l) => l.type === 'gla');
      expect(classifyTraces(floors, captionOnly).find((v) => v.id === 'floor-2')?.type)
        .not.toBe('below-grade');

      expect(classifyTraces(floors, scanned).find((v) => v.id === 'floor-2').type)
        .toBe('below-grade');
    });
  });

  it('survives outlines and labels it cannot use', () => {
    expect(classifyTraces(null, null)).toEqual([]);
    expect(classifyTraces([{ id: 'a', vertices: [{ x: 0, y: 0 }] }], [])).toEqual([]);
    expect(classifyTraces([rect('a', 0, 0, 10, 10)], [{ text: 'BASEMENT' }])).toEqual([]);
  });
});
