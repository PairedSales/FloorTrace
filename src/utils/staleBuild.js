// Surviving a deploy.
//
// Every build remints the hashed asset filenames and the Pages artifact is a
// whole replacement, so the previous deploy's chunks are *gone* — a request for
// one returns GitHub's 404 page, which is HTML where a module was expected.
// `index.html` itself is served with `Cache-Control: max-age=600`, so for ten
// minutes after a deploy a browser can hold an index that names chunks nobody
// serves any more. Four deploys in one afternoon makes that a normal event
// rather than a rare one.
//
// The recovery is a reload, but a plain one is not enough: it would be served
// the same cached `index.html` and fail identically. A one-shot query parameter
// makes the URL a cache miss, so the browser has to ask the origin.

const RECOVERY_KEY = 'floortrace:recovering-stale-build';
const PARAM = 'rebuild';

/**
 * Whether an error is a module that could not be fetched or executed.
 * Matched by message because the browsers disagree on the type and the wording:
 * Chrome throws a TypeError "Failed to fetch dynamically imported module",
 * Firefox "error loading dynamically imported module", Safari "Importing a
 * module script failed".
 */
export const isStaleChunkError = (error) => {
  const text = String(error?.message || error || '');
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch/i.test(text);
};

/**
 * Reload once against a cache-busting URL. Guarded by `sessionStorage` so a
 * failure that is *not* a stale build cannot turn into a reload loop — the
 * second attempt falls through and the error is shown instead.
 *
 * @returns {boolean} whether a reload was started
 */
export function recoverFromStaleBuild() {
  try {
    if (sessionStorage.getItem(RECOVERY_KEY)) return false;
    sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
  } catch {
    // Private mode with storage disabled: one reload is still better than a
    // blank page, and without the guard we accept the small risk of a loop.
  }
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

/**
 * Called once the app has actually mounted: the build we are running works, so
 * clear the guard and take the marker back out of the address bar. Leaving it
 * there would make the URL a user copies out of the bar a permanent cache miss.
 */
export function markBuildHealthy() {
  try { sessionStorage.removeItem(RECOVERY_KEY); } catch { /* as above */ }
  try {
    const url = new URL(window.location.href);
    if (!url.searchParams.has(PARAM)) return;
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  } catch { /* history is not load-bearing here */ }
}
