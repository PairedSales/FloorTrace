// @vitest-environment happy-dom
//
// Starting to place corners clears the outline being replaced. Cancelling used
// to leave the plan with no outline and no area, and the only way back was to
// know that Undo would do it — several times over. And an outline added and
// then abandoned used to stay in the list, empty. These are the cases that
// decide whether Cancel means cancel.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCornerPlacement } from '../useCornerPlacement';
import useAppStore from '../../store/appStore';
import * as undoManager from '../../store/undoManager';
import { makeTrace } from '../../utils/traceTypes';
import { flash } from '../../utils/notify';
import { app, oneDocument, IMAGE_A } from './harness';

vi.mock('../../utils/notify', () => ({ notify: vi.fn(), flash: vi.fn() }));

const square = [{ x: 0, y: 0 }, { x: 90, y: 0 }, { x: 90, y: 90 }, { x: 0, y: 90 }];
const userHole = { id: 'hole-1', ring: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }], source: 'user' };
const autoHole = { id: 'hole-auto-0', ring: [{ x: 40, y: 40 }, { x: 50, y: 40 }, { x: 50, y: 50 }], source: 'auto' };

const active = () => app().perimeterTraces.find((t) => t.id === app().activeTraceId);

describe('useCornerPlacement', () => {
  let outline;

  beforeEach(() => {
    vi.clearAllMocks();
    oneDocument();
    undoManager.clear();
    outline = makeTrace({
      id: 'trace-1',
      vertices: square,
      holes: [userHole, autoHole],
      wallFaces: { outer: { vertices: square, holes: [] }, inner: null },
      quality: { confidence: 0.9, warnings: [] },
      closed: true,
    });
    act(() => {
      app().setImage(IMAGE_A);
      useAppStore.setState({ perimeterTraces: [outline], activeTraceId: 'trace-1' });
    });
    // One real edit behind us, so there is history the cancel must not eat.
    act(() => { undoManager.save(); });
  });

  it('clears the outline to place corners on a clean plan, keeping the user’s own cut-outs', () => {
    const { result } = renderHook(() => useCornerPlacement());
    act(() => result.current.startPlacing());

    expect(app().perimeterVertices).toEqual([]);
    expect(active().vertices).toEqual([]);
    // Once each. Handing the kept holes back in used to add them a second
    // time, and a cut-out counted twice comes off the area twice.
    expect(active().holes.map((h) => h.id)).toEqual(['hole-1']);
    // The detector's wall faces describe the outline being replaced.
    expect(active().wallFaces).toBeNull();
  });

  it('puts the outline back when placement is cancelled', () => {
    const before = active();
    const depth = undoManager.depth();
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    // Two corners in, then Escape — which is the canvas clearing the list.
    act(() => { undoManager.save(); app().setPerimeterVertices([{ x: 1, y: 1 }]); });
    act(() => { undoManager.save(); app().setPerimeterVertices([{ x: 1, y: 1 }, { x: 5, y: 1 }]); });
    act(() => app().setPerimeterVertices(null));

    // The very object, so nothing downstream sees a changed outline.
    expect(active()).toBe(before);
    expect(active().holes.map((h) => h.id)).toEqual(['hole-1', 'hole-auto-0']);
    // The steps of something that never happened are gone with it: one Undo
    // must not take the outline away again a corner at a time.
    expect(undoManager.depth()).toBe(depth);
  });

  it('lets a finished outline stand, with the old one an Undo away', () => {
    const drawn = [{ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 50, y: 50 }];
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    act(() => {
      undoManager.save();
      app().setPerimeterOverlay({ vertices: drawn });
      app().setPerimeterVertices(null);
    });

    expect(active().vertices).toEqual(drawn);
    act(() => { undoManager.undo(); });
    act(() => { undoManager.undo(); });
    expect(active().vertices).toEqual(square);
  });

  it('remembers the outline from before the first ask when asked again part-way', () => {
    const before = active();
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    act(() => result.current.startPlacing());
    act(() => app().setPerimeterVertices(null));

    expect(active()).toBe(before);
  });

  it('does not bring back an outline the user deleted while placing', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    act(() => {
      useAppStore.setState({ perimeterTraces: [makeTrace({ id: 'trace-2' })], activeTraceId: 'trace-2' });
      app().setPerimeterVertices(null);
    });

    expect(app().perimeterTraces.map((t) => t.id)).toEqual(['trace-2']);
  });

  // The remembered outline belongs to one plan: restoring it into whichever
  // plan is on screen would put one drawing's outline on another.
  it('forgets the outline when the plan changes underneath it', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    act(() => {
      useAppStore.setState({ activeDocumentId: 'another-plan' });
      app().setPerimeterVertices(null);
    });

    expect(active().vertices).toEqual([]);
  });
});

