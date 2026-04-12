const DEFAULT_BINS = [0, 30, 45, 60, 90, 120, 135, 150];

const toDegrees = (radians) => (radians * 180) / Math.PI;

const foldOrientation = (deg) => ((deg % 180) + 180) % 180;

export const estimateDominantOrientations = (gray, width, height, options = {}) => {
  const bins = options.bins ?? DEFAULT_BINS;
  const strengths = bins.map(() => 0);

  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const idx = y * width + x;
      const gx =
        gray[idx + 1 - width] + 2 * gray[idx + 1] + gray[idx + 1 + width]
        - (gray[idx - 1 - width] + 2 * gray[idx - 1] + gray[idx - 1 + width]);
      const gy =
        gray[idx - width - 1] + 2 * gray[idx - width] + gray[idx - width + 1]
        - (gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1]);

      const magnitude = Math.abs(gx) + Math.abs(gy);
      if (magnitude < (options.edgeThreshold ?? 40)) continue;

      const edgeAngle = foldOrientation(toDegrees(Math.atan2(gy, gx)) + 90);
      let bestBin = 0;
      let bestDelta = Number.POSITIVE_INFINITY;

      for (let i = 0; i < bins.length; i += 1) {
        const d = Math.abs(edgeAngle - bins[i]);
        const delta = Math.min(d, 180 - d);
        if (delta < bestDelta) {
          bestDelta = delta;
          bestBin = i;
        }
      }

      const weight = Math.max(0, 1 - bestDelta / 22.5);
      strengths[bestBin] += magnitude * weight;
    }
  }

  const ranked = bins
    .map((angle, i) => ({ angle, strength: strengths[i] }))
    .sort((a, b) => b.strength - a.strength);

  const topN = options.topN ?? 4;
  return {
    ranked,
    dominant: ranked.slice(0, topN).map((entry) => entry.angle),
  };
};

export const snapAngleToBins = (degrees, bins) => {
  if (!Array.isArray(bins) || bins.length === 0) return degrees;
  const normalized = ((degrees % 180) + 180) % 180;
  let snapped = bins[0];
  let best = Number.POSITIVE_INFINITY;
  for (const bin of bins) {
    const delta = Math.abs(bin - normalized);
    const wrapped = Math.min(delta, 180 - delta);
    if (wrapped < best) {
      best = wrapped;
      snapped = bin;
    }
  }
  return snapped;
};
