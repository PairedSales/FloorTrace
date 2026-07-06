import { toast } from 'sonner';

// Promise-based confirmation toast — a non-blocking, on-theme replacement for
// window.confirm(). Resolves true when the user confirms, false when they cancel
// or dismiss the toast (safe default for destructive actions).
export function confirmToast(message, {
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
} = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    toast.warning(message, {
      duration: Infinity,
      action: { label: confirmLabel, onClick: () => finish(true) },
      cancel: { label: cancelLabel, onClick: () => finish(false) },
      onDismiss: () => finish(false),
      onAutoClose: () => finish(false),
    });
  });
}
