import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { loadImageFromFile } from '../utils/imageLoader';
import { prewarmDetection } from '../utils/detection';
import { perfMark, perfResetRun, MARKS } from '../utils/perfMarks';
import { notify, flash } from '../utils/notify';

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
    const file = input.files[0];
    if (file) {
      if (!makeRoomForIncoming()) {
        input.value = '';
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

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
        // Reset file input so the same file can be selected again
        input.value = '';
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    }
  }, [resetOverlays, handleManualMode, makeRoomForIncoming, setIsProcessing, setImage, setImageMimeType, fileInputRef]);

  const handleSaveProject = useCallback(async (isSaveAs = false) => {
    setIsProcessing(true, isSaveAs ? 'Saving project as…' : 'Saving project…');
    try {
      const storeState = useAppStore.getState();
      const historyState = undoManager.getHistoryState();

      const { exportProject } = await import('../utils/projectSerializer');
      const success = await exportProject(storeState, historyState, isSaveAs);

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

  const handleSaveProjectNormal = useCallback(() => handleSaveProject(false), [handleSaveProject]);
  const handleSaveProjectAs = useCallback(() => handleSaveProject(true), [handleSaveProject]);

  return {
    makeRoomForIncoming,
    handleFileOpen,
    handleFileUpload,
    handleSaveProject,
    handleSaveProjectNormal,
    handleSaveProjectAs,
  };
}
