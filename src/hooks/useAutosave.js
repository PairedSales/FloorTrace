import { useState, useRef, useEffect, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import useAppStore from '../store/appStore';
import { AUTOSAVE_FIELDS } from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { hashDataUrl } from '../utils/hash';
import { getDraft, setDraft, removeDraft } from '../utils/draftStorage';

const LOCAL_DRAFT_STORAGE_KEY = 'floortrace:autosave:v1';
const SAVE_ON_EXIT_KEY = 'floortrace:saveOnExit';
const WALL_MODE_KEY = 'floortrace:useInteriorWalls';

// Selector: pick only the autosave-relevant fields from the store.
const autosaveSelector = (state) =>
  AUTOSAVE_FIELDS.reduce((acc, k) => { acc[k] = state[k]; return acc; }, {});

// Pure camera state: where the user is looking, not what they have drawn. Pan
// and zoom are the most frequent interactions in a floorplan viewer and all six
// call sites end in a store write, so before this gate every pause in a
// stop-and-go pan rewrote the whole draft. The viewport is still persisted —
// by the next write that carries a real edit, and by the exit flush — so the
// only cost is that a restored draft opens on the last *edited* viewport.
//
// `canvasRotation` is deliberately not here: rotating is an edit to the
// document, not a camera move.
const CAMERA_ONLY_FIELDS = ['zoomScale', 'stageX', 'stageY', 'viewportSyncToken'];

const onlyCameraMoved = (slice, prevSlice) => {
  if (!prevSlice) return false;
  for (const key of AUTOSAVE_FIELDS) {
    if (CAMERA_ONLY_FIELDS.includes(key)) continue;
    if (!Object.is(slice[key], prevSlice[key])) return false;
  }
  return true;
};

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
  // The data URL last written to the image record. Compared by reference: the
  // store hands back the same string until the image itself is replaced, so a
  // pan, a vertex drag or a re-trace all leave it untouched and skip rewriting
  // ~770 kB of base64. Only the image-load and crop paths mint a new one.
  const writtenImageRef = useRef(null);

  const saveAutosavedDraft = useCallback(async (snapshot, { withHistory = false } = {}) => {
    try {
      const { image, ...stateWithoutImage } = snapshot;
      const payload = { state: stateWithoutImage };
      if (withHistory) payload.history = undoManager.getHistoryState();
      const imageChanged = writtenImageRef.current !== image;
      await setDraft(
        LOCAL_DRAFT_STORAGE_KEY,
        payload,
        { hash: hashDataUrl(image), dataUrl: image },
        imageChanged,
      );
      // Only on the success path: `setDraft` swallows its IndexedDB failure and
      // falls back to localStorage, and recording a write that did not happen
      // would skip the image on every later write.
      writtenImageRef.current = image;
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
          writtenImageRef.current = null;
          clearAutosavedDraft();
          return;
        }

        // Shallow equality is handled by the subscription itself, so at least
        // one autosave-relevant field changed — but `setViewportTransform`
        // mints a fresh `Math.random()` token per call, so even a camera update
        // landing on identical scale and position always gets here.
        if (onlyCameraMoved(slice, prevSlice)) return;

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
        writtenImageRef.current = null;
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

