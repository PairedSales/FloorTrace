import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { loadImageFromFile, loadImageFromClipboard } from '../utils/imageLoader';

export function useDragAndDrop(notify, handleManualMode, checkUnsavedChanges) {
  const setImage = useAppStore((s) => s.setImage);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const handlePasteImage = useCallback(async () => {
    if (!(await checkUnsavedChanges())) return;

    try {
      // Clear existing image before loading new one to ensure state change
      setImage(null);
      // Clear overlays as well
      resetOverlays();
      undoManager.clear();

      const loadedImage = await loadImageFromClipboard();
      if (loadedImage) {
        setImage(loadedImage);
        handleManualMode(loadedImage, true); // Automatically enter manual mode
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      notify('Failed to paste image. Make sure an image is copied to your clipboard.', { type: 'error' });
    }
  }, [resetOverlays, handleManualMode, checkUnsavedChanges, setImage, notify]);

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

        notify('Project loaded.', { type: 'success' });
      } else {
        resetOverlays();
        undoManager.clear();
        const loadedImage = await loadImageFromFile(file);
        setImage(loadedImage);
        handleManualMode(loadedImage, true);
      }
    } catch (error) {
      console.error('Error loading dropped file:', error);
      notify(`Failed to load file: ${error.message}`, { type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  }, [resetOverlays, handleManualMode, checkUnsavedChanges, notify, setIsProcessing, setImage]);

  return {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  };
}
