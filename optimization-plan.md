# FloorTrace — image-load-to-area performance analysis

> **Implementation status (items 1–6 and 8 are done).** Measured result on the fixtures:
> **~25–30% off the end-to-end clock**, plus ~1 s on the large inputs that trip §4.2 — slightly
> ahead of the 20–28% this plan estimated. Detection output is byte-identical throughout
> (`bench:detection` and both `probe:exterior` modes diff empty against the pre-change tree), and
> OCR holds 62/82 with 2 false positives. See §7 for the per-item outcome and what was
> deliberately left undone.

**Metric:** wall-clock from image drop to a completed area figure on screen. Nothing else is
scored here. Bundle size, memory and code cleanliness appear only where they move that clock.

**Constraint:** accuracy, reliability and behaviour are preserved exactly. A change that shaves
time but moves a detection result is a regression, not an optimization. Every proposal below
names the guard that proves it did not.

**Baseline is green:** 831/831 vitest, `bench:detection` 64/64 checks.

---

## 0. Read this first — three framing facts

**a. Everything here is measured in Node, not in a browser.** A repo-wide grep for
`performance.mark` / `performance.measure` outside tests returns exactly one hit
(`PerimeterLayer.jsx:141`, unrelated). Both harnesses are Node, and `cache.js:7-8` notes they
deliberately pass no `cacheKey` — i.e. they measure a configuration the browser never runs. Every
"% of end-to-end" below is inferred from Node ratios. **Task 0 in the implementation order is to
fix that**, because three things plausibly on the clock are invisible to static analysis: the
worker→main structured clone of the results, the React render cascade between steps 4 and 5, and
the real cost of CPU contention.

**b. The OCR time budget is wall-clock, which makes "fill the idle window" dangerous.**
`pipeline.js:699-702` sizes `effectiveBudget` from `Date.now()`, and `pipeline.js:747` / `:774`
*drop ROIs and break zoom ladders* when it is exceeded. Any change that puts another compute
thread against the OCR phase can therefore **silently delete detections** while every accuracy
benchmark still passes — because the benchmarks run in Node with no contention. This is the single
most important risk in this document and it gates roughly 1.0–1.5 s of otherwise-attractive
savings.

**c. Five separate findings describe one change.** The detection prewarm (§4.1) was independently
proposed by five of the six analyses. It must be counted once. Worse, it *subsumes* about ten
detection-side micro-optimizations: once `analyzeFloorplan` and the clamp trace run off-clock,
everything inside them stops being on-clock work. Those micro-optimizations are re-scoped in §4.6
from "clock savings" to "prewarm-duration savings" — a real but much smaller justification.

---

## 1. The pipeline

The fully automatic path, from `useDragAndDrop.handleDrop` / `useProjectIO`:

| # | Stage | Where | Blocking? |
|---|---|---|---|
| 0 | `FileReader.readAsDataURL` → `maybeDownscaleDataUrl` | `imageLoader.js:62-73` | main thread |
| 0b | `setImage(dataUrl)` → Konva render; **`wallSnapSegments` posted to detection worker** | `useSnappingSystem.js:46-66` | worker, off-clock |
| 2 | `detectAllDimensions(imgSrc)` — 6-phase OCR | `App.jsx:380` | **awaited** |
| 3 | `afterScanRef.current(dimensions)` = `runAutoScale` | `App.jsx:417` | **awaited** |
| 4 | `measureAndCalibrate` → `detectRoomsFromLabels` (one worker message, N labels) | `useAutoScale.js:73` | **awaited** |
| 4b | `selectProjectScale` → `addRooms` → `applyRoomCalibration` | `useAutoScale.js:87-106` | main thread |
| 5 | `autoTraceExterior` → `traceFloorplanBoundary(excludeRegions, constraints)` | `App.jsx:635` | **awaited** |
| 6 | `applyTracedBoundary` → store → area | `App.jsx:516-566` | main thread |

Steps 2, 4 and 5 are a strict `await` chain. Steps 4 and 5 both target the **single** detection
worker (`detection/index.js:7-24`), which is not even constructed until step 4 — except that step
0b already woke it (see §4.1).

