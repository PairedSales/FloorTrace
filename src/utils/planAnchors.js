// A place on the plan that a refused edit points at, in original image px:
// `{ runs: [[p, p], …] }`, the edges `findSelfIntersection` reports.
//
// Never stored on anything that is saved: the anchor is raised when the edit is
// refused and cleared a moment later, so a crop, a rotate or a moved corner
// cannot leave one pointing at the wrong part of the image.

/** Bounding box of an anchor, for the camera to test against the viewport. */
export const anchorBounds = (anchor) => {
  if (!anchor) return null;
  // Several disconnected runs when more than one edge is involved; the camera
  // has to frame all of them.
  const points = anchor.runs ? anchor.runs.flat() : (anchor.points ?? []);
  if (!points.length) return null;
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
};
