// Per-image memo for the expensive shared stages. A room click used to pay for
// a complete boundary trace that was thrown away immediately afterwards, so N
// room placements cost 2N full pipeline runs — and at two different working
// scales, which meant the footprint the room detector was clamped by and the
// perimeter the user saw came from different rasters.
//
// Caching is opt-in via `cacheKey`: the browser worker passes the image data
// URL, the Node harnesses pass nothing and keep measuring cold runs.

const MAX_ENTRIES = 4;
const entries = new Map();

const keyFor = (cacheKey, maxDimension, analyzeOptions) =>
  `${cacheKey}|${maxDimension}|${analyzeOptions ? JSON.stringify(analyzeOptions) : ''}`;

export const getCachedAnalysis = (cacheKey, maxDimension, analyzeOptions, compute) => {
  if (!cacheKey) return compute();
  const key = keyFor(cacheKey, maxDimension, analyzeOptions);
  if (entries.has(key)) {
    const value = entries.get(key);
    // Refresh recency.
    entries.delete(key);
    entries.set(key, value);
    return value;
  }
  const value = compute();
  entries.set(key, value);
  while (entries.size > MAX_ENTRIES) {
    entries.delete(entries.keys().next().value);
  }
  return value;
};

export const clearDetectionCache = () => entries.clear();
