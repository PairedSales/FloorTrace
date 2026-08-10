// Wall-segment snap engine for the room overlay rectangle. The image is
// analyzed once: long axis-aligned strokes are extracted as wall segments
// (collinear pieces merged across door gaps), so per-frame snapping during
// drag/resize is a cheap lookup instead of a pixel scan.
import { binarizeToWorkingScale } from './detection/raster';
// One wall-segment extractor for the whole app. The snap engine and the
// boundary stage were running two copies of the same vectorisation.
import { extractWallSegments } from './detection/wallEvidence';

export { extractWallSegments };

const WORKING_MAX_DIMENSION = 1400;
const EDGE_OVERLAP_FRAC = 0.35;
const SEGMENT_OVERLAP_FRAC = 0.8;

const loadImageElement = (src) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = src;
});

// Best segment within tolerance of pos whose extent sufficiently overlaps the
// edge span [spanA, spanB]. Snaps to the requested wall face — 'lo' is the
// first ink pixel across the thickness, 'hi' the last — never the centerline,
// so a room edge lands exactly where white turns black. The overlap
// requirement scales with whichever is shorter so long walls snap partial
// edges and short stubs still need real contact; it filters stray text
// strokes that survive extraction.
export const findSegmentSnap = (segments, pos, spanA, spanB, tolerance, face = 'lo') => {
  const lo = Math.min(spanA, spanB);
  const hi = Math.max(spanA, spanB);
  const edgeLen = Math.max(1, hi - lo);
  let best = null;
  for (const seg of segments) {
    const target = face === 'hi' ? seg.faceHi : seg.faceLo;
    const dist = Math.abs(target - pos);
    if (dist > tolerance) continue;
    const overlap = Math.min(hi, seg.hi) - Math.max(lo, seg.lo);
    if (overlap <= 0) continue;
    const segLen = Math.max(1, seg.hi - seg.lo);
    const required = Math.min(edgeLen * EDGE_OVERLAP_FRAC, segLen * SEGMENT_OVERLAP_FRAC);
    if (overlap < required) continue;
    if (!best || dist < best.dist || (dist === best.dist && overlap > best.overlap)) {
      best = { pos: target, dist, overlap };
    }
  }
  return best ? best.pos : null;
};

/**
 * @param {string} imageSrc data URL or object URL
 * @returns {Promise<{ snapVerticalEdge: Function, snapHorizontalEdge: Function }>}
 *   snap functions take/return natural-image coordinates; tolerance is in
 *   natural-image pixels; face picks which side of the wall band to land on
 *   ('lo' = left/top face, 'hi' = right/bottom face). Both return null when
 *   nothing qualifies.
 */
export const createWallSnapEngine = async (imageSrc) => {
  if (!imageSrc) {
    const noop = () => null;
    return { snapVerticalEdge: noop, snapHorizontalEdge: noop };
  }

  const image = await loadImageElement(imageSrc);
  const naturalW = image.naturalWidth || image.width;
  const naturalH = image.naturalHeight || image.height;

  const canvas = document.createElement('canvas');
  canvas.width = naturalW;
  canvas.height = naturalH;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(image, 0, 0);
  const imageData = ctx.getImageData(0, 0, naturalW, naturalH);

  const { width, height, scaleX, scaleY, ink } = binarizeToWorkingScale(imageData, WORKING_MAX_DIMENSION);
  const { vertical, horizontal } = extractWallSegments(ink, width, height);

  const snapVerticalEdge = (x, y1, y2, tolerance = 12, face = 'lo') => {
    const snapped = findSegmentSnap(
      vertical,
      x * scaleX,
      y1 * scaleY,
      y2 * scaleY,
      Math.max(1, tolerance * scaleX),
      face
    );
    return snapped === null ? null : snapped / scaleX;
  };

  const snapHorizontalEdge = (y, x1, x2, tolerance = 12, face = 'lo') => {
    const snapped = findSegmentSnap(
      horizontal,
      y * scaleY,
      x1 * scaleX,
      x2 * scaleX,
      Math.max(1, tolerance * scaleY),
      face
    );
    return snapped === null ? null : snapped / scaleY;
  };

  return { snapVerticalEdge, snapHorizontalEdge };
};
