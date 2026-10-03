// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useTheme } from '../useTheme';

/**
 * The theme is light until the user turns night mode on, and that is kept.
 *
 * It used to follow the computer, so a Windows set to dark handed the app's
 * dark shell to someone who had never asked for it here. Following the
 * computer is no longer an option at all.
 */
const stamped = () => document.documentElement.getAttribute('data-theme');
const saved = () => localStorage.getItem('floortrace:theme');

const osPrefers = (scheme) => {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query.includes(scheme),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  // A computer set to dark, which is the case the default must not follow.
  osPrefers('dark');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('useTheme', () => {
  it('is light on a first visit, whatever the computer is set to', () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    expect(stamped()).toBe('light');
  });

  it('keeps night mode once the user has turned it on', () => {
    const first = renderHook(() => useTheme());
    act(() => first.result.current.toggleTheme());
    expect(stamped()).toBe('dark');
    first.unmount();

    // The next visit.
    document.documentElement.removeAttribute('data-theme');
    const second = renderHook(() => useTheme());
    expect(second.result.current.theme).toBe('dark');
    expect(stamped()).toBe('dark');
  });

  it('turns night mode off again', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggleTheme());
    act(() => result.current.toggleTheme());
    expect(result.current.theme).toBe('light');
    expect(saved()).toBe('light');
  });

  // "Match my computer" was a third choice. Someone who had picked it keeps
  // what they were looking at, written down as their own choice.
  it('settles a saved "match my computer" on what that computer shows, once', () => {
    localStorage.setItem('floortrace:theme', 'system');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('dark');
    expect(saved()).toBe('dark');
    cleanup();

    localStorage.setItem('floortrace:theme', 'system');
    osPrefers('light');
    expect(renderHook(() => useTheme()).result.current.theme).toBe('light');
    expect(saved()).toBe('light');
  });

  it('will not be set to anything but light or dark', () => {
    localStorage.setItem('floortrace:theme', 'sepia');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
    act(() => result.current.setTheme('system'));
    expect(result.current.theme).toBe('light');
  });
});
