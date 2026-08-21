import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'floortrace:theme';
export const THEME_MODES = ['system', 'light', 'dark'];

// Two places name the current mode — the command bar's toggle and the View
// menu's row — so the wording lives with the modes rather than in whichever
// component happened to render it first.
export const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

const prefersDark = () => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? true;

// Stamped on <html>, which is what index.css keys the dark token block off.
// Only ever 'light' or 'dark' — 'system' is resolved here rather than left for
// CSS, so a token can never be defined in a media block the toggle cannot beat.
const apply = (mode) => {
  const resolved = mode === 'system' ? (prefersDark() ? 'dark' : 'light') : mode;
  document.documentElement.setAttribute('data-theme', resolved);
  return resolved;
};

/**
 * useTheme
 *
 * Light/dark/system, persisted. Defaults to 'system': this app is a desktop
 * tool and Windows users expect it to follow the OS, and the alternative —
 * the hardcoded dark shell it had before — put a #ffffff canvas against
 * #21222C chrome, a 15.8:1 step at the panel edge.
 *
 * @returns {{ theme: string, resolved: 'light'|'dark', cycleTheme: () => void,
 *             setTheme: (mode: string) => void }}
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEME_MODES.includes(saved) ? saved : 'system';
    } catch {
      return 'system';
    }
  });
  const [resolved, setResolved] = useState(() => (
    typeof document === 'undefined' ? 'dark' : apply(theme)
  ));

  useEffect(() => {
    setResolved(apply(theme));
    if (theme !== 'system') return;
    // Only 'system' listens: a pinned choice must not move when the OS does.
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return;
    const onChange = () => setResolved(apply('system'));
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((mode) => {
    if (!THEME_MODES.includes(mode)) return;
    setThemeState(mode);
    try {
      localStorage.setItem(THEME_KEY, mode);
    } catch {
      // persistence is best-effort
    }
  }, []);

  const cycleTheme = useCallback(() => {
    setTheme(THEME_MODES[(THEME_MODES.indexOf(theme) + 1) % THEME_MODES.length]);
  }, [theme, setTheme]);

  return { theme, resolved, cycleTheme, setTheme };
}
