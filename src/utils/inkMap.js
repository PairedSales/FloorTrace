// How much of the plan's own print lies under a rectangle.
//
// A label drawn on the plan has to go somewhere, and the plan says where it
// should not: on a room's name, its size, a wall, a stair. The sizes FloorTrace
// read are not the whole of that — a plan prints sizes the reader misses, and
// names it never looks for — so the only complete answer is the drawing's ink
// itself. This is a small summed-area table of darkness, built once per image,
// that answers "how dark is this box" in four lookups.

/**
 * @param {Uint8ClampedArray|number[]} rgba row-major RGBA
 * @returns {(x0:number,y0:number,x1:number,y1:number)=>number} mean darkness of
 *   the box in map pixels, 0 (blank paper) to 1 (solid ink)
 */
export function inkIntegral(rgba, width, height) {
  const stride = width + 1;
  const sums = new Float64Array(stride * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let row = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // Rec. 709 in 256ths, so white is exactly 255 and blank paper exactly 0.
      const lum = (54 * rgba[i] + 183 * rgba[i + 1] + 19 * rgba[i + 2]) / 256;
      // A transparent pixel shows the paper under it.
      row += (1 - lum / 255) * (rgba[i + 3] / 255);
      sums[(y + 1) * stride + x + 1] = sums[y * stride + x + 1] + row;
    }
  }
  const clampX = (v) => Math.max(0, Math.min(width, Math.round(v)));
  const clampY = (v) => Math.max(0, Math.min(height, Math.round(v)));
  return (x0, y0, x1, y1) => {
    const ax = clampX(x0);
    const ay = clampY(y0);
    const bx = clampX(x1);
    const by = clampY(y1);
    const area = (bx - ax) * (by - ay);
    if (!(area > 0)) return 0;
    const total = sums[by * stride + bx] - sums[ay * stride + bx]
      - sums[by * stride + ax] + sums[ay * stride + ax];
    return total / area;
  };
}

const maps = new WeakMap();

/**
 * The same question in image pixels, for a loaded image. Null when the image
 * cannot be read back (there is no canvas, or it is tainted) — a caller then
 * places its label without it.
 */
export function inkMapFor(image, maxSide = 480) {
  if (!image?.width || !image?.height) return null;
  if (maps.has(image)) return maps.get(image);
  let map = null;
  try {
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * ratio));
    const height = Math.max(1, Math.round(image.height * ratio));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    // Paper under a transparent plan, so its ink is measured against white.
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    const mean = inkIntegral(ctx.getImageData(0, 0, width, height).data, width, height);
    const sx = width / image.width;
    const sy = height / image.height;
    map = (x0, y0, x1, y1) => mean(x0 * sx, y0 * sy, x1 * sx, y1 * sy);
  } catch {
    map = null;
  }
  maps.set(image, map);
  return map;
}
