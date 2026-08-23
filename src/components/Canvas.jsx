import React, { forwardRef, useImperativeHandle, useRef, useEffect, lazy, Suspense } from 'react';
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
// measures itself against, and the empty state.
const CanvasStage = lazy(() => import('./CanvasStage'));

const Canvas = React.memo(forwardRef((props, ref) => {
  const { image, isProcessing, onFileOpen, onTryExample } = props;
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

  // A plan has been opened, so the pipeline demo has done its job. Marked here
  // rather than on the button, because a drop, a paste and a restored draft are
  // all first runs that never touch it.
  useEffect(() => {
    if (image) markWelcomed();
  }, [image]);

  return (
    <div ref={containerRef} className="absolute inset-0 canvas-grid-bg canvas-touch" style={{ cursor: 'default' }}>
      {!image && !isProcessing && (
        <WelcomeScreen
          isTouch={isTouch}
          onFileOpen={onFileOpen}
          onTryExample={onTryExample}
        />
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
