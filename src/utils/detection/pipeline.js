/**
 * Room detection — stub.
 *
 * The algorithm implementation has been removed to prepare for a
 * full rewrite.  This export preserves the public API so the UI
 * continues to compile and run (detection simply returns null).
 */
// eslint-disable-next-line no-unused-vars
export const detectRoomFromClickCore = (imageData, clickPoint, options = {}) => null;

/**
 * Exterior wall tracing — stub.
 *
 * The algorithm implementation has been removed to prepare for a
 * full rewrite.  This export preserves the public API so the UI
 * continues to compile and run (detection simply returns null).
 */
// eslint-disable-next-line no-unused-vars
export const traceFloorplanBoundaryCore = (imageData, options = {}) => null;

export const boundaryByMode = (result, wallMode = 'inner') => {
  if (!result) return null;
  if (wallMode === 'outer') return result.outer ?? result.inner;
  return result.inner ?? result.outer;
};
