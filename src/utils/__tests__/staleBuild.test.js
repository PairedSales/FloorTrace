// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isStaleChunkError, recoverFromStaleBuild, markBuildHealthy } from '../staleBuild';

const KEY = 'floortrace:recovering-stale-build';

describe('isStaleChunkError', () => {
  // The browsers disagree on both the type and the wording, and getting this
  // wrong either misses the recovery or reloads on an unrelated crash.
  it('recognises each browser\u2019s wording for a chunk that would not load', () => {
    for (const message of [
      'Failed to fetch dynamically imported module: https://x/assets/CanvasStage.abc.js',
      'error loading dynamically imported module',
      'Importing a module script failed.',
    ]) {
      expect(isStaleChunkError(new TypeError(message))).toBe(true);
    }
  });

  it('leaves an ordinary crash alone', () => {
    expect(isStaleChunkError(new Error('Cannot read properties of null'))).toBe(false);
    expect(isStaleChunkError(null)).toBe(false);
  });
});

describe('recoverFromStaleBuild', () => {
  let replace;

  beforeEach(() => {
    sessionStorage.clear();
    replace = vi.fn();
    delete window.location;
    window.location = { href: 'https://pairedsales.github.io/FloorTrace/', replace };
  });

  afterEach(() => { sessionStorage.clear(); });

  // A plain reload is served the same cached index.html and fails identically,
  // so the parameter is the whole point.
  it('reloads against a cache-busting URL', () => {
    expect(recoverFromStaleBuild()).toBe(true);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toMatch(/[?&]rebuild=\d+/);
  });

  // Without this a fault that is not a stale build becomes a reload loop, which
  // is a worse failure than the blank page it replaced.
  it('refuses a second attempt in the same session', () => {
    expect(recoverFromStaleBuild()).toBe(true);
    expect(recoverFromStaleBuild()).toBe(false);
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('clears the guard and the marker once a build is proven good', () => {
    recoverFromStaleBuild();
    expect(sessionStorage.getItem(KEY)).not.toBeNull();

    window.location = { href: 'https://pairedsales.github.io/FloorTrace/?rebuild=123' };
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;

    markBuildHealthy();

    expect(sessionStorage.getItem(KEY)).toBeNull();
    expect(replaceState).toHaveBeenCalled();
    expect(replaceState.mock.calls[0][2]).not.toContain('rebuild');
  });

  it('does nothing to a URL that carries no marker', () => {
    window.location = { href: 'https://pairedsales.github.io/FloorTrace/' };
    const replaceState = vi.fn();
    window.history.replaceState = replaceState;
    markBuildHealthy();
    expect(replaceState).not.toHaveBeenCalled();
  });
});