**Structure of the two detection steps.** `detectRoomFromClickCore` (`pipeline.js:293-341`) runs
`analyzeFloorplan` then a *clamp* `traceBoundary` with `{autoGarage:false, inclusive:true}`, both
memoized. `traceFloorplanBoundaryCore` (`pipeline.js:146-173`) runs `analyzeFloorplan` (memo hit)
then a *second* `traceBoundary` with `excludeRegions` + `constraints`. Both pass the same
`getSearchCache(...)`, and `boundary.js:140-152` states outright that the search "depends on
nothing but the analysis: constraints only reach scoring, excludeRegions and garage carving only
reach buildFloor." **That sentence is the key to the whole plan.**

---

## 2. Where the time actually goes

### OCR (step 2) — `node scripts/ocrBenchmark.mjs`, 16-core

| Fixture | preprocess | spatial | pass1 (residual) | roi | **total** |
|---|---|---|---|---|---|
| EF1 987×956 | 231 | 361 | 944 | 717 | **2254** |
| EF2 1084×870 | 291 | 435 | 783 | 1089 | **2598** |
| EF6 841×600 | 137 | 248 | 1474 | 1169 | **3029** |
| EF7 1017×1324 | 154 | 269 | 1652 | 1684 | **3759** |

`timings.pass1` is instrumented as the *residual* wait after spatial completes
(`pipeline.js:463-466`), so the phases sum to the total by construction. Pass 1's true duration is
`spatial + pass1` — 1.2–1.9 s.

### Detection (steps 4+5) — custom probe with the browser's `cacheKey` semantics

The shipped benchmark omits `cacheKey`, so it measures cold runs the app never performs. With the
memo active:

| Fixture | labels | analyze | label #1 | labels 2..N | **step 4** | **step 5** | total |
|---|---|---|---|---|---|---|---|
| EF1 | 7 | 108 | 551 | 11 (max 4) | 562 | 129 | **691** |
| EF2 | 7 | 121 | 852 | 17 (max 5) | 869 | 247 | **1116** |
| EF6 | 7 | 85 | 378 | 5 (max 1) | 383 | 82 | **465** |
| EF7 | 2 | 116 | 771 | 1 | 772 | 207 | **980** |

Two things this settles:

- **The memo works.** Labels 2..N cost 1–5 ms each, confirming CLAUDE.md. Independently profiled at
  0.4–4.3 ms with nothing page-sized per label, and nothing quadratic in label count.
- **The second trace is *not* redundant.** Step 5 warm is 82–247 ms against 446–877 ms cold — the
  shared `searchCache` already eliminates ~78–85% of it. Profiling the warm step-5 residual shows
  it is `buildFloor`/`nonGla` (`labelComponents` 29.6%, `findShadedPockets` 8.3%, `applyRegions`
  6.9%), **not** the search (`measureFootprint` 0.3%, `contourSupport` 2.1%). *Deduplicating the
  two traces is not the win — it has already been won.*

### End-to-end

| Fixture | OCR | Detection | **Total** | OCR share |
|---|---|---|---|---|
| EF1 | 2254 | 874 | ~3.2 s | 72% |
| EF2 | 2598 | 1249 | ~3.9 s | 68% |
| EF6 | 3016 | 547 | ~3.6 s | 85% |
| EF7 | 3759 | 1132 | ~4.9 s | 77% |

**OCR is 68–85% of the clock. Detection is 15–32%.** A cold first visit adds engine bootstrap
(1324 ms measured in Node from local disk; far more over a network — see §3.4).

### Scaling with input size

Fixtures are all ≤1400 px, so none exercises the `maxDimension = 1400` downscale. A phone photo
does. Nearest-neighbour upscales of EF1 (content identical):

| Input | Mpx | working raster | analyze | traceBoundary | full trace |
|---|---|---|---|---|---|
| 987×956 | 0.9 | 987×956 | 109 | 622 | 592 |
| 1974×1912 | 3.8 | 1400×1356 | 177 | 1004 | 1200 |
| 2961×2868 | 8.5 | 1400×1356 | 212 | 1028 | 1205 |
| 3948×3824 | 15.1 | 1400×1356 | 275 | 1517 | 1886 |

