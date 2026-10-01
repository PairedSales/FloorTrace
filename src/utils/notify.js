import useWorkspaceStore from '../store/workspaceStore';

/**
 * The one place the app decides how loudly to speak.
 *
 *   panel     — anything about the measurement that is still true. The area, a
 *               doubtful scale, why there is no outline. Never a passing message.
 *   flash()   — the bar above the plan: what just happened to the plan. One
 *               line, latest wins. Green when it was done ("Outline found"),
 *               amber when it was not, and why ("An outline needs three corners").
 *   notify()  — one notice over the plan, for what went wrong *outside* the
 *               plan and has nowhere of its own to be said: a file that would
 *               not open, a save that failed, storage that is full.
 *   dialog    — anything that destroys work. A dialog's own errors stay in it.
 *
 * A message that merely echoes what is already on screen gets no channel at all.
 *
 * ## Why there is no stack
 *
 * This used to be a toast library with room for two. Every stage of the
 * automatic run — the file loader, the scan, the scale, the trace, the typing
 * of outlines — reported on itself as it finished, each under its own id, and
 * they finish within a second or two of each other. Measured on the nine sample
 * plans: eight raised at least one toast, two raised a pair twelve milliseconds
 * apart, and on two the toast and the panel contradicted each other, because
 * each was also worked out twice — once for the toast and once for the panel.
 *
 * So the stages do not narrate. The run ends in one line in the bar, the panel
 * holds whatever is still true, and a notice is raised only when the thing that
 * went wrong is not on the plan at all. There is one notice at a time: a second
 * replaces the first, because the first was about something the user has since
 * moved on from.
 */

/**
 * What just happened to the plan, in the bar above it.
 *
 * `tone` is 'ok' for something done and 'warn' for something that was not —
 * a refusal, a job that came to nothing, a step still needed. Never for news
 * that is still true a minute later: that belongs on the panel.
 */
export function flash(text, tone = 'ok') {
  useWorkspaceStore.getState().flashStatus(text, tone);
}

/**
 * Something outside the plan went wrong. `type` is 'error' when it failed and
 * 'warning' when it half-worked or the user's work is at risk.
 *
 * `action` is `{label, onClick}` — the one thing to do about it, when there is
 * one. Latest wins; there is no stack to manage and no id to pick.
 */
export function notify(message, { type = 'error', action = null } = {}) {
  if (type !== 'error' && type !== 'warning') {
    throw new Error(`notify() is for failures: type must be 'error' or 'warning' (got ${JSON.stringify(type)}) for: ${message}`);
  }
  useWorkspaceStore.getState().setNotice({
    text: message,
    tone: type === 'error' ? 'crit' : 'warn',
    action,
  });
}
