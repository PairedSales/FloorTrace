import useAppStore from './appStore';
import { parkedStateFor, queueForParked } from './documentManager';

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
 * The verdicts `deliver` can return:
 *
 *   'applied' — the owning plan is the live one; the result is written now.
 *   'routed'  — the plan is open but parked. The write is held and replayed
 *               when that plan is next adopted.
 *   'stale'   — the plan still exists but its image has been replaced since the
 *               work began, so the result describes ink that is gone.
 *   'dropped' — the owning plan is gone entirely.
 *
 * 'routed' is what stops a plan switch from quietly throwing work away. Start a
 * trace, switch tabs while it runs, and before this existed the result resolved
 * to 'dropped' and the spinner cleared — you came back to a plan where the
 * trace simply had not happened, with nothing on screen to say so.
 *
 * A routed write is held as the *same closure* that would have run live, and is
 * run once its plan is back on the store root. That is deliberate: the
 * alternative is expressing every result twice, once as a live side effect and
 * once as a patch for a parked record, and those two expressions drift.
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

  if (token.docId !== state.activeDocumentId) {
    // Open but parked: hold the write for when this plan comes back. Closed:
    // there is nothing to hold it for.
    if (!state.documents[token.docId]) return 'dropped';
    // The parked plan's own image, not the live one. A crop it received before
    // being parked makes this result as stale as it would be live.
    const parkedImage = parkedStateFor(token.docId)?.image;
    if (parkedImage !== undefined && parkedImage !== token.image) return 'stale';
    return 'routed';
  }

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
 * Who owns this token's result, without doing anything about it.
 *
 * For a caller whose answer must NOT be replayed when its plan comes back.
 * Calibration is the case and the only one: area goes as scale squared, so a
 * scale applied late, from evidence the user has moved on from, is a wrong
 * number wearing the same green as a right one — such a plan is flagged for
 * re-measuring instead. That caller used to reach this through
 * `deliver(work, () => {}, { replayable: false })`, which is a delivery that
 * delivers nothing, answered by a verdict — `'refused'` — that existed only to
 * describe the empty closure. Asking the question directly says the same thing
 * with one fewer verdict and no pretend delivery.
 */
export const ownerVerdict = (token) => resolveOwner(token);

/**
 * Run `apply` only if the result may still be written, and say what happened.
 * The verdict is returned rather than swallowed so a caller can tell "written"
 * from "deliberately not written" — the two used to be the same silent `return`.
 */
export function deliver(token, apply) {
  const verdict = resolveOwner(token);
  if (verdict === 'applied') {
    apply();
    return verdict;
  }
  if (verdict === 'routed') {
    // Held, not run. `apply` writes through the store's setters, which address
    // whichever plan is live — so running it now would write this result onto
    // somebody else's drawing, which is the exact failure this layer exists to
    // prevent. It runs at adopt time instead, when those setters mean the plan
    // the work was about.
    //
    // A caller whose result must not survive the switch at all does not come
    // through here at all — it asks `ownerVerdict` and handles `'routed'`
    // itself.
    queueForParked(token.docId, apply);
  }
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
