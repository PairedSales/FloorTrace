# Dimension OCR — performance analysis

> **A dated record, not a live plan.** This is the measurement pass that produced the 1.8×
> speed-up, kept because the numbers and the two benchmarked-shut "free wins" in §6 are the
> reason not to re-attempt them. Later changes are not folded back in; CLAUDE.md is current.

Scope: `detectAllDimensions` / `detectDimensionsCore` (`src/utils/dimensions/`). Accuracy is
currently good; this is about the ~6–9s it takes. All numbers below are measured on this machine
(16 cores) via `scripts/ocrBenchmark.mjs` and standalone probes, not estimated.

## 1. Where the time goes

| fixture | px | preprocess | spatial | pass1 | **roi** | total |
|---|---|---|---|---|---|---|
| EF1 | 987×956 | 275 | 378 | 1010 | **4102** | 5766 |
| EF2 | 1084×870 | 252 | 396 | 822 | **4287** | 5757 |
| EF4 | 925×792 | 226 | 340 | 2898 | **5203** | 8667 |
| EF5 | 1199×1000 | 180 | 304 | 1701 | **4916** | 7102 |
| EF6 | 841×600 | 147 | 350 | 1939 | **4972** | 7408 |
| EF7 | 1017×1324 | 200 | 380 | 2302 | **4996** | 7879 |

Phase 4 (targeted ROI OCR) is **60–71%** of every scan. Phase 2 (full-page sparse pass) is 14–33%.

The JS raster work is **not** the problem. Measured against the real primitives:

- `prepareRoiVariants` full 6-variant ladder: **6.0 ms per ROI** (~200 ms across a whole scan)
- Phase-1 page ops: `scaleGray` 38 + `clahe` 90 + `unsharp` 37 + `binarizeInk` 13 ≈ 180 ms
- `dashLineMask` (one-off, page level): 50–68 ms

Netting these out: **~90% of a scan is Tesseract inference.** Every optimization that matters is
about the OCR calls themselves — how many, how big, and how parallel.

## 2. Root cause: call count, and all of it serialized

`ocrTesseract.js` keeps **one** cached worker. `recognizeSparse` and every `recognizeLine` await it
in turn, and the Phase-4 loop (`pipeline.js:678`) is a plain sequential `for` over the ROI queue.
Nothing in this pipeline ever runs two OCR calls at once.

Actual call counts (`OCR_DEBUG=1`), split by ROI priority:

| fixture | queued | read | prio ≥7: ROIs/calls → parses | prio ≤6: ROIs/calls → parses | detection rate |
|---|---|---|---|---|---|
| EF1 | 35 | 34 | 10 / 18 → **9** | 24 / 81 → **0** | (9 dims) |
| EF2 | 34 | 29 | 9 / 31 → **9** | 20 / 79 → **2** | 9/13 |
| EF4 | 94 | 19 | 8 / 38 → **6** | 11 / 46 → **1** | 4–5/12 |
| EF5 | 56 | 19 | 15 / 67 → **13** | 4 / 12 → **0** | 13/18 |
| EF6 | 63 | 28 | 10 / 32 → **6** | 18 / 62 → **0** | 10/10 |
| EF7 | 67 | 20 | 10 / 49 → **8** | 10 / 35 → **1** | 7/8 |
| **total** | **349** | **149** | **62 / 235 → 51** | **87 / 315 → 4** | |

Three things fall out of this table:

1. **~45 ms per `recognize()` call**, and 84–99 calls per scan. The ROI phase *is* its call count.
2. **The speculative tier burns 57% of all OCR calls (315/550) for 7% of the parses (4/55).**
   Every accepted dimension on four of six fixtures came from the priority-7/8 tier.
3. **The queue is truncated, badly.** 349 ROIs queued, only 149 read — `MAX_ROIS = 40` plus the
   clock cut the rest. EF4 queued 94 and read 19. On the hard plans the pipeline runs out of time
   before it runs out of candidates, which is exactly why EF4 scores 4–5/12.

Point 3 reframes the whole exercise: **on hard plans, speed is accuracy.** Making Phase 4 cheaper
doesn't just shorten the scan, it lets more of the queue actually get read. It also removes a real
nondeterminism — EF4 scored 5/12 on one run and 4/12 on the next purely on budget timing.

Two contributing details:

- The variant ladder is expensive even where it works: the productive tier averages 3.8 calls/ROI.
  A blank ROI still burns 3 reads before the digitless early-exit fires
  (`digitlessReads >= (variants.length > 2 ? 3 : 2)`, `pipeline.js:720`). EF1's histogram:
  21 of 34 ROIs used exactly 3 reads.
- `effectiveBudget` (`pipeline.js:645`) is `max(budget, elapsed + min(5200, max(900, 300 + 120·nRois)))`,
  so the nominal 2600 ms budget legitimately stretches to ~8.5 s. The budget isn't being violated;
  it's being *designed around*, and it's the thing capping accuracy on dense plans.

