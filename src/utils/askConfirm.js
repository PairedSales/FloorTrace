import useWorkspaceStore from '../store/workspaceStore';

/**
 * Promise-based confirmation for actions that discard work.
 *
 * It parks a request on the store, which `<ConfirmDialog>` renders as a real
 * focus-trapped `alertdialog`. A destructive choice is never a passing message
 * (`utils/notify.js`): one of those can be dismissed by clicking away, and
 * carries no more weight than "Area copied".
 *
 * Resolves true on confirm, false on cancel/Escape/backdrop — the safe default
 * for a destructive action.
 */
export function askConfirm(message, {
  confirmLabel = 'Confirm',
  detail = null,
} = {}) {
  return new Promise((resolve) => {
    useWorkspaceStore.getState().requestConfirm({
      message, detail, confirmLabel, resolve,
    });
  });
}
