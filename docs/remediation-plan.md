# FloorTrace — codebase review remediation plan

Findings from a review at `6473d35`, written for execution by sub-agents:
every task brief below is self-contained and can be handed to an agent that has
never seen the review.

This is the **live** task list. `docs/CODE_REVIEW.md` is an earlier review, and
marks itself historical.

The repository-hygiene findings from the same review (stale worktrees and
branches, orphaned `.git/worktrees` metadata, CI running only after merge,
`bench:scale` absent from CI, `.claude/worktrees/` excluded only per-machine,
CLAUDE.md wrong about the committed OCR weights) are **already fixed** and are
not repeated here. Two recovered commits came out of that work and are not yet
merged — see §0.

Tick tasks off here as waves land, so this stays a plan rather than a snapshot.

---

## How to use this document

1. Read **§0 Orchestration contract** — worktree isolation, commit protocol,
   the report format, and the one unmerged branch that moves a baseline.
2. Read **§1 Shared context**. Every agent brief must be prefixed with it
   verbatim — it is the part agents otherwise re-derive expensively and get
   wrong.
3. Pick a wave from **§2**. Tasks inside one wave touch disjoint files and can
   run in parallel; waves are ordered by dependency.
4. Hand the agent **§0 + §1 + the single task brief**. Do not hand it the whole
   document — the other tasks are noise that invites scope creep.
5. Each brief ends with **Acceptance**, **Verify**, **Out of scope** and
   **Escalate if**. The last one matters most: an agent working alone will
   quietly tune a threshold to make a benchmark pass. The briefs forbid it
   explicitly; keep that wording.

---

## 0. Orchestration contract

### Every concurrent agent MUST get its own worktree

Spawn with `isolation: "worktree"`. This is not an optimisation — it is
required for the plan's verification model to mean anything.

The wave structure guarantees no two concurrent tasks edit the same *file*, but
agents sharing one checkout also share one git index, one `HEAD`, and one
working tree. Two consequences, both fatal to this plan:

- **Commit contamination.** Each brief ends in a commit. A concurrent
  `git add -A` stages another agent's half-finished edits.
- **Poisoned baselines.** Almost every task verifies by diffing a benchmark
  *before* against *after*. In a shared tree, agent A's "before" run already
  contains agent B's in-flight changes, so every measurement is meaningless.

