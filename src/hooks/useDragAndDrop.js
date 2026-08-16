import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { loadImageFromFile, loadImageFromClipboard } from '../utils/imageLoader';
import { prewarmDetection } from '../utils/detection';
import { perfMark, perfResetRun, MARKS } from '../utils/perfMarks';
import { notify, flash } from '../utils/notify';

export function useDragAndDrop(handleManualMode, checkUnsavedChanges) {
  const setImage = useAppStore((s) => s.setImage);
  const setImageMimeType = useAppStore((s) => s.setImageMimeType);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const handlePasteImage = useCallback(async () => {
    if (!(await checkUnsavedChanges())) return;

    try {
      perfResetRun();
      perfMark(MARKS.imageSet);
      // Load and validate first — a failed paste must leave the current project intact
      const { dataUrl, mimeType } = await loadImageFromClipboard();
      if (dataUrl) {
        resetOverlays();
        undoManager.clear();
        setImage(dataUrl);
        setImageMimeType(mimeType);
        prewarmDetection(dataUrl);
        await handleManualMode(dataUrl, true); // Automatically enter manual mode
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      notify('Nothing to paste — copy an image first.', { type: 'error', id: 'paste' });
    }
  }, [resetOverlays, handleManualMode, checkUnsavedChanges, setImage, setImageMimeType]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;

    const isFloorplan = file.name.endsWith('.floorplan');
    const isImage = file.type.startsWith('image/');
    if (!isFloorplan && !isImage) return;

    if (!(await checkUnsavedChanges())) return;

    try {
      if (isFloorplan) {
        setIsProcessing(true, 'Loading project…');
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (ev) => resolve(ev.target.result);
          reader.onerror = (err) => reject(err);
          reader.readAsText(file);
        });

        const { importProject } = await import('../utils/projectSerializer');
        const { statePatch, historyPatch } = importProject(text);

        useAppStore.getState().loadProject(statePatch);
        undoManager.setHistoryState(historyPatch);

        flash('Project loaded');
      } else {
        perfResetRun();
        perfMark(MARKS.imageSet);
        // Load and validate first — a failed load must leave the current project intact
        const { dataUrl, mimeType } = await loadImageFromFile(file);
        resetOverlays();
        undoManager.clear();
        setImage(dataUrl);
        setImageMimeType(mimeType);
        // Not awaited: it runs in the detection worker while the scan below
        // holds the main thread and the Tesseract pool.
        prewarmDetection(dataUrl);
        await handleManualMode(dataUrl, true);
      }
    } catch (error) {
      console.error('Error loading dropped file:', error);
      notify(`Could not open that file — ${error.message}`, { type: 'error', id: 'file-open' });
    } finally {
      setIsProcessing(false);
    }
  }, [resetOverlays, handleManualMode, checkUnsavedChanges, setIsProcessing, setImage, setImageMimeType]);

  return {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  };
}
