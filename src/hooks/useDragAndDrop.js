import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { loadImageFromClipboard, loadPagesFromFile, isPdfFile } from '../utils/imageLoader';
import { MAX_OPEN_DOCUMENTS } from '../store/documentManager';
import { prewarmDetection } from '../utils/detection';
import { perfMark, perfResetRun, MARKS } from '../utils/perfMarks';
import { notify, flash } from '../utils/notify';

export function useDragAndDrop(handleManualMode, makeRoomForIncoming) {
  const setImage = useAppStore((s) => s.setImage);
  const setImageMimeType = useAppStore((s) => s.setImageMimeType);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const handlePasteImage = useCallback(async () => {
    if (!makeRoomForIncoming()) return;

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
        // Cleared, not left alone: a pasted image has no file behind it, and
        // inheriting the previous plan's filename would name this one after a
        // drawing it has nothing to do with.
        useAppStore.getState().setActiveDocumentMeta({ sourceFileName: null });
        prewarmDetection(dataUrl);
        await handleManualMode(dataUrl, true); // Automatically enter manual mode
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      notify('Nothing to paste — copy an image first.', { type: 'error', id: 'paste' });
    }
  }, [resetOverlays, handleManualMode, makeRoomForIncoming, setImage, setImageMimeType]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const openOne = useCallback(async (file) => {
    if (!file) return;

    const isFloorplan = file.name.endsWith('.floorplan');
    const openable = isFloorplan || file.type.startsWith('image/') || isPdfFile(file);
    // Said, not silently ignored. A dropped file that vanishes without a word
    // is indistinguishable from an app that has stopped responding — which is
    // what dragging in a PDF used to look like.
    if (!openable) {
      notify(`${file.name} is not a plan image, a PDF or a .floorplan.`, {
        type: 'warning', id: 'file-open',
      });
      return;
    }

    if (isFloorplan && !makeRoomForIncoming()) return;

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
        useAppStore.getState().setActiveDocumentMeta({ sourceFileName: file.name });
        // The image branch below prewarms and this one never did, so opening a
        // saved project paid for a cold analysis on its first trace.
        prewarmDetection(statePatch.image);

        flash('Project loaded');
      } else {
        // Load and validate before claiming a plan: a failed load must leave
        // the current project intact. A PDF arrives as one entry per page,
        // which is where a two-page plan set becomes two plans.
        setIsProcessing(true, 'Reading the plan…');
        const { pages, skipped } = await loadPagesFromFile(file, {
          maxPages: MAX_OPEN_DOCUMENTS,
          onProgress: (n, total) => {
            if (total > 1) setIsProcessing(true, `Rendering page ${n} of ${total}…`);
          },
        });

        for (const page of pages) {
          if (!makeRoomForIncoming()) break;
          perfResetRun();
          perfMark(MARKS.imageSet);
          resetOverlays();
          undoManager.clear();
          setImage(page.dataUrl);
          setImageMimeType(page.mimeType);
          useAppStore.getState().setActiveDocumentMeta({ sourceFileName: page.name });
          // Not awaited: it runs in the detection worker while the scan below
          // holds the main thread and the Tesseract pool.
          prewarmDetection(page.dataUrl);
          await handleManualMode(page.dataUrl, true);
        }

        if (skipped > 0) {
          notify(
            `Opened the first ${pages.length} pages — ${skipped} more are in that PDF.`,
            { type: 'warning', id: 'file-open' },
          );
        }
      }
    } catch (error) {
      console.error('Error loading dropped file:', error);
      notify(`Could not open that file — ${error.message}`, { type: 'error', id: 'file-open' });
    } finally {
      setIsProcessing(false);
    }
  }, [resetOverlays, handleManualMode, makeRoomForIncoming, setIsProcessing, setImage, setImageMimeType]);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    // Every dropped file, each becoming its own plan. Dropping a folder's worth
    // of elevations and getting only the first one was never the intent; it was
    // the only thing a single-document app could do.
    const files = [...(e.dataTransfer?.files ?? [])];
    for (const file of files) {
      // Sequential on purpose: each file opens a plan, and opening runs a
      // scan that must not race the next one for the OCR clock.
      await openOne(file);
    }
  }, [openOne]);


  return {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  };
}
