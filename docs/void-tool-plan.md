# Void / hole punch tool — implementation plan

Punch a void out of a perimeter trace by hand: drag a rectangle (or place a
polygon) inside a closed outline and have it subtracted from the area.

## What already exists

Most of the pipe is laid. `holes[]` on a trace is:

- subtracted by `calculateArea` (`areaCalculator.js:18`) and therefore by both
  `selectCombinedArea` (`appStore.js:578`) and the centroid badge
  (`PerimeterLayer.jsx:531`);
- serialised (`projectSerializer.js:91`) and, being part of `perimeterTraces`,
  automatically snapshotted for undo, autosaved, and written to `.floorplan` —
  all three lists derive from one declaration in `appStore.js`, so no field
  plumbing is needed for this work;
- preserved across a vertex edit (`appStore.js:260`, and the tests at
  `store/__tests__/appStore.test.js:42`);
- produced by `footprint.js` for enclosed voids and mapped out through
  `pipeline.js` → `index.js` → `App.jsx:559`;
- **drawn** — `PerimeterLayer.jsx:402-426` renders each visible trace's holes as
  a dashed ring with a dark fill, and `LeftPanel.jsx:376` appends `−N void`.

So "the detector finds a hole and nothing shows it" is not the state of the
code. Two smaller display faults remain, both in `PerimeterLayer.jsx`:

1. The hole rings render **first**, before the inactive-trace fills
   (`:429`) and the active-trace fill (`:450`). Both fills are translucent and
   cover their own voids, so a void reads as slightly-darker floor rather than a
   subtraction.
2. Nothing states how much area a void removed. The badge shows net square
   footage with no accounting for the difference.

## The real defect this work has to fix

A hand-punched void would be silently destroyed by a re-trace:

- `App.jsx:557-571` builds `shaped[]` carrying `holes:` from the detector and
  calls `setPerimeterOverlay(shaped[0])`. `'holes' in v` is true, so
  `appStore.js:260` replaces.
- The multi-floor path, `floorManager.js:168`, spreads `...normalized[i]` over
  the existing trace — same replacement.
- Both are reached by the **interior/exterior wall toggle** (`App.jsx:635`),
  which is one click and does not look destructive.

Provenance is what makes this fixable, and it earns its place here rather than
only in `boundaryQuality.js` wording.

## Decisions

| | |
|---|---|
| Gesture | Rectangle drag first; click-by-click polygon second |
| Editing | Select + Delete. No vertex handles. Redraw to fix |
| Re-trace | `source: 'user'` holes survive; `source: 'auto'` holes are replaced |
| Storage | Tagged objects on the trace; bare rings stay bare inside the detector |

## Data model

Traces carry tagged holes:

```js
holes: [{ id: 'hole-…', ring: [{x, y}, …], source: 'auto' | 'user' }]
```

The detector is untouched. `footprint.js`, `polygon.js`, `nonGla.js` and
`validate.js` keep emitting and consuming bare `Point[]` rings; the tag is
applied at the one boundary where pipeline holes become trace holes
(`applyTracedBoundary`, `App.jsx:559`).

One normalizer absorbs the difference and keeps v1 `.floorplan` files loading:

```js
// areaCalculator.js — a hole is a ring or a tagged ring; every consumer of a
// trace's holes goes through here so the two shapes never diverge downstream.
export const holeRings = (holes) =>
  (holes ?? []).map((h) => (Array.isArray(h) ? h : h.ring));
```

Consumers to route through it: `calculateArea`, `PerimeterLayer`'s `holeRings`
computation, `LeftPanel`'s count. The zod schema becomes a union of the two
shapes so old files parse and new ones round-trip.

## Work items

Ordered so each step is independently shippable and the destructive-toggle bug
is closed before the tool that can trigger it exists.

### 1. Display fixes (independent of everything else)

`PerimeterLayer.jsx`. Move the hole-ring block after the trace outlines so a
void is not painted over by its own trace's fill. Add a small centroid label per
hole — `Void −38 sq ft` — using `polygonArea` scaled by `feetPerPixel` and the
existing `formatArea` / `measureSideLenWidth` helpers, gated on `feetPerPixel`
the same way the centroid badge is. This half stands alone and can land first.

### 2. Tagged holes + merge semantics

- `areaCalculator.js`: add `holeRings`, route `calculateArea` through it.
- `appStore.js`: add `mergeHoles(existing, incoming)` beside the existing
  `mergeRooms` (`:191`), with the rule stated once —

  > Replacing a trace's holes replaces what the detector found. A void the user
  > punched is their assertion about the building and outlives a re-trace.

  ```js
  const mergeHoles = (existing, incoming) =>
    [...(existing ?? []).filter((h) => h.source === 'user'), ...incoming];
  ```

- Apply it in `setPerimeterOverlay` (`appStore.js:260`) and
  `applyDetectedTraces` (`floorManager.js:168`).
- `App.jsx:559` tags detector holes `source: 'auto'`.
- `projectSerializer.js:91`: `holes` becomes
  `z.array(z.union([z.array(vertexSchema), z.object({ id, ring, source })]))`.
- Update `appStore.test.js:56` — "clears holes when explicitly supplied as
  empty" is now "clears auto holes and keeps user holes"; that is the semantic
  change, asserted deliberately.

