// @vitest-environment jsdom
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

const handle = (name) => ({ name });

describe('usePlanManager', () => {
  let docA;
  let docB;

  beforeEach(() => {
    vi.clearAllMocks();
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
});