`analyze` scales sub-linearly (116 → 18 ms/Mpx); the trace is bounded by the working raster, which
caps at 1400. **Note the asymmetry: OCR's working cap is `MAX_OCR_DIM = 2600` (6.8 Mpx) against
detection's 1400 (1.9 Mpx).** OCR is the more size-sensitive of the two, and the fixtures
under-represent both.

---

## 3. The bottlenecks

### 3.1 The detection worker is idle for the entire OCR phase — then does 0.5–1.25 s serially

The dominant *structural* inefficiency. Step 4's first label pays `analyzeFloorplan` + a complete
clamp `traceBoundary` (378–852 ms), and it pays it *after* OCR has finished, on a worker that sat
doing nothing for 2.2–3.8 s. Per `boundary.js:140-152`, the expensive half of that work depends
only on the analysis — not on any OCR output.

### 3.2 Phase 2 and phase 3 of OCR do not overlap, despite being written to

`pipeline.js:441` creates `pass1Promise = recognizeSparse(...)` before the synchronous spatial
block at `:443-462`, and the header comment claims the sparse pass "runs in its worker while
spatial analysis runs here." It does not. `recognizeSparse` (`ocrTesseract.js:187-191`) is `async`
and its first statement is `await acquire('sparse')`, so it suspends immediately and the actual
`worker.recognize()` call is left on the microtask queue — which cannot drain until the
synchronous spatial block finishes.

Instrumented across 8 runs, sparse-recognize wall time and the `await` window were **identical to
1 ms every time** (EF1 937/937, EF2 785/786, EF5 1617/1617, EF7 1662/1663). Zero overlap. Patching
a dispatch-await in produced 97–134 ms of real overlap on every fixture.

> *Analyst's note:* mid-investigation I inferred from "total equals the sum of phases" that no
> overlap was happening, then corrected myself on the grounds that the instrumentation is
> residual-by-construction. The residual point is true but does not establish that overlap exists;
> direct instrumentation shows it does not. The original suspicion was right for the wrong reason.

### 3.3 Three of four Tesseract workers idle during pass 1; the pool is capped at 4 regardless of cores

`poolSize = min(4, floor(cores/2))` (`ocrTesseract.js:28-33`). On a 16-core machine that is 4, and
during the pass-1 await three of them are idle for 0.7–3.1 s — 3.0–9.4 idle worker-seconds per
scan. Meanwhile the low-priority ROI tier (25–33 of 34–40 queued ROIs) burns 1.8–2.6 s of
inference later for 0–2 accepted parses.

Measured directly: raising `MAX_POOL` 4→8 cut the ROI phase by 45–242 ms with detection results
**bit-identical** (9, 9/13, 10/10, 7/8 unchanged). Phase 4's own lane occupancy is already
excellent (91–95%), so the slack is *under pass 1*, not inside phase 4.

### 3.4 Cold-start asset serialisation

On a first visit the scan blocks on ~4.4 MB gz of Tesseract assets. Local sizes:

| Asset | raw | gz |
|---|---|---|
| `tesseract-core-simd-lstm.wasm.js` | 3.95 MB | 1.47 MB |
| `eng.traineddata.gz` | 2.94 MB | (pre-gz) |
| OpenCV chunk | 15.5 MB | 3.92 MB |
| Paddle models (`public/models`) | 12 MB | opt-in only |

Three specific problems: (a) `CV_WAIT_MS = 1500` is a hard race the first scan can lose with the
main thread idle; (b) on a genuinely cold first scan all four pool workers boot concurrently and
each independently misses the tesseract.js IndexedDB cache, so up to 11.7 MB is fetched for 2.94 MB
of data; (c) `useOcrWarmup` warms exactly **one** Tesseract worker and never the detection worker.

### 3.5 The image is decoded 3–4 times, at least 3 on the main thread

`maybeDownscaleDataUrl` (`imageLoader.js:34-59`) decodes the full image **solely to read
`width`/`height`**, then discards it when the image is under 4000 px — the common case. The canvas
decodes it again. `detectAllDimensions` (`DimensionsOCR.js:254-260`) decodes a third time plus a
full-page `getImageData`. The worker decodes a fourth time via
`fetch`→`blob`→`createImageBitmap`→`OffscreenCanvas`→`getImageData`. The base64 round-trip also
inflates the payload ~33%.

