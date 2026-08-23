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
    const state = useAppStore.getState();
    if (!state.image) {
      notify('Open a plan first.', { type: 'warning', id: 'export' });
      return;
    }
    // Ctrl+E and the File menu reached the dialog while a trace or scan was
    // running — the Export *button* beside them has always been disabled for
    // exactly that reason, and one component cannot disagree with itself. The
    // dialog renders from a snapshot of the state, so a trace landing behind it
    // is exported as the measurement that preceded it.
    if (state.isProcessing) {
      notify('Wait for the plan to finish, then export.', { type: 'warning', id: 'export' });
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
    if (state.isProcessing) {
      notify('Wait for the plan to finish, then copy.', { type: 'warning', id: 'export' });
      return;
    }
    setIsProcessing(true, 'Preparing the image…');
    try {
      const [{ renderExhibit, copyExhibit }, { readExportOptions }] = await Promise.all([
        import('../utils/exhibit'),
        import('../utils/exhibit/options'),
      ]);
      const { canvas, model } = await renderExhibit(state, { options: readExportOptions() });
      await copyExhibit(canvas);
      // The fastest way to take the number out of the app carried no caveat at
      // all, while the slow way carried all of them. The count is the same one
      // the dock prints, so the two cannot disagree.
      const flags = model?.flags?.filter((f) => f.severity !== 'reviewed').length ?? 0;
      flash(flags > 0
        ? `Copied — ${flags} ${flags === 1 ? 'thing' : 'things'} to check on this measurement`
        : 'Measurement image copied to the clipboard');
    } catch (error) {
      console.error('Exhibit copy failed:', error);
      notify(error.message || 'Could not copy the image.', { type: 'error', id: 'export' });
    } finally {
      setIsProcessing(false);
    }
  }, [setIsProcessing]);

  return { openExport, closeExport, copyExhibitNow };
}
