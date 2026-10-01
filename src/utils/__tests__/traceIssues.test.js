import { describe, it, expect } from 'vitest';
import { liveVoids, staleVoidCount, summariseIssues } from '../traceIssues.js';
import { warning } from '../detection/scoring.js';

const ring = (n = 4) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
const trace = (over = {}) => ({ id: 't1', name: '1st Floor', vertices: ring(), ...over });
const kinds = (summary) => summary.issues.map((i) => i.kind);

describe('summariseIssues', () => {
  it('counts nothing on an untouched plan', () => {
    expect(summariseIssues([], null, [])).toEqual({ count: 0, issues: [] });
    expect(summariseIssues(undefined, undefined, undefined)).toEqual({ count: 0, issues: [] });
  });

  it('counts a scale that wants checking, and not one that agrees', () => {
    const check = { level: 'check', short: 'Rooms disagree', detail: 'Why.', remedy: 'Do this.' };
    expect(summariseIssues([], check, []).issues).toEqual([
      { kind: 'scale', label: 'Rooms disagree', detail: 'Why.', remedy: 'Do this.' },
    ]);
    expect(summariseIssues([], { level: 'note' }, []).count).toBe(0);
  });

  it('counts a scale that was held back while the plan was parked', () => {
    expect(kinds(summariseIssues([], null, [], true))).toEqual(['rescale']);
  });

  it('counts one per double-counted outline, and names the pair', () => {
    const doubles = [{ innerName: 'Garage', outerName: '1st Floor' }, { innerId: 'b' }];
    const summary = summariseIssues([], null, doubles);
    expect(kinds(summary)).toEqual(['double-counted', 'double-counted']);
    expect(summary.issues[0].label).toBe('Garage sits inside 1st Floor');
    expect(summary.issues[0].remedy).toContain('Redraw 1st Floor so that it leaves Garage out');
    expect(summary.issues[1].label).toBe('One outline sits inside another');
  });

  it('counts a cut-out the outline has moved out from under, once per outline', () => {
    const holes = [{ ring: ring(), stale: true }, { ring: ring(), stale: true }];
    const summary = summariseIssues([trace({ holes })], null, []);
    expect(summary.issues).toHaveLength(1);
    expect(summary.issues[0]).toMatchObject({ kind: 'stale-void', traceId: 't1', count: 2 });
  });

  it('does not count a cut-out that is still subtracted', () => {
    expect(summariseIssues([trace({ holes: [{ ring: ring() }] })], null, []).count).toBe(0);
  });

  it('leaves a hidden outline’s cut-outs out, with its area', () => {
    const holes = [{ ring: ring(), stale: true }];
    expect(summariseIssues([trace({ holes, visible: false })], null, []).count).toBe(0);
  });

  // The outline is drawn on the plan and checked by eye. What the detector
  // doubted about it is on the trace, and is not a line on this list — however
  // low the score and however severe the finding.
  it('says nothing about how well an outline follows the walls', () => {
    const doubtful = trace({
      quality: {
        confidence: 0.3,
        warnings: [
          warning('unsealed', {}, 'error'),
          warning('heavy-closing', { radius: 12 }),
          warning('bridged-opening', { width: 40 }),
          warning('room-outside', { count: 1, names: ['Kitchen'] }, 'error'),
        ],
      },
    });
    const unexplained = trace({ id: 't2', quality: { confidence: 0.6, warnings: [] } });
    expect(summariseIssues([doubtful, unexplained], null, [])).toEqual({ count: 0, issues: [] });
  });

  it('adds up across every kind', () => {
    const holes = [{ ring: ring(), stale: true }];
    const summary = summariseIssues(
      [trace({ id: 'a', holes }), trace({ id: 'b', holes })],
      { level: 'check', short: 's', detail: 'd' },
      [{ innerName: 'A', outerName: 'B' }],
      true,
    );
    expect(kinds(summary)).toEqual(['scale', 'rescale', 'double-counted', 'stale-void', 'stale-void']);
    expect(summary.count).toBe(5);
  });
});

describe('void counting', () => {
  it('ignores a hole with too few points to be a ring', () => {
    const holes = [{ ring: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }];
    expect(liveVoids({ holes })).toHaveLength(0);
    expect(staleVoidCount({ holes })).toBe(0);
  });

  it('separates the subtracted from the stranded', () => {
    const holes = [{ ring: ring() }, { ring: ring(), stale: true }];
    expect(liveVoids({ holes })).toHaveLength(1);
    expect(staleVoidCount({ holes })).toBe(1);
  });

  it('reads a bare array of points as a subtracted void', () => {
    expect(liveVoids({ holes: [ring()] })).toHaveLength(1);
  });
});
