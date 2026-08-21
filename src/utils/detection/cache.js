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
// Keyed like the analysis memo, and bounded the same way. One entry was right
// while one image was ever in play; with two plans open, alternating between
// them meant the ladder was rebuilt from scratch on every switch.
const MAX_SEARCH_CACHES = 2;
/** @type {Map<string, SearchCache>} */
const searchCaches = new Map();

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
  retainedBytes = 0;
  for (const cache of searchCaches.values()) retainedBytes += cache.bytes;
};

// Charged across every live cache, not per instance.
//
// The budget was declared once and then charged against each SearchCache's own
// `this.bytes`, while one instance was minted per key. With a single instance
// alive that read as a global bound and behaved as one. Holding a ladder per
// plan without changing this would have multiplied the worker's ceiling by the
// number of open plans, against a comment (above) already recording >100 MB
// retained on a single multi-plan sheet.
let retainedBytes = 0;

// Evict whole caches, least recently used first, until the total is back
// under budget. A ladder is only useful entire, so a cache is dropped whole
// rather than trimmed — and the one being built is never the one evicted.
const evictSearchCaches = (keep) => {
  for (const [key, cache] of searchCaches) {
    if (retainedBytes < searchBudgetBytes) return;
    if (key === keep) continue;
    retainedBytes -= cache.bytes;
    searchCaches.delete(key);
  }
};

class SearchCache extends Map {
  constructor(key) {
    super();
    this.key = key;
    this.bytes = 0;
    this.overBudget = false;
    this.trippedStored = false;
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
    retainedBytes += bytes;
    if (retainedBytes < searchBudgetBytes) return;
    // Free what other plans are holding before giving up on this one: a ladder
    // that is still being climbed is worth more than one nobody has asked for
    // since the last switch.
    evictSearchCaches(this.key);
    if (retainedBytes < searchBudgetBytes) return;
    this.overBudget = true;
  }

  // One store is allowed through after the trip, and that is the whole fix for
  // a single-building page.
  //
  // The budget is charged incrementally from inside the candidate search
  // (candidates.js retain sites) but a wall network's entire closing ladder is
  // stored as ONE entry afterwards (boundary.js `memo(cache, 'gen|' + netKey)`).
  // A network that crosses the line part-way therefore lost its whole ladder —
  // including the rungs already computed AND already charged for. "Keep what is
  // already stored" is true at entry granularity, but on a page with one
  // building there is no earlier entry to keep, so the memo ended up holding
  // nothing and the perimeter trace paid a full cold search anyway.
  //
  // Letting the entry whose own charge crossed the line still land makes the
  // bound per-network — the granularity the key actually has — and overshoots
  // the nominal budget by exactly one entry. Measured on plans that trip: the
  // warm perimeter trace returns from ~1.5 s to ~0.3 s.
  set(key, value) {
    if (this.overBudget && !this.trippedStored) {
      this.trippedStored = true;
      return super.set(key, value);
    }
    return this.overBudget ? this : super.set(key, value);
  }
}

export const getSearchCache = (cacheKey, maxDimension, analyzeOptions) => {
  if (!cacheKey) return new Map();
  const key = keyFor(cacheKey, maxDimension, analyzeOptions);
  const existing = searchCaches.get(key);
  if (existing) {
    // Refresh recency.
    searchCaches.delete(key);
    searchCaches.set(key, existing);
    return existing;
  }
  const cache = new SearchCache(key);
  searchCaches.set(key, cache);
  while (searchCaches.size > MAX_SEARCH_CACHES) {
    const oldest = searchCaches.keys().next().value;
    if (oldest === key) break;
    retainedBytes -= searchCaches.get(oldest).bytes;
    searchCaches.delete(oldest);
  }
  return cache;
};

// A tripped budget used to be completely unobservable — the only symptom was a
// perimeter trace that took a second longer on large plans. Reported through
// the trace's debug channel so it can be seen rather than inferred.
export const searchCacheStats = () => {
  if (searchCaches.size === 0) return null;
  // The most recently used cache is the one the trace that is asking just used.
  let latest = null;
  for (const cache of searchCaches.values()) latest = cache;
  return {
    bytes: latest.bytes,
    entries: latest.size,
    overBudget: latest.overBudget,
    // Across every plan, which is the number the budget actually bounds.
    totalBytes: retainedBytes,
    caches: searchCaches.size,
  };
};

/**
 * Forget everything held for one image. Called when a decode is evicted or a
 * plan is closed — the alternative, clearing the whole cache on any image
 * change, threw away every other plan's work along with it.
 */
export const dropCacheKey = (cacheKey) => {
  if (!cacheKey) return;
  const prefix = `${cacheKey}|`;
  for (const key of entries.keys()) {
    if (key.startsWith(prefix)) entries.delete(key);
  }
  for (const [key, cache] of searchCaches) {
    if (key.startsWith(prefix)) {
      retainedBytes -= cache.bytes;
      searchCaches.delete(key);
    }
  }
};

export const clearDetectionCache = () => {
  entries.clear();
  searchCaches.clear();
  retainedBytes = 0;
};
