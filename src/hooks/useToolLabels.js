import { useState, useCallback } from 'react';

const TOOL_LABELS_KEY = 'floortrace:toolLabels';
const PREF_PREFIX = 'floortrace:';

/**
 * Whether the tool rail starts labelled, for a given storage.
 *
 * On by default for a browser that has never run FloorTrace: twelve icons in a
 * 48px column are unreadable until every one of them has been hovered, and
 * this is a tool people reach for occasionally rather than daily, so the first
 * session is exactly the one that needs the words. Any *other* `floortrace:`
 * key means this browser has used the app before — re-teaching a returning
 * user is how a new default reads as a regression — so they keep the compact
 * rail and can turn labels on from the rail or the View menu.
 *
 * An explicit choice always wins, and is never revisited: the rail must not
 * change width under the cursor because the app decided the user had learned
 * it.
 *
 * @param {Storage|null} storage
 * @returns {boolean}
 */
export function resolveInitialToolLabels(storage) {
  if (!storage) return true;
  try {
    const stored = storage.getItem(TOOL_LABELS_KEY);
    if (stored === 'true' || stored === 'false') return stored === 'true';
    if (typeof storage.key !== 'function') return true;
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key !== TOOL_LABELS_KEY && key?.startsWith(PREF_PREFIX)) return false;
    }
    return true;
  } catch {
    return true;
  }
}

/**
 * useToolLabels
 *
 * Names beside the tool-rail icons, persisted once the user chooses.
 *
 * @returns {{ toolLabels: boolean, setToolLabels: (value: boolean) => void }}
 */
export function useToolLabels() {
  const [toolLabels, setState] = useState(() => (
    typeof localStorage === 'undefined' ? true : resolveInitialToolLabels(localStorage)
  ));

  const setToolLabels = useCallback((value) => {
    const next = !!value;
    setState(next);
    try {
      localStorage.setItem(TOOL_LABELS_KEY, String(next));
    } catch {
      // persistence is best-effort
    }
  }, []);

  return { toolLabels, setToolLabels };
}
