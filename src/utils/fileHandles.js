/**
 * The file handle a plan was last saved to, for as long as the page lives.
 *
 * Kept in memory rather than in IndexedDB. A `FileSystemFileHandle` is
 * structured-cloneable and could be persisted, but a handle read back after a
 * reload has no permission attached — writing through it needs
 * `requestPermission`, which needs a user gesture, which means a re-grant
 * prompt on the first save of every restored plan. Within a session there is
 * no such problem: the grant from `showSaveFilePicker` is still live, so Save
 * overwrites the file the user chose instead of dropping another dated copy in
 * Downloads. That is the whole win, and it costs nothing.
 *
 * Its own module rather than a private map inside `projectSerializer` so that
 * closing a plan can drop the handle without importing the serializer — which
 * is dynamically imported precisely to keep it off the critical path.
 *
 * @type {Map<string, FileSystemFileHandle>} docId → handle
 */
const fileHandles = new Map();

export const getFileHandle = (docId) => (docId ? fileHandles.get(docId) : null);

export const rememberFileHandle = (docId, handle) => {
  if (docId) fileHandles.set(docId, handle);
};

/**
 * Drop a plan's handle. Must be called wherever a plan stops being that plan —
 * closing it, or emptying the last one in place, which reuses its id. A handle
 * that outlives its plan points the next plan's first Ctrl+S at the previous
 * property's file, with no picker and no warning.
 */
export const forgetFileHandle = (docId) => fileHandles.delete(docId);
