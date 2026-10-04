// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { flashAt, notify } from '../notify';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * How loudly the app speaks, and through which of its two passing voices.
 *
 * The rule under test is the one that replaced a stack of toasts: what happened
 * to the plan is one line in the bar, and a notice is for a failure that has
 * nowhere on the plan to be said. Neither keeps a queue.
 */
const ws = () => useWorkspaceStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState({ statusFlash: null, notice: null });
  useAppStore.setState({ errorAnchor: null, activeDocumentId: 'doc-1' });
});

describe('notify — something outside the plan went wrong', () => {
  it('is a failure unless it is said to be a caution', () => {
    notify('Could not open that file.');
    expect(ws().notice).toMatchObject({ text: 'Could not open that file.', tone: 'crit', action: null });
    notify('Autosave stopped.', { type: 'warning' });
    expect(ws().notice).toMatchObject({ tone: 'warn' });
  });

  // No good news and no bulletins: those were what filled the old stack.
  it('refuses to carry anything that is not a failure', () => {
    expect(() => notify('Outline found.', { type: 'success' })).toThrow(/failures/);
    expect(() => notify('Basement set to count as below grade.', { type: 'info' })).toThrow(/failures/);
    expect(ws().notice).toBeNull();
  });
});

describe('flashAt — a refusal with a place on the plan', () => {
  const anchor = { runs: [[{ x: 0, y: 0 }, { x: 10, y: 10 }], [{ x: 10, y: 0 }, { x: 0, y: 10 }]] };

  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lets the highlight go a little after the words', () => {
    flashAt('That would make the outline cross itself', anchor);
    vi.advanceTimersByTime(6100);
    expect(useAppStore.getState().errorAnchor).toBe(anchor);
    vi.advanceTimersByTime(2000);
    expect(useAppStore.getState().errorAnchor).toBeNull();
  });

  // An anchor is a place on one drawing. Clearing it later must not reach
  // across a plan switch and wipe one raised since on a different plan.
  it('does not clear a highlight raised on another plan in the meantime', () => {
    flashAt('That would make the outline cross itself', anchor);
    const other = { runs: [[{ x: 5, y: 5 }, { x: 6, y: 6 }]] };
    useAppStore.setState({ activeDocumentId: 'doc-2', errorAnchor: other });
    vi.advanceTimersByTime(10000);
    expect(useAppStore.getState().errorAnchor).toBe(other);
  });
});
