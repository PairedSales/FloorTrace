import useWorkspaceStore from '../store/workspaceStore';
import useAppStore from '../store/appStore';

// One guard for the several window-level keydown listeners. The modal half is
// load-bearing: HelpModal owns Escape while it is open, so without this a
// single press closed the modal *and* cancelled the active tool.

export const isTypingInField = (target) =>
  !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

// The export and settings dialogs are here for the same reason the help modal
// is: each is a focused surface over the plan, and a key that both drives it
// and reaches the canvas behind it does two things at once. Delete is the
// sharp case — it would act on the dialog and on the plan in the same press.
export const shortcutsBlocked = (target) => {
  if (isTypingInField(target)) return true;
  const workspace = useWorkspaceStore.getState();
  // An open menu owns the keyboard for the same reason a modal does — and it
  // is the sharper case, because the menu *prints* the keys it is swallowing.
  return !!(workspace.showHelpModal || workspace.showExportDialog
    || workspace.showSettings || workspace.menuOpen);
};

// ── Work in flight owns the drawing it started from ─────────────────────────
//
// While `isProcessing` is true a scan, a trace or a file read is holding the
// image it was handed. Undo, redo, paste and opening a file all *replace* that
// image, and the result then lands describing a drawing that is gone, at
// whatever confidence it earned, with nothing looking wrong.
//
// This cannot live in `shortcutsBlocked`: its two call sites are handed only
// `e.target`, and which key was pressed is the whole question. Blocking every
// shortcut while busy would also take Escape, the view keys and Ctrl+Alt plan
// switching — and switching plans mid-trace is a case this app deliberately
// supports, the result being held and replayed when that plan comes back. So
// the keys are read where the event is, in a capture-phase listener that
// reaches them before either of the window listeners does.
//
// It is also the only place the mouse's back/forward buttons can be reached:
// they are bound to undo/redo directly and pass through no guard at all.

const invalidatesWorkInFlight = (e) => {
  const chord = e.ctrlKey || e.metaKey;
  if (chord && !e.altKey) {
    const key = (e.key ?? '').toLowerCase();
    // z/y undo the edit the work was computed from; v and o put a different
    // drawing in front of it; s writes a file the running trace is not in.
    return key === 'z' || key === 'y' || key === 'v' || key === 'o' || key === 's';
  }
  return false;
};

const swallow = (e) => {
  e.preventDefault();
  // At window capture this is the first listener on the path, so nothing else
  // sees the event at all.
  e.stopImmediatePropagation();
  // Said, not silently eaten: a shortcut that does nothing and reports nothing
  // is the same screen as an app that has stopped responding. It does not point
  // at the Stop button, which is only there past five seconds and only for work
  // the detection worker can be terminated for — an OCR scan, the longest wait
  // in the app, has neither.
  useWorkspaceStore.getState().flashStatus('Still working — try that again once this finishes', 'warn');
};

const isBusy = () => useAppStore.getState().isProcessing;

if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (e) => {
    if (!isBusy() || isTypingInField(e.target)) return;
    if (invalidatesWorkInFlight(e)) swallow(e);
  }, true);

  window.addEventListener('mousedown', (e) => {
    if ((e.button === 3 || e.button === 4) && isBusy()) swallow(e);
  }, true);
}
