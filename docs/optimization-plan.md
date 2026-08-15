# FloorTrace — performance optimization plan

> **Status: implemented.** Every Tier 1 and Tier 2 item below has landed, plus
> T3‑22's determinism fix. T2‑18 and T3‑20/T3‑21 were deliberately not taken —
> see "Implementation record" at the end for what shipped, what the numbers
> turned out to be, and the three places this document was wrong.

Analysis only (as originally written). No implementation file was modified.

**Constraint honoured throughout:** every item ranked Tier 1 or Tier 2 is behaviour-preserving — same
polygons, same square feet, same detection rate, same rendered pixels. Items that could move a number
are quarantined in §4 and labelled.

## Method, and why the numbers here are trustworthy

Seven subsystems were audited independently, and every finding was then handed to a separate reviewer
whose brief was to *refute* it. 27 findings were raised; **18 survived as CONFIRMED, 8 as PLAUSIBLE,
1 was REFUTED outright**, and several CONFIRMED items had their impact estimates corrected downward by
the reviewer. Numbers below are the *verified* figures, not the finder's originals, and where the two
disagreed that is called out.

Measurements come from V8 CPU profiles (`--cpu-prof`, 50–200 µs sampling) over the real `fixtures/*.png`,
in-pipeline instrumentation of `traceFloorplanBoundaryCore` / `detectDimensionsCore`, a real
`npm run build` with a sourcemap-attributed chunk breakdown, `npm run probe:memory`, and micro-benchmarks
against the installed `konva@10.0.2` / `react-konva@19.0.10` and `tesseract.js@6.0.1`.

Prior art was read first and is not re-litigated: `docs/ocr-performance.md` §6/§7 (CLAHE ordering,
`UPSCALE_MAX`, `TARGET_GLYPH_PX`, `tessdata_fast`, pass-1 striping, `MAX_ROIS` are all benchmarked shut)
and `docs/remediation-plan.md` §3a.

### Baselines

| Path | Cold | Warm repeat |
|---|---|---|
| `traceFloorplanBoundary` (987×956 → 1017×1324 working raster) | 0.86–1.12 s | 0.14–0.31 s *when the memo survives*; **0.71–0.83 s when it does not** |
| Dimension OCR scan (post-wave, `docs/ocr-performance.md` §6) | 2.9–5.4 s | ~0 ms (memoised by image identity) |
| Initial JS on the critical path | 761,254 B raw / **240,169 B gz** | — |
| Worker retention worst case (`probe:memory`) | 51.9 MB (EF7) | — |

Where cold trace time goes (4-fixture profile, self time): `labelComponents` 13.8%, `dilateCols` 12.3%,
`closeRect` 8.9%, `applyRegions` 8.3%, `openRect` 9.4%, `dilateRows` 4.6%. By nearest ancestor:
`measureFootprint` 39.9%, `buildFloor` 18.8%, `analyzeFloorplan` 10.7%.

---

## 1. Ranked summary

Ranked by **verified impact × confidence**, with effort as the tiebreak.

| # | Optimization | Verified impact | Conf. | Risk | Effort |
|---|---|---|---|---|---|
| **T1‑1** | Stop the search memo blowing its 32 MB budget on page-sized label padding | **450–540 ms per room placement / re-trace** on 3 of 7 plans | High | Low | M |
| **T1‑2** | Replace `Uint8Array.from(mask, fn)` in `applyRegions` with a plain loop | **65–101 ms per carving trace** (7–9% cold, 34–48% warm) | High | None | **S** |
| **T1‑3** | Defer `warmupOcrEngines()` off mount | **4.44 MB gz** off the first-paint window | High | Low | S |
| **T1‑4** | Lazy-load the Konva `<Stage>` subtree | **~93 kB gz / ~307 kB raw** (~40% of initial JS) off critical path | High | Med | M |
| **T1‑5** | Make `dilateRows`/`dilateCols` run-based | **~5–7% off a cold trace** (40–60 ms/fixture) | High | Low | M |
| **T1‑6** | Split the image out of the autosave draft record | **~97% of draft I/O** (770 kB → ~19 kB per write) | High | Low | M |
| **T1‑7** | Drop the RGBA intermediate + chunk adler32 in the OCR PNG encoder | **75–90 ms** main-thread per scan, byte-identical | High | None | **S** |
| **T1‑8** | Stop `floorPlausibility` recomputing `generateCandidates`' opening | **10–14 ms per floor** (1.3–4.3% of a trace) | High | Low | S |
| **T2‑9** | Self-host the Google Fonts stylesheet | One render-blocking cross-origin RTT (~100–250 ms) | High | None | S |
| **T2‑10** | Skip `footprintEntry` for ladder rungs `sameAsPrevious` discards | ~10.6 ms/trace + 15 MB of churn removed | High | None | S |
| **T2‑11** | Lazy SATs + delete the two dead smear masks | 24 → 6 B/px retention; ~10 ms/trace | Med | None | M |
| **T2‑12** | Restore `React.memo` on `PerimeterLayer` / `MeasurementLayer` | ~0.2–0.5 ms/frame (1–3% of a frame) | High | None | S |
| **T2‑13** | Arm the OCR idle-release at warm-up, not only after a scan | One WASM heap + 5.2 MB model reclaimed | High | Low | S |
| **T2‑14** | Cache flattened point arrays in `DrawModeLayer` | 15–290 µs/frame + per-point GC churn | High | None | S |
| **T2‑15** | Drop `canvasRotation` from the image-load effect | 1 decode + 1 Konva layer rebuild + a blank frame, per rotate click | High | Low | S |
| **T2‑16** | Compact `.floorplan` export (drop `JSON.stringify` indent) | File size **2.1×** smaller | High | Low | **S** |
| **T2‑17** | Warm the snap engines at image-change time | Removes a 12–60 ms mid-gesture stall | Med | **Med** | S |
| **T2‑18** | Stabilise the four per-vertex Konva listeners | ~0.21 ms per `PerimeterLayer` render | Med | Low | S |
| **T2‑19** | Crop `netSelfSeals` to the net bbox | ~1–13 ms/trace (0.1–1.4%) | Med | Low | M |
| **T3‑20** | Move `detectDimensionsCore` into a Worker | ~700–850 ms of blocking removed; **wall clock unchanged** | Med | Med | **L** |
| **T3‑21** | Gate the exit-flush history write on actual mutation | ~24 MB of avoided writes/session | Med | Med | S |

**Do first:** T1‑2 and T1‑7. Both are provably byte-identical, land in an afternoon, and T1‑2 has by far
the best effort-to-payoff ratio in the entire audit.

---

## 2. Tier 1 — high impact

### T1‑1. Stop the search memo blowing its 32 MB budget on page-sized label padding

`src/utils/detection/cache.js:50-71`, `src/utils/detection/candidates.js:89-107,120-128,333`

**1. Current problem.** Every kept ladder rung charges the search memo
`memoBudget?.retain?.(entry.mask.byteLength + fp.labels.byteLength)` (`candidates.js:333`).
`measureFootprint` crops to `inkBounds ± (radius+2)` and then **re-expands to full page** purely to restore
page coordinates: `labels = new Labels(width*height).fill(-1); ... labels.set(local.labels.subarray(...))`.
So each candidate charges 3 bytes/px of page, of which the 2 bytes/px of labels are **16–81% `-1` padding
outside the crop**. Past `SEARCH_BUDGET_BYTES = 32 MB` the cache sets `overBudget = true; this.clear()`,
and `set()` becomes a permanent no-op **for the life of that image** — `getSearchCache` only builds a new
cache when the key changes.

**2. Why it matters.** `placeRoom` ends with `await autoTraceExterior()` (`App.jsx:961`), so a full trace
runs after **every room placement**, plus one more after the OCR batch in `runAutoScale`. The memo is the
only thing that stops each of those re-climbing the whole closing ladder (49% of a trace). Reproduced
independently — two traces on one `cacheKey`:

