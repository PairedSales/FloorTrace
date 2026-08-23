# FloorTrace — open work from the codebase review

Findings from a review at `6473d35`. **Waves A–D are done** — all eleven task
briefs landed, each on its own branch, each merged after an independent gate.
Final state at the end of the programme: lint 0 errors / 2 pre-existing
warnings, `npm test` 350 passed / 21 files (from 293/14), `bench:detection`
45/45, `bench:scale` 15/15 (from 14/14), `npm run build` clean. Peak
search-cache retention 114.1 MB → 51.9 MB; debounced autosave writes down
62–72%. The briefs themselves, their acceptance criteria and the wave-by-wave
verification notes are in git history and in the merged PRs; they are not
reproduced here, because a landed brief is a description of code that already
exists and the code is the better copy.

What is left is this file: **one deferred task (§1) and nine findings the waves
surfaced and deliberately did not fix (§2)**. `docs/CODE_REVIEW.md` is an
earlier review and marks itself historical.

---

## 1. Task E1 — one `TraceResult` the store holds whole

**Still open.** It was scheduled last on purpose: only worth doing once A1, A3
and C1 had shown which fields actually need to survive an edit. They have, so
the evidence it was waiting for is in.

### Why it exists

A1, A3, C1 and the `selectActivePerimeterOverlay` half of A1 are four instances
of one problem: **quality and geometry metadata is first-class inside the
detection pipeline and becomes lossy the moment it crosses into the store or the
UI.** The dropped holes, the hidden single-floor confidence, the swallowed OCR
error and the `source: 'manual'` written even when the decision was not adopted
are all the same shape. Each was fixed where it was found. E1 is what stops a
fifth instance appearing.

### What the four waves showed has to survive an edit

- `holes` and `quality` (A1). `selectActivePerimeterOverlay`
  (`src/store/appStore.js`) now returns `{ vertices, holes, quality }` and
  memoises on all three — but it is still a hand-written adapter that names its
  fields one at a time, which is exactly the shape that dropped `holes` in the
  first place.
- Per-trace `confidence` and `warnings[]` for a **single** floor (A3) — the
  case the old code treated as "nothing worth reporting".
- The `source`/`adopted` pair, which C1 showed is not one field but two
  questions — *where did this scale come from* and *was this room's correction
  taken*. They are two fields today (`src/utils/detection/validate.js`), but
  `source` is still derived from `adopted` at the write site, so the conflation
  is one refactor away from returning. Writing `source: 'manual'` to mean "a
  room was measured" regardless of whether the measurement was used is precisely
  the bug C1 fixed.

### The task

Collapse the lossy overlay adapter into a single `TraceResult` type the store
holds whole and the UI must read *through*, rather than a set of fields each
consumer re-picks. Model the scale's provenance and its adoption separately.

**Escalate rather than guess** if the type would have to be shared with the
detector's own internals: the pipeline's `quality` object is the detector's
vocabulary and the store's is the app's, and welding them makes every future
detector field a store migration.

---

## 2. Open findings — surfaced by the waves, deliberately not fixed

Every one of these was found by an agent that had a reason not to fix it inside
its own task. They are recorded here so the reasons do not have to be
rediscovered. Roughly in order of how much they matter.

Re-verified against the code on 2026-08-22: **#1, #6 and #8 still stand exactly
as written; #5 has since been fixed; #3's premise no longer holds.** Those three
are annotated below. #2, #4, #7 and #9 are carried over unre-verified.