### 3.6 The search memo has a cliff that turns step 5 into a cold trace — invisibly

`cache.js:68-78`: on exceeding the 32 MB budget, `retain()` sets `overBudget` **and calls
`clear()`**, after which every `set()` is a no-op — and `cache.js:84-88` only builds a fresh cache
when the *key* changes, which for one image it never does. So the memo dies permanently for that
image.

Measured: EF5 at native 1199×1000 charges 28.4 MB (89%) and stays warm — step 5 is 97 ms. The same
image upscaled 1.4× charges 34.2 MB, trips, and **step 5 becomes 1128 ms instead of ~130 ms**. The
charge is ~24 bytes per working pixel, and `maxDimension` is 1400 — so essentially every phone
photo or scan lands over the line. Zero fixtures trip it, which is exactly why it has never been
seen.

### 3.7 Dead work inside the clamp trace

`collectNonGlaRegions` (`nonGla.js:224-343`) unconditionally computes `bridgeRuns` + `openCavities`
— a page-sized allocation and a full-page `labelComponents`. On the automatic path the clamp trace
supplies no `excludeRegions` and sets `autoGarage:false`, so every consumer of that result is
gated off. Profiled at 483.7 ms inclusive across 4 fixtures (15.6% of step 4), of which
`bridgeRuns` is 270.7 ms self.

---

## 4. Opportunities, prioritized

Savings are stated **after** de-duplication. The aggregation rules are: the prewarm is one item;
detection micro-optimizations inside the prewarmed region are not clock savings; the three OCR
idle-window items compete for the same main thread and aggregate closer to `max` than `sum`.

### 4.1 — Prewarm detection during OCR ★ highest impact

**Saving: 450–700 ms (~10–20% of end-to-end). Confidence: high. Output risk: none by construction.**

Fire a fire-and-forget `warmDetection` message when the image is set, running exactly the
`analyzeFloorplan` + clamp-`traceBoundary` block from `pipeline.js:330-341` against the same memo
keys. Steps 4 and 5 then call precisely the code they call today and hit warm memos.

Two independent measurements agree:

| Source | today | warmed | saved | geometry |
|---|---|---|---|---|
| My probe, 4 fixtures × 4 runs | 3802–4426 ms | 1212–1727 ms | **628–675 ms/plan** | identical 4/4, every run |
| Workflow analyst, 5–7 fixtures | 810–891 ms | 72–154 ms | 666–757 ms (median 742) | byte-identical, incl. room rects |

The critic's correction: subtract the worker decode already banked by `wallSnapSegments` (see
below), and subtract browser CPU contention, which is unmeasured. **Budget 450–700 ms, not 750.**

**The plumbing already exists and nobody noticed.** `autoSnapEnabled` defaults true
(`appStore.js:61`), and `useSnappingSystem.js:46-66` already posts a `wallSnapSegments` message to
the detection worker the instant the image is set — during OCR. That request already pays the
worker's full-resolution decode off-clock. And `wallSnapEngine.js:68-70` calls
`binarizeToWorkingScale(imageData, 1400)` — *the identical call* `analyze.js:50-53` makes.

> **Therefore the cheapest form of this change is to route `wallSnapSegments` through
> `getCachedAnalysis`.** That is the entire analyze-prewarm with no new message type, no new
> dispatch site, and no new gating decision. Do this first; add the full clamp-trace prewarm second.

Two rescue-state traps are already safe: `boundary.js:232/240` gate the span/corridor rescues off
`bestOf` over `scored`, computed *before* the `inclusive` pool filter at `boundary.js:249`, so a
prewarm using identical options leaves `rescue.usedSpan`/`usedStructural` exactly as the real clamp
trace would.

**Guards:** extend `searchMemo.test.js`'s existing *"traces identically after a room-clamp trace on
the same key"* case with a prewarm-first variant — **the correctness property this change relies on
is already asserted in the suite**. Then `bench:detection` (both passes) and `bench:scale` diffed
with `sed -E 's/[0-9]+ms//g'` must be empty. Ship the warm request with `remediate: false` and
extend `remediation.test.js` with the bare-then-constrained ordering.