| | EF1 | EF2 | EF3 | EF4 | EF5 | EF6 | EF7 |
|---|---|---|---|---|---|---|---|
| trace 1 | 978 | 908 | 1041 | 917 | 953 | 377 | 1054 ms |
| trace 2 | **262** | **713** | **825** | **171** | **773** | **55** | **285** ms |
| charged | 22.8 | 33.1 | 34.2 | 21.6 | 35.2 | 4.8 | 16.8 MB |
| memo alive | yes | **NO** | **NO** | yes | **NO** | yes | yes |

Same code, 3–15× difference on the second trace, decided entirely by whether the memo survived.

**3. Proposed optimization.** Two independent changes, both output-identical:
- **(a)** Keep `measureFootprint`'s labels in *crop space* — return `{labels, cx0, cy0, cw, ch}` and have
  the four readers index through the offset instead of re-expanding (`footprintEntry`/`componentMask`
  `candidates.js:18-28,121`; `inkCoverage` `scoring.js:104`; `traceComponentBoundary` `scoring.js:20`,
  `footprint.js:29`; `boundary.js:315-317`). This also deletes the per-rung page-sized `fill(-1)` outright.
- **(b)** Stop retaining `entry.mask`: it is derivable from `entry.labels + componentId + bbox` via the
  existing `componentMask` in ~0.67 ms.

