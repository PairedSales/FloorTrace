/**
 * Id minting for the two levels this app nests: a *document* (one image and
 * everything measured from it — what a tab addresses) and a *trace* (one
 * polygon within one image).
 *
 * This module imports nothing, on purpose. Both minters are called from
 * `workingStateDefaults()`, which `appStore` evaluates at module load, and
 * `appStore` sits in an import cycle with `undoManager` and `traceManager`.
 * Minting from inside that cycle meant the first module to enter it decided
 * whether `newTraceId` was initialised yet — importing the serializer first
 * produced "newTraceId is not a function" at import time, from a file that had
 * not changed. A leaf module has no such ordering to get wrong.
 *
 * A bare `Date.now()` is not unique: two ids minted in the same millisecond
 * would be equal, and both levels are deleted by filtering on id — so one
 * "close this" would close two. The counter is what guarantees uniqueness;
 * the timestamp is only there to keep ids readable.
 */

let traceIdCounter = 0;
export const newTraceId = () => `trace-${Date.now()}-${(traceIdCounter += 1)}`;

let documentIdCounter = 0;
export const newDocumentId = () => `doc-${Date.now()}-${(documentIdCounter += 1)}`;
