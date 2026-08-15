# FloorTrace — warnings panel plan

> **Status: not implemented.** Design only; no implementation file has been modified. Written
> 2026-08-15 against `master` at `0870bdd`.

`quality.warnings[]` already travels from the detector to the store. It is surfaced as a `title=`
tooltip on one line of the traces list ([`LeftPanel.jsx:386`](../src/components/LeftPanel.jsx)) —
hover-only, unranked, unclickable, and truncated to whatever the browser decides to render. This plan
turns it into an inspectable list with click-to-highlight on canvas, so the confidence number becomes
something the user can act on rather than a verdict they can only accept or ignore.

## 1. What is there now

Three findings from tracing the path detector → worker → store → panel.

**Warnings survive the worker intact.** The `DEBUG_WHITELIST` at
[`detectionWorker.js:51`](../src/workers/detectionWorker.js) filters `data.debug` only —
`data.quality.warnings` crosses whole, and [`projectSerializer.js:82`](../src/utils/projectSerializer.js)
persists warning payloads as `detail: z.any()`. Anything added to a warning reaches the panel, and a
reopened project, for free. No transport work is needed at any phase of this plan.

**Validation warnings never reach a trace.** [`index.js:114`](../src/utils/detection/index.js)
(`getFloorBoundariesForMode`) copies `floor.warnings` only, and validate.js's output is merged in at
[`pipeline.js:144`](../src/utils/detection/pipeline.js) — *after* the per-floor split that
`applyTracedBoundary` reads. So `label-outside`, `self-intersecting`, `floors-overlap`, `covers-page`,
`no-inner` and `tiny-floor` exist only in the toast, and are gone the moment it is dismissed. The
current tooltip is structurally incapable of showing them. This is a bug in its own right, and it is
load-bearing for this feature: a panel built on the present routing would omit exactly the warnings
that matter most while looking authoritative.

**Almost no warning carries geometry.** `detail` holds scalars (`px`, `cover`, `spill`), a `floor`
index, or names. The floor index and the names are the two hooks a first implementation can pull on;
everything else needs the detector to record where it was.

## 2. Data model

One optional field on the warning object, plus a scope tag, in `warning()`
([`scoring.js:228`](../src/utils/detection/scoring.js)):

```js
{ code, severity, message, detail, scope: 'floor' | 'result', anchor: null }
```

`anchor` is `{kind: 'ring'|'rect'|'point'|'segment', …}` in **original image px** — never working-raster
px. The mapping happens once, in `pipeline.js`, beside `boundaryEntry`/`mapRings`, which is the only
place in the codebase that already owns the `scaleX`/`scaleY` transform.

Phase 1 leaves `anchor` null and derives anchors at render time from live store state. Phase 2 fills it
for the warnings that have no live equivalent to derive from.

## 3. Phase 0 — route the validation warnings (small)

In [`pipeline.js:144`](../src/utils/detection/pipeline.js), before `quality` is assembled: fan each
validation warning back onto the floor its `detail.floor` names, tagged `scope: 'floor'`.
`floors-overlap` goes onto both floors in `detail.floors`. Result-scoped warnings (`label-outside`,
`floors-rejected`, `no-alternative`, `no-boundary`) are tagged `scope: 'result'` and attached to every
floor as well as to the top level — with one floor, the common case, that is exactly right, and the
panel renders result-scoped warnings under a "this drawing" divider so a three-floor plan does not read
as three separate problems.

`quality.warnings` at the top level keeps today's contents unchanged, so `reportTrace`
([`App.jsx:580`](../src/App.jsx)) and every existing test are untouched.

**Tests.** One case asserting a self-intersecting floor's warning lands on that floor's `warnings`, and
one asserting a `label-outside` reaches all of them. Run `npm run bench:detection` and
`npm run probe:exterior` either side; the expected delta is zero, since nothing scoring-related moves.

## 4. Phase 1 — the panel and derived anchors (medium)

### 4.1 `src/utils/warningAnchors.js`

`resolveAnchor(warning, ctx)` where `ctx = {trace, rooms, detectedDimensions}`, returning an anchor in
image px or `null`. Anchors are derived at render time from live store state, and that is the point: a
crop, a rotate, or a hand-edited vertex cannot leave a stale anchor pointing at the wrong part of the
image, because there is nothing stored to go stale.

| Warning | Anchor |
| --- | --- |
| `room-outside` | the `rooms[]` rect matching `detail.name` |
| `label-outside` | the label points (see below) |
| `floors-overlap` | both floors' rings |
| `self-intersecting`, `covers-page`, `tiny-floor`, `no-inner`, `inner-not-nested`, `inner-over-inset`, `unsealed`, `weak-wall-support`, `incomplete-enclosure`, `wall-left-outside`, `annexation`, `heavy-closing` | the trace's own ring — these are whole-outline warnings, and the honest highlight is "this outline" |
| `bridged-opening`, `brush-mismatch`, `thin-structure-excluded`, `drawn-freehand`, `floors-rejected`, `no-alternative` | none in phase 1 |

