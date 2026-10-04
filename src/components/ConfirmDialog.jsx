import { useCallback, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import useWorkspaceStore from '../store/workspaceStore';
import { useIsTouch } from '../hooks/useViewport';
import Dialog from './Dialog';

/**
 * The question asked before anything that discards work — closing a plan,
 * reading the room sizes again.
 *
 * A real dialog, not a toast: an irreversible choice does not belong in the
 * notification stack at the same visual weight as "Area copied", dismissible by
 * clicking away, and capable of being pushed out of view by unrelated chatter.
 *
 * Driven by a store field so `askConfirm()` keeps its promise signature and
 * its call sites are plain `await`s.
 *
 * **Cancel has the focus.** Every one of these dialogs discards work, and Enter
 * pressed out of habit should keep it rather than lose it. There is no close
 * button for the same reason: the question is answered with one of its two
 * buttons, and Escape or a press outside means Cancel.
 */
const ConfirmDialog = () => {
  const request = useWorkspaceStore((s) => s.confirmRequest);
  const resolve = useWorkspaceStore((s) => s.resolveConfirm);
  const isTouch = useIsTouch();
  const cancelRef = useRef(null);
  const cancel = useCallback(() => resolve(false), [resolve]);

  if (!request) return null;

  const { message, detail, confirmLabel = 'Confirm' } = request;

  return (
    <Dialog
      id="confirm"
      role="alertdialog"
      size="sm"
      layer="z-[100]"
      hideClose
      title={message}
      subtitle={detail}
      onClose={cancel}
      initialFocus={cancelRef}
      icon={(
        <span className="grid place-items-center w-9 h-9 shrink-0 rounded-full bg-warn/15">
          <AlertTriangle className="w-[18px] h-[18px] text-warn" aria-hidden="true" />
        </span>
      )}
      // These dialogs are the ones that discard work, so on touch the buttons
      // get a real target — mis-tapping the wrong one because it was 8 mm tall
      // is the exact failure a confirmation exists to prevent.
      footer={(
        <>
          <button
            ref={cancelRef}
            type="button"
            onClick={cancel}
            className={`btn btn-secondary ${isTouch ? 'flex-1 h-11' : 'ml-auto'}`}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => resolve(true)}
            className={`btn btn-danger ${isTouch ? 'flex-1 h-11' : ''}`}
          >
            {confirmLabel}
          </button>
        </>
      )}
    />
  );
};

export default ConfirmDialog;
