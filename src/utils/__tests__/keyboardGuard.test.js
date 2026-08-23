// @vitest-environment happy-dom
//
// While a scan or a trace runs it is holding the image it started from. The
// shortcuts that replace that image were reaching it: a crop or an undo halfway
// through a trace turned the result into a description of ink that is gone, and
// nothing about the answer looked wrong afterwards.
//
// The guard is a capture-phase listener rather than a branch in
// `shortcutsBlocked`, because that function's callers hand it only `e.target`
// and *which key* is the whole question — blocking every shortcut while busy
// would also take Escape and Ctrl+Alt plan switching, and switching plans
// mid-trace is a case this app deliberately supports.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import '../keyboardGuard';

const seen = [];
const listener = (e) => seen.push(e);

beforeEach(() => {
  seen.length = 0;
  useAppStore.setState({ isProcessing: false });
  useWorkspaceStore.setState({ statusFlash: null });
  window.addEventListener('keydown', listener);
  window.addEventListener('mousedown', listener);
});
afterEach(() => {
  window.removeEventListener('keydown', listener);
  window.removeEventListener('mousedown', listener);
});

const press = (init) => window.dispatchEvent(
  new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
);
const reaches = () => seen.length > 0;

describe('shortcuts that would invalidate work in flight', () => {
  it('lets everything through when nothing is running', () => {
    press({ key: 'z', ctrlKey: true });
    expect(reaches()).toBe(true);
  });

  it('stops undo, redo, paste, open and save while work is running', () => {
    useAppStore.setState({ isProcessing: true });
    for (const key of ['z', 'y', 'v', 'o', 's']) {
      seen.length = 0;
      press({ key, ctrlKey: true });
      expect(reaches(), `Ctrl+${key} reached the app`).toBe(false);
    }
  });

  // Crop and erase are the two of the nine that rewrite the image, and they are
  // the only two gated: entering any other mode changes nothing the running job
  // was computed from, and the rail's own buttons are not gated at all.
  it('stops the digits that rewrite the image, and only those', () => {
    useAppStore.setState({ isProcessing: true });
    for (const code of ['Digit8', 'Digit9']) {
      seen.length = 0;
      press({ key: code.slice(5), code });
      expect(reaches(), `${code} reached the app`).toBe(false);
    }
    seen.length = 0;
    // The brush, during a scan: the longest wait in the app, and painting an
    // outline through it takes nothing away from it.
    press({ key: '1', code: 'Digit1' });
    press({ key: '5', code: 'Digit5' });
    expect(seen).toHaveLength(2);
  });

  // Switching plans mid-trace is supported on purpose: the result is held and
  // replayed when that plan comes back.
  it('leaves plan switching, outline switching and Escape alone', () => {
    useAppStore.setState({ isProcessing: true });
    press({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true });
    press({ key: '1', code: 'Digit1', altKey: true });
    press({ key: 'Escape' });
    press({ key: 'f' });
    expect(seen).toHaveLength(4);
  });

  it('never touches a key typed into a field', () => {
    useAppStore.setState({ isProcessing: true });
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'z', ctrlKey: true, bubbles: true, cancelable: true,
    }));
    expect(reaches()).toBe(true);
    input.remove();
  });

  // Bound straight to undo/redo, through no guard at all — this listener is the
  // only place they can be reached.
  it('stops the mouse back and forward buttons while work is running', () => {
    useAppStore.setState({ isProcessing: true });
    window.dispatchEvent(new MouseEvent('mousedown', { button: 3, bubbles: true, cancelable: true }));
    expect(reaches()).toBe(false);
    window.dispatchEvent(new MouseEvent('mousedown', { button: 0, bubbles: true, cancelable: true }));
    expect(reaches()).toBe(true);
  });

  // Silently eating a shortcut is the same screen as an app that has stopped
  // responding.
  it('says why the key did nothing, without promising a Stop button', () => {
    useAppStore.setState({ isProcessing: true });
    press({ key: 'z', ctrlKey: true });
    const { text } = useWorkspaceStore.getState().statusFlash ?? {};
    expect(text).toMatch(/working/i);
    // The Stop is only there past five seconds, and only for work the detection
    // worker can be terminated for — an OCR scan has neither.
    expect(text).not.toMatch(/stop/i);
  });
});

describe('shortcutsBlocked', () => {
  it('still blocks on a modal, a menu and a text field', async () => {
    const { shortcutsBlocked } = await import('../keyboardGuard');
    useWorkspaceStore.setState({ menuOpen: true });
    expect(shortcutsBlocked(document.body)).toBe(true);
    useWorkspaceStore.setState({ menuOpen: false });
    expect(shortcutsBlocked(document.body)).toBe(false);
    // …and is deliberately unaffected by `isProcessing`: it cannot see the key.
    useAppStore.setState({ isProcessing: true });
    expect(shortcutsBlocked(document.body)).toBe(false);
  });
});

// Guards against the listener being installed twice by a stray import.
it('installs one guard, whatever imports it', async () => {
  const spy = vi.spyOn(window, 'addEventListener');
  await import('../keyboardGuard');
  expect(spy.mock.calls.filter(([type]) => type === 'keydown')).toHaveLength(0);
  spy.mockRestore();
});
