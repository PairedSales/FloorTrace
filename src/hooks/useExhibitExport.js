import { useCallback } from 'react';
import useAppStore from '../store/appStore';

/**
 * The two ways out of the app that are not the dialog: open it, or skip it and
 * put the exhibit straight on the clipboard. Both load the renderer on demand —
 * it pulls in the whole compose/paint path, and most sessions that open the app
 * never reach an export.
 */
export function useExhibitExport(notify) {
  const setShowExportDialog = useAppStore((s) => s.setShowExportDialog);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const openExport = useCallback(() => {
    if (!useAppStore.getState().image) {
      notify('Open a plan first.', { type: 'warning' });
      return;
    }
    setShowExportDialog(true);
  }, [setShowExportDialog, notify]);

  const closeExport = useCallback(() => setShowExportDialog(false), [setShowExportDialog]);

  const copyExhibitNow = useCallback(async () => {
    const state = useAppStore.getState();
    if (!state.image) {
      notify('Open a plan first.', { type: 'warning' });
      return;
    }
    setIsProcessing(true, 'Preparing the image…');
    try {
      const [{ renderExhibit, copyExhibit }, { readExportOptions }] = await Promise.all([
        import('../utils/exhibit'),
        import('../utils/exhibit/options'),
      ]);
      const { canvas } = await renderExhibit(state, { options: readExportOptions() });
      await copyExhibit(canvas);
      useAppStore.getState().flashStatus('Measurement image copied to the clipboard');
    } catch (error) {
      console.error('Exhibit copy failed:', error);
      notify(error.message || 'Could not copy the image.', { type: 'error' });
    } finally {
      setIsProcessing(false);
    }
  }, [notify, setIsProcessing]);

  return { openExport, closeExport, copyExhibitNow };
}
