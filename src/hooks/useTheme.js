import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'floortrace:theme';
const THEMES = ['light', 'dark'];
const DEFAULT_THEME = 'light';

// Stamped on <html>, which is what index.css keys the dark token block off.
const apply = (theme) => {
  document.documentElement.setAttribute('data-theme', theme);
};

const save = (theme) => {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // persistence is best-effort
  }
};

// What this browser was last set to. There used to be a third answer, "match
// my computer"; someone who had picked it keeps what they were looking at —
// whichever way their computer is set today — written down as their choice, so
// the option going away does not change their screen.
const stored = () => {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (THEMES.includes(saved)) return saved;
    if (saved === 'system') {
      const theme = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      save(theme);
      return theme;
    }
  } catch {
    // unreadable storage is a first visit
  }
  return DEFAULT_THEME;
};

/**
 * useTheme
 *
 * Light, or night mode. Light until the user says otherwise: the plan is white
 * paper in every theme, and the people this app is for read dark text on a
 * light page more easily than the reverse. Night mode is one switch in
 * Settings, and it is kept.
 *
 * It does not follow the computer, and there is no option to. It did once,
 * which handed the dark shell to anyone whose Windows happened to be set dark,
 * whether or not they would have chosen it here; and as a third choice beside
 * Light and Dark it was a question most people could not answer.
 *
 * @returns {{ theme: 'light'|'dark', setTheme: (theme: string) => void,
 *             toggleTheme: () => void }}
 */
export function useTheme() {
  const [theme, setThemeState] = useState(() => (
    typeof document === 'undefined' ? DEFAULT_THEME : stored()
  ));

  useEffect(() => { apply(theme); }, [theme]);

  const setTheme = useCallback((next) => {
    if (!THEMES.includes(next)) return;
    setThemeState(next);
    save(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return { theme, setTheme, toggleTheme };
}
