import { useState, useRef, useEffect, useCallback } from 'react';
import { shallow } from 'zustand/shallow';
import { notify, flash } from '../utils/notify';
import useAppStore from '../store/appStore';
import { AUTOSAVE_FIELDS } from '../store/appStore';
import * as undoManager from '../store/undoManager';
import {
  readWorkspaceIndex, writeWorkspaceIndex, removeWorkspace,
  writeDocDraft, readDocDraft, removePlan,
  writeHistoryRecord, readHistoryRecord,
  adoptAbandonedWorkspace, sweepOrphans, claimWorkspaceSession,
  isQuotaError, LEGACY_DRAFT_KEY,
} from '../utils/workspaceDrafts';
import { getDraft, removeDraft } from '../utils/draftStorage';
import { documentLabel, parkedStateFor, parkedHistoryFor } from '../store/documentManager';

const SAVE_ON_EXIT_KEY = 'floortrace:saveOnExit';
// Comfortably inside `STALE_SESSION_MS`, so a tab that is merely idle is never
// mistaken for one that has closed.
const HEARTBEAT_MS = 30 * 1000;
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
export function useAutosave() {
  const setHasRestoredState = useAppStore((s) => s.setHasRestoredState);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);

  // ── save-on-exit preference (persisted in localStorage) ──────────────────
  const [saveOnExit, setSaveOnExit] = useState(() => {
    const stored = localStorage.getItem(SAVE_ON_EXIT_KEY);
    return stored === null ? true : stored === 'true';
  });

  // ── storage helpers ───────────────────────────────────────────────────────

  // The debounced write in flight, if any.
  //
  // Declared here rather than beside its effect because every path that
  // *removes* a plan's records has to cancel it first. A timer scheduled two
  // seconds ago does not know the plan was closed, the last plan emptied, or
  // autosave switched off — it just fires and writes the records back, and
  // `restart` keeps the plan's id, so that write lands under a live key and
  // survives the reload as a plan the user had closed.
  const autosaveTimerRef = useRef(null);
  const cancelPendingWrite = useCallback(() => {
    if (autosaveTimerRef.current) {
      clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  // Every plan the workspace holds, not just the one on screen: switching the
  // preference off must leave nothing behind, and it used to sweep one key.
  const clearAutosavedDraft = useCallback(async () => {
    cancelPendingWrite();
    // The image records are about to go, so nothing may still claim they are
    // written. Switching the preference off and back on otherwise rewrites
    // every plan with `imageChanged: false` against an image that no longer
    // exists — and the plan is silently dropped on the next reload.
    writtenImageByDocRef.current.clear();
    const index = await readWorkspaceIndex();
    if (index) await removeWorkspace(index);
    removeDraft(LEGACY_DRAFT_KEY);
  }, [cancelPendingWrite]);

  /**
   * What the index should say right now. Built from the store rather than
   * accumulated, so it cannot drift from the plans that actually exist.
   */
  const buildIndex = useCallback(() => {
    const state = useAppStore.getState();
    const docs = {};
    state.documentOrder.forEach((docId, i) => {
      const meta = state.documents[docId] ?? {};
      const isActive = docId === state.activeDocumentId;
      docs[docId] = {
        // A tab has to be drawable before its plan is hydrated, so the label is
        // resolved now rather than derived from state nobody has loaded yet.
        title: documentLabel({
          projectName: isActive ? state.projectName : meta.title,
          sourceFileName: meta.sourceFileName,
          index: i,
        }),
        sourceFileName: meta.sourceFileName ?? null,
        // This plan's own timestamp, recorded when it was parked. Stamping
        // every plan on every write made the field say "the workspace was
        // saved", which is not what a per-plan updatedAt means.
        updatedAt: isActive ? Date.now() : (meta.updatedAt ?? Date.now()),
        hasWork: isActive ? Boolean(state.image) : Boolean(meta.hasWork),
      };
    });
    return { order: [...state.documentOrder], activeId: state.activeDocumentId, docs };
  }, []);

  // Writing the index, deferred to a microtask and coalesced.
  //
  // Deferred because a plan transition is several `set` calls, and the index
  // has to describe the end of one. `closeDocument` trims `documentOrder` and
  // *then* adopts a successor, so a write that runs synchronously on the first
  // of those reads a half-finished transition and stamps `activeId` with the id
  // of the plan being closed — producing exactly the stale index this exists to
  // prevent, and doing it on every close rather than occasionally.
  //
  // Coalesced because those same several sets would otherwise each write.
  const indexWriteQueued = useRef(false);
  const queueIndexWrite = useCallback(() => {
    if (indexWriteQueued.current) return;
    indexWriteQueued.current = true;
    queueMicrotask(() => {
      indexWriteQueued.current = false;
      if (!useAppStore.getState()._hasRestoredState) return;
      writeWorkspaceIndex(buildIndex()).catch((error) => {
        console.error('Failed to write the workspace index:', error);
      });
    });
  }, [buildIndex]);


  // `withHistory` is off for the recurring debounced write: the undo stack is up
  // to 50 snapshots and dwarfs the document itself (2.3 MB vs 755 KB on the
  // largest fixture), and re-serialising it every 2 s buys nothing a user can
  // see. Exit paths write it, so history still survives a normal close; a draft
  // saved without it restores the document and starts undo empty.
  // The data URL last written to the image record. Compared by reference: the
  // store hands back the same string until the image itself is replaced, so a
  // pan, a vertex drag or a re-trace all leave it untouched and skip rewriting
  // ~770 kB of base64. Only the image-load and crop paths mint a new one.
  // Keyed by plan. One slot eventually reports "unchanged" for a plan whose
  // image record was never written this session, and then skips ~770 kB of
  // base64 forever — silently reinstating the exact cost the image split exists
  // to avoid. Deleted when a plan closes, so a leaked entry cannot outlive it.
  const writtenImageByDocRef = useRef(new Map());

  const saveAutosavedDraft = useCallback(async (docId, snapshot, { withHistory = false } = {}) => {
    if (!docId) return;
    try {
      const imageChanged = writtenImageByDocRef.current.get(docId) !== snapshot.image;
      await writeDocDraft(docId, snapshot, imageChanged);
      if (withHistory) await writeHistoryRecord(docId, undoManager.getHistoryState());
      await writeWorkspaceIndex(buildIndex());
      // Only on the success path: recording a write that did not happen would
      // skip the image on every later write.
      writtenImageByDocRef.current.set(docId, snapshot.image);
      useAppStore.getState().setDraftState('saved');
    } catch (error) {
      console.error('Failed to autosave local draft:', error);
      // Both channels, by the routing rule: the status bar carries it for as
      // long as it stays true, and the toast fires once because a storage
      // refusal is the one autosave event the user has to act on.
      useAppStore.getState().setDraftState('error');
      notify(
        isQuotaError(error)
          // Distinguished because the two need different actions from the user:
          // one is "make room", the other is "this browser will not store".
          ? 'Autosave stopped — this browser is out of storage. Export before you close the tab.'
          : 'Autosave is unavailable — storage is full or blocked.',
        { type: 'warning', id: 'autosave' },
      );
    }
  }, [buildIndex]);

  const handleSaveOnExitChange = useCallback((enabled) => {
    setSaveOnExit(enabled);
    localStorage.setItem(SAVE_ON_EXIT_KEY, String(enabled));
    if (!enabled) {
      useAppStore.getState().setDraftState('off');
      // Every plan, not just the one on screen. Sweeping one key left the rest
      // on disk after the user had said to keep nothing.
      clearAutosavedDraft();
      return;
    }
    // Writes now rather than waiting for the next edit. Switching it on and
    // seeing "Saving draft…" sit there until you happen to touch something is
    // the status bar telling the truth about the wrong thing.
    const state = useAppStore.getState();
    if (state._hasRestoredState && state.image) {
      state.setDraftState('pending');
      saveAutosavedDraft(state.activeDocumentId, state.getParkedState());
    } else {
      state.setDraftState('saved');
    }
  }, [saveAutosavedDraft, clearAutosavedDraft]);

  /**
   * Rebuild the open plans from the index.
   *
   * The active plan is hydrated eagerly because it is about to be rendered;
   * every other plan is opened with what the index knows — enough to draw a
   * tab — and hydrated on first switch. Reading seven multi-megabyte images at
   * startup to show one of them is the wrong trade.
   *
   * A plan whose record cannot be read is counted and dropped rather than
   * silently skipped: an index that names more plans than came back is exactly
   * the sort of quiet loss this app must not have.
   */
  const restoreWorkspace = useCallback(async (index) => {
    const store = useAppStore.getState();
    // The index's own choice first, then any other plan it names. One plan
    // whose record is gone — the plan that was open when a close left the
    // index stale, most likely — used to discard every *other* plan with it,
    // silently, while their records sat intact on disk under keys nothing
    // would read again. A workspace needs one plan to stand on, not that one.
    const preferred = index.order.includes(index.activeId) ? index.activeId : index.order[0];
    const candidates = [preferred, ...index.order.filter((id) => id !== preferred)];

    let activeId = null;
    let activeDraft = null;
    const missing = new Set();
    for (const docId of candidates) {
      const draft = await readDocDraft(docId);
      if (draft.status !== 'missing' && draft.status !== 'malformed') {
        activeId = docId;
        activeDraft = draft;
        break;
      }
      missing.add(docId);
    }
    if (!activeId) {
      // Nothing to stand on. Better to start clean than to open a workspace
      // whose visible plan is empty for reasons the user cannot see.
      return { opened: 0, lost: index.order.length };
    }

    // Only the plans that were probed and failed are dropped; the rest are
    // opened un-hydrated as before, and answer for themselves on first switch.
    const order = index.order.filter((docId) => !missing.has(docId));

    store.adoptWorkspace(order.map((docId) => ({
      docId,
      meta: {
        sourceFileName: index.docs?.[docId]?.sourceFileName ?? null,
        title: index.docs?.[docId]?.title ?? null,
        hasWork: Boolean(index.docs?.[docId]?.hasWork),
        hydrated: docId === activeId,
      },
    })), activeId);

    store.restoreFromSaved(activeDraft.state);
    if (typeof activeDraft.state.useInteriorWalls === 'boolean') {
      localStorage.setItem(WALL_MODE_KEY, String(activeDraft.state.useInteriorWalls));
    }
    writtenImageByDocRef.current.set(activeId, activeDraft.state.image ?? null);

    const savedHistory = await readHistoryRecord(activeId);
    if (savedHistory) undoManager.setHistoryState(savedHistory);
    else undoManager.clear();

    // An image record that went missing leaves the traces and calibration
    // intact and worth showing; the plan simply cannot be edited against ink
    // that is not there. Counted so the user is told, not silently degraded.
    const lost = missing.size + (activeDraft.status === 'no-image' ? 1 : 0);
    return { opened: order.length, lost };
  }, []);

  // ── Restore the workspace on startup ─────────────────────────────────────
  useEffect(() => {
    const restore = async () => {
      const saveOnExitEnabled = localStorage.getItem(SAVE_ON_EXIT_KEY) !== 'false';
      // 'pending' until the read actually finishes, not 'saved' on the way in.
      // Claiming the outcome first meant that a startup which never got past
      // its first read reported the draft as safe for the whole session, which
      // is the most expensive thing this status bar can say wrongly.
      useAppStore.getState().setDraftState(saveOnExitEnabled ? 'pending' : 'off');

      try {
        const savedWallModeRaw = localStorage.getItem(WALL_MODE_KEY);
        if (!saveOnExitEnabled) {
          if (savedWallModeRaw === 'true' || savedWallModeRaw === 'false') {
            setUseInteriorWalls(savedWallModeRaw === 'true');
          }
          setHasRestoredState(true);
          return;
        }

        // Our own index first; failing that, the newest workspace a dead
        // session left behind. The session id lives in `sessionStorage`, so
        // before this every browser restart stranded a whole workspace on disk
        // — the records were all still there, and nothing could name them.
        const index = (await readWorkspaceIndex()) ?? (await adoptAbandonedWorkspace());
        // A draft written before the workspace existed. Read once and adopted
        // as the first plan, so upgrading does not look like losing your work.
        const legacy = index ? null : await getDraft(LEGACY_DRAFT_KEY);
        const legacyState = legacy && ('state' in legacy ? legacy.state : legacy);

        if (legacyState?.image) {
          useAppStore.getState().restoreFromSaved(legacyState);
          if (typeof legacyState.useInteriorWalls === 'boolean') {
            localStorage.setItem(WALL_MODE_KEY, String(legacyState.useInteriorWalls));
          }
          const legacyHistory = legacy && 'history' in legacy ? legacy.history : null;
          if (legacyHistory) undoManager.setHistoryState(legacyHistory);
          else undoManager.clear();
          setHasRestoredState(true);
          flash('Autosaved project restored');
          return;
        }

        if (index?.order?.length) {
          const restored = await restoreWorkspace(index);
          if (restored.opened > 0) {
            setHasRestoredState(true);
            // One message with a count, never N toasts. A workspace of seven
            // plans restoring is one event, not seven.
            if (restored.lost > 0) {
              notify(
                `Restored ${restored.opened} of ${restored.opened + restored.lost} plans — `
                + `${restored.lost === 1 ? 'one could not be read' : `${restored.lost} could not be read`}.`,
                { type: 'warning', id: 'restore' },
              );
            } else {
              flash(restored.opened === 1
                ? 'Autosaved project restored'
                : `Restored ${restored.opened} plans`);
            }
            return;
          }
        }

        if (savedWallModeRaw === 'true' || savedWallModeRaw === 'false') {
          setUseInteriorWalls(savedWallModeRaw === 'true');
        }
      } catch (error) {
        // A failed restore is a plan not reopened. It must never also mean
        // autosave off for the session, which is what leaving the flag false
        // does — so the `finally` below sets it whatever happened here.
        console.error('Failed to restore autosaved workspace:', error);
        notify('Could not read the saved workspace — new work will still be saved.', {
          type: 'warning', id: 'restore',
        });
      } finally {
        setHasRestoredState(true);
        const store = useAppStore.getState();
        if (store.draftState === 'pending') store.setDraftState('saved');
      }
    };

    restore();
  }, [setHasRestoredState, setUseInteriorWalls, restoreWorkspace]);

  // ── Keep this session's claim fresh, and take out the rubbish ───────────
  //
  // The heartbeat is what makes adoption safe: a tab that is still open keeps
  // restamping its index, so `adoptAbandonedWorkspace` can only ever elect one
  // whose session is genuinely gone. Without it, opening a second tab would
  // take the first tab's plans.
  //
  // The sweep is the other half of the same problem. Nothing could enumerate
  // keys before, so a stranded workspace was both unreachable and undeletable,
  // and every restart added another one.
  useEffect(() => {
    if (!saveOnExit) return undefined;

    // Answer other tabs from now on, so none of them adopts this workspace.
    claimWorkspaceSession();

    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 3000));
    const cancelIdle = window.cancelIdleCallback ?? clearTimeout;
    const sweep = idle(() => {
      sweepOrphans()
        .then(({ plans, workspaces }) => {
          if (plans || workspaces) {
            console.info(`Swept ${plans} orphaned plan record(s) and ${workspaces} dead workspace(s).`);
          }
        })
        .catch((error) => console.warn('Sweeping orphaned drafts failed:', error));
    }, { timeout: 8000 });

    const beat = setInterval(() => {
      const state = useAppStore.getState();
      if (!state._hasRestoredState || !state.documentOrder.length) return;
      writeWorkspaceIndex(buildIndex()).catch(() => {});
    }, HEARTBEAT_MS);

    return () => {
      cancelIdle(sweep);
      clearInterval(beat);
    };
  }, [saveOnExit, buildIndex]);

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

  // ── Keep the index describing the plans that actually exist ─────────────
  //
  // `removePlan` deletes a plan's own records and touches the index not at all,
  // and no close path wrote it. Closing the active plan used to be repaired by
  // accident: the debounced write that followed was armed with the *closing*
  // plan's id, and its last step rewrote the index from live state. That write
  // was putting the neighbour's drawing under the closed plan's key, so it had
  // to go — which left a stale index naming a plan whose records are gone, and
  // a restore that answers that by discarding the whole workspace.
  //
  // Opening and reordering are the same fact about the same object, so they
  // land here too. The index is small; writing it again costs nothing next to
  // the multi-megabyte image writes it sits behind.
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state.documentOrder,
      () => { if (saveOnExit) queueIndexWrite(); },
    );
    return () => unsub();
  }, [saveOnExit, queueIndexWrite]);

  // ── Write a plan when it is parked ────────────────────────────────────────
  //
  // The moment a plan leaves the store root is the right time to write it, and
  // the only time its undo history can be written at all: history lives in
  // module state that belongs to whichever plan is live, so once another plan
  // has adopted the stacks there is nothing left to read.
  //
  // Without this, only the active plan's history ever reached disk — through
  // the exit flush — and every background plan came back from a reload with an
  // empty undo stack. Which is exactly what it did.
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      (state) => state.activeDocumentId,
      (activeId, previousId) => {
        if (!previousId || previousId === activeId) return;
        const state = useAppStore.getState();
        if (!state._hasRestoredState || !saveOnExit) return;

        // The plan that just left the root, as it was when it left.
        const parkedState = parkedStateFor(previousId);
        if (!parkedState?.image) return;

        writeDocDraft(previousId, parkedState, true)
          // Only on the success path, the same rule `saveAutosavedDraft` states
          // above. Recorded before the write, one failed park marks the image
          // as on disk forever: every later write then passes
          // `imageChanged: false` and stores a state record whose `imageKey`
          // points at nothing, the plan reloads without its drawing, and the
          // `!slice.image` branch removes it.
          .then(() => { writtenImageByDocRef.current.set(previousId, parkedState.image); })
          .then(() => writeHistoryRecord(previousId, parkedHistoryFor(previousId)))
          .then(() => writeWorkspaceIndex(buildIndex()))
          // Reported, not just on failure: this is the write that saves a plan
          // being switched away from, and the debounced timer it supersedes had
          // already put the status bar into 'pending'.
          //
          // Only *from* 'pending', the way the timer's own guard below does.
          // `draftState` is one field for the whole window, and this chain is
          // three IndexedDB transactions long — the user is on another plan
          // while it runs. Unconditional, it overwrites that plan's real
          // 'pending', the 'error' a failed write had just reported, or the
          // 'off' the user chose by unticking Save on exit mid-flight.
          .then(() => {
            const store = useAppStore.getState();
            if (store.draftState === 'pending') store.setDraftState('saved');
          })
          .catch((error) => {
            console.error('Failed to write a parked plan:', error);
            useAppStore.getState().setDraftState('error');
          });
      },
    );
    return () => unsub();
  }, [saveOnExit, buildIndex]);

  // ── Debounced autosave on working-state changes ───────────────────────────
  useEffect(() => {
    const unsub = useAppStore.subscribe(
      autosaveSelector,
      (slice, prevSlice) => {
        const state = useAppStore.getState();
        if (!state._hasRestoredState) return;
        if (!saveOnExit) return;
        // A plan switch replaces every field at once. Without this it reads as
        // the largest edit the app can make, and the debounced write that
        // followed would put the *incoming* plan's state under the *outgoing*
        // plan's key.
        if (state._swappingDocument) return;

        if (!slice.image) {
          // This plan has nothing to keep. Its own records go; the rest of the
          // workspace is untouched, which is the whole difference from before.
          // Cancel first: closing the last plan empties it in place and keeps
          // its id, so a write still pending from the edit before the close
          // would put the records straight back under a key that is live.
          cancelPendingWrite();
          writtenImageByDocRef.current.delete(state.activeDocumentId);
          removePlan(state.activeDocumentId);
          // `documentOrder` does not change when the last plan is emptied in
          // place, so the subscription above does not fire for it, and the
          // index would go on naming a plan whose records have just gone.
          queueIndexWrite();
          return;
        }

        // Shallow equality is handled by the subscription itself, so at least
        // one autosave-relevant field changed — but `setViewportTransform`
        // mints a fresh `Math.random()` token per call, so even a camera update
        // landing on identical scale and position always gets here.
        if (onlyCameraMoved(slice, prevSlice)) return;

        // After the camera gate, not before it: a pan schedules no write, and
        // reporting "saving" for one would leave the status bar spinning for
        // the rest of the session.
        state.setDraftState('pending');

        // Debounce: wait 2 seconds of inactivity before writing the draft.
        // This write, not the unload handler below, is what actually protects
        // the user's work.
        cancelPendingWrite();

        // The plan that changed, captured now. Reading the active id when the
        // timer fires would write the *incoming* plan's state under whichever
        // key happened to be active two seconds later.
        const docId = state.activeDocumentId;
        autosaveTimerRef.current = setTimeout(() => {
          autosaveTimerRef.current = null;
          const live = useAppStore.getState();
          // Capturing the id was only half of it: the *state* is still read
          // here, so a switch inside the debounce window wrote the incoming
          // plan's image, traces and calibration under the outgoing plan's
          // key — the exact swap the capture above exists to prevent, and one
          // that survives a reload looking like the plan it overwrote.
          //
          // A plan that has left the root needs nothing from this timer: it
          // was written in full, with its history, by the park subscription
          // above, or its records were removed when it closed. The last-plan
          // close does not reach here at all — `restart` keeps the id, so this
          // guard would not trip; what covers it is `cancelPendingWrite` in the
          // `!slice.image` branch, before the records are removed.
          if (live.activeDocumentId !== docId) {
            if (live.draftState === 'pending') live.setDraftState('saved');
            return;
          }
          saveAutosavedDraft(docId, live.getParkedState());
        }, 2000);
      },
      { equalityFn: shallow },
    );

    return () => {
      unsub();
      cancelPendingWrite();
    };
  }, [saveOnExit, clearAutosavedDraft, saveAutosavedDraft, cancelPendingWrite, queueIndexWrite]);

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

      const snapshot = state.getParkedState();
      if (!snapshot.image) {
        // `visibilitychange` fires while the page is still alive, so a pending
        // write outlives this and would undo the removal.
        cancelPendingWrite();
        writtenImageByDocRef.current.delete(state.activeDocumentId);
        removePlan(state.activeDocumentId);
        return;
      }

      // Only the active plan needs flushing here: every other open plan was
      // written in full when it was parked, which is a better moment than this
      // one — the browser may abandon an IndexedDB transaction once the page is
      // going away, and parking happens while it is unambiguously alive.
      saveAutosavedDraft(state.activeDocumentId, snapshot, { withHistory: true });
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushAutosaveNow();
      }
    };

    /**
     * Warn on close only when closing actually loses something.
     *
     * With `saveOnExit` on, the draft is the net and every open plan is on
     * disk, so a prompt would fire on every close and teach the user to dismiss
     * it. With it off, nothing is being kept at all, and a plan holding work is
     * about to be lost — which is the one case worth interrupting for.
     */
    const warnIfUnkept = (event) => {
      if (saveOnExit) return;
      const state = useAppStore.getState();
      const anyWork = state.image
        || state.documentOrder.some((id) => state.documents[id]?.hasWork);
      if (!anyWork) return;
      event.preventDefault();
      event.returnValue = '';
    };

    window.addEventListener('beforeunload', flushAutosaveNow);
    window.addEventListener('beforeunload', warnIfUnkept);
    window.addEventListener('pagehide', flushAutosaveNow);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('beforeunload', flushAutosaveNow);
      window.removeEventListener('beforeunload', warnIfUnkept);
      window.removeEventListener('pagehide', flushAutosaveNow);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [saveOnExit, clearAutosavedDraft, saveAutosavedDraft, cancelPendingWrite]);

  return { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft };
}

