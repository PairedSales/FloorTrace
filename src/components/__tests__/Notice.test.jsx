// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import Notice from '../Notice';
import useWorkspaceStore from '../../store/workspaceStore';
import { notify } from '../../utils/notify';

/**
 * The one notice. It replaced a toast stack, and the rules that matter are the
 * ones the stack broke: there is only ever one, it waits to be read, and it
 * never asks for more attention than the thing that went wrong deserves.
 */
beforeEach(() => {
  vi.useFakeTimers();
  useWorkspaceStore.setState({ notice: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const view = () => render(<Notice top="110px" />);

describe('the one notice', () => {
  // The complaint that ended the stack: two cards of different widths, one
  // over the other. A second notice takes the first one's place.
  it('replaces the one before it rather than stacking', () => {
    const v = view();
    act(() => notify('The first thing went wrong.'));
    act(() => notify('The second thing went wrong.'));
    expect(v.queryByText('The first thing went wrong.')).toBeNull();
    expect(v.getByText('The second thing went wrong.')).toBeTruthy();
    expect(v.container.querySelectorAll('[role="alert"], [role="status"]')).toHaveLength(1);
  });

  it('interrupts a screen reader for a failure and waits its turn for a caution', () => {
    const v = view();
    act(() => notify('Autosave stopped.', { type: 'warning' }));
    expect(v.getByRole('status').textContent).toContain('Autosave stopped.');
    expect(v.queryByRole('alert')).toBeNull();
    act(() => notify('The project file could not be saved.'));
    expect(v.getByRole('alert')).toBeTruthy();
  });

  it('goes when it is dismissed', () => {
    const v = view();
    act(() => notify('Something went wrong.'));
    fireEvent.click(v.getByRole('button', { name: 'Dismiss' }));
    expect(v.container.firstChild).toBeNull();
    expect(useWorkspaceStore.getState().notice).toBeNull();
  });

  it('offers the one thing to do about it, and goes once that is done', () => {
    const onClick = vi.fn();
    const v = view();
    act(() => notify('Autosave stopped.', { type: 'warning', action: { label: 'Save project file', onClick } }));
    fireEvent.click(v.getByRole('button', { name: 'Save project file' }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(v.container.firstChild).toBeNull();
  });
});

describe('how long it waits to be read', () => {
  it('leaves by itself, a caution sooner than a failure', () => {
    const v = view();
    act(() => notify('A caution.', { type: 'warning' }));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(v.container.firstChild).toBeNull();

    act(() => notify('A failure.'));
    act(() => { vi.advanceTimersByTime(8100); });
    expect(v.getByText('A failure.')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(v.container.firstChild).toBeNull();
  });

  it('stays while the pointer is on it, and a moment after it leaves', () => {
    const v = view();
    act(() => notify('A caution.', { type: 'warning' }));
    const card = v.getByRole('status');
    fireEvent.mouseEnter(card);
    act(() => { vi.advanceTimersByTime(60000); });
    expect(v.getByText('A caution.')).toBeTruthy();

    fireEvent.mouseLeave(card);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(v.getByText('A caution.')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(v.container.firstChild).toBeNull();
  });

  // A notice raised while an older one's timer is running must get its own
  // full time, not what was left of the first one's.
  it('gives a replacement its own time', () => {
    const v = view();
    act(() => notify('The first.', { type: 'warning' }));
    act(() => { vi.advanceTimersByTime(7000); });
    act(() => notify('The second.', { type: 'warning' }));
    act(() => { vi.advanceTimersByTime(2000); });
    expect(v.getByText('The second.')).toBeTruthy();
  });
});