## 3. Recommendations, in order

### R1. Run ROI reads through a Tesseract scheduler (4 workers) — the main event

Measured on 30 text-dense tiles at pipeline-realistic zoom:

| workers | time | speedup | reads identical to serial |
|---|---|---|---|
| 1 (today) | 1050 ms | 1.00× | — |
| 2 | 586 ms | 1.79× | 30/30 |
| **4** | **386 ms** | **2.72×** | **30/30** |
| 6 | 363 ms | 2.89× | 30/30 |
| 8 | 332 ms | 3.16× | 30/30 |

Pool boot is 200–335 ms with the model cached. Four workers is the knee.

**Per-read output is bit-identical at every worker count** — same tiles, same params, same engine.
Expected: ROI phase 4.3–5.2 s → **~1.6–1.9 s**.

Implementation notes that matter:
- Parallelize *across* ROIs; keep each ROI's variant ladder sequential. The ladder's early exit is
  what bounds the work — fanning it out would multiply calls, not reduce them.
- The loop mutates shared state: `candidates`, `parsedBoxes` (the "already covered" skip at
  `pipeline.js:686`), and `rois.splice()` for widened re-reads (`pipeline.js:814`). With a bounded
  in-flight pool, the skip-check becomes advisory and widened re-reads should append to a follow-up
  queue rather than splice into the array being iterated. **This means pipeline-level output is not
  guaranteed identical even though each read is** — gate the change on `npm run bench:ocr`.
- `applyPreset` flips one shared worker between `line` and `block` mode. With a pool, either keep
  two small pools (line-mode and block-mode) or set params per worker at creation. Don't route
  `setParameters` through the scheduler — it lands on an arbitrary worker.
- Memory: each worker holds the 5.2 MB traineddata plus its own WASM heap. Gate the count on
  `navigator.hardwareConcurrency` and don't exceed 4 by default.

### R2. Stop spending the full ladder on the speculative tier

57% of calls, 7% of parses. Cap the ladder by priority: full ladder for priority 7/8, one or two
rungs for priority ≤6. Optionally tighten the digitless bail from 3 reads to 2 for that tier.

Expected: removes roughly 20–25% of total OCR time on top of R1.

**This one does carry accuracy risk** — 4 real detections across the six fixtures came from that
tier. It is cheap to evaluate: run `npm run bench:ocr` over all fixtures before/after and keep it
only if the detection rate holds. My expectation is that it holds or improves, because the time
freed goes to ROIs that currently never get read at all.

### R3. Cache the OCR result by image hash

`handleFindRoomSize` (`App.jsx:392`) re-runs the entire scan against the same image, as does
re-entering manual mode. The detection pipeline already does this (`detection/cache.js`); the
dimension pipeline doesn't. Zero accuracy risk, small effort, turns a repeat scan into ~0 ms.

### R4. Don't terminate the worker after every scan

`App.jsx:386` terminates and re-warms on every scan. Cold boot measured **1520 ms**; with a pool
that cost multiplies. The comment says this is to release the WASM heap, which is legitimate — so
replace immediate teardown with an idle timeout (release after ~60 s idle, or on image change)
rather than tearing down the instant a scan finishes.

### R5. Tune the pre-OCR page upscale (measure, don't assume)

`ocrScale = min(2.2, 2000/maxDim)` for images under 1800 px means a 987×956 plan is OCR'd at
2000×1937 — 4× the pixels. Measured sparse-pass cost vs. yield:

| fixture | 1.0× | 1.4× | current |
|---|---|---|---|
| EF1 (2.03×) | 620 ms / 11 conf. digit words | 630 ms / 15 | 988 ms / 20 |
| EF4 (2.16×) | 1208 ms / 8 | 1743 ms / 20 | 3178 ms / 25 |
| EF5 (1.67×) | 1271 ms / 14 | 1354 ms / 13 | 1623 ms / 18 |

The upscale is genuinely buying accuracy — this is not dead weight. But EF4 pays +1435 ms going
from 1.4× to 2.16× for +5 confident digit words. Dropping the cap toward 1.4× would save 0.3–1.4 s
of pass1; the catch is that fewer pass-1 seeds means *more* speculative ROIs, so the net could wash
out. Worth an experiment, not worth assuming.

Free adjacent win: `clahe` currently runs on the *upscaled* page (90 ms) when it could run on the
native page before upscaling (23 ms). ~65 ms for a line move.

### R6. Shrink the ROI tiles

The ladder builds 273×112, 417×160 and 649×238 variants — **504k tile pixels per ROI**. Tesseract
cost scales with pixel count, and rung 3 is 2.6× rung 1. `TARGET_GLYPH_PX = 36` is generous given
the LSTM normalizes line height internally. Compounds with R2.

