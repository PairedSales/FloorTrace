import useAppStore from '../store/appStore';

/**
 * Promise-based confirmation for actions that discard work.
 *
 * The name is historical — this no longer raises a toast. It parks a request on
 * the store, which `<ConfirmDialog>` renders as a real focus-trapped
 * `alertdialog`. A destructive choice does not belong in the notification
 * stack: it was dismissible by clicking away, weighted the same as
 * "Side lengths enabled", and could be pushed out of view by unrelated chatter.
 *
 * Resolves true on confirm, false on cancel/Escape/backdrop — the safe default
 * for a destructive action, as before.
 */
export function confirmToast(message, {
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  detail = null,
} = {}) {
  return new Promise((resolve) => {
    useAppStore.getState().requestConfirm({
      message, detail, confirmLabel, cancelLabel, resolve,
    });
  });
}
