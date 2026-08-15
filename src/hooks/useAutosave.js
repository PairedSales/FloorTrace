import { useState, useRef, useEffect, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import useAppStore from '../store/appStore';
import { AUTOSAVE_FIELDS } from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { getDraft, setDraft, removeDraft } from '../utils/draftStorage';

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
 *  - Restores the last autosaved draft on mount.
 *  - Subscribes to relevant store fields and debounces writes to the draft
 *    store (2 s of inactivity before writing).
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

  // ── storage helpers ───────────────────────────────────────────────────────
  const clearAutosavedDraft = useCallback(() => {
    removeDraft(LOCAL_DRAFT_STORAGE_KEY);
  }, []);

  // `withHistory` is off for the recurring debounced write: the undo stack is up
  // to 50 snapshots and dwarfs the document itself (2.3 MB vs 755 KB on the
  // largest fixture), and re-serialising it every 2 s buys nothing a user can
  // see. Exit paths write it, so history still survives a normal close; a draft
  // saved without it restores the document and starts undo empty.
  const saveAutosavedDraft = useCallback(async (snapshot, { withHistory = false } = {}) => {
    try {
      const payload = { state: snapshot };
      if (withHistory) payload.history = undoManager.getHistoryState();
      await setDraft(LOCAL_DRAFT_STORAGE_KEY, payload);
    } catch (error) {
      console.error('Failed to autosave local draft:', error);
      if (notify) notify('Autosave unavailable (storage full or blocked).', { type: 'warning' });
    }
  }, [notify]);

  const handleSaveOnExitChange = useCallback((enabled) => {
    setSaveOnExit(enabled);
    localStorage.setItem(SAVE_ON_EXIT_KEY, String(enabled));
    if (!enabled) {
      removeDraft(LOCAL_DRAFT_STORAGE_KEY);
    }
  }, []);

  // ── Restore draft on startup ──────────────────────────────────────────────
  useEffect(() => {
    const restoreAutosavedDraft = async () => {
      const saveOnExitEnabled = localStorage.getItem(SAVE_ON_EXIT_KEY) !== 'false';
      try {
        const savedWallModeRaw = localStorage.getItem(WALL_MODE_KEY);
        const savedData = saveOnExitEnabled ? await getDraft(LOCAL_DRAFT_STORAGE_KEY) : null;
        if (savedData) {
          const parsed = savedData;
          // Support both new wrapped format: { state: ..., history: ... }
          // and legacy flat format: { image: ..., roomOverlay: ... }
          const hasWrappedState = parsed && 'state' in parsed;
          const savedState = hasWrappedState ? parsed.state : parsed;
          const savedHistory = hasWrappedState ? parsed.history : null;

          if (savedState?.image) {
            useAppStore.getState().restoreFromSaved(savedState);
            if (typeof savedState.useInteriorWalls === 'boolean') {
              localStorage.setItem(WALL_MODE_KEY, String(savedState.useInteriorWalls));
            }
            if (savedHistory) {
              undoManager.setHistoryState(savedHistory);
            } else {
              undoManager.clear();
            }
            setHasRestoredState(true);
            if (notify) notify('Autosaved project restored.', { type: 'info' });
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
  }, [setHasRestoredState, setUseInteriorWalls, notify]);

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

        // Debounce: wait 2 seconds of inactivity before writing the draft.
        // This write, not the unload handler below, is what actually protects
        // the user's work.
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

  // Best-effort flush when the tab is hidden or unloaded, and the only write
  // that carries the undo history. It is not a guarantee: setDraft opens an
  // async IndexedDB transaction, which a browser is free to abandon once the
  // page is going away — least likely to complete on `beforeunload`, most
  // likely on `visibilitychange`, which fires while the page is still alive.
  // What actually protects recent edits is the 2 s debounced write above; this
  // narrows the window from 2 s to the last edit, and persists undo history.
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

      saveAutosavedDraft(snapshot, { withHistory: true });
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

