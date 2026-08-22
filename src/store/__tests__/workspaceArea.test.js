import { beforeEach, describe, expect, it } from 'vitest';
import useAppStore, { computeWorkspaceArea, selectWorkspaceArea } from '../appStore';
import { clearParked, newDocumentId, newDocumentMeta } from '../documentManager';
import { newTraceId } from '../ids';

const app = () => useAppStore.getState();

const square = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
const trace = (n, type = 'gla') => ({
  id: newTraceId(), name: '1st Floor', vertices: square(n), holes: [],
  visible: true, closed: true, type, colorSource: 'type', nameSource: 'auto', color: '#BD93F9',
});

/** One live plan with `n`x`n` feet of the given type, at 1 px = 1 ft. */
const livePlan = (n, type = 'gla') => {
  clearParked();
  app().restart();
  const id = newDocumentId();
  useAppStore.setState({
    documents: { [id]: newDocumentMeta() },
    documentOrder: [id],
    activeDocumentId: id,
    image: 'data:image/png;base64,AAA',
    perimeterTraces: n ? [trace(n, type)] : [],
    calibration: { calibrated: true, feetPerPixel: { x: 1, y: 1 } },
  });
  return id;
};

/** Another plan the workspace knows only by what it last reported. */
const remembered = (area, patch = {}) => {
  const id = newDocumentId();
  useAppStore.setState((s) => ({
    documents: { ...s.documents, [id]: newDocumentMeta({ hasWork: true, area, ...patch }) },
    documentOrder: [...s.documentOrder, id],
  }));
  return id;
};

const gla = (total) => ({ byType: { gla: total }, counts: { gla: 1 }, gla: total, total });

describe('computeWorkspaceArea', () => {
  beforeEach(() => { livePlan(0); });

  it('is just the live plan when there is only one', () => {
    livePlan(30); // 900 sq ft
    const w = computeWorkspaceArea(app());
    expect(w.total).toBeCloseTo(900, 6);
    expect(w.isMultiPlan).toBe(false);
    expect(w.plans).toHaveLength(1);
  });

  // The whole point: a two-storey house is two plans, and only one is live.
  it('adds the live plan to what the others last reported', () => {
    livePlan(30);            // 900
    remembered(gla(700));
    const w = computeWorkspaceArea(app());

    expect(w.total).toBeCloseTo(1600, 6);
    expect(w.gla).toBeCloseTo(1600, 6);
    expect(w.isMultiPlan).toBe(true);
    expect(w.counts.gla).toBe(2); // two levels across two plans
  });

  it('keeps the types apart across plans', () => {
    livePlan(30, 'gla');                                        // 900 gla
    remembered({ byType: { gla: 700, garage: 400 }, counts: { gla: 1, garage: 1 }, gla: 700, total: 1100 });
    const w = computeWorkspaceArea(app());

    expect(w.byType.gla).toBeCloseTo(1600, 6);
    expect(w.byType.garage).toBeCloseTo(400, 6);
    expect(w.gla).toBeCloseTo(1600, 6);
    expect(w.total).toBeCloseTo(2000, 6);
  });

  it('ignores a plan that contributes nothing', () => {
    livePlan(30);
    remembered(null);
    const w = computeWorkspaceArea(app());
    expect(w.plans).toHaveLength(1);
    expect(w.isMultiPlan).toBe(false);
  });

  // A plan the workspace has not read back cannot be re-measured, so its
  // figure is remembered rather than fresh — and the UI says so.
  it('marks a plan whose state is still on disk', () => {
    livePlan(30);
    remembered(gla(700), { hydrated: false });
    const w = computeWorkspaceArea(app());
    expect(w.plans.find((p) => !p.isActive).fromDisk).toBe(true);
    expect(w.plans.find((p) => p.isActive).fromDisk).toBe(false);
  });

  it('recomputes the live plan rather than trusting its own record', () => {
    const id = livePlan(30);
    // A stale figure on the live plan's meta must not be what the roll-up uses.
    useAppStore.setState((s) => ({
      documents: { ...s.documents, [id]: { ...s.documents[id], area: gla(99999) } },
    }));
    remembered(gla(700));
    expect(computeWorkspaceArea(app()).total).toBeCloseTo(1600, 6);
  });
});

describe('selectWorkspaceArea', () => {
  it('returns the same object until something it depends on changes', () => {
    livePlan(30);
    remembered(gla(700));
    const first = selectWorkspaceArea(app());
    expect(selectWorkspaceArea(app())).toBe(first);

    remembered(gla(100));
    expect(selectWorkspaceArea(app())).not.toBe(first);
    expect(selectWorkspaceArea(app()).total).toBeCloseTo(1700, 6);
  });
});
