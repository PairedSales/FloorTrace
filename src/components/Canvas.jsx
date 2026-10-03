import React, { forwardRef, useImperativeHandle, useRef, useEffect, lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { useIsTouch } from '../hooks/useViewport';
import { markWelcomed } from '../hooks/useWelcome';
import WelcomeScreen from './WelcomeScreen';

// The Konva stage and everything under it load on demand. `manualChunks`
// already put konva in its own file, but splitting is not lazying: App.jsx
// imported Canvas, Canvas imported react-konva, so konva sat in the entry's
// static module graph and the browser had to fetch and compile 320 kB raw /
// 99 kB gz — ~42% of the initial JS — before the app could execute. Nothing in
// it is reachable until an image is loaded.
//
// What stays here is exactly what first paint shows: the container the camera
// measures itself against, the start screen, and the wait for a plan to open.
const CanvasStage = lazy(() => import('./CanvasStage'));

const Canvas = React.memo(forwardRef((props, ref) => {
  const { image, isProcessing, processingMessage, onFileOpen, onTryExample, addingPlan } = props;
  const isTouch = useIsTouch();
  const containerRef = useRef(null);
  // Populated by the lazy module once it mounts. The handle itself is eager so
  // `canvasRef.current` is never null — the rotate command and the keyboard
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

  // A plan has been opened, so the first-run introduction has done its job.
  // Marked here rather than on the button, because a drop, a paste and a
  // restored draft are all first runs that never touch it.
  useEffect(() => {
    if (image) markWelcomed();
  }, [image]);

  // The paper is white in every theme; the start screen is not paper. Only a
  // plan (or one on its way) gets the paper and, under the dark theme, the
  // light tokens `.canvas-grid-bg` pins to it.
  const hasPlan = image || isProcessing;

  return (
    <div
      ref={containerRef}
      className={`absolute inset-0 canvas-touch ${hasPlan ? 'canvas-grid-bg' : ''}`}
      style={{ cursor: 'default' }}
    >
      {!hasPlan && (
        <WelcomeScreen
          isTouch={isTouch}
          onFileOpen={onFileOpen}
          onTryExample={onTryExample}
          adding={addingPlan}
        />
      )}

      {/* A plan is being opened and there is nothing to draw yet: a PDF being
          rendered, the sample being fetched. With no word here the screen went
          from the start screen to a blank sheet for as long as that took. */}
      {!image && isProcessing && (
        <div className="absolute inset-0 grid place-items-center p-6" role="status" aria-live="polite">
          <div className="flex flex-col items-center gap-3 text-center">
            <Loader2 className="w-8 h-8 animate-spin text-accent" aria-hidden="true" />
            <p className="text-[17px] font-medium text-fg">{processingMessage || 'Opening the plan…'}</p>
          </div>
        </div>
      )}

      {hasPlan && (
        <Suspense fallback={null}>
          <CanvasStage {...props} containerRef={containerRef} apiRef={stageApiRef} />
        </Suspense>
      )}
    </div>
  );
}));

Canvas.displayName = 'Canvas';

export default Canvas;