## 4. Explicitly not recommended

**Swapping to `tessdata_fast`.** Measured: 385 ms vs 454 ms serial — only **1.18×** — and 7 of 24
reads changed. Not worth the accuracy exposure for that little. (Note `@tesseract.js-data/eng` only
publishes `4.0.0` and `4.0.0_best_int`; the current self-hosted 5.2 MB file is `best_int`. The
1.98 MB gz `fast` model exists at `tessdata.projectnaptha.com/4.0.0_fast` — worth considering purely
as a *first-load download* win, which is a separate question from scan speed.)

**Moving the pipeline into a Web Worker to make scans faster.** It won't — JS is ~10% of runtime.
It is still worth doing for *responsiveness* (Phase 1 + 3 block the main thread for ~600 ms, plus
~6 ms bursts between every ROI await), but it should be sold as UI smoothness, not speed. Check
whether tesseract.js spawning its own worker from inside a worker is acceptable across target
browsers before committing.

## 5. Expected outcome

R1 + R2 + R4 together should take a typical scan from **5.8–8.7 s to roughly 2.5–3.5 s**, with
detection rate flat or better — better specifically on the dense plans (EF4, EF5, EF6, EF7) that
currently exhaust the budget with most of their ROI queue unread.

Suggested order: **R1 → R3 → R4 → R2 → R5/R6.** R1 is the biggest win and the lowest accuracy risk;
R3 and R4 are cheap and risk-free; R2 needs a benchmark gate; R5/R6 are tuning once the structure
is right. Run `npm run bench:ocr` across all seven fixtures at every step — the detection rate is
the thing being protected.

---

## 6. Implementation results (measured after the fact)

Implemented: **R1, R2, R3, R4.** Rejected on the benchmark gate: **R5, R6.**

Baseline vs. shipped, all seven fixtures in one process, same order (`bench:ocr`):

| fixture | total before | total after | roi before | roi after | rate before | rate after |
|---|---|---|---|---|---|---|
| EF1 | 5588 | 2862 | 3958 | 958 | 9/12 | 9/12 |
| EF2 | 5716 | 2966 | 4334 | 1294 | 9/13 | 9/13 |
| EF3 | 5858 | 3267 | 4373 | 1516 | 9/9 | 9/9 |
| EF4 | 8474 | 5413 | 4995 | 1647 | 4/12 | 4/12 |
| EF5 | 7449 | 4424 | 5043 | 1997 | 13/18 | **14/18** |
| EF6 | 7199 | 3368 | 5000 | 1143 | 10/10 | 10/10 |
| EF7 | 7481 | 4234 | 5004 | 1835 | 7/8 | 7/8 |
| **total** | **47.8 s** | **26.5 s** | **32.7 s** | **10.4 s** | **61/82, 2 FP** | **62/82, 2 FP** |

Phase 4 came down **3.1×**; a scan is **1.8×** faster end to end. Verified in the browser as well
(EF2: 4006 ms cold, 9 dimensions + the balcony label — identical to the Node result).

### What the report got right

- **R1** is the main event, as predicted. Pool size was `min(4, cores/2)` when this was measured (it is `max(1, min(cap, cores/2))` now, with `cap` 8 only on a 16-core machine reporting ≥ 8 GiB), preset-affine (a `line`
  waiter prefers a worker already in `line` mode) so the ladder's mode switches don't thrash
  `setParameters`. Boots are kicked off at the *start of phase 2* — booting them lazily on the first
  ROI read cost ~1 s of the phase they exist to accelerate.
- **R3** measures at **0 ms** on a repeat scan. Keyed on data-URL identity rather than
  `hashDataUrl`, which samples only the first 8 KB and can alias (`CODE_REVIEW.md` F15).
- **R4**: a second image right after a scan now takes 2297 ms instead of 4006 ms — ~1.7 s of engine
  bootstrap saved per scan. Teardown moved to a 60 s idle timer; the teardown/rebuild cycle is
  exercised and clean.
- **R2** was flagged as the accuracy risk and it was the opposite: it *removed* the false positives
  R1 alone introduced on EF4 (2 → 5 → back to 2). The mechanism the report guessed at is real —
  freeing the budget lets the queue tail get read instead of the third zoom rung of a guess.

### What the report got wrong

- **R5's "free adjacent win" is not free and not a win.** Running CLAHE on the native page and
  upscaling afterwards is ~50 ms cheaper and costs **six detections** (62/82 → 56/82) with more
  false positives. Bilinear zoom is what *creates* the local contrast gradients CLAHE exists to
  flatten, so it has to run second. Left as-is with a comment saying why.
