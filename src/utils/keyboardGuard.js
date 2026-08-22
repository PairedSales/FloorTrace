import useWorkspaceStore from '../store/workspaceStore';

// One guard for the several window-level keydown listeners. The modal half is
// load-bearing: HelpModal owns Escape while it is open, so without this a
// single press closed the modal *and* cancelled the active tool.

export const isTypingInField = (target) =>
  !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

// The export dialog is here for the same reason the help modal is: it is a
// focused surface over the plan, and a key that both drives it and reaches the
// canvas behind it does two things at once. Delete is the sharp case — it would
// close a plan and delete a vertex in the same press.
export const shortcutsBlocked = (target) => {
  if (isTypingInField(target)) return true;
  const workspace = useWorkspaceStore.getState();
  return workspace.showHelpModal || workspace.showExportDialog;
};
