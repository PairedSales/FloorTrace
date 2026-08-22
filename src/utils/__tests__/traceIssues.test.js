import { describe, it, expect } from 'vitest';
import { liveVoids, staleVoidCount, summariseIssues } from '../traceIssues.js';
import { warning } from '../detection/scoring.js';

const ring = (n = 4) => Array.from({ length: n }, (_, i) => ({ x: i, y: i }));
const trace = (over = {}) => ({ id: 't1', name: '1st Floor', vertices: ring(), ...over });

describe('summariseIssues', () => {
  it('counts nothing on an untouched plan', () => {
    expect(summariseIssues([], null, [])).toEqual({ count: 0, level: 'ok' });
    expect(summariseIssues(undefined, undefined, undefined)).toEqual({ count: 0, level: 'ok' });
  });

  it('counts a scale that wants checking, and not one that agrees', () => {
    expect(summariseIssues([], { level: 'check' }, [])).toEqual({ count: 1, level: 'warn' });
    expect(summariseIssues([], { level: 'note' }, [])).toEqual({ count: 0, level: 'ok' });
  });

  it('counts one per double-counted outline', () => {
    const doubles = [{ innerId: 'a' }, { innerId: 'b' }];
    expect(summariseIssues([], null, doubles)).toEqual({ count: 2, level: 'warn' });
  });

  // The panel's whole claim is that the number beside the area is the number of
  // rows further down. A note about how the outline was reached is not a row.
  it('ignores info warnings so a clean plan still reads clean', () => {
    const quality = { confidence: 0.9, warnings: [warning('no-alternative', null, 'info')] };
    expect(summariseIssues([trace({ quality })], null, [])).toEqual({ count: 0, level: 'ok' });
  });

  it('raises the level to error for an error-severity warning', () => {
    const quality = {
      confidence: 0.3,
      warnings: [warning('heavy-closing', { radius: 12 }), warning('unsealed', {}, 'error')],
    };
    expect(summariseIssues([trace({ quality })], { level: 'check' }, []))
      .toEqual({ count: 3, level: 'error' });
  });

  it('counts a void the outline has moved out from under, once per outline', () => {
    const holes = [{ ring: ring(), stale: true }, { ring: ring(), stale: true }];
    expect(summariseIssues([trace({ holes })], null, [])).toEqual({ count: 1, level: 'error' });
  });

  it('does not count a void that is still subtracted', () => {
    expect(summariseIssues([trace({ holes: [{ ring: ring() }] })], null, []))
      .toEqual({ count: 0, level: 'ok' });
  });

  it('adds up across every outline', () => {
    const a = trace({ id: 'a', quality: { confidence: 0.6, warnings: [warning('no-inner', { floor: 0 })] } });
    const b = trace({ id: 'b', quality: { confidence: 0.6, warnings: [warning('heavy-closing', { radius: 9 })] } });
    expect(summariseIssues([a, b], null, [])).toEqual({ count: 2, level: 'warn' });
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