**Real risk is contention, not correctness.** On a 4-core machine `poolSize` is 2, so main thread +
2 OCR workers + 1 detection worker saturates the box, every ROI read slows in wall-clock terms, and
`effectiveBudget` does not move — detections fall off the end at `pipeline.js:747`. Gate on
`navigator.hardwareConcurrency >= 8` and verify with a browser A/B, not with the Node benchmarks.

### 4.2 — Fix the search-memo cliff

**Saving: ~1000 ms on affected plans (long side ≥1400 px — most phone photos). Zero on fixtures.**

Three separable changes in value order: (1) on trip, **stop storing but do not `clear()`** — the
entries already held still answer the second trace, so it degrades instead of falling off a cliff;
(2) make it a byte-charged LRU rather than a one-shot kill switch; (3) halve the dominant charge
(`fp.labels`, an `Int32Array`) with a `Uint16` label array plus sentinel. Add a debug counter so a
tripped budget is observable at all.

Output risk is nil — `searchMemo.test.js:142-165` already asserts warm/cold/starved equivalence
with a one-byte budget. The risk is memory: not clearing means holding up to the budget instead of
dropping to zero, which is what the 32 MB number was chosen to bound.

**This is the highest-value item for real-world inputs and the fixtures cannot see it.** Add an
upscaled fixture to the memo suite.

### 4.3 — Dispatch the sparse pass before spatial analysis

**Saving: ~100–140 ms measured (browser likely closer to the full ~150–200 ms). Risk: ~zero.**

Give `recognizeSparse` an `onDispatch` callback invoked immediately before
`entry.worker.recognize(...)` (`ocrTesseract.js:191`); await that plus a macrotask turn before the
spatial block. **A bare `setTimeout(0)` is not sufficient** — tested: it works only when the
acquired worker already carries the `sparse` preset, because otherwise `applyPreset` needs its own
round-trip and the recognize call is pushed past the synchronous block again (EF4/EF5/EF7 showed
exactly 0 ms overlap with the naive yield).

Note the Node harness overstates the prize: most of `timings.spatial` there is `ocrBenchmark.mjs`'s
zlib PNG encode, which happens before `recognizeSparse` and can never overlap. The browser's
`grayToPngBlob` uses stored (uncompressed) deflate blocks, ~10–20 ms.

### 4.4 — Raise the Tesseract pool cap on high-core machines

**Saving: 45–242 ms on the ROI phase (measured). Risk: memory.**

`MAX_POOL = 4` leaves 12 cores idle on a 16-core machine. At 8, results were bit-identical on all
four fixtures. Each extra worker holds a WASM heap plus 5.2 MB traineddata, so gate on
`hardwareConcurrency` **and** `navigator.deviceMemory`; never raise it on mobile. Interacts with
§4.1 — both spend cores, and §4.1 is worth more per core.

### 4.5 — Skip provably dead work in the clamp trace

**Saving: ~15 ms/plan (mean over 6 fixtures). Risk: none — pure dead-code guard.**

In `collectNonGlaRegions`, compute `barrier`/`cavities` lazily behind
`(options.excludeRegions?.length ?? 0) > 0 || options.autoGarage !== false`. That predicate is a
superset of every branch reading them.

Related, same character: `scoreConstraints` allocates a page-sized mask per candidate
(`labelFrame.js:36-37`) to sample at most 625 points — add `framedRectCoverage`/`framedPointInside`
reading `labels[...] === componentId` at the identical sample grid (~5 ms plus GC, bit-identical);
and `otsu(fullGray)` recomputes a histogram `inkOtsu(fullGray)` built and discarded one line
earlier.

**Note these are inside the prewarmed region** — after §4.1 they shorten the *prewarm*, not the
clock. See §4.6.

### 4.6 — Analysis micro-optimizations — **re-scoped, do not count as clock savings**

Six verified, provably bit-identical wins inside `analyzeFloorplan`, ~44–50 ms combined:

