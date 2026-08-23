// @vitest-environment happy-dom
//
// Closing a plan has to end that plan's identity as well as its records. The
// Save As grant is cached against the plan's id for the life of the page, and a
// handle left behind sends the next property's first Ctrl+S into the closed
// plan's file with no picker.
//
// `forgetFileHandle` shipped with zero callers once already. These are the
// tests that notice if it happens again.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePlanManager } from '../usePlanManager';
import { getFileHandle, rememberFileHandle, forgetFileHandle } from '../../utils/fileHandles';
import { app, oneDocument, addParkedDocument, IMAGE_A, IMAGE_B } from './harness';

const drafts = vi.hoisted(() => ({
  readDocDraft: vi.fn(async () => ({ status: 'ok', state: { image: 'data:image/png;base64,X' } })),
  readHistoryRecord: vi.fn(async () => null),
  removePlan: vi.fn(async () => {}),
}));
vi.mock('../../utils/workspaceDrafts', () => drafts);
vi.mock('../../utils/confirmToast', () => ({ confirmToast: vi.fn(async () => true) }));
vi.mock('../../utils/notify', () => ({ notify: vi.fn(), flash: vi.fn() }));

// What the plan was holding, so the last-plan branch can be shown to free it:
// the decoded bitmap is keyed by the image and unreachable once the record is
// gone, and `restart()` leaves the record looking untouched.
const released = vi.hoisted(() => []);
vi.mock('../../components/canvas/imageCache', async (orig) => ({
  ...(await orig()),
  forgetImage: vi.fn((url) => { released.push(url); }),
}));

const handle = (name) => ({ name });

describe('usePlanManager', () => {
  let docA;
  let docB;

  beforeEach(() => {
    vi.clearAllMocks();
    released.length = 0;
    docA = oneDocument();
    act(() => { app().setImage(IMAGE_A); });
    docB = addParkedDocument({ image: IMAGE_B });
    [docA, docB].forEach(forgetFileHandle);
  });

  it('drops the closed plan\u2019s file handle', async () => {
    rememberFileHandle(docB, handle('Property B.floorplan'));
    const { result } = renderHook(() => usePlanManager());

    await act(async () => { await result.current.closePlan(docB, { confirmFirst: false }); });

    expect(getFileHandle(docB)).toBeUndefined();
    expect(app().documentOrder).not.toContain(docB);
  });

  it('leaves the other plans\u2019 handles alone', async () => {
    rememberFileHandle(docA, handle('Property A.floorplan'));
    rememberFileHandle(docB, handle('Property B.floorplan'));
    const { result } = renderHook(() => usePlanManager());

    await act(async () => { await result.current.closePlan(docB, { confirmFirst: false }); });

    expect(getFileHandle(docA)).toEqual(handle('Property A.floorplan'));
  });

  it('drops every handle when every plan closes', async () => {
    rememberFileHandle(docA, handle('Property A.floorplan'));
    rememberFileHandle(docB, handle('Property B.floorplan'));
    const { result } = renderHook(() => usePlanManager());

    await act(async () => { await result.current.closeAllPlans(); });

    expect(getFileHandle(docA)).toBeUndefined();
    expect(getFileHandle(docB)).toBeUndefined();
  });

  it('still removes the plan\u2019s stored records', async () => {
    const { result } = renderHook(() => usePlanManager());
    await act(async () => { await result.current.closePlan(docB, { confirmFirst: false }); });
    expect(drafts.removePlan).toHaveBeenCalledWith(docB);
  });
  // Closing the *last* plan is structurally different — the plan does not go
  // away, it is emptied in place and keeps its id — and that branch lived in
  // `App.jsx`, out of reach of any test, until it moved here. It is the branch
  // most able to leak, precisely because nothing about it looks like a close.
  describe('closing the last plan', () => {
    beforeEach(async () => {
      const { result } = renderHook(() => usePlanManager());
      await act(async () => { await result.current.closePlan(docB, { confirmFirst: false }); });
      expect(app().documentOrder).toEqual([docA]);
      released.length = 0;
    });

    it('empties the plan in place, keeping exactly one open', async () => {
      const { result } = renderHook(() => usePlanManager());
      await act(async () => { await result.current.closePlan(docA, { confirmFirst: false }); });

      expect(app().documentOrder).toHaveLength(1);
      expect(app().image).toBeNull();
    });

    it('drops its file handle even though the id survives', async () => {
      rememberFileHandle(docA, handle('Property A.floorplan'));
      const { result } = renderHook(() => usePlanManager());

      await act(async () => { await result.current.closePlan(docA, { confirmFirst: false }); });

      // `restart()` keeps the id, so an id check alone would say nothing
      // changed — which is how the next Ctrl+S landed in the closed file.
      expect(getFileHandle(docA)).toBeUndefined();
    });

    it('releases the image the plan was holding', async () => {
      const { result } = renderHook(() => usePlanManager());
      await act(async () => { await result.current.closePlan(docA, { confirmFirst: false }); });

      expect(released).toContain(IMAGE_A);
    });
  });
});
