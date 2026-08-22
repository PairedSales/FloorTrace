import { getDraft, setDraft, removeDraft, listDraftKeys, isQuotaError } from './draftStorage';
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
 * they cannot fight over one index. A `localStorage` key would be shared by
 * both tabs, which is the whole failure. (It also used to be forbidden for a
 * second reason — `resolveInitialToolLabels` read the mere presence of any
 * other `floortrace:` key as "this browser has run FloorTrace before" — but
 * that resolver went with the tool-label preference. The first reason is the
 * one that was ever load-bearing.)
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
  setDraft(workspaceKey(getSessionId()), { ...index, savedAt: Date.now() }, null, false);

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

/**
 * Who else is open, asked directly.
 *
 * Write age cannot answer this. A tab closed ten seconds ago and a tab open and
 * idle for ten seconds have written their index equally recently, and the
 * common case — quit the browser, reopen it, want the work back — lands inside
 * any window generous enough to protect a live tab. So the tabs are asked
 * instead: every open one answers `who` with the session it owns, and anything
 * unclaimed is genuinely abandoned.
 *
 * The age check below stays as the fallback for a browser without
 * `BroadcastChannel`, where being slow to recover beats stealing.
 */
const CHANNEL = 'floortrace:workspace';
const CLAIM_WAIT_MS = 250;

let channel = null;
let answering = false;

/** Answer other tabs' roll-calls for as long as this one is open. */
export function claimWorkspaceSession() {
  if (answering || typeof BroadcastChannel === 'undefined') return;
  answering = true;
  channel = channel ?? new BroadcastChannel(CHANNEL);
  channel.addEventListener('message', (event) => {
    if (event.data?.type === 'who') {
      channel.postMessage({ type: 'mine', sessionId: getSessionId() });
    }
  });
}

/** The session ids of every other tab that answers within the window. */
async function liveSessions() {
  if (typeof BroadcastChannel === 'undefined') return null;
  const bus = new BroadcastChannel(CHANNEL);
  const seen = new Set();
  bus.addEventListener('message', (event) => {
    if (event.data?.type === 'mine') seen.add(event.data.sessionId);
  });
  bus.postMessage({ type: 'who' });
  await new Promise((resolve) => { setTimeout(resolve, CLAIM_WAIT_MS); });
  bus.close();
  return seen;
}

/**
 * Fallback staleness window, used only when `BroadcastChannel` is unavailable.
 */
export const STALE_SESSION_MS = 90 * 1000;

/** Long enough that nothing anyone still wants is inside it. */
export const SWEEP_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

const WORKSPACE_PREFIX = 'floortrace:workspace:v1:';
const DOC_PREFIX = 'floortrace:doc:v1:';
const HIST_PREFIX = 'floortrace:hist:v1:';

const readIndexAt = async (key) => {
  const raw = await getDraft(key);
  return raw && Array.isArray(raw.order) ? raw : null;
};

/** Every workspace index in the store except this session's, newest first. */
export async function listOtherWorkspaces() {
  const mine = workspaceKey(getSessionId());
  const keys = (await listDraftKeys())
    .filter((k) => k.startsWith(WORKSPACE_PREFIX) && k !== mine);
  const found = [];
  for (const key of keys) {
    const index = await readIndexAt(key);
    // `savedAt` is absent on an index written before it existed. Treating that
    // as epoch makes it eligible, which is right: it cannot belong to a live
    // tab, because a live tab on this build restamps it.
    if (index) found.push({ key, index, savedAt: Number(index.savedAt) || 0 });
  }
  return found.sort((a, b) => b.savedAt - a.savedAt);
}

/**
 * Give this session the workspace a dead one left behind.
 *
 * The index is keyed by a `sessionStorage` id so two tabs cannot fight over one
 * — which is right, and which also meant closing the browser stranded every
 * plan in it. The records were still on disk; nothing could name them. So on a
 * startup with no index of our own, the newest abandoned one is adopted under
 * our key and its old key removed: the work comes back, and the records stop
 * being garbage nothing can collect.
 */
export async function adoptAbandonedWorkspace(now = Date.now()) {
  const candidates = await listOtherWorkspaces();
  if (!candidates.length) return null;

  const live = await liveSessions();
  const abandoned = live
    // Asked and unclaimed: adopt regardless of how recently it was written.
    ? candidates.filter((c) => !live.has(c.key.slice(WORKSPACE_PREFIX.length)))
    // No way to ask, so fall back to age.
    : candidates.filter((c) => now - c.savedAt > STALE_SESSION_MS);
  if (!abandoned.length) return null;

  const [{ key, index }] = abandoned;
  await writeWorkspaceIndex(index);
  await removeDraft(key);
  return index;
}

/**
 * Delete records no surviving index names.
 *
 * Two sources: a plan dropped from an index that was rewritten without it, and
 * a whole workspace old enough that nothing in it is wanted. Deliberately
 * conservative — a plan referenced by *any* index, including another tab's, is
 * never touched, and a workspace is only swept once it is a week cold.
 */
export async function sweepOrphans(now = Date.now()) {
  const keys = await listDraftKeys();
  const mine = workspaceKey(getSessionId());

  const live = new Set();
  let sweptWorkspaces = 0;
  for (const key of keys.filter((k) => k.startsWith(WORKSPACE_PREFIX))) {
    const index = await readIndexAt(key);
    if (!index) continue;
    const savedAt = Number(index.savedAt);
    // A missing `savedAt` means an index written before the stamp existed, so
    // its age is unknown — never ancient. It is recovered by adoption instead,
    // which is what gives it a stamp.
    const ageKnown = Number.isFinite(savedAt) && savedAt > 0;
    if (key !== mine && ageKnown && now - savedAt > SWEEP_AFTER_MS) {
      for (const docId of index.order) await removePlan(docId);
      await removeDraft(key);
      sweptWorkspaces += 1;
      continue;
    }
    for (const docId of index.order) live.add(docId);
  }

  let sweptPlans = 0;
  for (const key of keys) {
    let docId = null;
    if (key.startsWith(DOC_PREFIX)) docId = key.slice(DOC_PREFIX.length).split('::')[0];
    else if (key.startsWith(HIST_PREFIX)) docId = key.slice(HIST_PREFIX.length);
    else continue;
    if (live.has(docId)) continue;
    await removeDraft(key);
    sweptPlans += 1;
  }
  return { plans: sweptPlans, workspaces: sweptWorkspaces };
}

export { isQuotaError };
