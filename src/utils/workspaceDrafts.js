import { getDraft, setDraft, removeDraft, isQuotaError } from './draftStorage';
import { hashDataUrl } from './hash';

/**
 * Where a workspace of open plans lives on disk.
 *
 * Three key families, all inside the existing `drafts` object store and with no
 * `DB_VERSION` bump. That is deliberate: the store uses out-of-line keys, so
 * new prefixes need no upgrade — and `getDB` has no `onblocked` handler, so a
 * version bump while a second browser tab of this app holds the database open
 * would hang the open promise forever and wedge autosave with no fallback.
 *
 *   floortrace:workspace:v1:<sessionId>   ~2 kB. Which plans are open, in what
 *                                         order, which is active, and enough
 *                                         about each to draw a tab for a plan
 *                                         that has not been hydrated yet.
 *   floortrace:doc:v1:<docId>             One plan's parked state, minus its
 *                                         image, plus a pointer to it.
 *   floortrace:hist:v1:<docId>            One plan's undo history.
 *
 * **Image records stay namespaced per plan.** `setDraft` already derives the
 * image key from the record key, so two plans holding the same picture keep two
 * copies. That is the right trade: it means closing one plan can never delete
 * the image another is still pointing at, no mark-and-sweep is needed, and the
 * `hashDataUrl` bucket collision that this repo has already shipped once cannot
 * be reintroduced by a shared image namespace.
 *
 * **The session id lives in `sessionStorage`, not `localStorage`.** Two browser
 * tabs of this app share IndexedDB and coordinate through nothing at all — no
 * BroadcastChannel, no storage listener — so each gets its own workspace and
 * they cannot fight over one index. It must not be a `localStorage` key for a
 * second reason: `resolveInitialToolLabels` infers "this browser has used
 * FloorTrace before" from the presence of *any* other `floortrace:` key there,
 * so writing one before first render would silently flip a genuinely new user
 * to the compact tool rail.
 */

const SESSION_KEY = 'floortrace:session';

export const workspaceKey = (sessionId) => `floortrace:workspace:v1:${sessionId}`;
export const docKey = (docId) => `floortrace:doc:v1:${docId}`;
export const historyKey = (docId) => `floortrace:hist:v1:${docId}`;

/** The legacy single-draft key, read once and migrated into the first plan. */
export const LEGACY_DRAFT_KEY = 'floortrace:autosave:v1';

let sessionId = null;

export function getSessionId() {
  if (sessionId) return sessionId;
  try {
    const existing = window.sessionStorage?.getItem(SESSION_KEY);
    if (existing) {
      sessionId = existing;
      return sessionId;
    }
  } catch {
    // Private mode, or storage disabled. A per-load id still works for the
    // life of the page; only restoring after a reload is lost.
  }
  sessionId = `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    window.sessionStorage?.setItem(SESSION_KEY, sessionId);
  } catch { /* as above */ }
  return sessionId;
}

// ── the index ────────────────────────────────────────────────────────────────

/**
 * @typedef {{order: string[], activeId: string|null,
 *            docs: Record<string, {title: string|null, sourceFileName: string|null,
 *                                  updatedAt: number, hasWork: boolean}>}} WorkspaceIndex
 */

export const readWorkspaceIndex = async () => {
  const raw = await getDraft(workspaceKey(getSessionId()));
  if (!raw || !Array.isArray(raw.order)) return null;
  return raw;
};

export const writeWorkspaceIndex = (index) =>
  setDraft(workspaceKey(getSessionId()), index, null, false);

export const removeWorkspaceIndex = () => removeDraft(workspaceKey(getSessionId()));

// ── one plan ─────────────────────────────────────────────────────────────────

/**
 * Write one plan's state. `image` is split into its own record by `setDraft`,
 * and `imageChanged` false leaves that record untouched — the image is 97% of
 * a payload, so rewriting it on every pause in interaction is the cost this
 * split exists to avoid.
 */
export const writeDocDraft = (docId, state, imageChanged) => {
  const { image, ...withoutImage } = state;
  return setDraft(
    docKey(docId),
    { state: withoutImage },
    image ? { hash: hashDataUrl(image), dataUrl: image } : null,
    imageChanged,
  );
};

export const readDocDraft = async (docId) => {
  const raw = await getDraft(docKey(docId));
  if (!raw) return { status: 'missing' };
  if (!raw.state || typeof raw.state !== 'object') return { status: 'malformed' };
  // `getDraft` recombines the image record when it can and returns the record
  // without it when it cannot. The three cases are kept apart on purpose: they
  // used to collapse into "no draft", which is indistinguishable from a plan
  // the user never had and throws away traces and calibration that survived.
  if (!raw.state.image) return { status: 'no-image', state: raw.state };
  return { status: 'ok', state: raw.state };
};

export const removeDocDraft = (docId) => removeDraft(docKey(docId));

/**
 * Undo history, in its own record and written when a plan is parked.
 *
 * It used to ride inside the draft, which meant every debounced write deleted
 * it and only the exit flush restored it — and an exit flush is the least
 * reliable moment there is, since the browser may abandon an IndexedDB
 * transaction once the page is going away. Writing at park is cheap, natural,
 * and happens while the page is unambiguously alive.
 */
export const writeHistoryRecord = (docId, history) => setDraft(
  historyKey(docId),
  {
    undoStack: history?.undoStack ?? [],
    redoStack: history?.redoStack ?? [],
    imagePool: history?.imagePool ? [...history.imagePool] : [],
  },
  null,
  false,
);

export const readHistoryRecord = async (docId) => {
  const raw = await getDraft(historyKey(docId));
  if (!raw?.undoStack) return null;
  return {
    undoStack: raw.undoStack,
    redoStack: raw.redoStack ?? [],
    imagePool: raw.imagePool ?? [],
  };
};

export const removeHistoryRecord = (docId) => removeDraft(historyKey(docId));

/** Forget one plan entirely — state, image and history. */
export const removePlan = async (docId) => {
  await removeDocDraft(docId);
  await removeHistoryRecord(docId);
};

/** Forget every plan the index names, and the index itself. */
export const removeWorkspace = async (index) => {
  for (const docId of index?.order ?? []) {
    await removePlan(docId);
  }
  await removeWorkspaceIndex();
};

export { isQuotaError };