- **R5's upscale cap**: swept 1.4 / 1.7 / 2.2. 1.4× is much worse (56/82, 6 FP). 1.7× holds the
  detection rate at 62/82 and saves 6.6 s, but adds two false positives (EF2, EF6). Not taken —
  in an appraisal tool a wrong dimension in the pick list is worse than a slower scan. This is a
  live knob if that trade is ever wanted; it is the largest remaining win.
- **R6**: `TARGET_GLYPH_PX` 36 → 32 loses EF5 (61/82), → 28 loses EF5 and two on EF7 (60/82, 4 FP),
  with no reliable time saving once phase 4 is parallel. 36 is already at the knee.

### Where the time is now

`pass1` is the new dominant phase (EF4: 3167 ms of 5413 ms). Phase 4 no longer saturates its budget
on any fixture, so `effectiveBudget`'s stretch-to-5.2 s clause is no longer what caps accuracy —
EF4's 4/12 is a detection problem, not a time problem, and should be chased as one.

### One thing the report implied that no longer holds

Point 3 of §2 ("the queue is truncated, badly — 349 queued, 149 read") was true of the clock, not
of `MAX_ROIS`. Raising the cap 40 → 60 now changes nothing: same 62/82, same 2 false positives,
~3 s slower. Phase 4 reads to the cap well inside its budget on every fixture, so ROIs 41-60 are
genuinely junk rather than unread labels. Left at 40.

---

## 7. Second round: parallelizing pass 1 (implemented, measured, reverted)

With phase 4 concurrent, `pass1` became the dominant phase — 33–60% of every scan, and still a
**single** `recognize()` while three of the four pool workers sit idle. The obvious next move is to
read the page as overlapping horizontal strips across the pool. Implemented and benchmarked; it
does not pay.

The raw phase win is real and large:

| | EF1 | EF2 | EF3 | EF4 | EF5 | EF6 | EF7 |
|---|---|---|---|---|---|---|---|
| pass1 single call | 1114 | 928 | 974 | 3177 | 1897 | 1673 | 2125 |
| pass1 as strips | **624** | **526** | **645** | **2155** | **1177** | **1338** | **967** |

But end-to-end it bought almost nothing and cost accuracy:

| variant | total | detections | false positives |
|---|---|---|---|
| single call (shipped) | 25.9 s | **62/82** | **2** |
| strips, 96 px overlap, strict band ownership | 26.0 s | 59/82 | 4 |
| strips, 96 px overlap, seam-margin merge | 24.7 s | 62/82 | 3 |
| strips, 180 px overlap, seam-margin merge | 26.1 s | 58/82 | 4 |

Three findings worth keeping:

1. **Attributing a line to the band that owns its centre loses rows.** A seam lands where Tesseract
   reads worst; if the owning band misses the row entirely and only its neighbour caught it, strict
   ownership discards the one good read. Preferring the read that saw the row furthest from a seam
   recovers all three lost detections. A white border on each strip (the existing fix for
   edge-touching text) is also required.
2. **A wider overlap is worse, not safer.** 180 px lost five detections that 96 px kept. More
   overlap means more of the page read twice by strips that disagree, and the merge has to pick.
3. **The phase win doesn't reach the total.** `spatial` (main-thread JS that runs under pass 1)
   inflates 30–40% once four workers are competing for CPU, and the ROI phase lengthens because a
   different pass-1 seed set produces a different ROI queue. ~1.2 s net for one extra false positive
   is a worse trade than the `UPSCALE_MAX` knob already rejected in §6.

Root cause of the accuracy loss is not the seams — it is that Tesseract re-estimates resolution and
layout per image, so a strip is genuinely a different OCR problem from the page. No overlap or merge
strategy fixes that.

### Also examined, not implemented

- **`dashLineMask` (~60 ms) computed under the pass-1 await.** It only needs `roiGray`, so it looks
  free — but it is sized off the *pass-1-refined* glyph height, and that refinement exists precisely
  because the spatial estimate collapses on plans dense with dashed walls. Using the bad estimate to
  build the dashed-line mask, on exactly the plans where it is bad, is not worth 0.2%.
- **Pipeline into a Web Worker.** Still the right call for responsiveness, not speed (§4), but it is
  blocked on more than nested workers: `dataUrlToImage` needs `Image`, and the PaddleOCR rescue hook
  in `browserEnv()` needs main-thread WebGL. Both would have to be reworked first.
- **Prefetching the scan on image load.** Moot — `handleManualMode` already runs it on drop/open, so
  there is no idle window to move it into.
- **OpenCV at mount (CODE_REVIEW F5).** Already resolved: `warmupOcrEngines` no longer touches
  `loadOpenCv`, so the 15.5 MB chunk is only fetched from inside a scan.

**Conclusion: the dimension pipeline is at a local optimum on the levers available.** Everything
still on the table trades accuracy for time. The remaining work is accuracy — EF4 at 4/12 and EF2 at
9/13 — which is a detection problem, not a performance one.