**4. Expected impact.** Instrumented projection of charged bytes, current → (a) → (a)+(b), MB:
EF1 22.8/13.0/5.8 · EF2 49.8/23.4/**7.2** · EF3 38.2/32.1/**20.0** · EF4 21.6/19.7/12.7 ·
EF5 48.9/43.3/**27.3** · EF6 4.8/4.8/3.9 · EF7 16.8/13.5/8.3. **Both changes are needed** — (a) alone
leaves EF5 at 43.3 MB. With both, all seven stay under the existing budget, converting the three
currently-cold fixtures' re-traces from 713–825 ms to the 168–285 ms a live memo delivers:
**~450–540 ms saved per room placement and per manual re-trace on 3 of 7 plans.** Change (a) alone also
removes 68 ms of page-sized `fill(-1)` across the fixture set regardless of the budget. Confidence: **high**.

**5. Tradeoffs / risks.**
- **(b) must recompute the mask on every read, never memoise it.** `entry.mask` is read by
  `scoreConstraints` (`scoring.js:72,79`) for *every* candidate whenever constraints exist — which is
  exactly the repeated post-room-placement trace. A lazy-but-cached mask would report 7.2 MB while the
  worker really holds 49.8 MB, defeating the property commit `0b138cc` added to stop tab OOMs.
  Recomputing costs ~0.67 ms × 8–18 kept candidates ≈ 12 ms/trace, which is affordable.
- **Coverage gap in the gate.** `npm run bench:detection` passes no `cacheKey`, so **no bench or test in
  the repo exercises the memo path at all.** Add a memo-warm-equals-memo-cold assertion (trace twice on
  one `cacheKey`, compare polygons) *before* landing this, or the change ships with its central safety
  claim untested.
- **Cheaper alternatives worth A/B-ing first:** (i) drop `entry.mask.byteLength` from the `retain` call —
  the same accounting change as (b) with none of the laziness; (ii) raise `SEARCH_BUDGET_BYTES` to 48–64 MB.
  `docs/remediation-plan.md:355-358` records that 32 was chosen deliberately because it "trips exactly the
  three heavy sheets", so this is a *better trade* than that decision, not a bug fix on top of it.
- Images that previously self-evicted now retain ~6–26 MB in the worker for as long as they are open.

---

### T1‑2. Replace `Uint8Array.from(mask, fn)` in `applyRegions` with a plain loop

`src/utils/detection/nonGla.js:427-429` — *found independently by two agents; the single best change in this audit.*

**1. Current problem.**
```js
const { labels: voidLabels, components: voidComps } = labelComponents(
  Uint8Array.from(newMask, (v) => (v ? 0 : 1)), width, height,
);
```
`%TypedArray%.from` with a mapper does not take V8's fast path — it walks the **iterator protocol** and
calls the mapper through generic dispatch per element, then ToNumber-coerces each result. Measured at
**~92 ns/px** against a plain loop's **~4 ns/px**.

**2. Why it matters.** `buildFloor` runs the non-GLA stage by default (`footprint.js:233`), and
`applyRegions` reaches this line whenever any garage/porch/patio/shaded region is accepted — the common
case for an appraisal tool. It is **not memoised**: the search memo covers nets and candidates only, so
`buildFloor` re-runs on every trace, and a trace follows every room placement (`App.jsx:961`).
Measured in-pipeline, `Uint8Array.from` vs the equivalent loop, with an element-by-element equality
assertion that never fired:

| | px | `from` | loop |
|---|---|---|---|
| EF1 | 943,572 | 86.8 ms | 3.8 ms |
| EF4 | 732,600 | 69.4 ms | 4.1 ms |
| EF7 | 1,346,508 | 115.8 ms | 14.8 ms |

**3. Proposed optimization.**
```js
const inv = new Uint8Array(newMask.length);
for (let i = 0; i < inv.length; i += 1) inv[i] = newMask[i] ? 0 : 1;
const { labels: voidLabels, components: voidComps } = labelComponents(inv, width, height);
```
**Strictly better:** give `labelComponents` an `invert` flag so no intermediate page-sized array is
materialised at all — that saves the remaining ~22 ms loop and 1 byte/px of garbage on top.
Better still, the inverse is already available: `newMask` is `componentMask(newLabels, component, width)`
(`nonGla.js:420`), so the void pass can be fed `labels[i] !== component.id` directly.

**4. Expected impact.** **65–101 ms per carving trace** (EF1 83, EF4 65, EF7 101 ms in situ) = **7–9% of a
cold trace and 34–48% of a warm repeat trace**, on the 3-of-7 fixtures that carve a region. Zero effect on
the other 4. Confidence: **high** — micro-benchmark and in-situ profile agree to within 15%.

**5. Tradeoffs / risks.** **None identified.** Output is the same `Uint8Array` of the same 0/1 values, so
`labelComponents` sees byte-identical input; no float arithmetic, no iteration-order dependence, no identity
feeding a memo. Verified element-wise on live data across all seven fixtures. Add a
`no-restricted-syntax` lint rule for `TypedArray.from(x, fn)` so it cannot come back — `eslint.config.js`
already carries custom rules.

---

### T1‑3. Defer `warmupOcrEngines()` off mount

`src/App.jsx:245-253`, `src/utils/DimensionsOCR.js:84-90`, `src/utils/dimensions/ocrTesseract.js:165-169`

**1. Current problem.** `useEffect(() => { warmupOcrEngines(); ... }, [])` runs unconditionally for every
visitor. In tesseract.js v6 `createWorker` is **not lazy** — `node_modules/tesseract.js/src/createWorker.js:239-243`
chains `loadInternal() → loadLanguageInternal() → initializeInternal()` before returning, so the core WASM
and language model are fetched *during the call*.

**2. Why it matters.** Once per page load, for **100% of visitors**, including everyone who bounces without
dropping an image. From the real build: `worker.min.js` 33,542 gz + `tesseract-core-simd-lstm.wasm.js`
1,471,178 gz + `eng.traineddata.gz` 2,935,819 = **~4.44 MB over the wire (~7.0 MB raw)**. The app's entire
initial JS payload is 240,169 gz — mount-time warm-up pulls **18.5× the whole application**, contending with
CSS, fonts and the logo for the same connection in the window that decides TTI.

**3. Proposed optimization.** Trigger on the *first signal the user is heading toward a scan* — a
`pointerdown` / `dragenter` / file-input focus, **or** a `requestIdleCallback` with a generous timeout,
whichever fires first. The rIC pattern already exists in this repo at `useEnhancedOcr.js:36-44`. Warm-up is
pure prefetch: `detectAllDimensions` calls `warmOcrEngine()` itself at `DimensionsOCR.js:214`.

**4. Expected impact.** ~4.44 MB gz off the first-paint window for everyone; removed *entirely* for the
visitor who never scans. Confidence: **high** (direct byte counts from the emitted build).

**5. Tradeoffs / risks.** The two variants differ more than they look:
- **rIC alone does not remove the bytes** — it fires within a few hundred ms of first paint, so a bouncing
  visitor still downloads all of it. It only removes contention with first paint.
- **Interaction-triggered removes the bytes but has a narrower window than it appears.** `handleManualMode`
  already auto-scans on drop/open, so warming at drop overlaps only FileReader + decode (tens of ms).
  `dragenter` and file-picker-open give a real head start; **Ctrl+V has no pre-signal at all**, so a
  paste-first user eats the full 1520 ms cold boot inside the scan. The OR-of-both trigger avoids this.
- Ship together with T2‑13 — whichever trigger warms the worker, it currently has no teardown timer.

---

### T1‑4. Lazy-load the Konva `<Stage>` subtree

`vite.config.js:34-37`, `src/App.jsx:3`, `src/components/Canvas.jsx:2,412`

**1. Current problem.** `manualChunks: { 'konva': ['konva','react-konva'] }` splits the chunk, but
**splitting is not lazying**. `App.jsx:3` statically imports `Canvas`, which statically imports `react-konva`,
so konva sits in the entry's static module graph. `dist/index.html` proves it —
`<link rel="modulepreload" ... href="/FloorTrace/assets/konva.AFRM49BC.js">` — and the entry chunk's second
line is literally `import{...}from"./konva.AFRM49BC.js"`. CLAUDE.md's justification ("not needed on first
paint before an image is loaded") describes an intent the build does not implement.

**2. Why it matters.** Once per page load, 100% of visitors, on the critical rendering path — ES modules
cannot execute the entry until every static import is fetched and compiled. konva is 320,277 B raw /
98,448 B gz = **42.1% of initial JS raw, 41.0% gz**. Meanwhile the only consumer is gated:
`Canvas.jsx:412` is `{camera.imageObj && (<Stage ...>` — with no image loaded, not one Konva node is created.

**3. Proposed optimization.** Extract the `<Stage>` block into `CanvasStage.jsx` behind `React.lazy` +
`<Suspense fallback={null}>`, leaving the container div and the "No floor plan loaded" empty state
(`Canvas.jsx:390-411`) eager. The cut line is clean — grep confirms the only konva importers are `Canvas.jsx`
and the eight components under `src/components/canvas/`; **none of the six canvas hooks import konva**.
Kick `import('./CanvasStage')` from a `requestIdleCallback` so the chunk is warm long before any drop.

**4. Expected impact.** ~**307 kB raw / ~93 kB gz** deferred (~40% of initial JS). Confidence: **high** on
bytes. *Corrected downward from the finder's 41%:* the konva chunk is not pure konva — rollup hoisted React
core into it (`R` exports `forwardRef`/`createElement`/`version`), so ~12 kB raw of react + jsx-runtime moves
back to the eager graph once nothing static reaches konva. The quoted "250–350 ms mobile parse time" is a
rule-of-thumb derivation, **not a measurement** — confirm in a real profile before quoting it.

**5. Tradeoffs / risks.**
- **The hazard most likely to bite:** `Canvas.jsx` has effects gated on `stageRef.current` (the angle-tool
  auto-init at `:300-305` sets `hasInitializedRef.current = true` only after the ref populates). Ref
  population **does not retrigger effects**, so an eager effect firing once against a null ref would never
  re-run. Any Stage extraction must move `stageRef`-dependent effects into the lazy module alongside the JSX.
- `canvasRef`'s `useImperativeHandle` backs `handleRotateCanvas` (`App.jsx:710`) and the keyboard shortcuts;
  it must stay eager or the ref is null until the chunk lands.
- The empty state must stay eager or first paint changes visibly.
- No e2e harness exists — verify by hand with `npm run dev` on no-image, drop, and rotate.

---

### T1‑5. Make `dilateRows`/`dilateCols` run-based instead of per-pixel distance sweeps

`src/utils/detection/raster.js:131-149,158-185,188-208`

**1. Current problem.** Both dilations are two per-pixel distance sweeps. `dilateCols` additionally keeps its
running distance in a scratch `Int32Array`, so every pixel costs a mask read plus a `dist[i]` read **and**
write — which is why it profiles at 12.3% self time against `dilateRows`' 4.6% despite an identical call
count. `erodeRows` is already run-based but paints with a scalar loop where `TypedArray.fill` would memset.

**2. Why it matters.** 16.9% of a cold trace's self time (measured, 4-fixture profile). Called from
`closeRect` on **every rung of every closing ladder** — `generateCandidates` climbs up to six ladders per
wall network at 8–9 radii each, so a single-net page runs 40+ closings and EF2's four nets run 32 rungs of
the base ladder alone. `closeRect` alone is 43–48% of `measureFootprint`, which is 39.9% of the trace.

**3. Proposed optimization.** Rewrite both as run-based line dilations — the identical operator (union over
runs of `[runStart − r, runEnd + r]`, clamped to the line, no wrap):
- `dilateRows`: scan each row for maximal ink runs; `out.fill(1, row + max(0, x−r), row + min(width−1, end−1+r) + 1)`.
- `dilateCols`: keep the existing `COL_TILE = 64` tiling and the `Int32Array` run-start bookkeeping
  `erodeCols` already uses, but paint `[runStart − r, runEnd + r]` instead of `[runStart + r, runEnd − r]`.

Keep `dilateRect`'s call order (rows then cols) unchanged. Separately, change `erodeRows`' paint to
`out.fill(1, row+from, row+to+1)` — `TypedArray.fill` no-ops when `end <= start`, so no extra guard is needed.

**4. Expected impact.** **~5–7% off a cold trace, ~40–60 ms per fixture.** The reviewer implemented both
variants and compared element-by-element against the shipped functions on real `boundaryMask`s from EF1
(987×956, 8.1% ink) and EF7 (1017×1324, 7.0% ink) at r = 2, 7, 17, 39, 58: **20/20 bit-identical**, at
1.20×–1.97× (median ~1.7×). Confidence: **high**. *The finder's 7–8% was at the optimistic edge.*

**5. Tradeoffs / risks.** The operator is provably the same — both forms are "on if any ink within ±r along
the line", neither wraps, and the run form clamps exactly where the sweep resets its distance. Dilation has
no border semantics here. **The entire risk is implementation bugs** in two primitives everything downstream
depends on: keep the old implementations in the test file and assert equality on random masks at several
radii, plus a `bench:detection` run. One caveat: the run-based column paint writes with a `width` stride and
could in principle lose on a near-degenerate mask (checkerboard, large r) — test that case before claiming
universal improvement; it was faster at every radius and density measured (4.4–49.3% ink).

---

### T1‑6. Split the image out of the autosave draft record

`src/hooks/useAutosave.js:124-152`, `src/store/appStore.js:134-143,375,425`, `src/utils/draftStorage.js:41-55`

**1. Current problem.** `AUTOSAVE_FIELDS` is every working-state key minus five, so `zoomScale`, `stageX`,
`stageY`, `canvasRotation`, `viewportSyncToken` **and `image`** are all autosave-relevant. The subscription
deliberately ignores *which* field changed (`void prevSlice; // unused but documents intent`), then writes
`pickFields(get(), AUTOSAVE_FIELDS)` — the whole base64 string — via `store.put(data, key)`, a whole-record
overwrite. **A pure pan or zoom rewrites the entire image to disk.** Worse,
`setViewportTransform`'s `token` is a fresh `Math.random()` from each caller, so even a camera update landing
on identical scale and position can never be shallow-equal to the previous slice.

**2. Why it matters.** Pan and zoom are the most frequent interactions in a floorplan viewer, and all six
call sites end in a store write (`useCanvasPan.js:73` per drag end, `useCanvasZoom.js:118` 100 ms after each
wheel burst, `useCameraController.js:82,174`, `useToolRouter.js:337,429`). The 2 s debounce coalesces a
continuous gesture, so the rate is roughly **one full draft write per pause in interaction** — 5–20 per minute
of stop-and-go work. Measured on EF7: total payload 789,137 B of which the image is **770,402 B = 97.6%**.
Corroborated by the repo's own record — `docs/remediation-plan.md:506` reports the post-D2 draft for EF3 at
755.4 KB, and EF3's PNG base64s to ~756 KB. The draft is already essentially nothing but the image.

**3. Proposed optimization.** Write two IndexedDB records inside **one** `readwrite` transaction: the image
under a key derived from its existing `hashDataUrl`, the rest of the state under `key` with `image` omitted.
`useAutosave` tracks the data-URL reference it last wrote and only includes the image record when that
reference changed — the image-load and crop paths, not pan/zoom/vertex edits. `getDraft` recombines, and
keeps reading the current single-record shape and the localStorage fallback so existing drafts still restore.
**Free adjacent win:** drop `viewportSyncToken` from `AUTOSAVE_FIELDS` entirely — its only reader is
`useCameraController.js:221`, compared against a ref that is `null` on mount, so a persisted random float can
never match.

**4. Expected impact.** Bytes per debounced write drop **789 kB → ~19 kB (~40×, ~97% of draft I/O)**, and
proportionally more on a large plan (`imageLoader.js` only downscales above 4000 px; `MAX_FILE_SIZE_BYTES`
is 20 MB, so multi-MB data URLs are reachable). Confidence: **high**.
**Be clear-eyed: this is an I/O, storage-quota and battery finding, not a frame-rate one** — the main-thread
saving is only ~0.3 ms per write.

**5. Tradeoffs / risks.**
- **Risk is low, not none.** The draft is the app's only protection against losing work. Two records must
  land in one transaction, and the **localStorage fallback** (`draftStorage.js:53`) JSON-stringifies whatever
  it is handed — that path needs its own recombination or it silently writes a state record with no image,
  which `restoreFromSaved` rejects at `useAutosave.js:82` and the user loses the draft entirely.
- **Land this cheaper step first (~10 lines):** `prevSlice` is already handed to the subscription and ignored.
  Comparing slice vs prevSlice over just the camera keys and skipping the debounced write when nothing else
  moved kills the pan/zoom case immediately, testable in isolation. It does not cover vertex-drag writes, so
  it is a step toward the record split, not a replacement.
- Verify manually: drop an image, edit, reload, confirm restore **including the interior/exterior toggle**
  (the regression D2 documented for `tracedBoundaries`).

---

### T1‑7. Drop the RGBA intermediate and the per-byte adler32 in the OCR PNG encoder

`src/utils/dimensions/raster.js:21-31`, `src/utils/DimensionsOCR.js:129-134,153-158`, `pipeline.js:421,775`

**1. Current problem.** Every OCR input is `env.toOcrInput(grayToImageDataLike(variant))`.
`grayToImageDataLike` allocates a `Uint8ClampedArray(w*h*4)` and writes four bytes per pixel; the encoder
immediately throws three of four away (`raw[dst+1+x] = data[src + x*4]`). The RGBA buffer exists for the
duration of one strided read. Separately, adler32 does **two modulos per byte**.

**2. Why it matters.** Once per OCR call, and the call counts were measured on live scans: 69 inputs /
7.5 M tile px (EF1), 105 / 11.9 M (EF4), 126 / 12.3 M (EF5). The largest single input is the pass-1 page at
2000×1937 = 3.87 M px — a **15.5 MB `Uint8ClampedArray` allocated and discarded**. All synchronous on the
main thread, and it is the bulk of the 4–6 ms burst between ROI reads that `docs/ocr-performance.md` §4
noticed but never attributed.

**3. Proposed optimization.** Give `imageDataLikeToPngBlob` a gray-input path that fills scanlines with
`raw.set(data.subarray(y*width, (y+1)*width), y*(width+1)+1)`, and have `browserEnv().toOcrInput` take the
gray object directly. Replace adler32 with the standard NMAX=5552 chunked form.

**4. Expected impact.** **75–90 ms of synchronous main-thread work removed per scan** — ~1.5–3% of a
2.9–5.4 s scan. Verified by replaying the exact captured tile set: buffer build 39.0 → 3.0 ms, adler32
19.9 → 7.5 ms; scaled to EF4 geometry ≈ 66 + 23 ms. Confidence: **high**; the finder's ~75 ms was if anything
conservative.

**5. Tradeoffs / risks.** **Provably byte-identical**, not merely argued: `out[j] = data[i]` into a
`Uint8ClampedArray` from a `Uint8Array` source cannot clamp, so the strided read recovers the gray byte
exactly; the chunked adler is the textbook zlib form. Verified on all 105 real tile shapes. Tesseract
receives identical bytes, so the detection rate cannot move.
- **Hard coupling the finder missed:** `scripts/ocrBenchmark.mjs:44-52` implements `toOcrInput` as
  `png.data = Buffer.from(imageDataLike.data.buffer, ...)` — pngjs expects a w·h·4 RGBA buffer. **Handing it
  a gray object breaks `npm run bench:ocr`** unless the harness is changed in the same commit.
- With both call sites gone, `grayToImageDataLike` has zero callers — delete it or keep it solely as the
  target of the byte-equality unit test (eslint errors on unused vars not matching `^[A-Z_]`).
- Free extra: `crc32` on the ~3.9 MB IDAT is a per-byte table loop; slice-by-8 buys another ~10 ms with the
  same byte-identity guarantee.

---

### T1‑8. Stop `floorPlausibility` recomputing the opening `generateCandidates` already computed

`src/utils/detection/boundary.js:382-400`, `src/utils/detection/candidates.js:256-264`

**1. Current problem.** `floorPlausibility` computes `inkCount(openRect(net.mask, w, h, thickRadius)) / net.wallSize`.
Twenty lines of call-stack earlier, for the same net, `generateCandidates` computes the identical
`thickRadius`, the identical `openRect(net.mask, ...)`, and `kept = inkCount(structural)`. And `net.wallSize`
is by construction identical to `netInk = inkCount(net.mask)` — verified empirically over 7 nets, exact in
every case. So `floorPlausibility`'s value is a float division of the same two integers.

**2. Why it matters.** `openRect` is four separable morphological passes over the full page, costing
7.8–13.7 ms per call, and it runs **once per floor** (`boundary.js:487`). Floor counts: EF1 2, EF2 4.
Worse on repeat traces: `generateCandidates` is memoised through the search cache (`boundary.js:189`) while
`floorPlausibility` is not, so on the second trace of an image its opening is free while `floorPlausibility`
still pays full price.

**3. Proposed optimization.** Return `structuralKept` and `netInk` on `generateCandidates`' result object,
carry them out of `detectFloorNet`, and have `floorPlausibility` take the fraction as a parameter.

**4. Expected impact.** ~19 ms on EF1 (2.1%), **~40 ms on EF2 (4.3%)**, ~14 ms on EF7 (1.3%). On a warm
repeat trace (140–310 ms) the same absolute saving is **5–10%**. Compounds with T1‑5. Confidence: **high** —
the equality is definitional, bit-identical, not approximate.

**5. Tradeoffs / risks.**
- **The freehand fallback is the one real care point.** `freehandFloorNet` (`boundary.js:347-377`) never calls
  `generateCandidates`, and in draw mode `detectFloorNet` is tried first, so a net can reach
  `floorPlausibility` from either producer. Thread `structuralFraction: null` and fall back to the current
  computation **only on null**. Do **not** default it to `1` — `floorPlausibility`'s `structural` feeds the
  legend-rejection test at `boundary.js:520-530` (`structural < 0.35`), and a wrong `1` silently keeps a
  legend as a building.
- One net can yield several `floorComps`, so the duplication within a net is worse than "once per net".
- Gate on byte-identical floor sets across the fixtures.

---

## 3. Tier 2 — real, smaller, mostly cheap

**T2‑9. Self-host the Google Fonts stylesheet** (`index.html:9-11`). Render-blocking cross-origin `<link>`
with no `media`/`onload` trick; the woff2 fetches cannot start until it returns — a serialized second hop.
~100–250 ms on a warm 4G connection. Also closes the offline gap in an app that self-hosts Tesseract assets
*specifically* so OCR works offline. **This is `docs/CODE_REVIEW.md` F20, still open** — file it as such, not
as a new discovery, and take F20's other half in the same commit: `canvasUtils.js:2,5`, `PerimeterLayer.jsx:8`
and `AngleOverlay.jsx:420` hardcode `'Inter, system-ui, sans-serif'`, a font the app never loads. Changing
the font string changes measured text width, so the measurement context and the Konva `Text` nodes must move
together or pill backgrounds mis-size. Prefer `@fontsource/*` over hand-copying woff2.

**T2‑10. Skip `footprintEntry` for rungs `sameAsPrevious` discards** (`candidates.js:314-334`). `climb`
builds a full-page `componentMask` before knowing whether the rung is kept. **109 of 174 rungs (62.6%)** are
discarded immediately. `sealMetrics` reads only `entry.bboxArea` and `entry.area`, both already on
`fp.largest` — this is the exact bug commit `b2269c6` fixed one level up in `netSelfSeals`; the sibling in
`climb` was missed. ~10.6 ms/trace (1.1%) plus **109 page-sized allocations (~15 MB of churn)** removed from
the hottest loop. Equality verified on all 174 rungs across four runs. Expect the same inconclusive A/B the
repo accepted for the `netSelfSeals` change ("weakly suggestive and no more") and land it on byte-identical
output. **Do this before T1‑1** — five lines, cannot move a number, and it shrinks the allocation surface
T1‑1's refactor then has to reason about.

**T2‑11. Lazy SATs + delete two dead masks** (`analyze.js:199-223`, `room.js:61-66`). Each analysis entry
retains exactly **24.0 B/px**. `smearH`/`smearV` are read by *nothing* (exhaustive grep: 6 hits, all their own
definition) — 2 B/px for nobody. The four SATs are 16 B/px (67%) with exactly one consumer, `growRoomRect`'s
`lineCoverage`, so a perimeter-only trace builds all four and reads none. Move them behind a **memoising
WeakMap accessor** (the pattern already at `pipeline.js:183-191`) — **not a getter**, because `boundary.js:472`
does `{...analysis, wallMask: net.mask}` per floor and spread would invoke it. Result: EF7 32.4 → 8.1 MB, plus
~10 ms/trace of `buildSat`.
**The third sub-proposal (a byte-bounded LRU) is refuted:** `detectionWorker.js:26` calls
`clearDetectionCache()` whenever the image URL changes, so **only one analysis is ever retained** — the
"4 entries = 188 MB" premise is wrong, and so is the identical claim in `docs/remediation-plan.md:367-373`.
`probe:memory` confirms a real worst case of 51.9 MB, not ~200 MB. **Downgrade open finding #3.**

**T2‑12. Restore `React.memo` on `PerimeterLayer` / `MeasurementLayer`** (`Canvas.jsx:461-464,507-510,516`).
Two freshly-allocated arrows per render defeat both memos. Canvas re-renders at pointer-event rate during
eraser, draw, crop and vertex-placement gestures. **Simplest fix the finders both missed:** Canvas already
keeps `routerRef` synced every render (`:99,:268-274`), so
`useCallback((index) => { if (routerRef.current?.rightClickPannedRef?.current) return; onDeletePerimeterVertex?.(index); }, [onDeletePerimeterVertex])`
needs no ref mirror and no surgery inside `useToolRouter`.
**Impact corrected down to ~0.2–0.5 ms/frame (1–3% of a 16.7 ms frame), not the claimed 5–15%.** Three
corrections worth carrying: the `MeasurementLayer` half is ~free when no lines are drawn (it emits zero
nodes); **no canvas repaint is saved** (konva 10's `autoDrawEnabled` means `batchDraw` already rAF-coalesces,
so the cost is JS-only); and this **does not fix the room-drag path** — `activeFeetPerPixel`
(`Canvas.jsx:354-374`) mints a fresh `{x,y}` every frame during a corner resize and invalidates three layers
anyway. **Do not "stabilise" `activeFeetPerPixel` by dropping `localRoomOverlay` from its deps** — during a
corner resize that object is the live scale the wall labels read, and freezing it would move a displayed
number (the comment at `:361-363` exists precisely for this).

**T2‑13. Arm the OCR idle-release at warm-up** (`App.jsx:245-253` vs `:459-464`,
`ocrTesseract.js:58-66`). `releaseOcrWorkersWhenIdle(60000)` is called from exactly one place — the `finally`
of a scan. Until then `idleDelay` is 0 and `scheduleIdleRelease` returns immediately, so the worker booted at
mount has **no teardown timer at all** and is released only when the tab closes. Reclaims one WASM heap plus
the 5.2 MB traineddata (confirmed by gunzip: 5,199,098 B) 60 s after load for every visitor who never scans.
Cleaner encoding than a second call site: have `warmOcrEngine` arm the policy itself so "a booted worker
always has a teardown timer" lives in `ocrTesseract.js`. **Strictly dominated by T1‑3** — ship that first;
this is the belt-and-braces companion.

**T2‑14. Cache flattened point arrays in `DrawModeLayer`** (`DrawModeLayer.jsx:12,20`, `useDrawTool.js:57-62`).
Every mousemove past `MIN_STEP` rebuilds **every committed stroke's** point array via
`flatMap((p) => [p.x, p.y])`, allocating a throwaway 2-element array per point. Committed strokes are
genuinely immutable (`appStore.js:370-371` appends by reference), so a `WeakMap<stroke, number[]>` cannot go
stale. 15–290 µs/frame — **0.1–1.8% of a 16 ms frame**, so cheap zero-risk cleanup, not a visible speedup.
**Strictly better:** have `useDrawTool` maintain the flat `number[]` incrementally, which also kills the
`pathRef.current.slice()` at `:61` that copies the entire growing array every frame.

**T2‑15. Drop `canvasRotation` from the image-load effect** (`useCameraController.js:185`). Every 45°
rotate re-runs the loader — `setIsImageReady(false)`, then `new Image(); img.src = image` against the full
data URL — which unmounts the background `<Layer>` (destroying and reallocating two stage-sized canvases) and
produces a **visible blank frame**. The dependency buys nothing: `canvasRotation` is read only at `:150-152`,
inside a branch unreachable on rotation because `zoomScale` is non-null by then. Read it through a ref
(a bare dep deletion trips `react-hooks/exhaustive-deps`, which is active). A polish/jank fix, ~2–4 clicks per
squaring-up adjustment; the 10–40 ms / 5–10 MB figures are **unmeasured estimates** — treat as upper bounds.

**T2‑16. Compact `.floorplan` export** (`projectSerializer.js:403`). `JSON.stringify(project, null, 2)` —
the only `null, 2` in `src/`. Measured **2.08×** file inflation (1.20 MB → 2.49 MB), and the non-image part
alone inflates 4.0× because indent-2 puts every vertex coordinate on its own line. One deleted argument, plus
~2.7 ms of the ~25 ms save path. Only user-observable difference: the file becomes one line — and it is mostly
base64 and 50 snapshots, so nobody reads it in an editor.
**Take (a) only.** The companion proposal to intern `tracedBoundaries` across snapshots is worth less than
advertised (~24% of a file that is already 64% image) and costs forward compatibility:
`validateProjectVersion` only rejects `version > 1`, so an older build handed a ref-pooled file would restore
snapshots whose `tracedBoundaries` is a `{ref:...}` stub — reaching the wall-mode toggle as **silently wrong
geometry**, exactly the class CLAUDE.md warns about.
**Better fix for the memory half, missed entirely:** `sanitizeData` deep-rebuilds every object with no
identity memo and runs over all 50 snapshots before stringify, so the shared `tracedBoundaries` reference D2
established is destroyed into 50 real heap objects *before JSON is involved*. A `WeakMap` memo in
`sanitizeData` cuts that transient expansion and most of the ~10 ms sanitize cost.

**T2‑17. Warm the snap engines at image-change time** (`useSnappingSystem.js:14-21`). The effect nulls all
six refs on `[image]` but starts nothing, so the first interaction after every image change pays a
12–60 ms build (up to ~140 ms at 12 MP) plus a full-natural-size `getImageData` readback and a data-URL decode.
`image` changes on every crop, so this is not once per session.
**Two corrections that matter.** (i) The stall does **not** land on the mousedown frame — `createWallSnapEngine`
awaits `loadImageElement` first, so it lands a few frames *into* the gesture, and until then drags run
unsnapped rather than blocked. (ii) **This is not behaviour-preserving for fast gestures.** `handleStageMouseUp`
commits `localRoomOverlay` from the last mousemove without re-snapping, so a quick flick that ends before the
engine finishes commits an *unsnapped* rect today and a *snapped* one after warming — and the room rect feeds
the implied px/ft used for calibration. Same for a perimeter vertex clicked during the warm-up window.
**Strictly better fix:** don't rebuild it on the main thread at all. `analyze.js:51-52` already runs the
identical `binarizeToWorkingScale(imageData, 1400)` on the same image **inside the detection worker**, memoised
per image. Have the worker return the working-scale `ink` (or the segments) and build the engine from that —
that *eliminates* the stall and the duplicate full-res `getImageData` instead of relocating them.
**Avoid one tempting micro-fix:** pre-scaling the snap engine's `getImageData` into a 1400-max canvas would
make Otsu run on a resampled histogram, changing the threshold, the segments, and where edges snap.

**T2‑18. Stabilise the four per-vertex Konva listeners** (`PerimeterLayer.jsx:465-484`). react-konva issues
`off(name, old)` + `off(name+ns)` + `on(name+ns, new)` per changed handler = 12 registry ops per vertex.
Measured 0.241 → 0.029 ms at N=20 (8.3×). But **~1–2.5% of a frame**, and most of the value is double-counted
with T2‑12, which removes the whole render on the Canvas path; the residual scope is the vertex drag itself
and a ~5-frame toggle animation. **Both proposed fixes are under-specified** — `handleDragStart/Move/End` are
plain function declarations recreated every render, so a memoised `PerimeterVertex` would fail on its first
prop. Prefer the memoised sub-component **plus** `useCallback` on those three, and **avoid** the
"recover the index from `e.target.getAttr('vertexIndex')`" variant: Konva keeps nodes alive across renders
while React reorders keys, so a stale attr after a delete would **delete the wrong vertex**. Do T2‑12 first,
re-profile, then decide whether this earns its diff.

**T2‑19. Crop `netSelfSeals` to the net bbox** (`boundary.js:40-56,96-105`) — `docs/remediation-plan.md`
open finding #4. The border audit checks out: `bridgeRuns` has no border semantics; `measureFootprint`
re-crops to `inkBounds ± (radius+2)`, so a window padded by exactly that lands on the same page window; the
pad is genuinely load-bearing because `floodOutside` treats the array border as outside. Reproduced
bit-identical over 9 nets.
**But the plan's framing is wrong and so was the finder's.** #4 calls this "the real cliff" and "potentially
the single biggest detection win"; measured it is **~1–13 ms/trace (0.1–1.4%)**, with a hard ceiling of 2.3%
from the all-callers `bridgeRuns` profile share. The finder's own 2–6% over-claims by ~4×, because
`boundary.js:126` short-circuits small nets *before* calling `netSelfSeals`, and cropping does not remove
`maskFor`'s cost (its loop already iterates only the bbox). **Cheapest correct version, 3 lines, no border
reasoning at all:** `measureFootprint` accepts `knownBounds`, and `netSelfSeals` passes none — so it pays a
full-page `inkBounds` scan it could skip by handing it the bridged mask's bbox, which is bounded by
`net.bbox` by construction. **Rank this below `labelComponents`** (13.8% self, the largest single item in the
profile and the real next target in this file).

---

## 4. Tier 3 — large, unproven, or not actually behaviour-preserving

**T3‑20. Move `detectDimensionsCore` into a Worker.** ~700–850 ms of main-thread blocking removed per scan,
landing as three contiguous stalls (decode+preprocess 220–320 ms, spatial 240–420 ms, `binarizeInk`+`dashLineMask`
85–110 ms) plus 4–6 ms per ROI. **Scan wall clock is unchanged** — `docs/ocr-performance.md` §4 is right that
this is responsiveness, not speed; sell it as such. One blocker the doc cited is now **stale**:
`detectionWorker.js:27-34` already ships the `fetch → blob → createImageBitmap → OffscreenCanvas → getImageData`
replacement for `dataUrlToImage`. Three reasons it is not CONFIRMED:
- **OpenCV in a worker is unverified.** If the emscripten glue reaches for `document` there, `openCvIfReady()`
  permanently returns null and every scan silently switches CLAHE implementation — and §6 documents that a
  CLAHE change of comparable size cost six detections (62/82 → 56/82).
- `env.paddleReady?.()` (`pipeline.js:701`) is a **synchronous** call gating the ROI phase's budget
  arithmetic; it cannot be a message round-trip and must be snapshotted into the request payload.
- Nested tesseract.js workers are unverified across the target browser matrix.

**Strictly better shape:** do **not** spawn a second worker. Add a `detectDimensions` message type to the
existing `detectionWorker`, which already caches the decoded `ImageData` keyed on the same data-URL identity —
one decode instead of two, and no second page-sized `ImageData` resident. Also note
`configureTesseract`'s guard is `typeof window !== 'undefined'` (`DimensionsOCR.js:42`), so **the whole block
is a no-op in a worker** and Tesseract would boot with unconfigured jsdelivr asset paths, silently breaking
offline OCR. Two corrections to the sell: there is **no spinner** in this app (`grep keyframes src/` is empty;
`isProcessing` only disables Toolbar buttons), so strike "the spinner freezes" — the honest claim is that the
Konva stage stops dropping frames. And **sequence it after T1‑7**, not before: the encoder change is proven
byte-identical, ships today, and the worker move relocates it for free.

**T3‑21. Gate the exit-flush history write on actual mutation** (`useAutosave.js:169-203`).
`visibilitychange → hidden` fires on every tab switch, minimise and OS app switch, and it is the one path
carrying `{withHistory: true}` — up to 50 snapshots plus the whole intern pool, written unconditionally with
no change check. But the magnitude claim is **half what was asserted**: the finder said the pool "reaches 6
easily" via eraser and crop; in fact `useEraserTool` never touches the image (it edits
`perimeterOverlay.vertices`), `useCropTool.js:122` is the **only** `onImageUpdate` caller, and every image-load
path calls `undoManager.clear()` first. Realistic pool size is **1, occasionally 2**. ~24 MB of avoided writes
for a 20-switch/5-edit session, at 0.9–1.9 ms per skipped flush — paid while the page is backgrounding, the
cheapest moment in the app. **No latency win at all.**
**The gate is the risky half:** a gate that reads "unchanged" when something did change loses work silently.
`saveAutosavedDraft` swallows its own failures, so the counter must only be recorded on the success path; and
`undoManager.save()` sets `isDirty`, which is in `EXCLUDED_AUTOSAVE_FIELDS` and therefore does **not** fire the
subscription — so an explicit bump in `save`/`undo`/`redo`/`cancelLastSave`/`setHistoryState` is load-bearing.
**Better decomposition:** land T1‑6 first, then gate **only the history record**. State is then always written
(zero data-loss surface) while the expensive half is skipped. Stacked behind T1‑6 this is nearly free; on its
own it is a small I/O win bought with a data-loss risk.

**T3‑22. The OpenCV chunk — reclassified: this is a determinism and bundle-size issue, not a perf win.**
`pipeline.js:364` starts `loadOpenCv()` and `:381` peeks at `openCvIfReady()` with **no `await` between them** —
only synchronous work. A dynamic `import()` cannot settle before synchronous code in the same job completes,
so **the first scan of a session structurally always takes the JS `clahe()` fallback**, and later scans take
`cv.CLAHE` + optional medianBlur. The same plan is preprocessed two different ways depending on when it was
dropped.
Chunk is 15,514,625 B raw / **3,895,902 B gz** — 16× the entire initial JS bundle — but it is fetched **once
per session** (`cvPromise` is a module singleton), behind a scan the user explicitly asked for, and *not* on
the first-paint path. **Runtime impact of removing it is approximately zero and possibly negative**, since
`clahe()` replaces `enhanceGrayWithCv`. The genuine win is 3.9 MB gz for scanning users.
**Do not take the "delete OpenCV" step on this evidence — it is not behaviour-preserving** (it changes
preprocessing for scans 2..N and deletes the `speckle > 0.12` denoise branch).
**Take the one-line determinism fix on its own merits:** either drop to `clahe()` unconditionally or `await`
`loadOpenCv` with a fixed deadline before peeking. Leaving a detection-affecting branch decided by download
latency is precisely the "wrong answer that looks green" failure mode CLAUDE.md warns about.
**Cheapest decisive experiment** (before any of that): temporarily stub `openCvIfReady` to null and run
`npm run bench:ocr` once over all seven fixtures. That answers "does cv.CLAHE + medianBlur earn 3.9 MB" with
no restructuring and no new benchmark mode to maintain. Note the env flag must be read inside
`opencvBridge.loadOpenCv` — `ocrBenchmark.mjs:83` runs a full warm-up scan that already primes the singleton.

---

## 5. Performance regressions and measurement errors found in recent work

**R1. The 32 MB search-memo budget (commit `0b138cc`, "Bound what the boundary search retains") created a
cliff.** It traded memory for speed deliberately and measured the memory, but the *accounting* is wrong: it
charges page-sized label arrays that are 16–81% padding. The result is that **3 of 7 fixtures permanently lose
their memo** and every subsequent trace costs 713–825 ms instead of 168–285 ms. This is T1‑1, and it is the
largest single item in this plan.

**R2. `a568332` ("Set the scale from every labelled room") multiplied R1's cost.** `placeRoom` now ends with
`await autoTraceExterior()` (`App.jsx:961`), so a full boundary trace follows **every** room placement — which
is exactly the repeated-trace pattern the memo exists to serve and R1 breaks. The two commits are individually
reasonable and jointly expensive.

**R3. `docs/CODE_REVIEW.md:269` is factually wrong, and it has been load-bearing.** It asserts
"`scripts/ocrBenchmark.mjs` already exercises the JS-CLAHE path, since Node never loads OpenCV." Measured
false — OpenCV resolves in Node in 271–410 ms with `cv.Mat` present, and `ocrBenchmark.mjs:81-87` runs a full
warm-up scan (`engine warm-up: 869ms`) before every measured fixture. **The bench takes the OpenCV branch for
every fixture, including the first.** So the 62/82 baseline in `docs/ocr-performance.md` §6 is a clean
measurement of a path **the browser's first scan structurally never runs**, and the JS-clahe path every user's
first scan *does* run has never been benchmarked. Anyone tuning against that table should know this.
Relatedly, `CODE_REVIEW.md` F5's claim that the 2 s init timeout means slow connections "never actually use
it" is also false — `opencvBridge.js:19`'s timeout wraps only `onRuntimeInitialized`, not the download.

**R4. `docs/remediation-plan.md` open finding #3 overstates its own case and should be downgraded.**
"Up to four images' analyses retained, 188 MB" is impossible: `detectionWorker.js:26` clears the whole
detection cache whenever the image URL changes, so only one analysis is ever held. `probe:memory` measures a
real worst case of **51.9 MB**, fully reclaimed. Conversely, **open finding #4 overstates in the other
direction** — "the real cliff… potentially the single biggest detection win" is measured at 0.1–1.4% of a
trace (T2‑19). The genuinely large item in that file is one expression no wave looked at (T1‑2).

**R5. Konva's `manualChunk` has never deferred anything** (T1‑4). Not a regression — it never worked — but
CLAUDE.md documents it as if it does, so the claim should be corrected alongside the fix.

---

## 6. Explicitly rejected — measured, and not worth doing

Recorded so they are not re-investigated.

| Candidate | Why not |
|---|---|
| **`applyRegions` cropping the page-background labelling to the footprint bbox** | **REFUTED.** Claimed 30–50 ms; measured **1.7 ms/carving trace** (~0.2%), and on EF4 the crop was consistently *slower* (5.8 vs 4.5 ms) because the footprint bbox is 69% of the page. The claimed 458 ms double-counted T1‑2's builtin. Worse, **all seven fixtures produce zero holes**, so the equivalence is unexercised and `bench:detection` cannot gate the risky hole-coordinate threading. |
| `imageSnapper.findCornerSnap` → summed-area table | *Measured independently for this report:* bit-identical over 1365 probes and 3× faster, but **0.057 ms/call** against a 16.7 ms frame. Agent measurements agree (34–122 µs). Micro-optimization. The ~3600 throwaway 2-element arrays per call (the `[[0,-1],...]` literal inside `hasNeighborDark`) are a one-line nursery-churn fix, not a finding. |
| `createSnapshot` / `structuredClone` per undoable action | **0.196 ms** on a realistic project. D2 already moved the only heavy member. Grows only with `drawStrokes` (3 × 2300 pts = 4.5 ms), and `save()` is **never** called per frame — every call site was checked. |
| Blob/ObjectURL instead of base64 data URLs | Structured clone of the full payload is 0.90 ms with the image vs 0.37 without — the string is a memcpy. ~0.5 ms/write for a blast radius across `imageLoader`, the store, `postMessage`, the serializer and every `img.src`. The image's real cost is bytes on disk (T1‑6). |
| `hashDataUrl` | 0.034 ms on a 752 KB URL (walks only 8 KB). Its collision hazard is a *correctness* issue (open finding #5), not perf. |
| Transferables / avoiding the data-URL `postMessage` | Fixture URLs are 200–800 KB → sub-ms structured clone; results are small polygons. Nothing to transfer. |
| Scratch-buffer pool for the closing ladder | `new Uint8Array(1.35M)` measures **0.00 ms** (calloc). Allocation is not the constraint. |
| Bit-packing boolean masks | Invasive across dozens of direct `mask[i]` consumers; buys only memory, which allocation timing says is not the constraint. |
| Parallelising the search across wall networks | **5 of 7 fixtures keep exactly one network**, and the ladder is per-network. |
| Lazy ROI variant construction (OCR) | `prepareRoiVariants` is 117–188 ms/scan and **70–97% of variants are read**. Best case ~45 ms on the easiest fixture, ~0 on the hard ones. |
| `regions.js` clustering quadratics | 1.9 ms (EF1) / 12.0 ms (EF4) self time. |
| `parse.js` regex/string churn | Zero `new RegExp`, all literals; ~5 ms total. |
| Self-intersection check on the mousemove path | Only ever sees the in-progress hand-clicked list (1–9 µs); vertex drag uses the O(n) `validateVertexMove`, and `hasSelfIntersection` runs on drag **end**. |
| Suppressing Konva's hit-graph redraw during brush modes | Real ~2× on layer draw, but `listening={false}` would kill vertex dragging and shape selection. **Behaviour change.** |
| `contourSupport` → `evidence.levelAt` → `nearby` box queries | Textbook SAT candidate; never exceeds 0.4% of any profile. |
| `lucide-react` tree-shaking | Already correct — 10.6 kB for the ~15 icons used; zero hits for unimported names. |
| `zod` on the critical path | Only importer is `projectSerializer.js`, and every call site uses `await import(...)` → 21 kB gz async chunk. |
| PaddleOCR's 12 MB of weights | Exemplary — opt-in via localStorage, warmed inside `requestIdleCallback`, never fetched by default. |
| DEV instrumentation leaking to production | **Verified absent.** `grep` over `dist/` for `Render count` / `Draw Call` returns nothing; the entry chunk has zero `console.log`. |
| Wheel zoom / right-click pan / vertex drag | Already correct — rAF-coalesced with a 100 ms debounced store write; pan writes `stage.position()` imperatively. `AngleOverlay` is the model: it mutates a ref, calls `layer.batchDraw()`, and commits to the store only on drag end. |

---

## 7. Non-performance defects surfaced in passing

Out of scope for this plan; recorded so they are not lost.

1. **`PerimeterLayer` never destructures `onVertexDragMove`**, so `setDraggedVertexCoords` never fires and
   **`isSelfIntersecting` is permanently false mid-drag**.
2. **`useToolRouter` never returns `isDraggingRef`/`dragStartPosRef`**, so `Canvas.jsx:134-135` passes
   `?? { current: false }` and `useCanvasPan.handleStageDragEnd` writes its click-suppression flag to a
   throwaway object nobody reads.
3. **`useCanvasPan`'s `canPanCanvas` `useMemo`** reads `isZoomingRef.current` while listing only the stable
   ref as a dep, so the zoom gate never re-evaluates.
4. **The candidate memo key `gen|${netKey}`** (`boundary.js:189`) is the net's *index* and, unlike the nets key
   at `:421`, omits `options.maxCloseRadius` — two traces of one image at different radii share a candidate set.
5. **The Konva `draw` monkey-patch** (`Canvas.jsx:330-349`) has **no cleanup**, so the content layer accumulates
   **two** `draw` wrappers per image load or rotation (its ref never nulls), each logging per redraw. Under
   StrictMode `k` starts at 2 and the render counters read double. Dev-only, but it makes dev profiling
   meaningless — disable all three DEV logs before trusting any before/after mousemove profile.
6. **`getDB()` memoizes a rejected promise permanently** (`draftStorage.js`), so one transient IndexedDB open
   failure downgrades the session to synchronous localStorage forever.
7. **`img.onerror`** (`useCameraController.js:180-183`) leaves `imageObj` on the previous image, and the loader
   effect has no abort guard — a rotation racing a slow load can land a stale `img` in state.
8. **`ShapeLayer` receives a `unitStyle` prop it never destructures** (`Canvas.jsx:521`), and
   `PerimeterPlacementLayer` receives an unused `roomOverlay` (`:478`).

---

## 8. Suggested sequencing

1. **T1‑2** and **T1‑7** — provably byte-identical, an afternoon each, immediate payoff.
2. **T2‑10** — five lines, cannot move a number, and it shrinks the surface T1‑1 must reason about.
3. **Add the memo-warm-equals-memo-cold assertion** (no bench or test currently exercises `cacheKey`).
4. **T1‑1** — the biggest single win, now gated by step 3.
5. **T1‑5**, **T1‑8**, **T2‑11** — detection throughput, all gated on `bench:detection` byte-identity.
6. **T1‑3** + **T2‑13**, then **T1‑4**, then **T2‑9** — the first-load story, in cost order.
7. **T1‑6** (cheap `prevSlice` gate first, then the record split), then **T3‑21** stacked behind it.
8. **T2‑12** → re-profile a real drag in Chrome → then decide on **T2‑18**. Disable the DEV logs first.
9. Everything else on merit.

Run `npm run bench:detection` (45/45, byte-identical IoUs and areas) before and after every detection change,
`npm run probe:exterior` for both auto and draw mode, and `npm run bench:ocr` for anything touching the OCR
path — noting R3, that its baseline measures a code path the browser's first scan never takes.

---

## 9. Implementation record

Landed on `claude/optimization-plan-impl-427953`. Every detection change was
gated on `npm run bench:detection` (45/45, byte-identical IoUs and areas) plus
`npm run probe:exterior` in both auto and draw mode; every OCR change on
`npm run bench:ocr` over all seven fixtures. The suite grew 350 → 637 tests.

### Measured before/after

**Boundary trace** (`npm run probe:memory`, same machine, same fixtures):

| | EF1 | EF2 | EF3 | EF4 | EF5 | EF6 | EF7 |
|---|---|---|---|---|---|---|---|
| cold before | 705 | 783 | 950 | 762 | 835 | 354 | 856 ms |
| cold after | **586** | **634** | **796** | **631** | **702** | **331** | **660** ms |
| warm before | 214 | **821** | **821** | 153 | **741** | 40 | 140 ms |
| warm after | **132** | **120** | **145** | **97** | **70** | **32** | **121** ms |
| charged before | 22.8 | 33.1 | 34.2 | 21.6 | 35.2 | 4.8 | 16.8 MB |
| charged after | **5.5** | **6.9** | **19.5** | **12.5** | **27.1** | **3.4** | **8.0** MB |
| memo | ok/**evicted**/**evicted**/ok/**evicted**/ok/ok | | | | | | → **0/7 evicted** |

