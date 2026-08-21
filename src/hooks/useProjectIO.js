import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import { parkedStateFor } from '../store/documentManager';
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
    if (!state.image) return true;
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
    const state = useAppStore.getState();
    const order = state.documentOrder;
    if (order.length < 2) return handleSaveProject(false);

    setIsProcessing(true, 'Saving all plans…');
    try {
      const { exportProject } = await import('../utils/projectSerializer');
      const used = new Set();
      let saved = 0;

      for (const docId of order) {
        const isActive = docId === state.activeDocumentId;
        const meta = state.documents[docId] ?? {};
        if (!(isActive ? state.image : meta.hasWork)) continue;

        // Only the active plan's full state is on the root; the rest are saved
        // from what they were parked with.
        const planState = isActive
          ? useAppStore.getState()
          : { ...useAppStore.getState(), ...(parkedStateFor(docId) ?? {}) };

        const success = await exportProject(
          { ...planState, projectName: uniqueName(planState.projectName || meta.title, used) },
          isActive ? undoManager.getHistoryState() : null,
          false,
          docId,
        );
        if (success) saved += 1;
      }

      flash(saved === 1 ? 'Saved 1 plan' : `Saved ${saved} plans`);
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