### 3. Hole validation

New export in `geometryValidation.js` (its existing job is polygon invariants,
and it already owns `segmentsIntersect` and `hasSelfIntersection`):

```js
validateHoleRing(ring, outer, existingHoles) → { ok, reason }
```

Four checks, exact rather than sampled — these polygons have a handful of
vertices each:

1. `hasSelfIntersection(ring, true)` — the void itself must be simple.
2. Every vertex `pointInPolygon(v, outer, [])` — inside the outline.
3. No `segmentsIntersect` between any ring edge and any outer edge. **This is
   the check vertex containment alone misses**: a void spanning a concave notch
   can have every vertex inside and still cross the wall.
4. Against each existing hole: no edge crossing, and neither ring contains a
   vertex of the other.

`pointInPolygon` comes from `detection/polygon.js:329`. `CanvasStage.jsx:20`
already imports `resolveRoomScale` from `detection/validate.js`, so utils
reaching into detection has precedent; the import direction is safe —
`detection/validate.js` imports `geometryValidation.js`, but `polygon.js`
imports nothing from utils, so there is no cycle.

`validate.js`'s `sampledOverlap` is a grid sampler for whole floors and is the
wrong instrument here — not reused.

### 4. Store actions

`appStore.js`, next to the other trace mutators:

- `addHole(traceId, ring)` — tags `source: 'user'`, assigns an id, appends.
- `removeHole(traceId, holeId)`.

Both are called after `undoManager.save()` by the tool, matching how
`useDrawTool` (`useDrawTool.js:87`) commits.

### 5. The tool

- **State**: `voidToolActive` in `workingStateDefaults` (`appStore.js:14`).
  Snapshotted — follow `cropToolActive`/`eraserToolActive`, not the excluded
  `drawModeActive`.
- **Toggle**: `useToolManager.js` — add to `deactivateAll` and give it a
  `handleVoidToolToggle` in the same shape as `handleCropToolToggle`.
- **Hook**: `src/hooks/useVoidTool.js`, modelled on `useCropTool` — a
  mousedown/move/up drag producing a live rectangle, plus a click-to-place
  polygon path modelled on the `drawAreaActive` branch of
  `useToolRouter.handleStageClick` (`:563`). On commit: pick the target trace,
  validate, then `undoManager.save()` + `addHole`, or `toast.error` with the
  validation reason.
- **Target trace**: hit-test the candidate's centroid against every visible
  closed trace with `pointInPolygon`, preferring the active trace when more than
  one contains it. A void placed outside every outline is rejected with the
  reason rather than silently attached to the active trace.
- **Routing**: `useToolRouter.js` — a `voidToolActive` branch in
  `handleStageMouseDown` / `MouseMove` / `MouseUp` beside the crop branches, an
  `Escape` case that drops the in-progress shape then exits the tool (the
  two-stage pattern `drawModeActive` uses at `:691`), and an `Enter` case that
  closes a polygon in progress.
- **Selection + delete**: hole rings become `listening` when the tool is active;
  click selects (`selectedHole` state in the router, cleared on stage click like
  the measurement/shape indices at `:469`); Delete/Backspace calls `removeHole`
  from the existing `handleKeyDown` (`:674`).
- **Preview layer**: extend `PerimeterLayer` with the in-progress ring and the
  selected-hole highlight, drawn in the invalid colour (`#FF5555`, matching
  `isSelfIntersecting`) when the current candidate fails validation, so the
  rejection is visible before release.
- **Button**: `ToolsPanel.jsx`, gated on `hasArea` alongside Line/Area/Angle.
  `SquareDashedBottom` or `Scissors` from lucide.

### 6. Reporting

- `LeftPanel.jsx:376`: `−2 voids (1 yours)` when the sets are mixed, so a
  user-asserted subtraction is distinguishable from a guessed one.
- `boundaryQuality.js`: no new warning code. Provenance is consumed by the panel
  wording; the detector's `warnings[]` describes what the detector did, and a
  user void is not something it did.

## Tests

`src/utils/__tests__/` (vitest, no browser harness — the canvas interaction
needs manual `npm run dev` verification):

- `holeValidation.test.js` — the four rules, with the notch-spanning case that
  vertex containment alone passes, and hole-inside-hole both ways round.
- `appStore.test.js` — a user hole survives `setPerimeterOverlay` with detector
  holes; an auto hole does not; `holeRings` accepts both shapes.
- `floorManager.test.js` — same across `applyDetectedTraces`, in both the
  identity-preserved and rebuilt branches.
- `projectSerializer` round-trip of a mixed hole set, plus a v1 fixture with
  bare-ring holes still parsing.

`npm run bench:detection` is unaffected — nothing in `src/utils/detection/`
changes — but run it either side anyway, per CLAUDE.md.

## Out of scope

- **Vertex editing of an existing void.** Redraw instead.
- **Re-validating user voids against a new footprint after a re-trace.** A void
  kept from before could end up outside or straddling the new outline. Worth a
  follow-up: run `validateHoleRing` post-merge and warn (not drop). Not in this
  pass.
- **Voids in `innerHoles`.** The interior-wall mode uses the detector's inset
  hole set; a user ring is the same geometry in both modes and is simply carried
  across, not inset.