Worst-case worker retention 51.9 → **43.2 MB**. The three fixtures that used to
lose their memo now keep it, which is the 6–7× warm-trace improvement — and a
trace follows every room placement (`App.jsx:961`), so that is the number a user
feels.

**First load** (real `npm run build`, gzip -9 over every JS file `index.html`
references):

| | raw | gzip |
|---|---|---|
| before | 761,254 B | 240,169 B |
| after | **388,320 B** | **126,081 B** |

konva (308 kB raw / 95 kB gz) and `CanvasStage` (65 kB / 22 kB) are now fetched
on demand. OCR warm-up (~4.4 MB gz) no longer runs at mount at all.

**OCR**: 62/82 detections, 2 false positives — identical to the pre-change
baseline in `docs/ocr-performance.md` §6, which is the point: T1‑7 is
byte-identical and T3‑22 preserves the branch the benchmark measures.

**Autosave**: a debounced write on `ExampleFloorplan.png` is **1.1 kB instead of
202 kB**; a pure pan now writes nothing at all.

### Not taken, and why

- **T2‑18 (per-vertex Konva listeners).** The plan's own instruction was "do
  T2‑12 first, re-profile a real drag in Chrome, then decide whether this earns
  its diff." T2‑12 landed; the re-profile did not happen, and the plan already
  measures the residual at ~1–2.5% of a frame with most of the value
  double-counted against T2‑12. Landing it unprofiled would be taking a
  behaviour risk (the plan flags that both proposed fixes are under-specified,
  and that the `getAttr('vertexIndex')` variant can **delete the wrong vertex**)
  to buy something not shown to exist. Left open.