describe('useCornerPlacement — adding an outline', () => {
  let outline;
  const ids = () => app().perimeterTraces.map((t) => t.id);

  beforeEach(() => {
    vi.clearAllMocks();
    oneDocument();
    undoManager.clear();
    outline = makeTrace({ id: 'trace-1', vertices: square, closed: true });
    act(() => {
      app().setImage(IMAGE_A);
      useAppStore.setState({ perimeterTraces: [outline], activeTraceId: 'trace-1' });
    });
    act(() => { undoManager.save(); });
  });

  it('adds an empty outline and starts placing its corners', () => {
    const { result } = renderHook(() => useCornerPlacement());
    act(() => result.current.addOutline());

    expect(app().perimeterTraces).toHaveLength(2);
    expect(app().activeTraceId).not.toBe('trace-1');
    expect(active().vertices).toEqual([]);
    expect(app().perimeterVertices).toEqual([]);
  });

  it('takes it back out when placement is cancelled, history and all', () => {
    const depth = undoManager.depth();
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.addOutline());
    act(() => { undoManager.save(); app().setPerimeterVertices([{ x: 1, y: 1 }]); });
    act(() => app().setPerimeterVertices(null));

    expect(ids()).toEqual(['trace-1']);
    // Back on the outline that was selected, which is the very object it was.
    expect(app().activeTraceId).toBe('trace-1');
    expect(active()).toBe(outline);
    // Undo must not bring an empty outline back.
    expect(undoManager.depth()).toBe(depth);
    // Nothing to announce: the plan is as it was.
    expect(flash).not.toHaveBeenCalled();
  });

  it('lets a drawn one stand, with the add an Undo away', () => {
    const drawn = [{ x: 100, y: 0 }, { x: 150, y: 0 }, { x: 150, y: 50 }];
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.addOutline());
    const added = app().activeTraceId;
    act(() => {
      undoManager.save();
      app().setPerimeterOverlay({ vertices: drawn });
      app().setPerimeterVertices(null);
    });

    expect(ids()).toEqual(['trace-1', added]);
    expect(active().vertices).toEqual(drawn);
    act(() => { undoManager.undo(); });
    act(() => { undoManager.undo(); });
    expect(ids()).toEqual(['trace-1']);
  });

  // "Not drawn yet — click its corners on the plan, or paint over its walls":
  // going to the brush is the other way to draw the same outline, not a change
  // of mind.
  it('leaves it for the brush when the user goes to paint it instead', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.addOutline());
    const added = app().activeTraceId;
    act(() => {
      app().setPerimeterVertices(null);
      app().setDrawModeActive(true);
    });

    expect(ids()).toEqual(['trace-1', added]);
    expect(app().activeTraceId).toBe(added);
  });

  it('ends a redraw in progress first, the way Cancel would', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    expect(active().vertices).toEqual([]);
    act(() => result.current.addOutline());

    // The outline being redrawn is back, and the new one is being placed.
    expect(app().perimeterTraces[0]).toBe(outline);
    expect(app().perimeterTraces).toHaveLength(2);
    expect(app().perimeterVertices).toEqual([]);

    // …and abandoning the new one leaves exactly what there was.
    act(() => app().setPerimeterVertices(null));
    expect(ids()).toEqual(['trace-1']);
    expect(active()).toBe(outline);
  });

  it('replaces an abandoned add when asked for again part-way', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.addOutline());
    act(() => result.current.addOutline());
    expect(app().perimeterTraces).toHaveLength(2);

    act(() => app().setPerimeterVertices(null));
    expect(ids()).toEqual(['trace-1']);
  });

  it('does not take out an empty outline that was already there', () => {
    act(() => {
      useAppStore.setState({
        perimeterTraces: [outline, makeTrace({ id: 'trace-2' })],
        activeTraceId: 'trace-2',
      });
    });
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.startPlacing());
    act(() => app().setPerimeterVertices(null));

    expect(ids()).toEqual(['trace-1', 'trace-2']);
  });

  it('forgets the added outline when the plan changes underneath it', () => {
    const { result } = renderHook(() => useCornerPlacement());

    act(() => result.current.addOutline());
    act(() => {
      useAppStore.setState({ activeDocumentId: 'another-plan' });
      app().setPerimeterVertices(null);
    });

    expect(app().perimeterTraces).toHaveLength(2);
  });
});
