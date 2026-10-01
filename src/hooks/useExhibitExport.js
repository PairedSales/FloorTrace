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
    // Ctrl+E reaches here while a trace or scan is running — the Menu's own
    // "Save image…" is greyed out for exactly that reason, and the shortcut
    // cannot disagree with it. The dialog renders from a snapshot of the state,
    // so a trace landing behind it would be saved as the measurement that
    // preceded it.
    if (state.isProcessing) {
      notify('Wait for the plan to finish, then save the image.', { type: 'warning', id: 'export' });
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
      // The fastest way to take the number out of the app must not be the one
      // way that carries no caveat: a doubtful scale is printed on the image,
      // and the copy says that it is.
      const flags = model?.flags?.length ?? 0;
      flash(flags > 0
        ? `Image copied, with ${flags} ${flags === 1 ? 'note' : 'notes'} about this measurement printed on it`
        : 'Image copied — paste it into your report');
    } catch (error) {
      console.error('Exhibit copy failed:', error);
      notify(error.message || 'Could not copy the image.', { type: 'error', id: 'export' });
    } finally {
      setIsProcessing(false);
    }
  }, [setIsProcessing]);

  return { openExport, closeExport, copyExhibitNow };
}