- **T3‑20 (OCR pipeline into a worker).** Quarantined by the plan itself with
  three unverified blockers, one of which — `configureTesseract`'s
  `typeof window !== 'undefined'` guard being a no-op in a worker, silently
  breaking offline OCR — is a correctness hazard, not a perf one.
- **T3‑21 (gate the exit-flush history write).** The plan's own decomposition
  says to land T1‑6 first and then gate *only* the history record. T1‑6 landed;
  the gate is a data-loss surface bought for ~24 MB of avoided writes paid while
  the page is backgrounding, with **no latency win at all**. Not worth it
  unattended.

### Where this document was wrong

1. **T1‑5's `erodeRows` note.** The plan says `TypedArray.fill` "no-ops when
   `end <= start`, so no extra guard is needed." That is only true for
   non-negative indices: `fill` reads a **negative** end as relative to the
   array length, so when `r` exceeds a run on row 0 the exclusive end goes
   negative and the call paints most of the mask. Caught by the equality test,
   which is exactly why the plan insisted on one. The shipped code guards.
2. **T1‑4's cut line.** Extracting the `<Stage>` subtree was necessary but not
   sufficient — konva stayed modulepreloaded afterwards. The plan correctly
   noted rollup hoists React into the konva chunk, but the binding that actually
   kept it on the critical path was rollup's **CommonJS interop helper**: a
   single shared virtual module folded into the konva chunk, which then made
   *every* other chunk statically import konva to reach it. Both React and
   `commonjsHelpers` have to be pinned.
