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

// Memo for the boundary search (wall networks + every closing-ladder rung).
// Deliberately one image deep, not an LRU like the analysis above: a rung holds
// a page-sized label array, so a handful of images' worth of ladders is tens of
// megabytes in a worker. One entry is all the sharing that is needed — the
// clamp trace behind a room click and the perimeter trace that follows it are
// always the same image.
let searchKey = null;
let searchCache = null;

// One image deep is not a size. A rung holds a page-sized label array plus its
// mask and the memo holds every rung of every policy of every wall network, so
// a sheet carrying several plans retained over 100 MB in a worker that is also
// holding the decoded image. Past this budget the memo stops storing and drops
// what it has: a cold re-trace (~1s) instead of tens of megabytes held for as
// long as the image is open. Sized from the fixtures so a single-plan page
// keeps its memo and a multi-plan sheet does not.
const SEARCH_BUDGET_BYTES = 32 * 1024 * 1024;

class SearchCache extends Map {
  constructor() {
    super();
    this.bytes = 0;
    this.overBudget = false;
  }

  // Charged by the search as it allocates what this cache would hold.
  retain(bytes) {
    if (this.overBudget) return;
    this.bytes += bytes;
    if (this.bytes < SEARCH_BUDGET_BYTES) return;
    this.overBudget = true;
    this.clear();
  }

  set(key, value) {
    return this.overBudget ? this : super.set(key, value);
  }
}

export const getSearchCache = (cacheKey, maxDimension, analyzeOptions) => {
  if (!cacheKey) return new Map();
  const key = keyFor(cacheKey, maxDimension, analyzeOptions);
  if (key !== searchKey) {
    searchKey = key;
    searchCache = new SearchCache();
  }
  return searchCache;
};

export const clearDetectionCache = () => {
  entries.clear();
  searchKey = null;
  searchCache = null;
};
