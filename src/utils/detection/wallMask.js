const inBounds = (x, y, width, height) => x >= 0 && y >= 0 && x < width && y < height;

export const dilate = (mask, width, height, radius = 1) => {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 0;
      for (let ky = -radius; ky <= radius && !on; ky += 1) {
        for (let kx = -radius; kx <= radius && !on; kx += 1) {
          const px = x + kx;
          const py = y + ky;
          if (inBounds(px, py, width, height) && mask[py * width + px]) {
            on = 1;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
};

export const erode = (mask, width, height, radius = 1) => {
  if (radius <= 0) return mask;
  const out = new Uint8Array(mask.length);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let on = 1;
      for (let ky = -radius; ky <= radius && on; ky += 1) {
        for (let kx = -radius; kx <= radius && on; kx += 1) {
          const px = x + kx;
          const py = y + ky;
          if (!inBounds(px, py, width, height) || !mask[py * width + px]) {
            on = 0;
          }
        }
      }
      out[y * width + x] = on;
    }
  }
  return out;
};

export const closeMask = (mask, width, height, radius = 1) => erode(dilate(mask, width, height, radius), width, height, radius);

export const openMask = (mask, width, height, radius = 1) => dilate(erode(mask, width, height, radius), width, height, radius);

export const prepareWallMask = (baseMask, width, height, options = {}) => {
  const closeRadius = options.closeRadius ?? 1;
  const openRadius = options.openRadius ?? 1;
  const closed = closeMask(baseMask, width, height, closeRadius);
  return openMask(closed, width, height, openRadius);
};