3. **T3‑22's "runtime impact of removing OpenCV is approximately zero."** The
   decisive experiment the plan proposed was run (`FLOORTRACE_NO_OPENCV=1`, all
   seven fixtures): the JS path costs **one detection and two extra false
   positives** (62/82 with 2 FP → 61/82 with 4 FP). OpenCV earns its branch. The
   fix taken was the determinism half only, as the plan advised.

### Coverage added

- `src/utils/detection/__tests__/searchMemo.test.js` — the memo-warm-equals-cold
  gate the plan required before T1‑1, including the budget-eviction path (via a
  test-only `setSearchBudgetBytes`), the no-cacheKey path, and the
  room-clamp-then-trace sequence `App.jsx` actually performs.
- `src/utils/detection/__tests__/raster.test.js` — 256 assertions holding the
  run-based `dilateRows`/`dilateCols` bit-identical to the distance sweeps they
  replaced, across empty/full/checkerboard/border-hugging/linework masks at ten
  radii, plus the four composed operators.
- `src/utils/__tests__/pngEncoder.test.js` — the gray scanline path, slice-by-8
  CRC-32 and chunked adler-32 against the forms they replaced.
- `npm run probe:memory` now reports charged bytes and whether the memo evicted,
  which is what makes T1‑1's claim checkable rather than assertable.
- `eslint` bans `TypedArray.from(x, fn)` so T1‑2 cannot regress.
