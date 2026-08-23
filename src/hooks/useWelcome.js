import { useState } from 'react';

// Same `floortrace:` namespace as every other preference (`floortrace:theme`,
// `floortrace:saveOnExit`). One flag, one meaning: this browser has had a plan
// open at least once.
export const WELCOME_KEY = 'floortrace:welcomed';

const read = () => {
  try {
    return localStorage.getItem(WELCOME_KEY) === '1';
  } catch {
    // Private-mode Safari throws on access, not just on write.
    return false;
  }
};

/**
 * Marks the welcome as seen. A plain function rather than a setter off the
 * hook, so the one component that *decides* (WelcomeScreen) and the one that
 * *observes an image arriving* (Canvas) do not need two copies of the same
 * state — the flag is read fresh on every mount of the empty state, and the
 * empty state unmounts the moment an image exists.
 */
export function markWelcomed() {
  try {
    localStorage.setItem(WELCOME_KEY, '1');
  } catch {
    // persistence is best-effort; the welcome showing twice is not a defect
  }
}

/**
 * Whether to show the full first-run welcome rather than the compact empty
 * state. Read once per mount: the animation is worth watching once and is
 * noise on the fifth new plan of a session.
 *
 * @returns {boolean}
 */
export function useWelcome() {
  // No `window` means no localStorage and no first run to celebrate — treat it
  // as already welcomed so nothing large renders and then vanishes.
  const [showWelcome] = useState(() => (typeof window === 'undefined' ? false : !read()));
  return showWelcome;
}
