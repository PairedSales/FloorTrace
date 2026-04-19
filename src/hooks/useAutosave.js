import { useState, useRef, useEffect, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import useAppStore from '../store/appStore';
import { AUTOSAVE_FIELDS } from '../store/appStore';

const LOCAL_DRAFT_STORAGE_KEY = 'floortrace:autosave:v1';
const SAVE_ON_EXIT_KEY = 'floortrace:saveOnExit';
const WALL_MODE_KEY = 'floortrace:useInteriorWalls';

// Selector: pick only the autosave-relevant fields from the store.
const autosaveSelector = (state) =>
  AUTOSAVE_FIELDS.reduce((acc, k) => { acc[k] = state[k]; return acc; }, {});

/**
 * useAutosave
 *
 * Owns the entire draft-persistence lifecycle:
 *  - Restores the last autosaved draft from localStorage on mount.
 *  - Subscribes to relevant store fields and debounces writes to localStorage
 *    (2 s of inactivity before writing).
 *  - Exposes `saveOnExit` and `handleSaveOnExitChange` so the LeftPanel
 *    preference toggle can be wired without touching App directly.
 *
 * @returns {{ saveOnExit: boolean, handleSaveOnExitChange: (enabled: boolean) => void }}
 */
export function useAutosave(notify) {
  const setHasRestoredState = useAppStore((s) => s.setHasRestoredState);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);

  // ── save-on-exit preference (persisted in localStorage) ──────────────────
  const [saveOnExit, setSaveOnExit] = useState(() => {
    const stored = localStorage.getItem(SAVE_ON_EXIT_KEY);
    return stored === null ? true : stored === 'true';
  });

  // ── localStorage helpers ──────────────────────────────────────────────────
  const clearAutosavedDraft = useCallback(() => {
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
  }, []);

  const saveAutosavedDraft = useCallback((snapshot) => {
    try {
      localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error('Failed to autosave local draft:', error);
      if (notify) notify('Autosave unavailable (storage full or blocked).');
    }
  }, [notify]);

  const handleSaveOnExitChange = useCallback((enabled) => {
    setSaveOnExit(enabled);
    localStorage.setItem(SAVE_ON_EXIT_KEY, String(enabled));
    if (!enabled) {
      localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
    }
  }, []);

  // ── Restore draft on startup ──────────────────────────────────────────────
  useEffect(() => {
    const restoreAutosavedDraft = async () => {
      const saveOnExitEnabled = localStorage.getItem(SAVE_ON_EXIT_KEY) !== 'false';
      try {
        const savedWallModeRaw = localStorage.getItem(WALL_MODE_KEY);
        const savedStateRaw = saveOnExitEnabled ? localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY) : null;
        if (savedStateRaw) {
          const savedState = JSON.parse(savedStateRaw);
          if (savedState?.image) {
            useAppStore.getState().restoreFromSaved(savedState);
            if (typeof savedState.useInteriorWalls === 'boolean') {
              localStorage.setItem(WALL_MODE_KEY, String(savedState.useInteriorWalls));
            }
            setHasRestoredState(true);
            return;
          }
        }
        if (savedWallModeRaw === 'true' || savedWallModeRaw === 'false') {
          setUseInteriorWalls(savedWallModeRaw === 'true');
        }
      } catch (error) {
        console.error('Failed to restore autosaved draft:', error);
      }
      setHasRestoredState(true);
    };

    restoreAutosavedDraft();
  }, [setHasRestoredState, setUseInteriorWalls]);

  // Persist wall mode preference independently so it survives when no image
  // draft is present.
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state.useInteriorWalls,
      (value) => {
        localStorage.setItem(WALL_MODE_KEY, String(value));
      },
    );
    return () => unsub();
  }, []);

  // ── Debounced autosave on working-state changes ───────────────────────────
  const autosaveTimerRef = useRef(null);
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      autosaveSelector,
      (slice, prevSlice) => {
        const state = useAppStore.getState();
        if (!state._hasRestoredState) return;
        if (!saveOnExit) return;

        if (!slice.image) {
          clearAutosavedDraft();
          return;
        }

        // shallow equality is handled by the subscription itself — if we're
        // here, at least one autosave-relevant field changed.
        void prevSlice; // unused but documents intent

        // Debounce: wait 2 seconds of inactivity before writing to localStorage.
        if (autosaveTimerRef.current) {
          clearTimeout(autosaveTimerRef.current);
        }

        autosaveTimerRef.current = setTimeout(() => {
          saveAutosavedDraft(useAppStore.getState().getAutosaveState());
        }, 2000);
      },
      { equalityFn: shallow },
    );

    return () => {
      unsub();
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [saveOnExit, clearAutosavedDraft, saveAutosavedDraft]);

  // Flush current working state immediately when the tab is being hidden or
  // unloaded so accidental exits do not lose the most recent edits.
  useEffect(() => {
    const flushAutosaveNow = () => {
      const state = useAppStore.getState();
      if (!state._hasRestoredState) return;

      if (!saveOnExit) {
        clearAutosavedDraft();
        return;
      }

      const snapshot = state.getAutosaveState();
      if (!snapshot.image) {
        clearAutosavedDraft();
        return;
      }

      saveAutosavedDraft(snapshot);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAutosaveNow();
      }
    };

    window.addEventListener('beforeunload', flushAutosaveNow);
    window.addEventListener('pagehide', flushAutosaveNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flushAutosaveNow);
      window.removeEventListener('pagehide', flushAutosaveNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveOnExit, clearAutosavedDraft, saveAutosavedDraft]);

  return { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft };
}
