// Answer keys moved as data (scripts/realKeys.mjs): a draft is not an answer,
// a key survives the trip exactly with its record of who drew it, an outline a
// person corrected is never replaced without --force, and a plan it writes
// opens in the app.
import { describe, expect, it } from 'vitest';
import { applyKey, applyPlan, keyOf, repairOutcome, untouched } from '../realKeys.mjs';

const ring = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const draft = () => ({
  id: 'trace-draft-1',
  type: 'gla',
  typeSource: 'auto',
  nameSource: 'auto',
  closed: true,
  vertices: ring(0, 0, 100, 80),
  quality: { source: 'auto', confidence: 0.9, warnings: [] },
});
const plan = (traces) => ({ perimeterTraces: traces, activeTraceId: traces[0]?.id ?? null });
const key = [
  { type: 'gla', points: [[2, 3], [98, 3], [98, 77], [2, 77]] },
  { type: 'garage', points: [[98, 3], [150, 3], [150, 77], [98, 77]] },
];

describe('answer keys as data', () => {
  it("leaves the app's untouched trace out of an export", () => {
    expect(untouched(draft())).toBe(true);
    expect(keyOf(plan([draft()]))).toBeNull();
  });

  it('writes a key into a draft the way the app holds a typed outline', () => {
    const state = plan([draft()]);
    expect(applyKey(state, key)).toBe('applied');
    const [house, garage] = state.perimeterTraces;
    expect(house).toMatchObject({
      type: 'gla',
      name: '1st Floor',
      typeSource: 'user',
      closed: true,
      quality: { source: 'manual', edited: true },
    });
    expect(garage).toMatchObject({ type: 'garage', name: 'Garage', color: '#FFB86C' });
    expect(state.activeTraceId).toBe(house.id);
    expect(keyOf(state)).toEqual(key);
  });

  it('never replaces outlines a person corrected, unless forced', () => {
    const corrected = {
      ...draft(),
      vertices: ring(0, 0, 90, 80),
      quality: { source: 'auto', confidence: null, warnings: [], edited: true },
    };
    const state = plan([corrected]);
    expect(applyKey(state, key)).toBe('kept');
    expect(state.perimeterTraces[0]).toBe(corrected);
    expect(applyKey(state, key, { force: true })).toBe('applied');
    expect(applyKey(state, key)).toBe('unchanged');
  });

  it("drops a trace level the app's importer would refuse, and nothing else", () => {
    const drafted = { lastTraceOutcome: { at: 1, level: null, reason: null, floors: 1, source: 'auto' } };
    expect(repairOutcome(drafted)).toBe(true);
    expect(drafted.lastTraceOutcome).toEqual({ at: 1, reason: null, floors: 1, source: 'auto' });
    expect(repairOutcome(drafted)).toBe(false);

    const saved = { lastTraceOutcome: { at: 2, level: 'failed', reason: 'no outline', floors: 0 } };
    expect(repairOutcome(saved)).toBe(false);
    expect(saved.lastTraceOutcome.level).toBe('failed');
    expect(repairOutcome({ lastTraceOutcome: null })).toBe(false);
  });

  it("carries the key's record of who drew it, and never over a person's own", () => {
    const about = { by: 'Claude (draft for review)', at: '2026-09-28T00:00:00.000Z', notes: 'One storey.' };
    const saved = (traces) => ({
      floors: [{ state: { ...plan(traces), lastTraceOutcome: { at: 1, level: null, floors: 1 } } }],
    });

    const drafted = saved([draft()]);
    expect(applyPlan(drafted, key, about)).toEqual({ outcome: 'applied', repaired: true, write: true });
    expect(drafted.answerKey).toEqual(about);
    expect(keyOf(drafted.floors[0].state)).toEqual(key);

    const checked = saved([{ ...draft(), quality: { source: 'manual', confidence: null, warnings: [], edited: true } }]);
    checked.answerKey = { by: 'a person' };
    expect(applyPlan(checked, key, about)).toEqual({ outcome: 'kept', repaired: true, write: true });
    expect(checked.answerKey).toEqual({ by: 'a person' });

    expect(applyPlan(null, key, about)).toMatchObject({ outcome: 'missing', write: false });
  });
});
