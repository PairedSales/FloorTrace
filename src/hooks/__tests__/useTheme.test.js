// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';
import { useTheme } from '../useTheme';

/**
 * The theme is light until the user says otherwise, and what they say is kept.
 *
 * It used to follow the computer, so a Windows set to dark handed the app's
 * dark shell to someone who had never asked for it here.
 */
const stamped = () => document.documentElement.getAttribute('data-theme');

// A computer set to dark, which is the case the default must not follow.
const osPrefersDark = () => {
  vi.stubGlobal('matchMedia', (query) => ({
    matches: query.includes('dark'),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
};

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  osPrefersDark();
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

  it('keeps dark once the user has chosen it', () => {
    const first = renderHook(() => useTheme());
    act(() => first.result.current.setTheme('dark'));
    expect(stamped()).toBe('dark');
    first.unmount();

    // The next visit.
    document.documentElement.removeAttribute('data-theme');
    const second = renderHook(() => useTheme());
    expect(second.result.current.theme).toBe('dark');
    expect(stamped()).toBe('dark');
  });

  it('still follows the computer for someone who asks it to', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.setTheme('system'));
    expect(stamped()).toBe('dark');
  });

  it('falls back to light on a saved value it does not know', () => {
    localStorage.setItem('floortrace:theme', 'sepia');
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe('light');
  });

  it('cycles from the default: light, dark, then the computer', () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('dark');
    act(() => result.current.cycleTheme());
    expect(result.current.theme).toBe('system');
  });
});