The cost (~200–500 ms setup and a checkout's disk each) is trivial against
that. If for some reason worktrees are unavailable, run the tasks **strictly
one at a time** — do not fall back to concurrent agents in one tree.

### Commit protocol

- One task, one commit, on the task's own branch.
- The agent commits its own work; the orchestrator merges. Agents never merge,
  rebase, push, or open a PR.
- `git add` explicit paths. Never `git add -A` or `git add .`.
- Integrate a finished wave onto its own branch (`claude/remediation-wave-a`
  and so on) and open a PR against `master`. **Never push directly to
  `master`** — a ruleset requires the `build` check there, so a direct push
  either fails or defeats the gate it exists to enforce.

### What each agent reports back

The orchestrator sees only the final message, so it must carry:

1. **Verdict** — done / blocked / escalated.
2. **Benchmark deltas** — the actual numbers before and after for every bench
   the brief names, not "unchanged". If a check moved, the fixture and both
   values.
3. **Which route** — several briefs offer a documented fallback (A2's second
   stable pass, A3's badge-instead-of-list, D2's keep-in-autosave). Say which
   was taken and why.
4. **Anything found and not fixed**, with the file and line.

### One unmerged branch changes a baseline if it lands

`claude/optimistic-perlman-b2dcce` carries commit `e024871`, "Seat each room
edge on the wall face instead of predicting it" — a Phase D addition to
`src/utils/detection/room.js` that also **edits
`fixtures/ExampleFloorplan7.truth.json`**. It is recovered work that was never
committed and has not been verified: `npm test`, `bench:detection` and
`bench:scale` were not re-run against it.

It is not merged, so the baselines in §1 are valid as they stand. But it moves
every room's implied px/ft, which is exactly what Task B1 is measured against.
**Decide before Wave B whether it lands first.** If it does, re-measure the
`bench:scale` baseline and treat B1's adjudication against the new numbers.

#### Adjudicated — it has now been measured

It cannot be benched in isolation: it is based on `37096a7`, which predates
`a568332`, so `scripts/scaleBenchmark.mjs` does not exist on it and `a568332`
independently edited `ExampleFloorplan7.truth.json`. Merged onto master in a
scratch worktree (clean auto-merge) it gives `npm test` 294/14, lint clean,
`probe:exterior` **byte-identical**, and every boundary and floor polygon on
every fixture unchanged — only room rectangles move, as a `room.js`-only change
should.

The 2×2, `bench:detection` IoU on ExampleFloorplan7 (the only fixture whose
truth it edits):

| OWNER'S SUITE | old truth | new truth |
|---|---|---|
| old code | 91.5% *(baseline)* | 91.9% |
| new code | **91.5%** | 99.3% |

The new code clears 45/45 against the **unedited** truth, so the truth edit is
not load-bearing. Independent confirmation comes from fixtures it never touched:
on ExampleFloorplan1 the six rooms' implied scales collapse from a **6.0%**
spread to **0.6%** and consensus error against an unchanged target goes
**+3.1% → +0.6%**, with all six room IoUs improving against independently
authored truth. `bench:scale` goes 14/14 → **15/15** because EF7's `KNOWN`
expected-failure — annotated *"Fix the rectangle, not the selector"* — becomes a
real pass.

Against it: EF6's `BEDROOM 2 (left)` and `BEDROOM 1 (right)` drop from 100.0%,
but their truth rects are pixel-identical to the *old detector output*, so that
100.0% was never independent evidence; EF6's one rect that plainly was measured
improves. EF2's inter-room spread worsens (36.7% → 51.8%) with consensus error
flat.

**Recommendation: land it before Wave B integration** — B1 is adjudicated by
`bench:scale`, and that instrument currently carries a ~5% common-mode bias on
EF7.

#### Landed — merged into the Wave C base as `16c0327`

Signed off after Wave B had already integrated, so it went in ahead of Wave C
instead, as its own PR (#179) against `master` rather than buried inside a wave.
Re-gated on the Wave C base: lint 0/2, `npm test` **322 passed / 17 files**,
`bench:detection` **45/45**, `bench:scale` **15/15** — the EF7 `KNOWN`
expected-failure is gone, and no `KNOWN` entries remain.

Every boundary and floor line in `bench:detection` is byte-identical; only room
rectangles moved, which is what a `room.js`-only change should do:

| fixture | room | before | after |
|---|---|---|---|
| EF1 | all six | 90.9–98.4% | **95.6–99.1%** (every one improves) |
| EF3 | LIVING ROOM | 92.8% | **97.0%** |
| EF3 | BASEMENT-L | 97.5% | 98.1% |
| EF6 | BEDROOM 2 (left) | 100.0% | 97.3% |
| EF6 | BEDROOM 1 (right) | 100.0% | 98.7% |
| EF6 | LIVING ROOM (left) | 97.8% | **99.2%** |
| EF7 | OWNER'S SUITE | 91.5% | **99.3%** |
| EF7 | BEDROOM 2 | 86.2% | **88.9%** |

The two EF6 drops are the ones the adjudication predicted and discounted: those
truth rects are pixel-identical to the *old detector output*, so their 100.0%
was never independent evidence.

---

## 1. Shared context

> Paste this block at the top of every agent brief.

### Repository

FloorTrace is a client-side React SPA that reads a floorplan image, OCRs the
room dimension labels, traces the exterior walls with classical CV, and reports
square footage. No server. Work from the root of your own worktree.

Claude Code worktrees live under `.claude/worktrees/<name>/` and have no
`node_modules` of their own, but Node and npm resolve up to the parent repo's
copy, so every `npm run` script works unmodified. **Do not run `npm install`.**

### Commands

```bash
npm test                    # vitest run — all tests
npm run lint                # eslint .
npm run bench:detection     # detection accuracy vs fixtures/ (CI-gated)
npm run bench:scale         # project-scale selection vs fixtures/
npm run probe:exterior      # exterior tracer on synthetic scenarios
npm run probe:exterior draw # same, re-traced from a synthetic brush stroke
npm run dev                 # Vite dev server (manual UI verification)
```

### Baselines at `6473d35` — any change from these is a regression until proven otherwise

| Check | Baseline |
|---|---|
| `npm test` | 293 passed, 14 files |
| `npm run lint` | 0 errors, 2 warnings (both pre-existing `react-hooks/exhaustive-deps`) |
| `npm run bench:detection` | **45/45 checks passed** |
| `npm run bench:scale` | **14/14 checks passed** |
| Search-cache retention, ExampleFloorplan5 | ~112 MB (measured by Task B2's probe) |

**Superseded from Wave C onward.** The wall-face-seating commit landed in the
Wave C base (`16c0327`, see §0), so agents from Wave C on are given these
instead: `npm test` **322 passed / 17 files**, `bench:detection` **45/45** with
moved room rectangles, `bench:scale` **15/15**, peak search-cache retention
51.9 MB. Lint is unchanged at 0 errors / 2 warnings.

### Non-negotiable rules

- **Always run `npm run bench:detection` before and after any change under
  `src/utils/detection/`.** It scores polygon shape and square feet, not just
  bounding boxes. A tracer that returns each building's bounding rectangle
  passes a box check while discarding every notch and wing.
- **A benchmark that moves is a finding, not an obstacle.** Never widen a
  tolerance, tune a constant, or edit a `.truth.json` to make a check pass.
  Report the movement and stop.
- **Detection results carry their own quality.** Never drop a `warnings[]` or
  `confidence` on the way to the UI, and never report a trace as a plain
  success without consulting it. The failure mode this codebase is most prone
  to is a wrong answer that looks green.
- Comment density: short "why" lines only, no docstring blocks. Match
  `pipeline.js` and `appStore.js`, not the verbosity of nearby one-off code.
- `eslint.config.js` treats unused vars as errors except names matching `^[A-Z_]`.
- There is **no jsdom and no testing-library** in devDependencies. React
  component tests are not possible. Test at the store / pure-function level, or
  verify manually with `npm run dev`.
- Tests live under `src/**/__tests__/`. Vitest's default glob picks up any
  `*.test.js`; the store runs unmodified under the default node environment.

### Commit convention

One task per commit. End the message with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

Do not push or open a PR unless explicitly asked.

---

## 2. Waves

Tasks within a wave touch disjoint files and may run concurrently — each in its
own worktree, per §0. Waves are strictly ordered.

### Wave A — user-visible wrong numbers (4 agents, parallel)

Integrated on `claude/remediation-wave-a`, PR #177. Gate at that tip: lint
0 errors / 2 warnings, `npm test` **306 passed / 16 files**, `bench:detection`
**45/45**, `bench:scale` **14/14**, both bench outputs byte-identical to the §1
baseline. (A2's re-scoped commit merged in after that line was written, taking
the branch to 321 passed / 17 files.)

| ID | Task | Files | Status |
|---|---|---|---|
| **A1** | Preserve perimeter holes across an edit | `src/store/appStore.js`, new test | ✅ `b7e8e91` |
| **A2** | Make candidate selection a total order | `src/utils/detection/{scoring,boundary,pipeline}.js`, new test | ✅ `0ec3c7a` after re-scoping — see below |
| **A3** | Report OCR failure as failure; show trace quality for one floor | `src/utils/DimensionsOCR.js`, `src/components/LeftPanel.jsx` | ✅ `388af3b` |
| **A4** | User-facing text and input fixes | `src/App.jsx`, `src/hooks/useKeyboardShortcuts.js`, `src/utils/boundaryQuality.js` | ✅ `39b990d` |

**A2 escalated, and the finding is larger than the task.** The defect is not the
predicted intransitive cycle but a *degenerate tie*: on `ExampleFloorplan.png`
two candidates carry equal `radius` and equal `bridgedSpan` with scores inside
the 0.015 epsilon, so the comparator returns `0` and `Array.prototype.sort`
stability decides the winner by push order. Control: leaving `pickCandidate`
**unmodified** and reversing the input array drops the bench to **44/45** — the
45/45 baseline is a property of push order, not of the algorithm. The current
winner is the *lower*-scoring candidate (0.9598 over 0.9704), so every
principled total order flips it and loses EF1's `GARAGE` check. Re-scoped to
include adjudicating which candidate is actually correct.

**Re-scoped and landed as `0ec3c7a`.** The adjudication: `structural` is not a
smaller building, it is the house **plus two ~9px × 330px fingers** tracing
around the garage along its top and bottom walls. `all` is correct, on three
grounds none of which is a benchmark number — `candidates.js:221-229` states the
contract outright ("wrong for a porch whose railings are the only thing holding
its outline"); five existing tests encode it and all five fail when `structural`
wins; and `probe:exterior`'s `garage door 5px` scenario drops 98.5% → 61.0%
bboxIoU under a naive total order.

**The real defect it found, and did not fix.** `support.mean` is
`∫level ds / ∮ds`, normalised by the candidate's *own* perimeter. Excising a
region along drawn wall removes one weakly-drawn edge and adds *twice* the
well-drawn cut line — so **amputation raises `support.mean` unconditionally,
for any excised region of any size, whenever the removed edge is below the
current mean**. Its intended counterweight `coverage` counts *ink pixels*, and
the garage's own walls stay inside the fingers, so losing a 47,000 px bay (~17%
of the floor) cost coverage 0.003. `seal` is 1.000 either way. **No term in
`scoreCandidate` is sensitive to enclosed area disappearing relative to a
sibling hypothesis.** Fixing that means choosing a scoring formulation validated
only against the benchmark — the trap this document warns about — so it was left
as a finding. It deserves its own task.

What landed instead is a tie-break, not a tuned constant: `SCORE_EPSILON` stays
0.015, no weight changed, and `invention(c) = c.variant === 'structural' ? 1 : 0`
ranks ahead of closing radius **only inside the existing noise band**. The tier
is measured against the leader (`lead - score <= SCORE_EPSILON`) rather than
pairwise, which is what makes it transitive by construction. A `structural`
hypothesis that scores clearly better still wins, and still does — the three
`dim string` probe scenarios keep `[thin-structure-excluded]` at IoU 99.7%,
byte-identical.

**Two detection checks moved, both verified by the orchestrator:**

| | before | after | |
|---|---|---|---|
| EF4 outer bbox IoU | 90.6% | **92.4%** | real gain — truth's left edge is 94, old code returned 109 and raised a spurious `thin-structure-excluded` |
| EF6 outer polygon IoU | 100.0% | **99.9%** | real loss — EF6's outer polygon truth is independently authored (round hand-measured coordinates), unlike its room rects |

`bench:scale`, `probe:exterior` and `probe:exterior draw` byte-identical.
Accepted: EF4's gain plus a genuine order-dependence fix outweighs EF6's 0.1pp.

Also fixed: `boundary.js:262`'s `ranked.find((c) => c.variant === 'all')` —
named `widest`, compared on `entry.area`, but returning the first in *rank*
order (a second, independent order-dependence; byte-identical on its own). And
`pipeline.js:213`'s comment promised `autoGarage: false` guarantees a clicked
garage is still detected — unkeepable, since it stops the carve but cannot
return a bay the winning candidate never enclosed.

Still open from A2:

- **The `structural` rescue is ungated** (`boundary.js:230-233`) — it runs
  unconditionally whenever a structural mask exists, while `span` immediately
  below it *is* gated. `candidates.js:227-229` describes the gate that should
  exist. Needs a new threshold.
- **The structural-with-garage footprint is geometrically degenerate** — two
  wall-width fingers, cleaned up only when they fall under `buildFloor`'s 3%
  filament-shave budget. Latent now, reachable whenever `structural` wins by
  more than the epsilon on a plan with a thin-line-bounded bay.

A3 also found that this document's own acceptance test for it is wrong: deleting
`public/tesseract/eng.traineddata.gz` produces an **unsettled promise and a hang**,
not an error toast. tesseract.js throws uncaught inside its own message handler,
so `bootEntry`'s rejection handler in `src/utils/dimensions/ocrTesseract.js:106-111`
never runs and `acquire` never resolves. Pre-existing, separate from A3, and
un-timeout-ed anywhere on that path.

### Wave B — after A (2 agents, parallel)

Integrated on `claude/remediation-wave-b`, PR #178 (stacked on #177). Gate at
that tip: lint 0 errors / 2 warnings, `npm test` **321 passed / 17 files**,
`bench:detection` **45/45 and byte-identical to the §1 baseline**, `bench:scale`
**14/14**, peak search-cache retention **114.1 MB → 51.9 MB**.

| ID | Task | Depends on | Files | Status |
|---|---|---|---|---|
| **B1** | One definition of "this room is non-GLA" | A4 (`App.jsx`) | `src/utils/dimensions/exteriorLabels.js`, `src/utils/detection/scale.js`, `src/App.jsx` | ✅ `88cc8de` |
| **B2** | Bound what the boundary search retains | A2 (deterministic pick) | `src/utils/detection/{cache,candidates,raster,index}.js`, `src/workers/detectionWorker.js`, `scripts/`, `package.json` | ✅ `0b138cc` |

**B1 met its own escalate condition and committed anyway**; the orchestrator
adjudicated and upheld it. ExampleFloorplan1's consensus error moves
+3.1% → +3.6% because GARAGE is now correctly dropped. That regression is an
artifact of the ~3% common-mode rectangle overshoot described in §0: overlaying
B1 onto the wall-face-seating branch gives **15.60 px/ft / +0.6% both with and
without the garage** — a perfect no-op. B1 also found the same centroid test a
second time in `scale.js`'s `labelSqFt` cross-check and fixed both.

**B2 deviated from the brief in three places, each measured.** The budget is
**32 MB, not 48** (at 48, EF3's 42.9 MB memo stays under and EF3 still retains
75.4 MB; 32 trips exactly the three heavy sheets and leaves the four normal ones
memoised). `Int16Array`, not `Uint16Array`, because `scoring.js:104` tests
`labels[...] >= 0`, which is unconditionally true for an unsigned array. And
B2b's `clearDetectionCache()` was wired into the **worker only** — nothing on the
main thread ever calls the pipeline cores, so the main-thread copy of `cache.js`
module state is permanently empty and a call in `terminateDetectionWorker` would
be a no-op twice over. A comment at `src/utils/detection/index.js:104` records
this so it is not re-added.

**Follow-up B2 surfaced and did not fix:** with the search memo forced entirely
off, the fixtures still retain 11.6–32.5 MB. That is `getCachedAnalysis`'s LRU
(`src/utils/detection/cache.js:10`, `MAX_ENTRIES = 4`), holding several
page-sized masks per image for up to four images with no size bound. It is now
the dominant retention, and it is why EF1 (50.3 MB) and EF7 (51.9 MB) sit just
above 50 even though their search memos are only 28.5 and 21.0 MB. Worth its own
task.

### Wave C — after B (2 agents, parallel)

Base is `16c0327` — Wave B plus the wall-face-seating commit (§0). Agents were
given **322 passed / 17 files, `bench:detection` 45/45, `bench:scale` 15/15** as
their baseline, not the §1 numbers.

Integrated on `claude/remediation-wave-c`. Gate at that tip: lint 0 errors /
2 warnings, `npm test` **331 passed / 18 files**, `bench:detection` **45/45**,
`bench:scale` **15/15**, and `bench:detection`, `bench:scale`, `probe:exterior`
and `probe:exterior draw` all **byte-identical to the Wave C base** once timings
are normalised. Wave C moved no geometry at all.

| ID | Task | Depends on | Files | Status |
|---|---|---|---|---|
| **C1** | Symmetric scale correction + extract the decision | B1 | `src/App.jsx`, `src/utils/detection/validate.js`, `src/utils/boundaryQuality.js`, new test | ✅ `202de1d` |
| **C2** | Tracer performance | B2 | `src/utils/detection/{candidates,boundary,index}.js` | ✅ `b2269c6` |

**C1 took the brief's preferred route on the layering wrinkle** — `resolveScaleUpdate`
takes `otherSamples` rather than `rooms`, so `validate.js` stays free of store
imports — and the extraction was *not* larger than the brief assumed:
`decideProjectScale` is untouched, no store restructuring, and `updateScale`
went from ~80 lines to 24. It reproduced the asymmetry first, against three
authoritative rooms at ~16 px/ft and a room implying 12: **drag #1 → 16 px/ft
`adopted: false`, drag #2 → 12 px/ft `adopted: true`.**

**C1 deviated once, into `boundaryQuality.js`, and it was necessary.** Writing
`source: 'auto'` on a non-adopted decision routes `scaleQualitySummary` into
`autoScaleSummary`, which knows nothing about `room-vs-project` and fell through
to the generic auto-consensus note — presenting the *rejected room's* gap as if
it were room-to-room spread. The guard dispatches on reason before source.
Verified by the orchestrator rather than accepted: `selectProjectScale`'s
top-level quality vocabulary is only `auto-consensus`, `area-implausible`,
`rooms-disagree` and `too-few-rooms`, so `ROOM_REASONS` provably cannot
intercept a genuine automatic path.

C1 found and did not fix: `handleInteriorWallToggle` (`src/App.jsx:695`) still
does not re-review the footprint, and provably need not — `tracedAreaPx` reads
`floor.outer.polygon`, which the toggle only selects for *display*, so the area
fed to `reviewAgainstFootprint` is toggle-invariant. It also notes the plain
scan-then-drag path may be unreachable, since `placeRoom` already passes
`pinned: true`; the `source: 'manual'`-on-rejection bug is still live on the
typed-dimension paths, which are unpinned by design and now symmetric.

**C2 landed all three changes and reports that change 2 is not the speedup this
plan expected it to be.** The old object-keyed memo was already invalidated only
when its net actually mutated, so it computed `netSelfSeals` exactly once per
version of each net — which is what the id-set key also does. Recomputation
count is unchanged. Its real value is that the memo no longer depends on someone
remembering to hand-invalidate a key whose object is mutated in place. **The
merge-loop cliff this task set out to remove is still there.**

C2 also landed a fourth pure saving inherited from the recovered WIP:
`netSelfSeals` no longer calls `footprintEntry`, which allocated a page-sized
component mask per candidate net so `sealMetrics` could read two scalars off it.
Verified identical by the orchestrator — `sealMetrics` reads only `.area` and
`.bboxArea`, and `footprintEntry` sets those to exactly `fp.largest.size` and
`bboxAreaOf(fp.largest.bbox)`.

Timings, 4 interleaved A/B rounds, median of 4 per arm: **−3.0% over the sum of
per-fixture medians**, every per-fixture delta inside a 4–22% within-arm spread.
Six of seven point the same way, which is weakly suggestive and no more. The
change is justified by the work removed, not by a wall-clock win these fixtures
can resolve. **This is the honest answer, and it is the reason C2's acceptance
was byte-identical output rather than a measured speedup.**

Still open from C2:

- **The real `netSelfSeals` cliff.** `boundary.js:43` calls `bridgeRuns` over
  the **whole page** for a net whose ink is confined to `net.bbox`, and
  `maskFor` allocates a full-page `Uint8Array` to feed it. Cropping both to the
  bbox looks identical for `bridgeRuns` alone, but `measureFootprint` re-crops
  to `inkBounds ± (radius+2)` and `closeRect`/`floodOutside` treat the array
  border as outside — so a naive pre-crop moves the border and is **not**
  provably identical without auditing those two border semantics. Needs
  `raster.js`, which was outside C2's file list.
- **`requestTimeout` is unverified by execution.** `index.js` is main-thread
  worker-wrapper code with no test coverage and no jsdom in the repo. The 120 s
  cap and the 2 s-per-label slope are judgement calls, read and linted only.

### Wave D — after C (3 agents, parallel)

Integrated on `claude/remediation-wave-d`. Gate at that tip: lint 0 errors /
2 warnings, `npm test` **350 passed / 21 files**, `bench:detection` **45/45**,
`bench:scale` **15/15**, `probe:exterior` and `probe:exterior draw`
**byte-identical to the Wave C tip**, `npm run build` clean.

| ID | Task | Depends on | Files | Status |
|---|---|---|---|---|
| **D1** | Cache identity that can't alias two images | B2 | `src/workers/detectionWorker.js`, `src/store/undoManager.js`, `src/utils/hash.js`, 3 new tests | ✅ `4fa6936` |
| **D2** | Autosave weight and the unload claim | A1 | `src/store/appStore.js`, `src/hooks/useAutosave.js` | ✅ `a7bcb9e` |
| **D3** | Remaining cleanup | C2 | `src/store/floorManager.js`, `src/utils/detection/boundary.js`, `CLAUDE.md`, new test | ✅ `94ad46f` |

**D1 did not stub the collision — it found one.** `src/utils/__tests__/collidingDataUrls.js`
holds two distinct, equal-length data URLs that genuinely collide under the
current `hashDataUrl` (both → `dafa84e7`), found by enumerating base64 bodies;
32 bits needs only ~50k candidates. Verified independently by the orchestrator.
Its tests fail against the pre-fix code with exactly the described symptom: undo
returns the wrong image, and the worker serves image A's pixels for image B.

Route chosen by measurement, not preference: full-string FNV costs **4.20 ms**
per `save()` on a 2 MB data URL, while `===` costs **0.00 ms** in the common
case (the store hands back the same reference) and **0.067 ms** against an
equal-but-distinct string. So verification is exact *and* ~60× cheaper.
Interning survives — 1 pool entry across 10 saves of an unchanged image,
asserted in a test, so no memory was traded for the correctness fix.

D1 also had to fix a second aliasing the brief did not name: `cacheKey` keys
`getCachedAnalysis`/`getSearchCache` too, so a shared key hands image B the
geometry computed for A even with the pixel cache fixed. It is now
`${hash}#${decodeCount}`, stable across requests for one image (which is what
makes N room clicks cost one trace) and distinct across images.

**D2 rejected both the brief's route and its documented fallback, and was
right.** It verified rather than reasoned:

- Dropping `tracedBoundaries` from `AUTOSAVE_FIELDS` is a real regression, as
  the brief predicted — and worse than stated, since the field is in
  `PERSISTENT_FLOOR_FIELDS` too, so reopening a `.floorplan` would become
  strictly better than restoring a draft.
- Dropping it from `SNAPSHOT_FIELDS` — **the documented fallback** — is not a
  silent no-op but a correctness bug. `handleTracePerimeter` (`src/App.jsx:665`)
  calls `undoManager.save()` *before* tracing, so undoing a trace would restore
  the old perimeter while leaving the **new** result in the store; the next wall
  mode toggle re-applies the geometry the user just undid, and the reported
  square footage changes. The crop path fails the other way.

Its third route keeps the field in both sets but stops *cloning* it:
`SNAPSHOT_FIELDS_NO_IMAGE` became `SNAPSHOT_CLONED_FIELDS` /
`SNAPSHOT_SHARED_FIELDS`, still derived from the single declaration. Safe
because `setTracedBoundaries` replaces wholesale and every reader is pure —
verified by the orchestrator, not just claimed. Debounced draft writes:
**2334.3 → 755.4 KB** (EF3), **1488.4 → 573.4 KB** (EF5), **736.1 → 203.0 KB**
(EF1); distinct `tracedBoundaries` objects across 50 snapshots **50 → 1**, and
that identity survives IndexedDB's structured clone.

**D3's `ctx.scale` item was display-only, and it proved it.** The value reaches
exactly one place — `scoring.js:239`, the `bridged-opening` detail — while the
confidence multiplier on the next line uses the raw `support.longestGap`. No
bench fixture exercises it (six of seven analyse at `scaleX = 1`, and the one
downscaled fixture emits no `bridged-opening`), so D3 forced downscales on the
synthetic scenarios: a 166 px opening was announced as **104 px** at 0.625, and
is now scale-invariant, with confidence bit-identical at every downscale. In
practice this bit any image over 1400 px on its long edge.

D3 deviated on item 3 because the brief's route crossed a file boundary:
`loadProject`/`restoreFromSaved` live in `appStore.js`, which D2 owned. Rather
than reach across, it deleted the module-level `nextTraceNumber` and derives the
name from the traces on hand — equivalent on every existing path, and
additionally correct after any project load.

Item 6 was a phantom: **there is no dead-export list** anywhere in `docs/` or
`CLAUDE.md`. D3 correctly did nothing rather than inventing one, and did not
"fix" the main-thread `clearDetectionCache` no-op that B2 documented.

### Optional, last

**E1** — collapse the lossy overlay adapter into a single `TraceResult` type the
store holds whole. Only worth doing after A1/A3/C1 have shown which fields
actually need to survive an edit.

**A1, A3 and C1 have now all landed, so E1 is unblocked** and the evidence it
was waiting for is in. What the four waves showed has to survive an edit:
`holes` and `quality` (A1), per-trace `confidence` and `warnings[]` for a single
floor (A3), and the `source`/`adopted` pair, which C1 showed is not one field
but two questions — *where did this scale come from* and *was this room's
correction taken* — conflated into one string. E1 should model those separately;
writing `source: 'manual'` to mean "a room was measured" regardless of whether
the measurement was used is precisely the bug C1 fixed.

### Waves A–D are complete

All eleven tasks landed, each on its own branch, each merged by the orchestrator
after an independent gate. Final state: lint 0 errors / 2 pre-existing warnings,
`npm test` **350 passed / 21 files** (from 293/14), `bench:detection` **45/45**,
`bench:scale` **15/15** (from 14/14), `npm run build` clean. Peak search-cache
retention 114.1 MB → 51.9 MB; debounced autosave writes down 62–72%.

Every wave's `bench:detection`, `bench:scale`, `probe:exterior` and
`probe:exterior draw` output was diffed in full against the previous wave's tip,
not just checked for a passing total. The only geometry that moved in the entire
programme was A2's two adjudicated checks (EF4 90.6% → 92.4%, EF6 100.0% →
99.9%) and the room rectangles moved by the wall-face-seating commit — both
argued on evidence other than the benchmark number.

---

## Task A1 — Preserve perimeter holes across an edit

**Severity: highest. This silently inflates the reported square footage.**

### Context

A traced floor carries `holes` — enclosed voids (courtyards, light wells) that
are subtracted from its area. `selectPerimeterOverlay`
(`src/store/appStore.js:491`) returns `{ vertices }` and nothing else. Every
perimeter edit path — vertex drag, vertex insert, right-click delete — routes
through it into `App.jsx`'s `updatePerimeterVertices` (line 842), which calls
`setPerimeterOverlay({ vertices })`.

In the store, `src/store/appStore.js:243` reads:

```js
holes: v?.holes ?? (v ? [] : t.holes ?? []),
```

With `v = { vertices }`, `v?.holes` is `undefined`, so it falls to the truthy
branch and writes `[]`. **Every hole is deleted the moment the user nudges a
corner**, and the void's area is silently added back into the total.

This was verified by running the real store under vitest: set a trace with one
courtyard, move one vertex the way `handleVertexDragEnd` does, and
`trace.holes.length` goes `1 → 0`.

Consumers were checked: `PerimeterLayer.jsx:406`, `PerimeterLayer.jsx:532` and
`LeftPanel.jsx:296` all read `trace.holes` off `perimeterTraces` directly, not
off the overlay. **No consumer changes are needed.**

### Changes

**1. `src/store/appStore.js:243`** — preserve unless explicitly supplied:

```js
// before
holes: v?.holes ?? (v ? [] : t.holes ?? []),

// after
holes: v ? ('holes' in v ? (v.holes ?? []) : (t.holes ?? [])) : [],
```

Add a short why-line above it explaining the deliberate asymmetry with the
`quality` line immediately below: a hand edit **clears** quality (the
detector's confidence no longer describes this geometry) but **keeps** holes
(they are independent rings the edit did not touch).

**2. `src/store/appStore.js:491` `selectPerimeterOverlay`** — stop dropping
data. Return `{ vertices, holes, quality }` and widen the memo key from
`active.vertices` alone to `activeTraceId + vertices + holes + quality`. No
current consumer needs the extra fields; the point is that a lossy adapter is
what made this bug reachable at all.

### New test — `src/store/__tests__/appStore.test.js`

Node environment, no new dependencies. Import `useAppStore` and
`calculateArea` and cover:

1. Set an overlay with a 100×100 outer ring and a 20×20 courtyard. Apply a
   vertex move as `setPerimeterOverlay({ vertices: moved })`. Assert
   `holes.length === 1` and that the computed area still excludes the void.
2. An explicit `setPerimeterOverlay({ vertices, holes: [] })` clears them.
3. `setPerimeterOverlay(null)` clears them.
4. A hand edit still nulls `quality` — guard the asymmetry so a later
   "simplification" cannot collapse the two branches.

### Acceptance

- All four tests pass and fail against the unmodified store (check by
  reverting the one-line change).
- `npm test` at 294+ passed, no previously-passing test broken.
- `npm run lint` still 0 errors.

### Verify

```bash
npm test
npm run lint
```

Manual sanity check with `npm run dev` is welcome but not required.

### Out of scope

Do not touch `App.jsx`, `PerimeterLayer.jsx` or `LeftPanel.jsx`. Do not change
what produces holes (`footprint.js`) or how they are rendered.

### Escalate if

Widening `selectPerimeterOverlay`'s memo causes visible re-render churn on the
canvas. If so, land change 1 only, add a comment on the selector documenting
that it is deliberately vertices-only, and report.

---

## Task A2 — Make candidate selection a total order

**The chosen footprint can currently depend on the order candidates were generated in.**

### Context

`pickCandidate` in `src/utils/detection/scoring.js:287` ranks every candidate
footprint; `ranked[0]` becomes the polygon the user is billed square footage
against. Its comparator is:

```js
const ranked = [...usable].sort((a, b) => {
  if (Math.abs(b.score - a.score) > 0.015) return b.score - a.score;
  if (a.radius !== b.radius) return a.radius - b.radius;
  return a.bridgedSpan - b.bridgedSpan;
});
```

This is intransitive. Three ladder rungs scoring 0.80 / 0.81 / 0.82 at radii
20 / 40 / 60 give `a < b` (tie, smaller radius), `b < c` (tie, smaller radius)
and `a > c` (0.02 clears the epsilon) — a cycle. `Array.prototype.sort` with an
inconsistent comparator has an implementation-defined result, so the winner can
depend on push order, which is controlled by which rescue hypotheses fired
(`src/utils/detection/boundary.js:230-246`). Score triples inside 0.02 across
adjacent rungs are the normal case for a closing ladder, not a corner case.

`traceBoundary` already took care to make floor *ordering* a valid total order
(see the row-grouping comment at `boundary.js:518`); the same hazard was
reintroduced in the selection that actually decides the answer.

### Changes

Replace the comparator with a precomputed sort key so the ordering is
transitive by construction:

```js
const SCORE_BUCKET = 0.015;
const ranked = usable
  .map((c) => [-Math.round(c.score / SCORE_BUCKET), c.radius, c.bridgedSpan, c])
  .sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  .map((e) => e[3]);
```

**This is not a pure refactor.** Bucketing differs from a pairwise epsilon at
bucket boundaries. It must be measured, not assumed.

### New test — in `src/utils/detection/__tests__/`

Construct the cycle above as three minimal candidate objects and assert:

1. the winner is identical for the array and for `array.reverse()`;
2. the comparator is transitive over the triple (sort three permutations, all
   give the same order).

### Acceptance

- `npm run bench:detection` reports **45/45** *and* the printed IoU on every
  check is unchanged from the baseline run. A 45/45 with a moved IoU means the
  pick changed and is **not** acceptance.
- `npm run probe:exterior` and `npm run probe:exterior draw` numbers unchanged.
- `npm test` green.

### Verify

```bash
npm run bench:detection > /tmp/bench-after.txt   # diff against a before-run
npm run probe:exterior
npm run probe:exterior draw
npm test
```

Capture a *before* run first — the IoU comparison is the whole verification.

### Fallback

If the bench moves, do **not** tune `SCORE_BUCKET` to restore it. Instead
implement the exact current semantics transitively: sort by score descending
only, then a second stable pass reordering within each contiguous ±0.015 run by
radius then `bridgedSpan`. More code, provably order-independent, zero
behaviour change. Report which route you took.

### Out of scope

Do not change scoring weights, `candidateConfidence`, or the rescue gates.

### Escalate if

The fallback also moves the bench — that would mean the current answer depends
on the intransitivity, which is a much bigger finding. Stop and report.

---

## Task A3 — Report OCR failure as failure; show trace quality for one floor

Two independent honesty fixes in different files.

### Context — part 1

`detectAllDimensions` in `src/utils/DimensionsOCR.js:231` ends:

```js
} catch (error) {
  console.error('DimensionsOCR error:', error);
  return { dimensions: [], exteriorLabels: [], detectedFormat: null };
}
```

Every failure — worker terminated mid-scan, WASM OOM, `traineddata` 404, a bug
in the merge — becomes an empty result. The `catch` in `App.jsx`'s
`handleManualMode` (line 447) is therefore dead code, and the user is shown
`No dimensions found — enter room size manually` as a **warning**, identical to
a clean scan of a plan that genuinely has no labels. Since the automatic-scale
feature now depends on label count, "OCR broke" and "this plan has no labels"
must be distinguishable.

### Context — part 2

`src/components/LeftPanel.jsx:265` gates the entire Perimeters section on
`perimeterTraces.length > 1`. That section contains the per-trace confidence
line — the thing that keeps a doubtful outline marked as doubtful *after* it is
on the canvas. For the common single-floor case the section is hidden entirely,
so a 55%-confidence trace is announced once in a toast and is then
indistinguishable from a 95% one forever. Scale quality *is* persistent (the
note under the Area figure); trace quality is not.

### Changes

**1. `src/utils/DimensionsOCR.js`** — remove the swallow and rethrow. Keep the
`console.error`. The caller side needs no change: `handleManualMode`'s existing
catch has the right wording ("Could not scan dimensions — enter room size
manually") and its own `placeCentredOverlay` fallback. Confirm `lastScan` is
not populated on the failure path (it is assigned after the `await`, so a throw
already skips it — verify, don't assume).

Check the other call sites: `useProjectIO` and `useDragAndDrop` both route
through `handleManualMode` and never call `detectAllDimensions` directly.
Confirm this still holds before landing.

**2. `src/components/LeftPanel.jsx:265`** — change the gate to
`perimeterTraces.some((t) => t.vertices?.length >= 3)`. Everything inside
already handles a single trace; only the gate assumes multi-floor. The "Add"
button's own `< 7` gate stays.

Run `npm run dev` and look at it. If a single-row list reads as noise, the
acceptable alternative is to leave the list gated and instead hoist a
confidence badge under the Area figure for the active trace — same outcome,
less chrome. Say which you chose and why.

### Acceptance

- Deleting `public/tesseract/eng.traineddata.gz` locally and scanning produces
  the **error** toast, not the "no dimensions found" warning. Restore the file
  afterwards.
- With one traced floor, its confidence and warnings are visible in the UI
  after the toast has gone.
- `npm test`, `npm run lint` green.

### Verify

```bash
npm test
npm run lint
npm run dev    # manual: both behaviours above
```

### Out of scope

Do not change the OCR pipeline itself (`src/utils/dimensions/`). Do not change
toast wording in `App.jsx`.

### Escalate if

Rethrowing surfaces a failure path that was being swallowed routinely (i.e. the
error toast fires on a normal scan). That would mean the pipeline throws in
ordinary operation and is a separate bug — report it rather than restoring the
swallow.

---

## Task A4 — User-facing text and input fixes

Three small independent fixes. Low risk, immediate user impact.

### 1. Literal escape sequences in two strings

`src/App.jsx:935` and `src/App.jsx:964` use `'\\u2026'` and `'\\u2014'` inside
**single-quoted** strings, so the backslash is literal. The spinner reads
`Finding room\u2026`, and the room-detection-failed warning — the one that
exists specifically so a failed detection is not silent — reads
`Could not find the room outline \u2014 drag the overlay…`.

Replace with the real characters `…` and `—`. A grep confirms these are the
only two occurrences in `src/`.

### 2. `Ctrl+R` hijacks browser reload

`src/hooks/useKeyboardShortcuts.js:74-78` intercepts `Ctrl/Cmd+R` and rotates
the canvas counter-clockwise, calling `preventDefault()`. That is the reload
shortcut on every platform. Bare `R` already rotates clockwise (line 64).

Remove the `Ctrl+R` binding, or move counter-clockwise to `Shift+R`. If you
move it, update `src/components/HelpModal.jsx`'s shortcut list to match.

### 3. `primaryWarning` returns the first warning, not the most important

`src/utils/boundaryQuality.js:27-33` is documented as "the single most
important reason to doubt this trace" but returns `pool[0]` — whatever
`boundary.js` happened to push first. It is the headline the user reads on a
doubtful trace.

Sort by a declared severity rank (`error` > `warn`, then a small explicit
ordering of codes by how much they should worry someone) before taking the
first. Keep the existing `info` filtering.

### Acceptance

- No `\u` escape survives in `src/` (`grep -rn '\\\\u[0-9a-f]\{4\}' src/`).
- `Ctrl+R` reloads the page in `npm run dev`.
- `primaryWarning` prefers an `error` over a `warn` regardless of push order —
  add a small unit test if `boundaryQuality.js` has none.
- `npm test`, `npm run lint` green.

### Verify

```bash
npm test
npm run lint
npm run dev    # manual: Ctrl+R reloads; spinner text reads correctly
```

### Out of scope

Do not restructure `useKeyboardShortcuts`. Do not change warning *text* in
`scoring.js`'s `WARNING_TEXT`.

---

## Task B1 — One definition of "this room is non-GLA"

**Depends on A4** (both touch `src/App.jsx`).

### Context

A garage, porch or patio is inside the drawing but is not living area. Three
places ask "is this room non-GLA?" and they do not agree.

The tracer's carve gets it right: `floodLabelledRegion`
(`src/utils/detection/nonGla.js:81`) floods outward from the label to the
enclosing cavity, deliberately so it does not depend on where the label sits.

The two places that decide whether a room feeds the **project scale** and the
**tracer's known-inside constraints** use a much weaker test:

- `src/utils/detection/scale.js:85` — `inRegion(centreOf(room.rect), region)`
- `src/App.jsx:52` — `centreInNonGla(r.rect)`

`region` here is `exteriorLabels[].bbox`, which is the OCR **text line box**
around the word "GARAGE" (`src/utils/dimensions/pipeline.js:491`) — roughly
90×18 px. So the test asks whether a 320×150 px garage rectangle's centroid
lands inside an 18-px-tall strip of text. On `fixtures/ExampleFloorplan.png`
the GARAGE rect is `[620, 596, 943, 743]`, centroid `(781, 670)`; whether it
passes depends entirely on where the name label sits relative to the dimension
label — the exact coupling `floodLabelledRegion` exists to avoid.

The commit message for `a568332` claims "non-GLA labels are dropped by
keyword". They are not — nothing compares the room's own label text against
`matchExteriorFeature`. When this misses, a garage joins the scale consensus
*and* is asserted as known-inside the very footprint it is being carved out of.

### Changes

**1. `src/utils/dimensions/exteriorLabels.js`** — add a shared predicate. This
file already owns the keyword vocabulary, is pure JS with no browser
dependency, and is therefore importable from `scaleBenchmark.mjs` under Node.

```js
export const roomIsNonGla = (room, labels = []) =>
  Boolean(matchExteriorFeature(room.labelId ?? room.name ?? ''))
  || labels.some((l) => rectsOverlap(l.bbox, room.rect));
```

Two independent tests, either sufficient:
- the room's **own label text** matches the keyword — catches
  `GARAGE 20'-7" x 9'-6"` read as one line;
- the name-label bbox **overlaps the room rect at all** — a name label sits
  inside the room it names, so any overlap is the signal. This replaces
  centroid-in-textbox.

Note the two rect conventions in play: `room.rect` is
`{left, right, top, bottom}`, label bboxes are `{x, y, width, height}`. Convert
explicitly; do not assume.

**2. `src/utils/detection/scale.js:85`** and **3. `src/App.jsx:52`** — use it.
Keep the existing `rejected: { reason: 'non-gla' }` bookkeeping in
`selectProjectScale` so the panel can still explain why a room was dropped.

### Acceptance

This **changes the scale selector's inputs**, so the benchmark is the
adjudicator, not a formality.

- `npm run bench:scale` — if any fixture's consensus error changes, judge the
  new number against that fixture's `truth.scale.pixelsPerFoot` and say in the
  commit message whether it improved. **Do not adjust a tolerance or a truth
  file.**
- `npm run bench:detection` — 45/45 with unchanged IoUs. `boundaryConstraints`
  feeds the tracer, so this can move.
- Unit tests for `roomIsNonGla`: keyword-in-label hit, bbox-overlap hit,
  a genuine bedroom whose label happens to sit near a porch label — miss.
- `npm test`, `npm run lint` green.

### Verify

```bash
npm run bench:scale
npm run bench:detection
npm test && npm run lint
```

### Out of scope

Do not touch `src/utils/detection/nonGla.js` — the carve is already correct.
Do not change the keyword regex.

### Escalate if

A fixture's scale error gets *worse*. That would mean a room currently
contributing usefully is being excluded, and the predicate needs narrowing —
report the fixture and the numbers rather than loosening the test.

---

## Task B2 — Bound what the boundary search retains

**Depends on A2.** Get the pick deterministic before changing what the cache holds.

### Context

Measured on this commit (Node, `--expose-gc`, `heapUsed + arrayBuffers`, four
GCs between samples):

| fixture | working raster | retained after one **cached** trace |
|---|---|---|
| ExampleFloorplan | 987×956 | **+112 MB** |
| ExampleFloorplan5 | 1199×1000 | **+112 MB** |
| ExampleFloorplan7 | 1017×1324 | +56 MB |

An **uncached** trace (`traceFloorplanBoundaryCore(imageData, {})`) retains
~0 MB. The same trace with a `cacheKey` retains 112 MB, and
`clearDetectionCache()` frees exactly that.

The browser worker always passes a `cacheKey`
(`src/workers/detectionWorker.js:55`), so this is the production path — and
`clearDetectionCache` is **exported from `src/utils/detection/cache.js` and
never called anywhere in `src/`**.

Cause: `footprintEntry` (`src/utils/detection/candidates.js:114`) retains, per
ladder rung, a page-sized `Int32Array labels` (~4.8 MB at 1200×1000) plus a
`Uint8Array mask`. The memo holds every rung of every policy of every network
for as long as the image is open, on top of the worker's retained
`lastImageData` and the main thread's undo image pool. At `maxDimension: 1400`
on a multi-plan sheet this is a plausible tab OOM on a mid-range laptop.

A cleaner fix was considered and rejected: storing per-rung descriptors and
re-deriving masks does not work, because consecutive rungs at increasing
closing radius produce genuinely different labelings — nothing can be shared
across the ladder, and re-deriving at score time defeats the memo entirely.

### Changes — in this order, each independently measurable

**B2a — land the measurement first.** Add `scripts/memoryProbe.mjs` and a
`"probe:memory"` script. Without it the rest is unfalsifiable, and every other
number in this repo is defended by a bench. Working script:

```js
import fs from 'node:fs';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { clearDetectionCache } from '../src/utils/detection/cache.js';

const png = PNG.sync.read(fs.readFileSync(process.argv[2]));
const imageData = { width: png.width, height: png.height, data: png.data };
const mb = (b) => (b / 1048576).toFixed(1);
const settle = () => {
  for (let i = 0; i < 4; i += 1) global.gc();
  const m = process.memoryUsage();
  return m.heapUsed + m.arrayBuffers;
};

const a = settle();
traceFloorplanBoundaryCore(imageData, {});
const b = settle();
traceFloorplanBoundaryCore(imageData, { cacheKey: 'k' });
const c = settle();
clearDetectionCache();
const d = settle();
console.log(`uncached retains  +${mb(b - a)} MB`);
console.log(`cached   retains  +${mb(c - b)} MB`);
console.log(`clearCache freed   ${mb(c - d)} MB`);
```

Requires `node --expose-gc`; wire that into the npm script. Iterate over
`fixtures/*.png` by default.

**B2b — wire up the dead cleanup.** Call `clearDetectionCache()` from
`terminateDetectionWorker` (`src/utils/detection/index.js:104`) and when the
worker's `lastImageKey` changes (`src/workers/detectionWorker.js:11`). Note
`index.js` runs on the main thread and `cache.js` state lives in the worker —
the call must be posted to the worker, not made locally. Check this carefully;
a same-thread call there is a no-op that looks like a fix.

**B2c — narrow the label array.** `measureFootprint`
(`src/utils/detection/candidates.js:87`) allocates
`new Int32Array(width * height).fill(-1)` per rung, for ids numbering in the
low hundreds. Check `labelComponents`' id range in
`src/utils/detection/raster.js`; if bounded, `Int16Array` halves the payload.
`Uint16Array` also works but needs a sentinel other than `-1` (use `0xFFFF`, or
offset ids by 1) — every `>= 0` and `=== -1` comparison downstream must be
updated together. Expected: **112 MB → ~60 MB.**

**B2d — give the memo a byte budget.** `getSearchCache`
(`src/utils/detection/cache.js:43`) caps at one image with no size bound. Track
approximate retained bytes as candidates are pushed and stop memoising past
~48 MB, returning a fresh `Map`. Trades a ~1 s cold re-trace for ~60 MB on
pathological plans (many networks × many rungs) and is a no-op on normal ones.

### Acceptance

- `npm run probe:memory` reports **< 50 MB retained** on ExampleFloorplan5.
- `npm run bench:detection` 45/45 with unchanged IoUs.
- Warm second-trace timing (baseline 106–306 ms depending on fixture) does not
  regress except on the budget-exceeded path, where a cold re-trace (~1 s) is
  the intended trade.
- `npm test`, `npm run lint` green.

### Verify

```bash
npm run probe:memory
npm run bench:detection
npm test && npm run lint
```

### Out of scope

Do not change the candidate generation policies, the closing ladder's radii, or
scoring. This task must not move a single traced polygon.

### Escalate if

B2c changes any IoU. A label-type change should be bit-identical; if it is not,
a `-1`/`>= 0` comparison was missed. Find it rather than reverting.

---

## Task C1 — Symmetric scale correction, and extract the decision

**Depends on B1.**

### Context

`updateScale` in `src/App.jsx:750` derives pinning from
`options.pinned || calibration.quality?.source === 'manual'` (line 768).

After an automatic scan the source is `'auto'`, so dragging the room overlay
runs **unpinned**: `decideProjectScale` sees ≥4 authoritative other-samples,
finds the corrected room >22% away, and keeps the pooled scale
(`adopted: false`). But `applyRoomCalibration` is still called with
`source: 'manual'` regardless of `adopted`. On the *next* drag `pinned` is now
true, `otherSamples` is `[]`, and the identical correction is adopted.

Same gesture, opposite outcome, one drag apart — and the rejected one is the
user's first attempt to fix the room the app got wrong, which is exactly when
they will try again with the same drag.

Separately, `reviewAgainstFootprint` (`src/hooks/useAutoScale.js:117`) bails
unless `source === 'auto'` and is only ever called once, inside `runAutoScale`.
A toolbar re-trace or an interior/exterior toggle changes the footprint without
ever revisiting the `area-implausible` verdict that footprint produced.

### Changes

**1.** `updateRoomOverlay` (`src/App.jsx:833`) passes `{ pinned: true }`.
Dragging the room overlay is a deliberate correction. The existing
`room-vs-auto` note (App.jsx:782-792) already handles pinned-with-disagreement
and states how far the area moved — it simply never fires on the drag that
matters.

**2.** Stop writing `source: 'manual'` when `decision.adopted === false`. Write
the source the decision actually reflects. This is the write that makes drag #2
differ from drag #1, and it also permanently disables the footprint
cross-check.

**3.** Call `reviewAgainstFootprint` from `runTrace`'s success path
(`src/App.jsx:613`), not only from inside `runAutoScale`. It is already guarded
on `source === 'auto'`, so re-entry is safe.

**4. The extraction, which is half the point of this task.** `updateScale` is
~80 lines inside `App.jsx` doing five things — pinning, decision, post-hoc
patch of the decision's level/reason, announce-or-not, and the store write —
and is untestable where it sits. Extract the decision half into a pure
`resolveScaleUpdate({ dims, overlay, rooms, calibration, pinned })` in
`src/utils/detection/validate.js`, leaving `App.jsx` with the store write and
the toast. That extraction is what lets the asymmetry be pinned by a test
rather than by argument.

### Acceptance

- New unit tests on `resolveScaleUpdate` covering: drag #1 vs drag #2 produce
  the **same** result for the same inputs; `adopted: false` does not write
  `source: 'manual'`; the `room-vs-auto` note fires with the area-percentage
  wording when a pinned room disagrees with ≥2 others.
- `npm run bench:scale` 14/14. **State explicitly in the commit message that
  the bench covers the automatic path only** — the interactive path is guarded
  by the new tests, nothing else.
- `npm test`, `npm run lint` green.

### Verify

```bash
npm test
npm run bench:scale
npm run lint
npm run dev   # manual: scan a fixture, drag the room overlay, confirm the
              # first drag is honoured and the note explains the area change
```

### Out of scope

Do not change `decideProjectScale`, `robustScale`, or `selectProjectScale`
semantics — only who calls them and with what `pinned`. Do not change the
tolerance constants.

### Escalate if

Making drag #1 pinned causes a fixture in `bench:scale` to move. It should not
— the bench does not exercise the interactive path — and if it does, the
extraction changed something it should not have.

---

## Task C2 — Tracer performance

**Depends on B2.** Pure performance; must not move a single polygon.

### Changes

**1. Hoist `inkBounds` out of the rung loop.** `measureFootprint`
(`src/utils/detection/candidates.js:58`) calls `inkBounds`, a full-raster scan,
on every call — but within one `climb` the mask does not change between rungs.
Compute it once per `climb` and pass it in.

**2. Memoise `netSelfSeals` on the id-set, not the object.**
`partitionWallNetworks` (`src/utils/detection/boundary.js:113-148`) caches
`independentOf` keyed by the net object, then does `cache.delete(a)` after
every merge, so the expensive `netSelfSeals` (a `bridgeRuns` +
`measureFootprint` over the **whole page**) is recomputed. The merge loop also
restarts from scratch on every merge. The `minMerge` gate saves this on clean
plans; a noisy scan with many mid-size components is a cliff. Key the memo on
the merged id-set so an unchanged net keeps its answer, and consider capping
the candidate set.

**3. Scale the worker timeout by label count.** `runWorkerRequest`
(`src/utils/detection/index.js:26`) uses a flat 30 s. `detectRoomsFromLabels`
is a single request covering every label on the page and is the one most likely
to trip it — and tripping it terminates the worker, discarding the analysis
cache, so the retry is a cold start. Scale the timeout with
`payload.labels?.length`.

### Acceptance

- `npm run bench:detection` 45/45 with **byte-identical** IoUs and areas.
- Per-fixture boundary timings improved or unchanged (the bench prints them).
- `npm test`, `npm run lint` green.

### Verify

```bash
npm run bench:detection   # diff full output against a before-run
npm run probe:exterior
npm test && npm run lint
```

### Out of scope

No behaviour changes. If a change is not provably output-identical, do not make
it in this task.

---

## Task D1 — Cache identity that can't alias two images

**Depends on B2** (both touch `src/workers/detectionWorker.js`).

### Context

`hashDataUrl` (`src/utils/hash.js:9`) is FNV-1a, 32-bit, over
`dataUrl.slice(0, 8192) + '|' + dataUrl.length`. It is used as **identity**, not
as a bucket key, in three places:

- the detection worker's decoded-`ImageData` cache
  (`src/workers/detectionWorker.js:11`) — a collision returns the **previous
  image's pixels** for the new image;
- `getCachedAnalysis` / `getSearchCache` keys — a collision returns another
  image's geometry;
- `undoManager`'s image intern pool (`src/store/undoManager.js:29`) — a
  collision restores the wrong image on undo.

Two images sharing an 8 KB prefix *and* a length is unlikely from a file
picker, but the eraser and crop tools generate data URLs from the **same
canvas** at the **same dimensions** via `toDataURL`, which is the one scenario
where the prefix has a real chance of matching. A 32-bit space also makes
birthday collisions plausible across the intern pool's lifetime. The failure
mode is silent geometry from the wrong drawing.

### Changes

**1. Worker.** Keep `lastImageUrl` beside `lastImageKey` and compare with
`===` before returning the cached `ImageData`. The OCR layer already does
exactly this and documents why (`src/utils/DimensionsOCR.js:190`).

**2. Intern pool.** Store `{ url }` and verify on resolve, or extend
`hashDataUrl` to sample prefix + suffix + length. Full-string FNV over a 2 MB
data URL is roughly 5–10 ms per `save()` — measure it before choosing, since
`save()` fires on every undoable user action.

Whatever you choose, keep `hashDataUrl`'s existing behaviour available for
callers that only need a bucket key, and document at the call site which
guarantee each one needs.

### Acceptance

- A synthetic test: two distinct data URLs engineered to collide under the
  current hash resolve to different images through both paths.
- `npm test`, `npm run lint` green.
- No measurable regression in `save()` cost (state the measurement).

---

## Task D2 — Autosave weight and the unload claim

**Depends on A1** (both touch `src/store/appStore.js`).

### Context

`saveAutosavedDraft` (`src/hooks/useAutosave.js:43`) serialises
`{ state, history: undoManager.getHistoryState() }` into IndexedDB after 2 s of
inactivity — up to 50 full working-state snapshots plus every interned image
data URL. `tracedBoundaries` (the entire detector result, every floor's
polygons) is in both `SNAPSHOT_FIELDS` and `AUTOSAVE_FIELDS`, so each snapshot
carries a copy.

Separately, `flushAutosaveNow` is registered on `beforeunload`
(`src/hooks/useAutosave.js:184`) but does async IndexedDB work. The transaction
will not reliably complete during unload, so the comment's guarantee
("accidental exits do not lose the most recent edits") holds only for the
`visibilitychange` / `pagehide` paths, and even then only if the browser grants
time. The real protection is the 2 s debounce.

### Changes

1. Drop `tracedBoundaries` from `AUTOSAVE_FIELDS`; evaluate dropping it from
   `SNAPSHOT_FIELDS` too. It is re-derivable, and its only readers
   (`handleInteriorWallToggle`, `applyTracedBoundary`) can re-trace. Check what
   breaks: toggling interior/exterior after a reload currently relies on it.
   If that regression is real, keep it in autosave but out of the 50 undo
   snapshots.
2. Persist `undoManager.getHistoryState()` on `pagehide` only, not on the 2 s
   debounce.
3. Correct the comment to state what actually protects the user.

### Acceptance

- Draft payload size measurably smaller (state before/after bytes for a
  fixture-sized project).
- Restore-from-draft still works, including the interior/exterior toggle after
  a reload — verify manually with `npm run dev`.
- `npm test`, `npm run lint` green.

---

## Task D3 — Remaining cleanup

**Depends on C2** (touches `src/utils/detection/boundary.js`).

Independent one-liners; land as one commit.

1. **`ctx.scale` is hardcoded to `1`** (`src/utils/detection/boundary.js:213`),
   so `candidateConfidence`'s `bridged-opening` detail reports working-scale px
   as if they were original-image px, and `boundaryQuality.js:19` renders that
   to the user as "a Npx opening was bridged". On a downscaled image the number
   is off by the downscale factor. Pass the real `analysis.scaleX`.
2. **`applyDetectedTraces` forces `visible: true`**
   (`src/store/floorManager.js:164`), overriding traces the user hid.
3. **`nextTraceNumber`** (`src/store/floorManager.js:22`) is module-level and
   reset only by `resetPerimeterTraces`. Reopening a project can start naming
   at "7th Floor". Reset it from `loadProject` / `restoreFromSaved`.
4. **`CLAUDE.md`** says drafts persist to localStorage; `draftStorage.js` is
   IndexedDB with a localStorage fallback. Fix the sentence.
5. **Indentation** at `src/utils/detection/boundary.js:466`.
6. ~~Consider removing `clearDetectionCache` from the dead-export list once B2b
   has wired it up — verify it is actually called.~~ **There is no dead-export
   list.** D3 grepped `docs/` and `CLAUDE.md` for one and found nothing; the
   only mentions are this item and B2's own result record. Nothing to do.

### Acceptance

`npm test`, `npm run lint`, `npm run bench:detection` 45/45 unchanged.

---

## 3. Effort and sequencing summary

| Wave | Tasks | Wall-clock with parallel agents |
|---|---|---|
| A | A1, A2, A3, A4 | ~2 h (A2 dominates — the bench cycle) |
| B | B1, B2 | ~4 h (B2 dominates) |
| C | C1, C2 | ~3 h (C1 dominates — the extraction) |
| D | D1, D2, D3 | ~2 h |

A1 is ready to execute immediately: the change is one expression, the failing
test is specified, and no other file is involved.

---

## 3a. Open findings — surfaced by the waves, deliberately not fixed

Every one of these was found by an agent that had a reason not to fix it inside
its own task. They are recorded here so the reasons do not have to be
rediscovered. Roughly in order of how much they matter.

| # | Finding | Where | Why it was left |
|---|---|---|---|
| 1 | **No term in `scoreCandidate` is sensitive to enclosed area disappearing relative to a sibling hypothesis.** `support.mean` is normalised by the candidate's *own* perimeter, so excising a region along drawn wall removes one weakly-drawn edge and adds twice the well-drawn cut line — amputation raises it **unconditionally**, for any region of any size, whenever the removed edge is below the current mean. Its intended counterweight `coverage` counts ink pixels, and a garage's own walls stay inside the fingers, so losing a 47,000 px bay (~17% of the floor) cost coverage 0.003. `seal` is 1.000 either way. | `scoring.js` | Fixing it means choosing a scoring formulation validated only against the benchmark — the trap this document exists to warn about. Needs its own task, with an adjudication method that is not the bench. |
| 2 | **OCR failure on a missing `traineddata` is an unsettled promise and a hang, not an error.** tesseract.js throws uncaught inside its own message handler, so `bootEntry`'s rejection handler never runs and `acquire` never resolves. Nothing on that path is timed out. | `src/utils/dimensions/ocrTesseract.js:106-111` | Pre-existing and separate from A3. It also means **this document's own acceptance test for A3 was wrong.** |
| 3 | ~~**`getCachedAnalysis`'s LRU is unbounded in bytes** (`MAX_ENTRIES = 4`), holding several page-sized masks per image for up to four images.~~ **DOWNGRADED — the "four images" premise is wrong.** `detectionWorker.js:26` calls `clearDetectionCache()` whenever the image URL changes, so **only one analysis is ever retained**; the LRU's other three slots cannot fill in the browser. The retention that was real has since been addressed by lazy SATs (T2‑11): the four coverage SATs were 16 B/px of a 24 B/px analysis entry with a single consumer (`growRoomRect`), and the two undirected smears they were built from had no readers at all. Worst-case `probe:memory` retention is now 43.2 MB, down from 51.9. | `src/utils/detection/cache.js:10` | Superseded. Keep only as a note that `MAX_ENTRIES = 4` is dead capacity in the browser. |
| 4 | ~~**The real `netSelfSeals` cliff is still there** … "potentially the single biggest detection win"~~ **RESOLVED, and the framing was wrong by ~4×.** Measured, cropping is worth **0.1–1.4% of a trace**, with a hard ceiling of 2.3% from the all-callers `bridgeRuns` profile share — `boundary.js:126` short-circuits small nets *before* calling `netSelfSeals`, and cropping does not remove `maskFor`'s cost because its loop already iterates only the bbox. The border-semantics audit turned out to be unnecessary: `netSelfSeals` now simply hands `measureFootprint` the `knownBounds` it already has (`bbox` *is* `inkBounds(bridged)` — `maskFor` measured it from those very pixels and `bridgeRuns` only fills gaps *between* existing runs), which skips a full-page `inkBounds` scan with no change to any window. The genuinely large item in this file was one expression no wave looked at: `Uint8Array.from(mask, fn)` in `applyRegions` (T1‑2), 65–101 ms per carving trace. | `boundary.js:48` | Done. |
| 5 | **`serializeSketch` keys exported images by raw `hashDataUrl`.** Two colliding images alias in the saved `.floorplan`, and `imageRef` can point at the wrong one on reopen — the same bug class D1 fixed in the other three places. | `src/utils/projectSerializer.js:274` | Outside D1's three files. The serializer should use the same intern discipline rather than the raw hash. |
| 6 | **The `structural` rescue is ungated** — it runs unconditionally whenever a structural mask exists, while `span` immediately below it *is* gated. `candidates.js:227-229` describes the gate that should exist. | `boundary.js:230-233` | Needs a new threshold, which is a tuning decision A2 was explicitly forbidden from making against the bench. |
| 7 | **The structural-with-garage footprint is geometrically degenerate** — two wall-width fingers tracing around the garage, cleaned up only when they fall under `buildFloor`'s 3% filament-shave budget. Latent now, reachable whenever `structural` wins by more than the epsilon on a plan with a thin-line-bounded bay. | `boundary.js` / `footprint.js` | Downstream of #6. |
| 8 | **`requestTimeout` is unverified by execution.** `index.js` is main-thread worker-wrapper code with no test coverage and no jsdom in the repo. The 120 s cap and 2 s-per-label slope are judgement calls, read and linted only. | `src/utils/detection/index.js` | No test harness exists for it. Would need jsdom or a worker stub. |
| 9 | `flushAutosaveNow` is still registered on `beforeunload`, where its async IndexedDB work will not reliably complete. Harmless and occasionally works; the comment is now honest about what actually protects the user (the 2 s debounce). | `src/hooks/useAutosave.js:189` | D2's brief did not ask for the listener to be removed. |

Two things checked and found **not** to be problems, recorded so they are not
re-investigated: `handleInteriorWallToggle` need not re-review the footprint
(`tracedAreaPx` reads `floor.outer.polygon`, which the toggle only selects for
*display*, so the area is toggle-invariant); and the main-thread
`clearDetectionCache` call is correctly absent, since nothing on the main thread
calls the pipeline cores.

---

## 4. The thread running through all of it

A1, A3, C1 and the `selectPerimeterOverlay` half of A1 are four instances of
one problem: **quality and geometry metadata is first-class inside the detection
pipeline and becomes lossy the moment it crosses into the store or the UI.**
The dropped holes, the hidden single-floor confidence, the swallowed OCR error,
and the `source: 'manual'` written even when the decision was not adopted are
all the same shape.

Task E1 — one `TraceResult` the store holds whole and the UI must read through
— is what stops a fifth instance appearing. It is worth more than any
individual fix above, and it should be done last, once A1/A3/C1 have shown
which fields actually need to survive an edit. Doing it first would be
guessing.
