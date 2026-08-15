// A label array plus the window of the page it covers.
//
// `measureFootprint` already crops to the mask's ink box before closing and
// labelling, then used to re-expand the result to a page-sized array purely to
// restore page coordinates. On a plan occupying a corner of the sheet that
// array is 16-81% `-1` padding, and the boundary search memoises one per kept
// ladder rung — which is what pushed three of seven fixtures past the memo's
// byte budget and cost them their memo for as long as the image stayed open.
//
// So labels stay in crop space and carry their frame. `frame` absent or null
// means "page-sized", which is what every other producer of labels in the
// pipeline (`labelComponents` over a full-page mask) hands back.

import { traceComponentBoundary } from './polygon.js';

// Trace a component whose labels may live in a crop; the ring comes back in
// page coordinates either way. The component never touches the crop border
// except where that border *is* the page border — `measureFootprint` pads the
// crop by `radius + 2` and the closing grows ink by at most `radius` — so the
// walk sees the same neighbourhood in both frames.
export const traceFramedBoundary = (carrier, width, height) => {
  const { labels, frame, componentId } = carrier;
  if (!frame) return traceComponentBoundary(labels, width, height, componentId);
  const ring = traceComponentBoundary(labels, frame.w, frame.h, componentId);
  if (frame.x0 || frame.y0) {
    for (const p of ring) {
      p.x += frame.x0;
      p.y += frame.y0;
    }
  }
  return ring;
};

// Page-sized 0/1 mask of one labelled component. Iterates the component's
// bbox, which is in page coordinates whether the labels are cropped or not.
export const framedComponentMask = (labels, frame, componentId, bbox, width, height) => {
  const mask = new Uint8Array(width * height);
  const { minX, minY, maxX, maxY } = bbox;
  if (!frame) {
    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        if (labels[row + x] === componentId) mask[row + x] = 1;
      }
    }
    return mask;
  }
  const { x0, y0, w, h } = frame;
  const fy0 = Math.max(0, minY - y0);
  const fy1 = Math.min(h - 1, maxY - y0);
  const fx0 = Math.max(0, minX - x0);
  const fx1 = Math.min(w - 1, maxX - x0);
  for (let fy = fy0; fy <= fy1; fy += 1) {
    const src = fy * w;
    const dst = (fy + y0) * width + x0;
    for (let fx = fx0; fx <= fx1; fx += 1) {
      if (labels[src + fx] === componentId) mask[dst + fx] = 1;
    }
  }
  return mask;
};
