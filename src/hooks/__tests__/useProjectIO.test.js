// @vitest-environment jsdom
//
// `Save all plans` composes each plan's state itself, and got it wrong twice in
// the same expression: a plan with no parked record fell back to the plan on
// screen, and a draft read back without its separate image record has no
// `image` key at all, so the spread let the live image through a second door.
//
// Both produce a file that is schema-valid, correctly named, and the wrong
// property. `planStateForSave` is unit-tested; this checks the loop that uses it.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjectIO } from '../useProjectIO';
import {
  app, oneDocument, addParkedDocument, addUnhydratedDocument, IMAGE_A, IMAGE_B,
} from './harness';

const IMAGE_C = 'data:image/png;base64,PLAN-C';

const serializer = vi.hoisted(() => ({ exportProject: vi.fn(async () => true) }));
vi.mock('../../utils/projectSerializer', async (importOriginal) => ({
  // `planStateForSave` stays real — it is the thing under test.
  ...(await importOriginal()),
  exportProject: serializer.exportProject,
}));

const drafts = vi.hoisted(() => ({
  readDocDraft: vi.fn(async () => ({ status: 'missing' })),
  readHistoryRecord: vi.fn(async () => null),
  removePlan: vi.fn(async () => {}),
}));
vi.mock('../../utils/workspaceDrafts', () => drafts);

const toasts = vi.hoisted(() => ({ notify: vi.fn(), flash: vi.fn() }));
vi.mock('../../utils/notify', () => toasts);
vi.mock('../../utils/imageLoader', () => ({ loadImageFromFile: vi.fn() }));
vi.mock('../../utils/detection', () => ({ prewarmDetection: vi.fn() }));

const saveAll = async () => {
  const { result } = renderHook(() => useProjectIO(vi.fn(), { current: null }, vi.fn()));
  await act(async () => { await result.current.handleSaveAllProjects(); });
};

/** Which image each call to `exportProject` carried. */
const savedImages = () => new Map(
  serializer.exportProject.mock.calls.map(([state, , , docId]) => [docId, state.image]),
);

describe('handleSaveAllProjects', () => {
  let docA;

  beforeEach(() => {
    vi.clearAllMocks();
    docA = oneDocument();
    act(() => { app().setImage(IMAGE_A); });
  });

  it('writes each parked plan\u2019s own drawing', async () => {
    const docB = addParkedDocument({ image: IMAGE_B });
    await saveAll();

    const images = savedImages();
    expect(images.get(docA)).toBe(IMAGE_A);
    expect(images.get(docB)).toBe(IMAGE_B);
  });

  // The blocker. `adoptWorkspace` opens with `clearParked()`, so a plan
  // reopened but never switched to has no parked record — and the old
  // `?? {}` spread left the active plan's state standing under its name.
  it('never writes the active plan into an unhydrated plan\u2019s file', async () => {
    const docB = addUnhydratedDocument();
    drafts.readDocDraft.mockResolvedValue({ status: 'ok', state: { image: IMAGE_C } });

    await saveAll();

    expect(drafts.readDocDraft).toHaveBeenCalledWith(docB);
    expect(savedImages().get(docB)).toBe(IMAGE_C);
    expect(savedImages().get(docB)).not.toBe(IMAGE_A);
  });

  // The second door: `writeDocDraft` stores the image as its own record, so a
  // draft whose image record is gone comes back with no `image` KEY — and a
  // spread over the live state then inherits the picture on screen.
  it('never lets a draft with no image key inherit the live image', async () => {
    const docB = addUnhydratedDocument();
    drafts.readDocDraft.mockResolvedValue({
      status: 'no-image',
      state: { projectName: 'Lost its picture' },
    });

    await saveAll();

    expect(savedImages().get(docB)).toBeNull();
    expect(toasts.notify).toHaveBeenCalledWith(
      expect.stringContaining('without its image'),
      expect.anything(),
    );
  });

  it('skips a plan it cannot read, and says so instead of inventing one', async () => {
    const docB = addUnhydratedDocument();
    drafts.readDocDraft.mockResolvedValue({ status: 'missing' });

    await saveAll();

    expect(savedImages().has(docB)).toBe(false);
    expect(toasts.notify).toHaveBeenCalledWith(
      expect.stringContaining('could not be read back'),
      expect.anything(),
    );
  });

  it('gives a background plan its own undo history, not none', async () => {
    const docB = addUnhydratedDocument();
    const history = { undoStack: [{ image: IMAGE_C }], redoStack: [] };
    drafts.readDocDraft.mockResolvedValue({ status: 'ok', state: { image: IMAGE_C } });
    drafts.readHistoryRecord.mockResolvedValue(history);

    await saveAll();

    const call = serializer.exportProject.mock.calls.find(([, , , id]) => id === docB);
    expect(call[1]).toBe(history);
  });

  it('flashes plainly when every plan saved', async () => {
    addParkedDocument({ image: IMAGE_B });
    await saveAll();
    expect(toasts.flash).toHaveBeenCalledWith('Saved 2 plans');
    expect(toasts.notify).not.toHaveBeenCalled();
  });
});
