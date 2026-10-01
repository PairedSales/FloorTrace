import { describe, expect, it } from 'vitest';
import {
  WORKING_STATE_KEYS,
  SNAPSHOT_FIELDS,
  AUTOSAVE_FIELDS,
  PERSISTENT_FLOOR_FIELDS,
  EXCLUDED_SNAPSHOT_FIELDS,
  EXCLUDED_AUTOSAVE_FIELDS,
  EXCLUDED_PERSISTENT_FIELDS,
} from '../appStore';

/**
 * Working state is projected three ways — into an undo snapshot, into the
 * autosaved draft, and into a saved `.floorplan`. All three are derived from
 * one declaration by exclusion, and the point of deriving them is that a field
 * added to working state cannot be silently absent from any of them.
 *
 * `appStore.test.js` spot-checks membership of a handful of names, which is
 * exactly the level of checking that let `exteriorLabels` be autosaved but not
 * exported — reopening a project then degraded every later trace to
 * geometry-only, and nothing failed. These assertions are about the shape of
 * the derivation rather than about any one field, so they keep holding as
 * fields are added.
 */
describe('working-state projections', () => {
  const PROJECTIONS = [
    ['SNAPSHOT_FIELDS', SNAPSHOT_FIELDS, EXCLUDED_SNAPSHOT_FIELDS],
    ['AUTOSAVE_FIELDS', AUTOSAVE_FIELDS, EXCLUDED_AUTOSAVE_FIELDS],
    ['PERSISTENT_FLOOR_FIELDS', PERSISTENT_FLOOR_FIELDS, EXCLUDED_PERSISTENT_FIELDS],
  ];

  it.each(PROJECTIONS)('%s is a subset of working state', (_name, fields) => {
    const working = new Set(WORKING_STATE_KEYS);
    expect(fields.filter((k) => !working.has(k))).toEqual([]);
  });

  it.each(PROJECTIONS)('%s has no duplicates', (_name, fields) => {
    expect(new Set(fields).size).toBe(fields.length);
  });

  // The complement of the subset check: a projection must account for every
  // working-state field either by carrying it or by naming it in its exclusion
  // list. A new field that is in neither is the failure mode this file exists
  // for, and it is invisible without this assertion.
  it.each(PROJECTIONS)('%s accounts for every working-state field', (_name, fields, excluded) => {
    const covered = new Set([...fields, ...excluded]);
    expect(WORKING_STATE_KEYS.filter((k) => !covered.has(k))).toEqual([]);
  });

  // Each exclusion list is a statement about working state, so a name in one
  // that working state does not have is a stale entry — a field renamed or
  // removed, with the exclusion left pointing at nothing.
  it.each(PROJECTIONS)('%s excludes only fields that exist', (_name, _fields, excluded) => {
    const working = new Set(WORKING_STATE_KEYS);
    expect(excluded.filter((k) => !working.has(k))).toEqual([]);
  });

  it('keeps the union of all three projections equal to working state', () => {
    const union = new Set([...SNAPSHOT_FIELDS, ...AUTOSAVE_FIELDS, ...PERSISTENT_FLOOR_FIELDS]);
    // Fields excluded from all three are transient by intent, so they are named
    // here rather than inferred: if one of them ever becomes document content,
    // this list is the thing that has to be argued with. Equally, a *new* field
    // that lands in none of the three projections fails here rather than
    // quietly failing to persist.
    const TRANSIENT_EVERYWHERE = [
      'isProcessing',        // spinner
      'processingMessage',   // spinner text
      'traceInteractionMode', // drawing vs idle
      'drawModeActive',      // tool toggle; note drawStrokes IS autosaved
      'isDirty',             // project tracking
      'viewportSyncToken',   // camera sync signal, meaningless once reloaded
    ];
    const missing = WORKING_STATE_KEYS.filter((k) => !union.has(k));
    expect(missing.sort()).toEqual([...TRANSIENT_EVERYWHERE].sort());
  });

  it('exports working-state keys, not the shared defaults object', () => {
    // Guards the aliasing hazard rather than the projections: handing out the
    // memoised defaults object lets one project's nested calibration and
    // perimeterTraces be mutated into the next.
    expect(Array.isArray(WORKING_STATE_KEYS)).toBe(true);
    expect(WORKING_STATE_KEYS.every((k) => typeof k === 'string')).toBe(true);
  });
});