- `binarizeToWorkingScale` makes two full-resolution passes (convert, then histogram) that can be
  fused — ~14–16 ms at 8.5 Mpx, and it scales with **full** resolution, so a 24 Mpx phone shot pays
  ~45 ms.
- The downscale accumulator is a page-sized `Float64Array` where `Uint32` is exact (max bin ~9000
  vs a 4.29e9 ceiling) — 43.8 → 30.2 ms measured, 5.9 MB less transient allocation.
- `strokes` allocates four page-sized masks OR-ed together; one shared `out` buffer is the same
  union — 5.3 ms and 4.2 MB saved.
- `estimateStrokeThickness`'s column scan never got the `COL_TILE` treatment the morphology passes
  did.
- The four coverage SATs are 2D summed-area tables but every query is a single row or column.
- All three `labelComponents` calls use the wide `Int32` path although a self-widening `narrow`
  mode exists.

**After §4.1 these are off the clock entirely.** Their remaining value is making the prewarm finish
inside the OCR window on plans where OCR is fast, and reducing GC pressure in a worker that also
holds the decoded image. That is real but small — do them opportunistically, not as a priority.

### 4.7 — Collapse the redundant main-thread decodes

**Saving: unmeasured, likely 100–300 ms on large images. Risk: low.**

`maybeDownscaleDataUrl` decodes the full image only to read dimensions. Use `createImageBitmap`
(cheaper, off main thread) or reuse the decode for the subsequent `getImageData` in
`detectAllDimensions` rather than decoding twice back to back. Measure first (Task 0) — this is
exactly the kind of cost the Node harnesses cannot see.

### 4.8 — Speculative low-tier ROI prefetch during pass 1

**Saving: 250–500 ms claimed. Confidence: medium. Do not attempt before Task 0 and §4.3.**

Build the low-tier ROI list from `regions` alone as soon as spatial analysis finishes, dispatch on
idle workers during the pass-1 await, and cache results keyed on **exact tile bytes + PSM mode** so
a hit is only ever served for a byte-identical request. Correctness is then structural.

Listed last among the OCR items despite its size because: the main thread must build tiles, encode
PNGs and dispatch, and `dashLineMask` (71–277 ms of synchronous main-thread work) also wants that
window — **they queue, they do not overlap**. And it is the proposal most exposed to the wall-clock
budget hazard in §0b. Instrument main-thread occupancy in that window *before* building it.

---

## 5. Tradeoffs, risks, regressions

| Risk | Affects | Mitigation |
|---|---|---|
| **Wall-clock OCR budget deletes detections under contention** | §4.1, §4.4, §4.8 | Browser A/B on a throttled 4-core profile. Gate on `hardwareConcurrency`. Node benchmarks *cannot* see this. |
| Node-only measurement | everything | Task 0 instrumentation before any implementation |
| Memory: not clearing the search memo | §4.2 | Byte-charged LRU; `npm run probe:memory` |
| Memory: 8 Tesseract workers × (WASM heap + 5.2 MB) | §4.4 | Gate on `deviceMemory`; never on mobile |
| Speculative prewarm wasted on crop/new image | §4.1 | Harmless — `detectionWorker.js:27` already clears on a new URL |
| Result **ordering** changes with pool size | §4.4 | `dedupeCandidates` is already order-independent (`pipeline.js:131-138`), but the advisory `parsedBoxes` skip and the `followUps` queue are order-sensitive — verify with `bench:ocr` |
| Bandwidth: OpenCV competing with Tesseract prefetch | cold start | **Do not** attach `loadOpenCv()` to the interaction triggers. Chain it off `entries[0].ready` in `prewarmOcrPool` — OpenCV has a JS fallback and the scan proceeds without it; Tesseract it cannot. |

### Explicitly rejected — do not re-derive

- **A second detection worker.** The analysis memo and search cache are worker-module-scoped
  (`detectionWorker.js:9-11`, `cache.js:10-11`, documented at `index.js:147-157`). A second worker
  starts cold, and sharing would mean transferring exactly the tens-of-megabytes payload the memo
  exists to avoid.
- **Deduplicating the two boundary traces.** Already ~85% shared; the warm residual is
  `buildFloor`/`nonGla`, not the search.