One exception to "no detector changes in phase 1": matching `label-outside` by name against
`detectedDimensions` is ambiguous when two labels read `12 x 14`.
[`validate.js:139`](../src/utils/detection/validate.js) already holds the `outside` array in original
px, so adding `points: outside.slice(0, 8).map(({x, y}) => ({x, y}))` to the detail is a one-line,
geometry-inert change. Worth taking.

### 4.2 `boundaryQuality.js`

Export `detailText` (currently module-private), add `warningLabel(code)` for a short title-case headline
per code, and `rankedWarnings(warnings)` returning the sorted list with severity, label, detail and
scope. The existing `WARNING_RANK`/`severityRank` ordering is reused verbatim, and `primaryWarning`
becomes `rankedWarnings(...)[0]`, so the collapsed line and the expanded list can never disagree about
which warning is worst.

### 4.3 LeftPanel

The block at [`LeftPanel.jsx:385`](../src/components/LeftPanel.jsx) becomes a `<button aria-expanded>`
carrying the same text, with `title=` dropped. Expanded, it lists each warning: a severity dot
(red/amber/slate), the label, the detail line, and a target icon when an anchor resolves. Info-severity
warnings collapse behind "· 2 notes". A `good` trace that still has warnings gets a quiet notes
affordance rather than being hidden entirely, as it is today.

### 4.4 Store

Transient `focusedWarning: {traceId, index} | null` plus `setFocusedWarning`, excluded from
`SNAPSHOT_FIELDS` and `AUTOSAVE_FIELDS` alongside `cropToolActive`. Cleared on trace delete, on
re-trace, and on Escape in `useKeyboardShortcuts`.

### 4.5 `src/components/canvas/WarningHighlightLayer.jsx`

Rendered inside the content layer after `PerimeterLayer`, `listening={false}`, drawing the resolved
anchor: a dashed high-contrast stroke at `2 / scale` for rings and rects, a target ring for points,
matching the `strokeWidth={n / scale}` convention the sibling layers already use. No animation in v1.

### 4.6 Camera

An effect in `CanvasStage` on `focusedWarning`: compute the anchor bbox, test it against the current
viewport rect, and call `setViewportTransform` **only** if it is not fully visible with ~15% padding.
Zoom out to fit where needed; never zoom *in* past the current scale — the user has already framed the
plan, and the anchor may be a whole outline.

### 4.7 Tests

`warningAnchors.test.js`, including a guard that every code in `WARNING_RANK` either resolves an anchor
or appears in an explicit `UNANCHORED` set, so a warning added later cannot become silently
unclickable. A store test that `focusedWarning` stays out of snapshots. Manual verification via
`npm run dev`, per the repo's no-e2e convention.

## 5. Phase 2 — detector-emitted anchors (medium)

Fills `anchor` at emission, in working px, mapped once in `pipeline.js` via a `mapAnchor` helper
alongside `mapRings`:

- **`bridged-opening`** — the gap spans the closing ladder actually welded, recorded in `candidates.js`.
  The highest-value item here: "a 34px opening was bridged" is unactionable until the user can see where.
- **`weak-wall-support`** — runs of low `contourSupport` from `wallEvidence.js`, as polylines.
- **`annexation`** — the bbox of the candidate-minus-reference region.
- **`brush-mismatch`** — the miss/spill regions `regionFit` already computes.
- **`thin-structure-excluded`** — `floor.excludedRegions[].bbox` exists already in `boundary.js`; it
  needs mapping and forwarding, nothing more.

This phase touches `scoring.js`, `candidates.js` and `wallEvidence.js`, so `npm run bench:detection` and
`npm run probe:exterior` before and after are mandatory. `anchor` is promoted to a typed field in
`traceQualitySchema` rather than riding inside `detail: z.any()` — the repo's rule is that a quality
signal is never allowed to be dropped silently on the way to the UI, and an untyped field is one schema
tightening away from being dropped.

## 6. Known limits

- Phase 0 changes what the panel reports for existing autosaved drafts only after a re-trace. Warnings
  are not recomputed retroactively for a stored trace.
- The whole-outline anchors in §4.1 are a weak highlight: honest, but they do not point at anything in
  particular. If that reads as noise in practice, the fix is phase 2 for those codes, not a different
  phase 1.
- `label-outside` is deliberately gentler for `source: 'drawn'` traces
  ([`validate.js:134`](../src/utils/detection/validate.js)). The panel must keep showing it as a warning
  rather than an error there — a label outside a hand-drawn outline is usually a deliberate exclusion.

## 7. Decisions taken

Recorded so a later reader does not re-litigate them:

- **Phased over full.** Ship the panel on anchors derivable with no detector change, then add
  detector-emitted anchors. Keeps bench risk out of the UI work.
- **Fix the validation routing here**, not as a follow-up — the panel is wrong without it.
- **Inline expander on the trace row**, not a separate aggregated issues section. The warnings stay
  attached to the trace they describe, which is what makes them navigable on a multi-floor plan.
- **Highlight always; move the camera only when the anchor is off-screen.** Always-zoom yanks the view
  around on a plan the user has already positioned.
