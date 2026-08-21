import useAppStore from './appStore';

/**
 * Ownership for asynchronous work.
 *
 * Every long await in this app — an OCR scan, an exterior trace, a room
 * detection — produces a result *about a particular drawing*, and resumes into
 * whatever the app looks like by then. The existing guards asked one question,
 * `image !== startImage`, and used it to answer two different ones:
 *
 *   1. Do these pixels still exist? A crop, an erase or a new file replaces the
 *      image, and a result computed from the old ink describes ink that is gone.
 *   2. Is this still the drawing the user is looking at?
 *
 * With one plan those coincide, which is why one comparison could stand in for
 * both. With several plans open they come apart, and the image comparison
 * answers the second question wrongly in the most dangerous direction: two
 * plans opened from the same file hold the *same* data URL, so each would pass
 * the other's staleness test exactly. A result would land on the wrong drawing
 * and nothing would look wrong.
 *
 * So work is tracked rather than inferred. `beginWork` captures who asked and
 * what they asked about; `deliver` decides what may be written; `settleWork`
 * releases it. The token also carries an `AbortController`, so work that can
 * stop early has one standard thing to check.
 *
 * The verdicts `deliver` can return, and why there are three rather than two:
 *
 *   'applied' — the owning plan is the live one; the result is written.
 *   'stale'   — the plan still exists but its image has been replaced since the
 *               work began, so the result describes ink that is gone.
 *   'dropped' — the owning plan is gone entirely.
 *
 * A fourth verdict, 'routed', belongs here once a plan can be open without
 * being live: a result for a background plan should reach that plan rather than
 * be thrown away. There is no such state yet — one plan is open and it is
 * always the active one — so routing is deliberately absent rather than stubbed.
 * `resolveOwner` below is the single place that decision is made, and it is
 * where routing will go.
 */

/** @type {Map<string, Set<object>>} docId → live tokens */
const inFlight = new Map();

const activeDocumentId = () => useAppStore.getState().activeDocumentId;

/**
 * Claim ownership of a unit of async work on behalf of the active plan.
 *
 * @param {string} kind what this work is, for diagnosis: 'scan' | 'trace' |
 *   'room' | 'measure'. Not branched on today; it is what makes a token
 *   readable in a log and what a later rule ("a calibration may not be applied
 *   across a plan switch") will key on.
 * @param {{image?: string|null}} [opts] the image this work is about, defaulting
 *   to the one currently loaded. Passed explicitly by callers that already hold
 *   it — the scan is handed an `imgSrc` and must own *that*, not whatever the
 *   store happens to show when it starts.
 */
export function beginWork(kind, { image } = {}) {
  const state = useAppStore.getState();
  const token = {
    kind,
    docId: state.activeDocumentId,
    image: image === undefined ? state.image : image,
    controller: new AbortController(),
    settled: false,
  };
  const forDoc = inFlight.get(token.docId);
  if (forDoc) forDoc.add(token);
  else inFlight.set(token.docId, new Set([token]));
  return token;
}

/**
 * Release a token. Safe to call twice; belongs in a `finally`.
 *
 * Settling removes the token from the in-flight registry — it says the awaiting
 * is over, so nothing can abort it any more. It does **not** invalidate the
 * token as an ownership claim: `isCurrent` and `deliver` keep answering
 * correctly afterwards, which is what lets the synchronous tail of an async
 * function stay guarded after its `finally` has run.
 */
export function settleWork(token) {
  if (!token || token.settled) return;
  token.settled = true;
  const forDoc = inFlight.get(token.docId);
  if (!forDoc) return;
  forDoc.delete(token);
  if (forDoc.size === 0) inFlight.delete(token.docId);
}

/**
 * What may be done with a result carried by this token. The one place the
 * question is decided, so every caller answers it the same way.
 */
function resolveOwner(token) {
  if (!token) return 'dropped';
  if (token.controller.signal.aborted) return 'dropped';
  const state = useAppStore.getState();
  // Only the active plan exists today, so "not the active plan" means gone.
  // When a plan can be open in the background this is where 'routed' is
  // returned instead, and `deliver` gains a branch that writes to it.
  if (token.docId !== state.activeDocumentId) return 'dropped';
  if (token.image !== state.image) return 'stale';
  return 'applied';
}

/**
 * Whether this token still owns what it set out to change. For the middle of a
 * long function, where the next few statements are all conditional on it;
 * `deliver` is the better tool when there is a single block to guard.
 */
export const isCurrent = (token) => resolveOwner(token) === 'applied';

/**
 * Run `apply` only if the result may still be written, and say what happened.
 * The verdict is returned rather than swallowed so a caller can tell "written"
 * from "deliberately not written" — the two used to be the same silent `return`.
 */
export function deliver(token, apply) {
  const verdict = resolveOwner(token);
  if (verdict === 'applied') apply();
  return verdict;
}

/** The signal for work that can stop early rather than finish and be discarded. */
export const signalOf = (token) => token?.controller?.signal;

/**
 * Abandon every unit of work a plan has in flight. Their results will be
 * dropped rather than applied, and anything watching the signal can stop now.
 * Called when a plan is closed or restarted — the work was about a drawing that
 * no longer exists.
 */
export function detachDocument(docId) {
  const forDoc = inFlight.get(docId);
  if (!forDoc) return 0;
  const count = forDoc.size;
  for (const token of forDoc) {
    token.settled = true;
    token.controller.abort();
  }
  inFlight.delete(docId);
  return count;
}

/** Abandon the active plan's work. */
export const detachActiveDocument = () => detachDocument(activeDocumentId());

/** How many units of work a plan has in flight. For tests and diagnosis. */
export const workCount = (docId = activeDocumentId()) => inFlight.get(docId)?.size ?? 0;

/** Test seam: forget every token without aborting. */
export function resetRequests() {
  inFlight.clear();
}
