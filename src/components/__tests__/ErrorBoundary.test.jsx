// @vitest-environment happy-dom
//
// The one screen whose whole job is to be right about something the user cannot
// check. It promised the autosaved draft was intact regardless of whether
// anything was being saved, so with "Save work on exit" off it told a user their
// work was safe at the moment it was not.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import ErrorBoundary from '../ErrorBoundary';
import useAppStore from '../../store/appStore';

const Boom = () => { throw new Error('render exploded'); };

const show = () => render(<ErrorBoundary><Boom /></ErrorBoundary>).container.textContent;

beforeEach(() => {
  // React logs the caught error itself; the test is about what is printed.
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('the crash screen’s promise about the draft', () => {
  it('says the draft is there when it is being written', () => {
    useAppStore.setState({ _hasRestoredState: true, draftState: 'saved' });
    expect(show()).toMatch(/work is not lost/i);
  });

  it('does not claim a draft when nothing is being kept', () => {
    useAppStore.setState({ _hasRestoredState: true, draftState: 'off' });
    const text = show();
    expect(text).not.toMatch(/work is not lost/i);
    expect(text).toMatch(/Nothing was saved/i);
  });

  it('says the last write failed rather than that the work is safe', () => {
    useAppStore.setState({ _hasRestoredState: true, draftState: 'error' });
    const text = show();
    expect(text).not.toMatch(/work is not lost/i);
    expect(text).toMatch(/refused to store/i);
  });

  // A throw on first paint is exactly when `draftState` is still its 'off'
  // default and knows nothing about what is on disk. Reading it there would
  // print "nothing was saved" over a draft that is sitting in IndexedDB.
  it('does not read the default as a verdict before the restore has run', () => {
    useAppStore.setState({ _hasRestoredState: false, draftState: 'off' });
    const text = show();
    expect(text).not.toMatch(/Nothing was saved/i);
    expect(text).toMatch(/reloading reads it back/i);
  });
});
