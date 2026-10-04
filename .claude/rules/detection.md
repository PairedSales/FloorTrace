---
paths:
  - "src/utils/detection/**"
  - "src/workers/**"
  - "src/utils/boundaryQuality.js"
  - "src/utils/wallSnapEngine.js"
  - "scripts/detectionBenchmark.mjs"
  - "scripts/scaleBenchmark.mjs"
  - "scripts/cubicasaBenchmark.mjs"
  - "scripts/syntheticProbe.mjs"
  - "scripts/traceDebug.mjs"
  - "scripts/drawBoundary.mjs"
  - "scripts/memoryProbe.mjs"
  - "scripts/lib/**"
  - "fixtures/**"
---

# Wall and boundary detection (`src/utils/detection/`)

The cores (`detectRoomFromClickCore`, `traceFloorplanBoundaryCore` in `pipeline.js`) take a plain `{width, height, data}` and run identically in `src/workers/detectionWorker.js` and in the Node harnesses. Keep them free of browser APIs.

## Verify every change, before and after

- `npm run bench:detection` scores polygon shape and square feet on every plan in `fixtures/` (a CI gate). It runs each fixture twice: bare, then with the truth file's room clicks as constraints — the path the app takes after a scan, and the only one that exercises remediation. `boundary.bare` in a truth file relaxes the bare run only.
- `npm run probe:exterior` (and `probe:exterior draw`) prints the synthetic scenarios `exterior-failures.test.js` asserts, with exact truth. Fastest way to see what a change did.
- `npm run bench:scale` whenever room rectangles or scale selection can move (a CI gate).
- `npm run bench:cubicasa -- --compare <saved-run>` is the wide check (thousands of plans, local only — `datasets/README.md`). A change that fixes a fixture can quietly break forty apartments. Try it on its `--watch` list (`scripts/lib/cubicasaReview.json`) first, iterate on `--split dev`, confirm on `train` and `val`, and put the scoreboard before and after in the PR and in the log in `docs/accuracy-roadmap.md`. `--draw-changed` draws every plan whose verdict moved: look at the ones that got worse. A plan whose answer key is wrong goes in the review file's `exclude` with its reason, never quietly left to lose. `npm run bench:real` scores the 75 real plan-book pages in `datasets/real/` the same way. Their keys were drawn by Claude and never checked by a person, so use it to see that a change does not make them worse, and when a verdict looks wrong check the key against the ink before the tracer.
- Diff the full output, not the totals. For a performance-only change, strip timings (`sed -E 's/[0-9]+ms//g'`) and require an empty diff.
- Never tune a threshold until a benchmark passes. Adjudicate on evidence other than the benchmark — the ink, another fixture, a synthetic case — and say so when there is none.
- The Node harnesses pass no `cacheKey`, so every room there is a cold trace (~0.7 s); in the browser rooms after the first cost 1–5 ms. `utils/perfMarks.js` (DEV only) times the real path.
- `node scripts/traceDebug.mjs <image>` prints networks, candidates, scores and carve decisions.
- Truth files do not all follow one convention for where a room edge sits. Measure the ink before believing a truth rect. `benchUtils.bboxOf` is half-open.
- Synthetic test images: draw walls in black. Otsu binarisation drops mid-grey walls when the histogram has only two levels. A test that needs a grey tone gives it a spread and softens the edges, as `binarize.test.js` does.

## Stages

- `raster.js` — Otsu, OR-pool downscale, run-based morphology, components (ids from 0, background −1), flood fill, summed-area tables.
- `analyze.js` — `wallMask` (strict; rooms use it), `boundaryMask` (plus rescued line-like ink and screened glazing; the tracer uses it), `thickMask` (structural strokes).
- `wallEvidence.js` — axis-aligned wall segments and graded per-point evidence (`contourSupport`).
- `candidates.js` — footprints per wall network: evidence `all`/`structural` × policy `weld`/`raw`/`span`; every closing-ladder rung is a candidate.
- `scoring.js` — seal, support, coverage, economy, constraints → `confidence` and `warnings[]`.
- `boundary.js` — orchestrator: partition into wall networks, generate, score, pick, build floors, order them.
- `footprint.js` — per floor: contour, filament shave, non-GLA carve, holes, interior envelope inset per edge.
- `nonGla.js` (+ `garage.js`) — garage/porch/patio candidates from four detectors, merged, removed in one pass under a cumulative bound.
- `remediate.js` — second-chance trace (`join`, `escalate`) below `REMEDIATION_CONFIDENCE` or when a known-inside constraint is excluded. Never in draw mode.
- `validate.js` — post-hoc checks, `scaleIsotropy`/`robustScale`, `orientDimsToBox`, `resolveRoomScale`, `constraintFactor`.
- `room.js` — rectangle growth from a label. `brush.js` — draw mode. `scale.js` — which room the project scale comes from. `cache.js` — per-image memo. `labelFrame.js`, `polygon.js`.

## Invariants

