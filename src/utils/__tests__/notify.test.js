// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { flash, notify } from '../notify';
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
  useAppStore.setState({ activeDocumentId: 'doc-1' });
});

describe('flash — what just happened to the plan', () => {
  it('is green unless it is said to be a refusal', () => {
    flash('Outline found.');
    expect(ws().statusFlash).toMatchObject({ text: 'Outline found.', tone: 'ok' });
    flash('An outline needs at least three corners', 'warn');
    expect(ws().statusFlash).toMatchObject({ tone: 'warn' });
  });

  it('keeps only the latest: there is nothing to stack', () => {
    flash('Found the outline.');
    flash('Area copied');
    expect(ws().statusFlash.text).toBe('Area copied');
  });

  it('never raises a notice', () => {
    flash('Could not do that', 'warn');
    expect(ws().notice).toBeNull();
  });
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

  it('keeps one, and the latest: a second replaces the first', () => {
    notify('The first.');
    notify('The second.');
    expect(ws().notice.text).toBe('The second.');
  });

  it('leaves the bar alone', () => {
    notify('Could not save the project file.');
    expect(ws().statusFlash).toBeNull();
  });
});
