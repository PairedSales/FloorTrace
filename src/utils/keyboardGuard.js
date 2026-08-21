import useWorkspaceStore from '../store/workspaceStore';

// One guard for the several window-level keydown listeners. The modal half is
// load-bearing: HelpModal owns Escape while it is open, so without this a
// single press closed the modal *and* cancelled the active tool.

export const isTypingInField = (target) =>
  !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

export const shortcutsBlocked = (target) =>
  isTypingInField(target) || useWorkspaceStore.getState().showHelpModal;