- **Quality is an output.** `quality: {confidence, warnings[], usedFallback, source, …}` travels with the result onto each trace and into the saved file. The worker forwards a whitelist of debug fields — never blanket-null them. It decides remediation, the runner-up outlines and the benchmarks' verdicts. It is *not* narrated to the user: an outline is checked by eye against the plan, so no warning, score or "check it" is shown for one (see CLAUDE.md). The one exception is a trace that produced no outline at all — then there is no picture, and `lastTraceOutcome.reason` (the worst warning, worded by `utils/boundaryQuality.js`) is given under Outline with the ways to draw one by hand.
- **Excluding a known-inside constraint is subtracted outside the weighted mean**, beside `annex` and `incomplete`. It is a contradiction, not a lower mark; as a reward term alone, `economy` bought it back.
- **Remediation adjudicates on effective confidence** (the detector's own × `constraintFactor`): constraints are scoped per network, so inside the network that caused a miss the miss is invisible. `escalate` runs only when the ladder ceiling was reached, nothing sealed, or a constraint was missed.
- **`quality.source: 'drawn'` is judged more gently** in both `scoring.js` and `validate.js` — a label outside a hand-drawn outline warns rather than errors. In draw mode the stroke is the intent.
- **`exemptRegions` and `carvedRegions` stay separate**: label boxes padded by their size vs. exactly what the carve removed (containment only).
- **A `shaded` carve is a guess, not a statement.** It is refused when a parsed label sits on the tint field (`groupTintFields`, closed across thin ink but blocked by `thickMask`), it does not join `carvedRegions`, and its `area-excluded` warning is `warn`. A non-GLA candidate holding a living room's label is refused with `non-gla-not-removed`.
- **A label whose cavity fails is voted again behind the glazing.** The carve's barrier is thick wall, which a wall of windows is not, so a balcony's cavity can hold the room it opens off: too big to carve, or holding that room's label. Only then does the label vote on `boundaryMask`, where window frames are wall, and the cavity it finds is opened by an exterior wall's thickness before it is offered. Only then, because the finer barrier also splits a hatched deck into its boards.
- **A labelled deck drawn in boards is carved from the boards' span** (`boardedArea`, `nonGla.js`). The barrier reads boards as wall, so the label lands on them or in a strip between two. Only for a label no other route answered, and only when the label sits mostly on the piece, it is a space's size, it lies along the outline and it fills most of its box. Each guard answers a false piece found on CubiCasa: the label's own text, stair treads and cabinets (they hold a living room's label and are refused), hatching webbed across a whole drawing (fill). Board spacing is scaled to the page, not to the wall.
- **Every labelled non-GLA space inside a footprint is answered**: carved, or refused with a reason. One no region answers is stated as `non-gla-not-removed` with `no-separable-region`.
- **A carve may not cut off a wing.** Only the largest piece survives a carve, so `applyRegions` tries each region as it would actually be carved and refuses one whose cut-off piece holds two or more labelled rooms (`splits-footprint`). A single room reached only across the carved space goes with it, and `label-outside` names it.
- **The fill-aware split gives back walls drawn in the tone it sets aside** (`keepBands`, `raster.js`). A set-aside piece is ink again only when it has a body (most of it survives a 2 px erosion), spans a tenth of the page, has no bulk (an erosion of ~1% of the page takes nearly all of it) and mostly looks out on something much lighter, past at most a thin outline. Each test answers one thing the same tone also draws — anti-aliasing and a scan's grey line work, furniture, room fills and balconies, a room fill's shaded rim (ExampleFloorplan7, whose scale went 12% wrong without the last). Don't drop one to rescue another plan.
- **Two drawings in one wall network are cut apart** (`cutDrawings`, `boundary.js`). The partitioner's grouping radius, or a dimension string across the gap, makes two drawings on one sheet one network, and the weld then closes the gap along their aligned walls; its notch test misses a gap when a window sits below a corner. A network is cut along a band no thick stroke crosses, and only when each side encloses itself and a tenth of the whole, the cut loses nothing enclosed but the band, thick wall on each side faces the band, and what the band encloses is not drawn closed (a patio between two wings is the carve's to answer). Each test answers a slice through one building found on CubiCasa — aligned doorways, a thin partition, a patio. A side keeps its network's weld reach (`net.reach`, read by `generateCandidates`), so the cut removes only the welds across it.
- **Remediation's hold count exempts labels in carves, not in the thin-structure region** (`measureHold`). That region's box is the union of scattered hairline areas and can span the floor; exempting what it covered hid a room lost behind a window from the pass that finds it.
- **Glazing rescue** only where the grey band lines up with wall at both ends. Don't relax `minFlank` in `bridgeRunsGuarded`: one wall thickness is also what a scan line sees of a diagonal wall.
- **The room-click clamp (`roomClampBoundary`) is a rail.** It asks for the widest hypothesis (`autoGarage: false`, `autoShaded: false`); a click inside its bbox but outside its mask drops the clamp; a click outside the bbox is refused in words. Too tight means a click that silently does nothing.
- **`options.foreignPoints`** (every other parsed label) is passed by all three room-detection callers: the scan batch, a pill click, a manual click.
- **Room edges seat on the interior wall face**, measured over the final span. Snapping targets wall faces (the white→black transition on the room side), never centrelines — a product rule.
- **A label's two numbers carry no axis.** Orient them to the box (`orientDimsToBox`) for scale, but never inside the open-plan rescue, which exists because the box is wrong on one axis.
- **`cache.js` keys on the data URL, not its hash** (`hashDataUrl` can alias two images). The `cacheKey` is minted once per decode; `MAX_DECODED` is 2 so two open plans don't evict each other; `dropCacheKey` drops one image; past the 32 MB budget the memo stops storing but never clears.
- **Labels stay in crop space** with their `frame` (`labelFrame.js`); re-expanding them to page size blew the memo budget.
- **Scale selection (`scale.js`)**: the scale is one room's own (`settleRoomAxes`, the same rule a room picked by hand goes through), and that room is the one the box is drawn on. Every labelled room is measured only to choose it — the one nearest the middle of the rooms that agree — and to judge it; the middle (`robustScale`) is a yardstick and is never applied. Only the confidence gate earns its place. Weighting by isotropy or length measured no better or worse; never show a spread derived from the samples as error; a centreline-vs-face offset model was tested and falsified.
- `%TypedArray%.from(x, fn)` is lint-banned here: ~92 ns/px against ~4 ns/px for a preallocated loop, which is the whole per-pixel budget.

Background papers: `Reference Data for Wall Detection System/`.
