import { toast } from 'sonner';
import useAppStore from '../store/appStore';

/**
 * The one place the app decides how loudly to speak.
 *
 * The routing rule, from docs/messaging-audit.md:
 *
 *   toast       — the user must know it, and cannot see it
 *   flash()     — confirmation of something they just did
 *   context bar — what the current mode needs
 *   dock        — anything still true, that they may act on later
 *   dialog      — anything that destroys work
 *
 * A message that merely echoes visible chrome gets no channel at all.
 */

// Three tiers, not the six ad-hoc numbers this replaced. Duration tracks
// importance so the pairing is learnable: acknowledgements go before you look
// at them, failures wait.
export const DURATION = {
  SHORT: 3000,
  NORMAL: 6000,
  LONG: 10000,
};

const EMIT = {
  success: toast.success,
  error: toast.error,
  warning: toast.warning,
  info: toast.info,
};

const DEFAULT_DURATION = {
  success: DURATION.SHORT,
  info: DURATION.NORMAL,
  warning: DURATION.NORMAL,
  error: DURATION.LONG,
};

/**
 * Raise a toast. `type` and `id` are both required.
 *
 * `type` used to be inferred by substring-matching the message — a message
 * containing "detected" was styled as a success regardless of what it said,
 * which in an app whose worst news is about detection is a loaded gun.
 *
 * `id` is what makes the stack survivable: sonner replaces a toast with the
 * same id instead of stacking a second copy, so a repeated condition updates
 * in place. Without it, two identical messages are two toasts and the visible
 * cap (2) is spent on saying one thing twice.
 */
export function notify(message, { type, id, duration, action } = {}) {
  if (!type || !EMIT[type]) {
    throw new Error(`notify() needs an explicit type (got ${JSON.stringify(type)}) for: ${message}`);
  }
  if (!id) {
    throw new Error(`notify() needs a stable id so it can coalesce, for: ${message}`);
  }
  return EMIT[type](message, {
    id,
    duration: duration ?? DEFAULT_DURATION[type],
    ...(action ? { action } : {}),
  });
}

/** Dismiss a toast raised earlier under `id`. */
export const dismiss = (id) => toast.dismiss(id);

let anchorTimer = null;

/**
 * A refusal that has a place on the plan. The message goes to the toast; the
 * geometry goes to the canvas, where WarningHighlightLayer draws it with the
 * same treatment the detector's own `segment` warnings get.
 *
 * "Cannot close perimeter: would cause self-intersection" is unactionable on
 * its own — the user has to find the crossing themselves. Highlighting the two
 * edges makes it a pointer instead of a dead end.
 */
export function notifyAt(message, { anchor, id, type = 'error', duration } = {}) {
  const ms = duration ?? DEFAULT_DURATION[type] ?? DURATION.LONG;
  const store = useAppStore.getState();
  store.setErrorAnchor(anchor ?? null);
  clearTimeout(anchorTimer);
  if (anchor) {
    // Outlives the toast slightly: the highlight is the useful half, and it
    // should not vanish the instant the words do.
    anchorTimer = setTimeout(() => {
      useAppStore.getState().setErrorAnchor(null);
    }, ms + 1500);
  }
  return notify(message, { type, id, duration: ms });
}

/**
 * Confirmation of the user's own action, in the status bar rather than over
 * the plan. Latest wins — there is no stack, because there is nothing to
 * compare between two acknowledgements.
 */
export function flash(text) {
  useAppStore.getState().flashStatus(text);
}
