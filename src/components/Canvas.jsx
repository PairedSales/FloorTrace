import React, { forwardRef, useImperativeHandle, useRef, useEffect, lazy, Suspense } from 'react';
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
  const { image, isProcessing } = props;
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
    const handle = idle(() => { import('./CanvasStage'); }, { timeout: 4000 });
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
              <p className="text-[13px] text-fg-2">
                Paste an image <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-panel-2 border border-line rounded text-fg-2">Ctrl+V</kbd> or open a file <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-panel-2 border border-line rounded text-fg-2">Ctrl+O</kbd>
              </p>
            )}
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
