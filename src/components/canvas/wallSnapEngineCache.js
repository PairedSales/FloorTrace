/**
 * Wall-snap engines, kept across the canvas remount a plan switch causes.
 *
 * A leaf module on purpose. This cache is written by a canvas hook and released
 * by the store when a plan closes, and if the store reached into the hook to do
 * that it would drag the canvas module graph — the snapper, the wall-snap
 * engine and the detection bridge — into the eager entry chunk. That is the
 * same rule the tab strip follows, one layer down: nothing the shell can reach
 * may import from ./canvas/.
 *
 * Two entries, matching the worker's decode cache: alternating between two
 * plans is the case worth being free, and an engine holds vectorised segments
 * for a whole page.
 */

const MAX_ENGINES = 2;

/** @type {Map<string, Promise<object>>} data URL -> engine */
const engines = new Map();

export const cachedWallSnapEngine = (image) => {
  const hit = engines.get(image);
  if (!hit) return null;
  // Refresh recency.
  engines.delete(image);
  engines.set(image, hit);
  return hit;
};

export const rememberWallSnapEngine = (image, task) => {
  engines.set(image, task);
  while (engines.size > MAX_ENGINES) engines.delete(engines.keys().next().value);
  return task;
};

/** Forget a plan's engine. Called when its image is gone for good. */
export const forgetWallSnapEngine = (image) => {
  engines.delete(image);
};
