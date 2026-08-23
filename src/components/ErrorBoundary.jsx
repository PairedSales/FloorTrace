import { Component } from 'react';
import { recoverFromStaleBuild, isStaleChunkError } from '../utils/staleBuild';
import useAppStore from '../store/appStore';

// What this screen may honestly promise about the work. The draft is only a net
// where the draft store is actually being written: with "Save work on exit" off
// nothing was stored at all, and after a storage refusal the last write failed.
// Telling someone their work is safe and being wrong about it is the worst
// sentence this app can print, and it was printed unconditionally.
const DRAFT_PROMISE = {
  off: 'Nothing was saved — “Save work on exit” is off, so reloading starts a new session.',
  error: 'This browser refused to store the draft, so the most recent work may not survive a reload.',
};
const DRAFT_PROMISE_DEFAULT =
  'Your work is not lost — the autosaved draft is still in this browser, and reloading restores it.';
// Before the restore effect has run, `draftState` is still its 'off' default and
// says nothing about what is on disk. A render that throws on first paint is
// exactly that moment, and printing "nothing was saved" there is the same lie
// this table exists to stop, pointing the other way.
const DRAFT_PROMISE_UNKNOWN =
  'This failed before the app finished starting. Whatever was saved before is still in this browser, and reloading reads it back.';

/**
 * The last thing between a thrown render and a blank page.
 *
 * There was nothing here, and `Canvas` renders its lazy stage inside
 * `<Suspense fallback={null}>` — so a chunk that failed to load produced no
 * error, no fallback and no text: a white rectangle that reads as "the app
 * hangs on startup" rather than as a failure anyone could report.
 *
 * A stale build is handled rather than displayed. Every deploy remints the
 * hashed filenames and GitHub Pages serves `index.html` with `max-age=600`, so
 * for ten minutes after a deploy a reload can ask for chunks that no longer
 * exist. That is not the user's problem to read about, so it reloads through
 * `recoverFromStaleBuild`, once.
 */
class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // Kept: with no server and no telemetry, the console is the only record of
    // what happened, and the user may well be asked to open it.
    console.error('FloorTrace crashed:', error, info?.componentStack);
    if (isStaleChunkError(error)) recoverFromStaleBuild();
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // A stale build is already reloading; saying so beats a bare spinner.
    const stale = isStaleChunkError(error);
    // Read here rather than subscribed to: the tree that would re-render is the
    // one that just threw, and this screen is shown once and then reloaded away.
    const { draftState, _hasRestoredState } = useAppStore.getState();
    const promise = _hasRestoredState
      ? (DRAFT_PROMISE[draftState] ?? DRAFT_PROMISE_DEFAULT)
      : DRAFT_PROMISE_UNKNOWN;

    return (
      <div role="alert" className="fixed inset-0 flex items-center justify-center p-6 bg-shell">
        <div className="max-w-md text-center">
          <p className="text-base font-semibold text-fg mb-2">
            {stale ? 'Updating to the latest version…' : 'FloorTrace hit an error'}
          </p>
          {!stale && (
            <>
              <p className="text-[13px] text-fg-2 leading-relaxed mb-4">
                {promise}
              </p>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-3 py-1.5 text-[13px] rounded border border-line bg-panel-2 text-fg hover:bg-panel"
              >
                Reload FloorTrace
              </button>
              <pre className="mt-4 text-[11px] text-fg-3 whitespace-pre-wrap text-left">
                {String(error?.message || error)}
              </pre>
            </>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