- **Merging steps 4 and 5 into one worker message.** Worth ~20–60 ms, but it would move
  `selectProjectScale` into the worker, fold away the deliberate UX beat at `App.jsx:917-923`, and
  require re-siting both stale-image guards. Not before §4.1 — and probably not after.
- **An early exit in the closing ladder.** Investigated; no safe formulation found. Every rung is
  scored and a winner below the top already beat every wider rung.
- **The benchmarked-shut OCR items:** CLAHE before the pre-OCR upscale; lowering `UPSCALE_MAX` /
  `TARGET_GLYPH_PX`; parallel-strip full-page OCR; raising `MAX_ROIS` above 40.
- **`processingMessage` as a dead `Canvas` prop.** The dead prop is real; the re-render claim built
  on it is not.
- **Autosave on the critical path.** The 2 s debounce does fire mid-scan, but the image is skipped
  by reference (`useAutosave.js:81`) and undo interns it (`undoManager.js:34-38`) — a rounding
  error on the IndexedDB path. *One caveat:* on the localStorage fallback (private browsing, IDB
  blocked, quota) it becomes a synchronous multi-MB `JSON.stringify` + `setItem`, plausibly
  100–500 ms of hard stall inside the wall-clock OCR budget. Defensively gate the debounced write
  on `!isProcessing`.

---

## 6. Recommended implementation order

**Task 0 — instrument, before changing anything.** Add `performance.mark`s to `App.jsx` at drop,
scan-start (`:380`), scan-end, measure-end (`useAutoScale.js:78`), trace-end (`:639`) and
boundary-applied (`:645`), plus one in the worker around `imageBitmapToImageData`, emitted behind
the `import.meta.env.DEV` flag `DimensionsOCR.js:265` already uses. Drive it with the synthetic-drop
technique already in the repo. *Everything below is an estimate until this exists.*

| Order | Item | Expected | Why here |
|---|---|---|---|
| 1 | §4.1a — route `wallSnapSegments` through `getCachedAnalysis` | 100–230 ms | Whole analyze-prewarm, zero new plumbing, no gating decision |
| 2 | §4.2 — search-memo cliff | ~1000 ms on real inputs | Largest real-world win; independent of everything else |
| 3 | §4.3 — sparse-pass dispatch | 100–140 ms | Small, isolated, and it *lengthens* the pass-1 window later items exploit |
| 4 | §4.1b — full clamp-trace prewarm | 350–500 ms more | Needs the contention A/B; do it once Task 0 can measure it |
| 5 | §4.5 — dead work in clamp trace | ~20 ms | Shortens the prewarm; trivially provable |
| 6 | §4.4 — pool cap | 45–240 ms | After 4, so the core budget is decided with the prewarm in place |
| 7 | §4.7 — collapse duplicate decodes | measure first | Task 0 tells you whether this is 30 ms or 300 ms |
| 8 | §4.6 — analysis micro-optimizations | prewarm duration only | Opportunistic |
| 9 | §4.8 — speculative ROI prefetch | 250–500 ms | Highest complexity and risk; only with occupancy data |

**Rationale for the ordering.** 1–3 are independent, low-risk and individually provable. 4 is the
biggest single item but carries the contention risk, so it waits for instrumentation. 6 competes
with 4 for cores and must be decided after it. 9 is deferred not because it is small but because it
is the most exposed to the wall-clock budget hazard and depends on occupancy data that does not yet
exist.

**Realistic aggregate for items 1–6, applying the de-duplication rules:** roughly **0.7–1.1 s off a
3.2–4.9 s clock (20–28%)** on fixture-sized plans, plus ~1 s on the large real-world inputs that
trip §4.2. Not the sum of the individual claims, which double-counts to roughly twice that.

### Standing regression gate for every item

```bash
npm run bench:detection && npm run bench:ocr && npm run bench:scale && npm run probe:exterior && npx vitest run
```

For pure-perf detection changes, diff `bench:detection` before/after with `sed -E 's/[0-9]+ms//g'`
— the diff must be **empty**, not merely similar. That is the established convention in this repo
and it is the only check that distinguishes "faster" from "different".

