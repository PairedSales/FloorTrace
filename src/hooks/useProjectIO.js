import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import { parkedStateFor, parkedHistoryFor } from '../store/documentManager';
import { readDocDraft, readHistoryRecord } from '../utils/workspaceDrafts';
import { forgetFileHandle } from '../utils/fileHandles';
import * as undoManager from '../store/undoManager';
import { loadImageFromFile } from '../utils/imageLoader';
import { prewarmDetection } from '../utils/detection';
import { perfMark, perfResetRun, MARKS } from '../utils/perfMarks';
import { notify, flash } from '../utils/notify';

/**
 * A name no other plan in this save is using. Two unnamed plans both produce
 * "Sketch <date>.floorplan", and the browser then silently appends "(1)" or
 * overwrites — neither is a good way to find out you saved one plan twice.
 */
const uniqueName = (name, used) => {
  const base = (name ?? '').trim() || 'Sketch';
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) {
    candidate = `${base} (${n})`;
    n += 1;
  }
  used.add(candidate);
  return candidate;
};

export function useProjectIO(handleManualMode, fileInputRef, openPlan) {
  const setImage = useAppStore((s) => s.setImage);
  const setImageMimeType = useAppStore((s) => s.setImageMimeType);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  /**
   * Make room for an incoming plan.
   *
   * This used to be a discard prompt — opening anything with an image loaded
   * asked whether to throw the current work away, on `isDirty || image`, which
   * is essentially always. Opening now adds a plan instead of replacing one, so
   * there is nothing to discard and nothing to ask.
   *
   * The empty plan the app starts with is reused rather than left behind, so
   * opening your first file does not leave an "Untitled 1" tab beside it.
   */
  const makeRoomForIncoming = useCallback(() => {
    const state = useAppStore.getState();
    if (!state.image) {
      // The incoming file takes this plan's id — a different drawing, a
      // different name, the same tab. Whatever that id was last saved to
      // belongs to something else now, so the next Save has to ask rather than
      // overwrite it. The third place a plan stops being that plan, beside
      // closing one and emptying the last.
      forgetFileHandle(state.activeDocumentId);
      return true;
    }
    return Boolean(openPlan());
  }, [openPlan]);

  const handleFileOpen = useCallback(() => {
    fileInputRef.current?.click();
  }, [fileInputRef]);

  const handleFileUpload = useCallback(async (event) => {
    // The element that fired, not the one ref: there is a second, camera-only
    // input on mobile, and clearing the wrong one leaves a retaken photo of the
    // same scene looking to the browser like no change at all.
    const input = event.target;
    // Every file, not just the first. Each becomes its own plan, which is what
    // a tab strip makes possible and what selecting several files has always
    // looked like it should do.
    const files = [...(input.files ?? [])];
    for (const file of files) {
      // At the cap: stop opening, keep what was opened, and let the plan
      // manager's own message explain why the rest did not appear.
      if (!makeRoomForIncoming()) break;

      try {
        if (file.name.endsWith('.floorplan')) {
          setIsProcessing(true, 'Loading project…');
          const text = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (err) => reject(err);
            reader.readAsText(file);
          });

          const { importProject } = await import('../utils/projectSerializer');
          const { statePatch, historyPatch } = importProject(text);

          useAppStore.getState().loadProject(statePatch);
          undoManager.setHistoryState(historyPatch);
          useAppStore.getState().setActiveDocumentMeta({ sourceFileName: file.name });
          // The image branch below prewarms and this one never did, so opening a
          // saved project paid for a cold analysis on its first trace.
          prewarmDetection(statePatch.image);

          flash('Project loaded');
        } else {
          // Before the load, not after: the base64 round-trip and the decode
          // inside `loadImageFromFile` are part of the ingest cost.
          perfResetRun();
          perfMark(MARKS.imageSet);
          // Load and validate first — a failed load must leave the current project intact
          const { dataUrl, mimeType } = await loadImageFromFile(file);
          resetOverlays();
          undoManager.clear();
          setImage(dataUrl);
          setImageMimeType(mimeType);
          // The name of the file this plan came from. `useProjectIO` and the
          // drop handler have both always had it in hand and thrown it away;
          // it is what names a plan before the user types a subject line.
          useAppStore.getState().setActiveDocumentMeta({ sourceFileName: file.name });
          // Not awaited: it runs in the detection worker while the scan below
          // holds the main thread and the Tesseract pool.
          prewarmDetection(dataUrl);
          await handleManualMode(dataUrl, true); // Automatically enter manual mode
        }
      } catch (error) {
        console.error('Error loading file:', error);
        notify(`Could not open that file — ${error.message}`, { type: 'error', id: 'file-open' });
      } finally {
        setIsProcessing(false);
      }
    }

    // Outside the loop: clearing it empties `input.files`, which is why the
    // list is snapshotted above before anything is opened. Reset so selecting
    // the same file again still counts as a change.
    input.value = '';
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, [resetOverlays, handleManualMode, makeRoomForIncoming, setIsProcessing, setImage, setImageMimeType, fileInputRef]);

  const handleSaveProject = useCallback(async (isSaveAs = false) => {
    setIsProcessing(true, isSaveAs ? 'Saving project as…' : 'Saving project…');
    try {
      const storeState = useAppStore.getState();
      const historyState = undoManager.getHistoryState();

      const { exportProject } = await import('../utils/projectSerializer');
      const success = await exportProject(
        storeState, historyState, isSaveAs, storeState.activeDocumentId,
      );

      if (success) {
        useAppStore.getState().setIsDirty(false);
        flash(isSaveAs ? 'Project saved' : 'Project exported');
      }
    } catch (error) {
      console.error('Error exporting project:', error);
      notify(`Could not save the project — ${error.message}`, { type: 'error', id: 'file-save' });
    } finally {
      setIsProcessing(false);
    }
  }, [setIsProcessing]);

  /**
   * Save every plan that holds work.
   *
   * Through the download fallback, never the picker: `showSaveFilePicker`
   * consumes the user gesture, so the second call in a loop is refused by the
   * browser. A plan already saved through the picker this session still
   * overwrites its own file, because that grant is still live.
   *
   * Names are disambiguated here rather than left to collide. Two unnamed
   * plans both produce "Sketch <date>.floorplan", and a browser silently
   * appends "(1)" — or, with a picker, overwrites. Neither is a good way to
   * find out you saved one plan twice.
   */
  const handleSaveAllProjects = useCallback(async () => {
    const order = useAppStore.getState().documentOrder;
    if (order.length < 2) return handleSaveProject(false);

    setIsProcessing(true, 'Saving all plans…');
    try {
      const { exportProject, planStateForSave } = await import('../utils/projectSerializer');
      const used = new Set();
      let saved = 0;
      let unreadable = 0;
      let withoutImage = 0;

      for (const docId of order) {
        // Read live, per iteration. A plan's records come off disk inside this
        // loop — roughly a second each on a real plan — and the tab strip stays
        // clickable throughout, so which plan is active can change mid-save.
        // Deciding it from a snapshot taken before the first await is the same
        // shape of mistake as the one below.
        const live = useAppStore.getState();
        const isActive = docId === live.activeDocumentId;
        const meta = live.documents[docId] ?? {};
        if (!(isActive ? live.image : meta.hasWork)) continue;

        // Only the active plan's full state is on the root. A plan parked this
        // session is in memory; one the workspace reopened but has not been
        // switched to since is only on disk, because `adoptWorkspace` opens
        // with `clearParked()`.
        //
        // Spread over the active state, a null record left the active state
        // standing: Save all wrote the plan you were looking at into every
        // other plan's file, under that plan's name, and flashed "Saved 3
        // plans". `planStateForSave` never falls back to the live plan, and
        // pins `image` rather than letting an absent key inherit one.
        let planState;
        let history;
        if (isActive) {
          planState = live;
          history = undoManager.getHistoryState();
        } else {
          const parked = parkedStateFor(docId);
          planState = planStateForSave(live, parked ?? (await readDocDraft(docId)).state);
          if (!planState) {
            unreadable += 1;
            continue;
          }
          // Its own history, not none. The plan is either in memory with its
          // stacks or on disk with its history record beside its draft, so the
          // reason this used to hard-code null — that only the live plan's
          // stacks were reachable — stopped being true. Without it, Save all
          // and Ctrl+S produced two different files for the same plan.
          history = parked ? parkedHistoryFor(docId) : await readHistoryRecord(docId);
        }
        if (!planState.image) withoutImage += 1;

        const success = await exportProject(
          { ...planState, projectName: uniqueName(planState.projectName || meta.title, used) },
          history ?? null,
          false,
          docId,
        );
        if (success) saved += 1;
      }

      // Counted and said. A plan silently missing from "Save all", or one
      // written without the drawing, is the kind of loss the user finds out
      // about from the folder, later.
      const message = saved === 1 ? 'Saved 1 plan' : `Saved ${saved} plans`;
      const notes = [];
      if (unreadable) notes.push(`${unreadable} could not be read back`);
      if (withoutImage) notes.push(`${withoutImage} saved without its image`);
      if (notes.length) {
        notify(`${message} — ${notes.join(', ')}.`, { type: 'warning', id: 'file-save' });
      } else {
        flash(message);
      }
    } catch (error) {
      console.error('Error saving all projects:', error);
      notify(`Could not save every plan — ${error.message}`, { type: 'error', id: 'file-save' });
    } finally {
      setIsProcessing(false);
    }
    return true;
  }, [setIsProcessing, handleSaveProject]);

  const handleSaveProjectNormal = useCallback(() => handleSaveProject(false), [handleSaveProject]);
  const handleSaveProjectAs = useCallback(() => handleSaveProject(true), [handleSaveProject]);

  return {
    makeRoomForIncoming,
    handleFileOpen,
    handleFileUpload,
    handleSaveProject,
    handleSaveAllProjects,
    handleSaveProjectNormal,
    handleSaveProjectAs,
  };
}
