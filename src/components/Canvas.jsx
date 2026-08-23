import React, { forwardRef, useImperativeHandle, useRef, useEffect, lazy, Suspense } from 'react';
import { FolderOpen } from 'lucide-react';
import { useIsTouch } from '../hooks/useViewport';

// The Konva stage and everything under it load on demand. `manualChunks`
// already put konva in its own file, but splitting is not lazying: App.jsx
// imported Canvas, Canvas imported react-konva, so konva sat in the entry's
// static module graph and the browser had to fetch and compile 320 kB raw /
// 99 kB gz — ~42% of the initial JS — before the app could execute. Nothing in
// it is reachable until an image is loaded.
//
// What stays here is exactly what first paint shows: the container the camera
// measures itself against, and the empty state.
const CanvasStage = lazy(() => import('./CanvasStage'));

const Canvas = React.memo(forwardRef((props, ref) => {
  const { image, isProcessing, onFileOpen } = props;
  const isTouch = useIsTouch();
  const containerRef = useRef(null);
  // Populated by the lazy module once it mounts. The handle itself is eager so
  // `canvasRef.current` is never null — the rotate button and the keyboard
  // shortcuts hold it from mount, and both are no-ops without an image anyway.
  const stageApiRef = useRef(null);

  useImperativeHandle(ref, () => ({
    fitToWindow: () => stageApiRef.current?.fitToWindow(),
    rotateCanvas: (direction) => stageApiRef.current?.rotateCanvas(direction),
    zoomByStep: (direction) => stageApiRef.current?.zoomByStep(direction),
    closeVoid: () => stageApiRef.current?.closeVoid(),
  }), []);

  // Warm the chunk during the first idle moment so a drop never waits on it.
  useEffect(() => {
    const idle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 2000));
    const cancel = window.cancelIdleCallback ?? clearTimeout;
    // Caught, not floated: a stale deploy makes this reject, and an unhandled
    // rejection here is noise on the console at best and a reported "error" at
    // worst. The real load below is what surfaces the failure, through the
    // error boundary, at the moment it actually matters.
    const handle = idle(() => { import('./CanvasStage').catch(() => {}); }, { timeout: 4000 });
    return () => cancel(handle);
  }, []);

  return (
    <div ref={containerRef} className="absolute inset-0 canvas-grid-bg canvas-touch" style={{ cursor: 'default' }}>
      {!image && !isProcessing && (
        <div className="absolute inset-0 flex items-center justify-center p-6">
          <div className="text-center max-w-sm">
            <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-panel-2 border border-line flex items-center justify-center">
              <svg className="w-7 h-7 text-fg-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <path d="M9 3v18" />
                <path d="M15 3v18" />
                <path d="M3 9h18" />
                <path d="M3 15h18" />
              </svg>
            </div>
            <p className="text-base font-semibold text-fg mb-1">
              No floor plan loaded
            </p>
            {/* Two keybindings are the whole instruction on a desktop and a dead
                end on a phone, where the route in is the button at the bottom of
                the screen — or the camera, which is the fastest way to get a
                paper plan into this app and does not exist on the desktop. */}
            {isTouch ? (
              <p className="text-[13.5px] text-fg-2 leading-relaxed">
                Photograph a plan, or open an image, with the buttons below.
              </p>
            ) : (
              <>
                {/* A button, not two keybindings. This is the whole screen at
                    the one moment the app has nothing else to say, and it used
                    to answer with a pair of chords — which is a dead end for
                    anyone who does not read them, and the reason Open had to
                    keep a label up in the top row. It has one here instead. */}
                <button
                  type="button"
                  onClick={onFileOpen}
                  className="mt-1 inline-flex items-center gap-2 h-9 px-3.5 rounded-md
                             bg-accent text-accent-ink text-[12.5px] font-semibold
                             hover:brightness-110 transition-[filter] cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" aria-hidden="true" />
                  Open a plan
                </button>
                <p className="mt-3 text-[13px] text-fg-3">
                  or drop one here, or paste with <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-panel-2 border border-line rounded text-fg-2">Ctrl+V</kbd>
                </p>
              </>
            )}
            {/* What the app is about to attempt, and the honest caveat. Three
                spinners used to run in sequence with nothing having said what
                they were for or that the last of them can be wrong — so a bad
                trace arrived as a surprise rather than as the expected case it
                is. Both shells, because the surprise is the same on a phone. */}
            <p className="mt-5 pt-4 border-t border-line text-[12.5px] text-fg-3 leading-relaxed">
              FloorTrace reads the printed room sizes, works out the scale from them, and
              traces the exterior walls to get the area. Automatic tracing works best on a
              clean plan with space around the drawing — when it struggles, you paint
              roughly over the walls instead and it snaps to them.
            </p>
          </div>
        </div>
      )}

      {(image || isProcessing) && (
        <Suspense fallback={null}>
          <CanvasStage {...props} containerRef={containerRef} apiRef={stageApiRef} />
        </Suspense>
      )}
    </div>
  );
}));

Canvas.displayName = 'Canvas';

export default Canvas;