| # | Finding | Where | Why it was left |
|---|---|---|---|
| 1 | **No term in `scoreCandidate` is sensitive to enclosed area disappearing relative to a sibling hypothesis.** `support.mean` is normalised by the candidate's *own* perimeter, so excising a region along drawn wall removes one weakly-drawn edge and adds twice the well-drawn cut line — amputation raises it **unconditionally**, for any region of any size, whenever the removed edge is below the current mean. Its intended counterweight `coverage` counts ink pixels, and a garage's own walls stay inside the fingers, so losing a 47,000 px bay (~17% of the floor) cost coverage 0.003. `seal` is 1.000 either way. | `scoring.js` | Fixing it means choosing a scoring formulation validated only against the benchmark — the trap this document exists to warn about. Needs its own task, with an adjudication method that is not the bench. |
| 2 | **OCR failure on a missing `traineddata` is an unsettled promise and a hang, not an error.** tesseract.js throws uncaught inside its own message handler, so `bootEntry`'s rejection handler never runs and `acquire` never resolves. Nothing on that path is timed out. | `src/utils/dimensions/ocrTesseract.js` | Pre-existing and separate from A3. `bootEntry` now has a rejection arm that calls `failWaiters` when the last entry dies — whether the throw actually reaches it was not re-tested. |
| 3 | ~~**`getCachedAnalysis`'s LRU is unbounded in bytes** (`MAX_ENTRIES = 4`)~~ — was downgraded on the grounds that `detectionWorker.js` cleared the whole cache on every image change, so only one analysis was ever retained. **That premise is gone:** the multi-plan work replaced the blanket `clearDetectionCache()` with `dropCacheKey(entry.cacheKey)`, precisely so a second open plan keeps its work. All four slots can now fill. The 32 MB search-cache budget and lazy SATs (T2‑11) bound what each slot costs; worst-case `probe:memory` retention was 43.2 MB when last measured, but that was measured under the old one-entry behaviour. | `src/utils/detection/cache.js` | **Re-measure before trusting the number.** `MAX_ENTRIES = 4` is live capacity now, not dead capacity. |
| 4 | ~~**The real `netSelfSeals` cliff**~~ **RESOLVED, and the framing was wrong by ~4×.** Measured, cropping is worth **0.1–1.4% of a trace**, ceiling 2.3%. `netSelfSeals` now hands `measureFootprint` the `knownBounds` it already has, skipping a full-page `inkBounds` scan with no change to any window. The genuinely large item in this file was one expression no wave looked at: `Uint8Array.from(mask, fn)` in `applyRegions` (T1‑2), 65–101 ms per carving trace. | `boundary.js` | Done. Kept as the record of a measurement that contradicted its own headline. |
| 5 | ~~**`serializeSketch` keys exported images by raw `hashDataUrl`.**~~ **FIXED.** `projectSerializer.js` imports `internKey` from `utils/hash` and mints the export key with it, with a comment naming the collision this avoids. | `src/utils/projectSerializer.js` | Closed. |
| 6 | **The `structural` rescue is ungated** — `boundary.js` runs it unconditionally whenever a structural mask exists, while `span` immediately below it *is* gated on the seal threshold. `candidates.js` describes the gate that should exist. Still true today. | `boundary.js` | Needs a new threshold, which is a tuning decision A2 was explicitly forbidden from making against the bench. |
| 7 | **The structural-with-garage footprint is geometrically degenerate** — two wall-width fingers tracing around the garage, cleaned up only when they fall under `buildFloor`'s 3% filament-shave budget. Latent now, reachable whenever `structural` wins by more than the epsilon on a plan with a thin-line-bounded bay. | `boundary.js` / `footprint.js` | Downstream of #6. |
| 8 | **`requestTimeout` is unverified by execution.** `index.js` is main-thread worker-wrapper code with no test file. The 120 s cap and 2 s-per-label slope are judgement calls, read and linted only. | `src/utils/detection/index.js` | Still no harness for it. The repo now has happy-dom for hook tests (see CLAUDE.md), so a worker stub is cheaper than it was when this was written. |
| 9 | `flushAutosaveNow` is still registered on `beforeunload`, where its async IndexedDB work will not reliably complete. Harmless and occasionally works; the comment is honest about what actually protects the user (the 2 s debounce). | `src/hooks/useAutosave.js` | D2's brief did not ask for the listener to be removed. |

Two things checked and found **not** to be problems, recorded so they are not
re-investigated: `handleInteriorWallToggle` need not re-review the footprint
(`tracedAreaPx` reads `floor.outer.polygon`, which the toggle only selects for
*display*, so the area is toggle-invariant); and the main-thread
`clearDetectionCache` call is correctly absent, since nothing on the main thread
calls the pipeline cores.

---

## 3. The rule the whole programme ran on

Recorded because it is the part that generalises. Every wave's
`bench:detection`, `bench:scale`, `probe:exterior` and `probe:exterior draw`
output was diffed **in full** against the previous wave's tip, not just checked
for a passing total. The only geometry that moved in the entire programme was
A2's two adjudicated checks (EF4 90.6% → 92.4%, EF6 100.0% → 99.9%) and the room
rectangles moved by the wall-face-seating commit — both argued on evidence other
than the benchmark number.

An agent working alone will quietly tune a threshold to make a benchmark pass.
Every brief forbade it explicitly; keep that wording in anything written from
this file.
