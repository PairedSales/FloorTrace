import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';
import { loadImageFromFile } from '../utils/imageLoader';
import { confirmToast } from '../utils/confirmToast';
import { notify, flash } from '../utils/notify';

export function useProjectIO(handleManualMode, fileInputRef) {
  const image = useAppStore((s) => s.image);
  const isDirty = useAppStore((s) => s.isDirty);
  const setImage = useAppStore((s) => s.setImage);
  const setImageMimeType = useAppStore((s) => s.setImageMimeType);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const checkUnsavedChanges = useCallback(() => {
    if (isDirty || image) {
      return confirmToast(
        'You have unsaved changes. Opening a new project or image will discard them. Continue?',
        { confirmLabel: 'Discard' }
      );
    }
    return Promise.resolve(true);
  }, [isDirty, image]);

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
      if (!(await checkUnsavedChanges())) {
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

          flash('Project loaded');
        } else {
          // Load and validate first — a failed load must leave the current project intact
          const { dataUrl, mimeType } = await loadImageFromFile(file);
          resetOverlays();
          undoManager.clear();
          setImage(dataUrl);
          setImageMimeType(mimeType);
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
  }, [resetOverlays, handleManualMode, checkUnsavedChanges, setIsProcessing, setImage, setImageMimeType, fileInputRef]);

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
    checkUnsavedChanges,
    handleFileOpen,
    handleFileUpload,
    handleSaveProject,
    handleSaveProjectNormal,
    handleSaveProjectAs,
  };
}
