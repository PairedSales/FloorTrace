import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import useWorkspaceStore from '../store/workspaceStore';
import { useIsTouch } from '../hooks/useViewport';

/**
 * The four decisions that discard work — restart, manual mode, re-scan, and
 * opening over unsaved changes — used to be `toast.warning(…, {duration:
 * Infinity})`. That put an irreversible choice in the notification stack at the
 * same visual weight as "Side lengths enabled", dismissible by clicking away,
 * and capable of being pushed out of a 2-slot stack by unrelated chatter.
 *
 * Driven by a store field so `confirmToast()` keeps its promise signature and
 * its four call sites are unchanged.
 */
const ConfirmDialog = () => {
  const request = useWorkspaceStore((s) => s.confirmRequest);
  const resolve = useWorkspaceStore((s) => s.resolveConfirm);
  const isTouch = useIsTouch();
  const confirmRef = useRef(null);
  const previouslyFocused = useRef(null);

  useEffect(() => {
    if (!request) return;
    previouslyFocused.current = document.activeElement;
    confirmRef.current?.focus();

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        resolve(false);
        return;
      }
      // Tab is not handled here. This listener is on `window`, so
      // `e.currentTarget` is `window`, which has no `querySelectorAll` — the
      // copy that lived here could only ever `preventDefault()` and fall
      // through. The focus trap that works is the `onKeyDown` on the dialog
      // element below, where `currentTarget` is the element holding the
      // buttons.
    };
    // Capture: the dialog must see Escape before the tool-cancel handler does,
    // or cancelling the dialog would also cancel whatever tool is active.
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previouslyFocused.current?.focus?.();
    };
  }, [request, resolve]);

  if (!request) return null;

  const { message, detail, confirmLabel = 'Confirm', cancelLabel = 'Cancel' } = request;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 animate-fade-in"
      onMouseDown={(e) => { if (e.target === e.currentTarget) resolve(false); }}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={detail ? 'confirm-detail' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'Tab') {
            const list = Array.from(e.currentTarget.querySelectorAll('button'));
            if (!list.length) return;
            e.preventDefault();
            const i = list.indexOf(document.activeElement);
            const next = e.shiftKey
              ? list[(i - 1 + list.length) % list.length]
              : list[(i + 1) % list.length];
            next?.focus();
          }
        }}
        className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-line
                   bg-panel-2 shadow-2xl p-5"
      >
        <div className="flex gap-3">
          <span className="grid place-items-center w-9 h-9 shrink-0 rounded-full bg-warn/15">
            <AlertTriangle className="w-[18px] h-[18px] text-warn" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-[14px] font-semibold text-fg leading-snug">
              {message}
            </h2>
            {detail && (
              <p id="confirm-detail" className="mt-1.5 text-[12.5px] leading-snug text-fg-3">
                {detail}
              </p>
            )}
          </div>
        </div>

        {/* These four dialogs are the ones that discard work, so the buttons
            get a real touch target rather than the shell's 32 px default —
            mis-tapping Restart because the target was 8 mm tall is the exact
            failure a confirmation exists to prevent. */}
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={() => resolve(false)}
            className={`rounded-md border border-line bg-panel-2 text-fg-2 font-medium
                        hover:text-fg hover:border-accent/50 transition-colors cursor-pointer
                        ${isTouch ? 'flex-1 h-11 text-[14px]' : 'h-8 px-3.5 text-[12.5px]'}`}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => resolve(true)}
            // `accent-ink`, not `white`: dark `--crit` is a light salmon tuned to
            // read as text on a dark ground, so white on it is 2.54:1. The ink
            // token is already white in the light theme, where crit is dark.
            className={`rounded-md border border-crit bg-crit font-semibold text-accent-ink
                        hover:brightness-110 transition-[filter] cursor-pointer
                        ${isTouch ? 'flex-1 h-11 text-[14px]' : 'h-8 px-3.5 text-[12.5px]'}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
