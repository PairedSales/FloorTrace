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
// holding the decoded image. Past this budget the memo stops storing. Sized
// from the fixtures so a single-plan page keeps its memo and a multi-plan sheet
// does not.
const SEARCH_BUDGET_BYTES = 32 * 1024 * 1024;

// Overridable so the eviction path itself is testable: on the fixtures it is
// reached only by the heaviest sheets, and "the memo agrees with a cold trace
// while it is alive" is the weaker of the two properties that matter.
let searchBudgetBytes = SEARCH_BUDGET_BYTES;
export const setSearchBudgetBytes = (bytes) => {
  searchBudgetBytes = bytes ?? SEARCH_BUDGET_BYTES;
};

class SearchCache extends Map {
  constructor() {
    super();
    this.bytes = 0;
    this.overBudget = false;
  }

  // Charged by the search as it allocates what this cache would hold.
  //
  // Tripping the budget stops further storing; it deliberately does NOT clear
  // what is already held. Clearing made the budget a cliff rather than a bound:
  // `getSearchCache` only builds a fresh cache when the KEY changes, and the key
  // is constant for one image, so a single trip killed the memo for as long as
  // that image stayed open and turned the perimeter trace back into a full cold
  // trace (~1 s). Measured: a plan whose working raster reaches the 1400 px cap
  // charges ~24 B/px and trips, taking the second trace from ~130 ms to ~1130 ms
  // — i.e. essentially every phone photo, which is why no fixture ever showed it.
  //
  // Keeping the early entries is also the right half to keep, not merely the
  // cheap one: both traces climb the same closing ladder from r=2 upward, so
  // what is already stored when the budget trips is exactly what the second
  // trace asks for first. An LRU would evict those in favour of the late,
  // wide rungs and serve this access pattern worse.
  retain(bytes) {
    if (this.overBudget) return;
    this.bytes += bytes;
    if (this.bytes < searchBudgetBytes) return;
    this.overBudget = true;
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

// A tripped budget used to be completely unobservable — the only symptom was a
// perimeter trace that took a second longer on large plans. Reported through
// the trace's debug channel so it can be seen rather than inferred.
export const searchCacheStats = () => (searchCache
  ? {
    bytes: searchCache.bytes,
    entries: searchCache.size,
    overBudget: searchCache.overBudget,
  }
  : null);

export const clearDetectionCache = () => {
  entries.clear();
  searchKey = null;
  searchCache = null;
};
