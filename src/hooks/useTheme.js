import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'floortrace:theme';
// In the order the phone's theme row cycles through them: from the default.
export const THEME_MODES = ['light', 'dark', 'system'];
const DEFAULT_THEME = 'light';

// The phone menu's theme row names the current mode, so the wording lives
// with the modes rather than in the component that happens to render it.
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
 * Light/dark/system, persisted. Light until the user says otherwise: the plan
 * is white paper in every theme, and the people this app is for read dark
 * text on a light page more easily than the reverse. It used to follow the
 * computer, which handed a dark shell to anyone whose Windows happened to be
 * set dark, whether or not they would have chosen it here. Dark, or following
 * the computer, is a choice made in Settings, and a choice made there is kept.
 *
 * @returns {{ theme: string, resolved: 'light'|'dark', cycleTheme: () => void,
 *             setTheme: (mode: string) => void }}
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return THEME_MODES.includes(saved) ? saved : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  });
  const [resolved, setResolved] = useState(() => (
    typeof document === 'undefined' ? DEFAULT_THEME : apply(theme)
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