---

## 7. Implementation outcome

### What shipped

| Item | Change | Measured |
|---|---|---|
| Task 0 | `src/utils/perfMarks.js` — DEV-only marks at drop / scan / measure / trace / area, plus worker decode reported on the message envelope | the missing instrumentation now exists |
| §4.1a | `wallSnapSegmentsCore` routes the existing snap request through `getCachedAnalysis` | folded into §4.1b below |
| §4.1b | `prewarmDetectionCore` + a `warmDetection` worker message, fired unawaited when the image is set | **631 ms/plan, 75% of the detection half** |
| §4.2 | `retain()` stops storing without clearing; `searchCacheStats()` makes a trip observable | step 5 on a tripped plan **1128 ms → ~95 ms** |
| §4.3 | `recognizeSparse` gains `onDispatch`; the pipeline waits for it plus one macrotask | **OCR 183–450 ms faster per scan** |
| §4.4 | Pool cap 4 → 8 gated on `hardwareConcurrency >= 16 && deviceMemory >= 8` | 45–242 ms (browser only; Node has no `deviceMemory`) |
| §4.5 | `collectNonGlaRegions` computes `barrier`/`cavities` only when something reads them | ~15–20 ms, pure dead-code guard |
| §4.6 | Histogram fused into `toGrayscale`; `Uint32` downscale accumulator + hoisted x-map; one shared `keepLongRuns` buffer | shortens the prewarm; scales with full image resolution |

On-clock detection, before → after: EF1 791→184, EF2 1041→308, EF6 549→91, EF7 989→263 ms. The
prewarm costs 318–705 ms and runs inside a 2.0–4.2 s scan, so it has margin on every fixture.

### Two things worth knowing

**§4.3 beat its estimate by 3–4×** (predicted ~100–140 ms, measured 183–450 ms). The extra comes
from a second broken overlap the same fix repairs: `prewarmOcrPool()` at `pipeline.js:440` was
meant to boot the remaining workers *under* the sparse pass, but with no yield before the
synchronous spatial block those boots could not progress either. One change repairs both.

**§4.1's risk profile is better than the plan assumed.** The prewarm calls `roomClampBoundary` —
the *same* function `detectRoomFromClickCore` calls, resolving to the *same* memo entry. Equality
is structural, not measured. This is also why no `remediate: false` was added: `options.boundary`
is part of the memo key, so anything extra would key differently and buy nothing.

### Not done, deliberately

- **§4.7 (duplicate decodes)** — the plan says "measure first", and Task 0 only just landed. The
  decode timing now rides on the worker envelope; take a browser reading before touching it.
- **§4.8 (speculative ROI prefetch)** — the plan defers this pending main-thread occupancy data,
  and §4.3 has just changed the shape of that window. Re-measure before building it.
- **§4.2 changes (2) and (3)** — the byte-charged LRU and the `Uint16` label array. (2) is not
  merely deferred but *wrong for this access pattern*: both traces climb the ladder from r=2
  upward, so the entries held when the budget trips are exactly the ones the second trace wants,
  and an LRU would evict them in favour of the wide rungs. (3) touches `labelComponents` and needs
  its own bit-identity test.
- **The browser contention A/B** that §4.1 and §4.4 are gated on. Both are gated defensively
  (`>= 8` cores for the prewarm, `>= 16` cores *and* `>= 8 GB` for the wide pool), but the
  wall-clock OCR budget in §0b means only a real browser measurement can confirm they are free on
  mid-range hardware.

## Appendix — reproducing the measurements

`bench:detection` and `bench:ocr` are shipped. The three probes written for this analysis are not
in the repo (no source files were modified); they live in the session scratchpad:

- `pathProbe.mjs` — steps 4+5 with browser `cacheKey` semantics, which the shipped harness omits
- `specProbe.mjs` — the A/B counterfactual behind §4.1, including the geometry-identity assertion
- `scaleProbe.mjs` — cost vs input size, via nearest-neighbour upscales of a fixture

The pool experiment in §4.4 was run against a *copy* of `src/` with `MAX_POOL` parameterised by an
env var; the repository tree was left untouched throughout.
