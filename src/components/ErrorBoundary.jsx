import { Component } from 'react';
import { recoverFromStaleBuild, isStaleChunkError } from '../utils/staleBuild';

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

    return (
      <div role="alert" className="fixed inset-0 flex items-center justify-center p-6 bg-shell">
        <div className="max-w-md text-center">
          <p className="text-base font-semibold text-fg mb-2">
            {stale ? 'Updating to the latest version…' : 'FloorTrace hit an error'}
          </p>
          {!stale && (
            <>
              <p className="text-[13px] text-fg-2 leading-relaxed mb-4">
                Your work is not lost — the autosaved draft is still in this
                browser, and reloading restores it.
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
