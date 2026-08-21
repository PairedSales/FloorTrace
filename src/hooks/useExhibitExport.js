import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { notify, flash } from '../utils/notify';

/**
 * The two ways out of the app that are not the dialog: open it, or skip it and
 * put the exhibit straight on the clipboard. Both load the renderer on demand —
 * it pulls in the whole compose/paint path, and most sessions that open the app
 * never reach an export.
 */
export function useExhibitExport() {
  const setShowExportDialog = useWorkspaceStore((s) => s.setShowExportDialog);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);

  const openExport = useCallback(() => {
    if (!useAppStore.getState().image) {
      notify('Open a plan first.', { type: 'warning', id: 'export' });
      return;
    }
    setShowExportDialog(true);
  }, [setShowExportDialog]);

  const closeExport = useCallback(() => setShowExportDialog(false), [setShowExportDialog]);

  const copyExhibitNow = useCallback(async () => {
    const state = useAppStore.getState();
    if (!state.image) {
      notify('Open a plan first.', { type: 'warning', id: 'export' });
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
      flash('Measurement image copied to the clipboard');
    } catch (error) {
      console.error('Exhibit copy failed:', error);
      notify(error.message || 'Could not copy the image.', { type: 'error', id: 'export' });
    } finally {
      setIsProcessing(false);
    }
  }, [setIsProcessing]);

  return { openExport, closeExport, copyExhibitNow };
}
