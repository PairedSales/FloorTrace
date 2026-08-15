# Two-point scale calibration — implementation plan

Drag a line along a printed scale bar, or along a wall whose length you know,
type the true length, and that becomes the project scale.

## What already exists

Calibration is a solved problem in this codebase for one input shape: **a
labelled rectangle**. Two gestures produce one, and both end at the same store
write.

- The scan (`App.jsx:838` → `useAutoScale.measureAndCalibrate`) measures every
  OCR'd label, pools the rooms that agree via `robustScale`, and writes the
  median.
- A room gesture — clicking a dimension pill (`App.jsx:969`) or dragging the
  overlay (`App.jsx:793`) — goes through `updateScale` (`App.jsx:759`) →
  `resolveScaleUpdate` (`validate.js:313`), which orients the label to the
  rectangle, resolves the two axes against each other, and decides whether this
  room outvotes the pool.

Both write through `applyRoomCalibration` (`appStore.js:283`), the only writer,
which throws unless the caller passes `mutationSource === 'room-calibration'`.

So the backlog's "no path to a scale at all" is slightly too strong, and the
correction matters for what this feature has to be. There *is* a manual path:
`manualEntryMode` + `handleCanvasClick` (`App.jsx:983`). It requires the user to
type a room's **width and height**, click inside that room, and then — when
`detectRoomFromClick` finds nothing, which is the normal outcome on a scan or a
photo — drag a 200×200 px placeholder box onto the room by eye
(`App.jsx:912-919`). The scale is then whatever that hand-dragged rectangle
implies.

What is missing is not the plumbing. It is a calibrating gesture that does not
require a rectangle: **one length, asserted directly**.

### The provenance field that is actually read

`calibration.source` is written as the constant `'room-calibration'`
(`appStore.js:309`) and is read **nowhere**. The provenance that drives
behaviour is `calibration.quality.source` (`'auto' | 'manual'`), read in three
places:

- `validate.js:330` — `isPinned`, which decides whether the room pool gets a
  vote against the user's own gesture;
- `useAutoScale.js:121` — the footprint cross-check only revisits an automatic
  scale;
- `boundaryQuality.js:143` — which wording the Area panel uses.

A plan that only adds `calibration.source = 'line-calibration'` therefore
changes nothing about how the app behaves. Both fields have to move, and the
second one is the load-bearing half.

## Decisions

| | |
|---|---|
| Gesture | Two clicks, preview between them — the Line tool's interaction |
| Availability | Gated on `image`, never on `hasArea` — see below |
| Tool identity | Its own tool, not a mode on the Line tool |
| Length entry | A Scale section in `LeftPanel`, reusing the Room Size inputs |
| One line | Isotropic (`sx = sy`), and the UI says so |
| Two perpendicular axis lines | Per-axis, with `scaleIsotropy` grading the gap |
| Second parallel/diagonal line | Supersedes, isotropically; reports what moved |
| Precedence | A hand-set scale outranks every automatic write |

**Availability is the reason this is a separate tool.** The Line/Area/Angle
group is gated on `hasArea` (`ToolsPanel.jsx:48`, fed `area > 0` at
`App.jsx:1241`), which is false at exactly the moment calibration is needed. Its
label rendering also assumes a scale exists — `feetPerPixel` defaults to
`{x: 1, y: 1}`, so an uncalibrated measurement line reads a confident `215.3 ft`
(`canvasUtils.js:74-82`). The scale line's preview must show **pixels** until a
scale exists, and that is a different renderer branch, not a different gate.

What is genuinely shared is the geometry and the drawing:
`getMeasurementLineLayout` renders both, and the two-click-plus-preview routing
is a ~15-line branch in `useToolRouter` that is cheaper to write twice than to
parameterise.

## One line, one axis

A line from A to B with asserted true length `L` gives exactly one equation:

```
L² = (Δx·sx)² + (Δy·sy)²
```

One equation, two unknowns. Three cases follow, and they are the whole design:

1. **One line, any angle.** Solvable only under `sx = sy`, giving
   `s = L / hypot(Δx, Δy)`. A diagonal line admits no other reading at all.
2. **One near-horizontal and one near-vertical line.** `sx = Lx / |Δx|` and
   `sy = Ly / |Δy|`, each independently determined.
3. **Anything else** (a second parallel line, a second diagonal) is a fresh
   isotropic assertion that supersedes the first, not a new axis.

"Near-axis" is within 5° of horizontal or vertical. The error that admits is
worth writing down rather than hiding: a line 5° off axis, read as an axis
length, is `1/cos(5°) = 0.4%` long. At 10° it is 1.5%. Five degrees keeps the
misclassification cost below the noise in everything else here.

### Why per-axis output is safe, and why it barely matters

Every display path already handles `{x, y}` correctly — `calculateArea`
(`areaCalculator.js:30-32`), `calculatePerimeter`, `getMeasurementLineLayout`,
and the side-length labels at `PerimeterLayer.jsx:183`. Emitting two scalars
breaks nothing.

More usefully: **area is exactly linear in `sx·sy`**, so collapsing two scalars
to their geometric mean `√(sx·sy)` leaves every reported area *unchanged*. It
only changes side lengths. That is why `resolveRoomScale:228` can collapse an
anisotropic room to one scalar without moving the number the user acts on, and
it is why this decision is low-stakes in the direction that matters.

The two cases then split cleanly:

- Two lines agreeing within `ISOTROPY_TOLERANCE` (`validate.js:155`, 5%) →
  collapse to the geometric mean, exactly as `resolveRoomScale` does. The second
  line's real value here is that it is the **only** available cross-check on a
  hand-set scale.
- Two lines disagreeing by more → keep both. `validate.js:211-220` states this
  codebase's position that "a plan is drawn at one scale, so a disagreement is
  measurement error and not anisotropic pixels", and that is right for one room
  rectangle measured against one printed label. It is not right for two
  deliberate perpendicular assertions by the user on a listing photo that was
  resized non-proportionally, which is precisely the population this feature
  serves. Keep both scalars, and warn — the warning is what makes the choice
  honest either way.

## Data model

Three new fields in `workingStateDefaults` (`appStore.js:14`):

```js
scaleToolActive: false,
// The lines the scale was asserted from, in original image px. Kept rather
// than just their result: a hand-set scale must stay inspectable and
// re-editable, and a second line has to be scored against the first.
scaleLines: [],          // [{ id, start, end, feet, axis: 'x'|'y'|'diagonal' }]
currentScaleLine: null,  // in progress
```

`feet` is always decimal feet, matching `roomDimensions`; the unit toggle is a
display concern and is handled at the input, not in storage.

The three projections fall out of that one declaration, which is the point of
the design at `appStore.js:92/134/156` — but two exclusion lists need entries,
following exactly what `lineToolActive` and `currentMeasurementLine` do:

- `EXCLUDED_PERSISTENT_FIELDS` (`:156`) gains `scaleToolActive` and
  `currentScaleLine`. `scaleLines` is **not** excluded — it is document content.
- `EXCLUDED_SNAPSHOT_FIELDS` (`:92`) gains nothing. Follow `cropToolActive` and
  `eraserToolActive`, which are snapshotted; only `angleToolActive` and
  `drawModeActive` are not.

`calibration` is already a snapshot field, so undo restores the previous scale
for free — provided the tool calls `undoManager.save()` before writing, which is
this codebase's convention, not automatic behaviour.

`projectSerializer.js`: a `scaleLineSchema` beside `measurementLineSchema`
(`:111`) and a `scaleLines` entry in `floorStateSchema` (`:169`).
`calibrationSchema` (`:49`) needs nothing — `source` is already
`z.string().nullable().optional()` — but `scaleQualitySchema` gains the new
`quality` members so a reopened project keeps its reason to doubt, which is the
one direction that file must never fail in.

### Image edits do not invalidate a scale line

`useCropTool.js:112-119` keeps the canvas at full size and redraws the selection
**in place**, white-filling outside it. Crop and erase therefore both preserve
image-pixel coordinates, and neither resamples, so feet-per-pixel is invariant
across both. `scaleLines` and `calibration` survive `handleImageUpdate`
(`App.jsx:720`) untouched — deliberately unlike `rooms`, which it clears. State
this in a comment at the clear site so nobody adds a defensive reset later.

## Precedence

This is the correctness core, and the failure it prevents is the one this
codebase keeps re-learning: a user's explicit assertion silently replaced by an
automatic one.

| Event | Effect on a hand-set scale |
|---|---|
| Re-scan → `measureAndCalibrate` | **Does not overwrite.** Records the disagreement |
| Footprint review → `reviewAgainstFootprint` | Already gated on `source === 'auto'` (`useAutoScale.js:121`) — no change |
| Dimension pill / overlay drag → `updateScale` | Overwrites. Explicit gesture, most recent wins; the panel then says the scale came from a room |
| A second scale line | Supersedes, per the three cases above |
| Undo | Restores — `calibration` and `scaleLines` are both snapshot fields |

Two edits implement it:

- `useAutoScale.applyDecision` (`:30`) returns early when the calibration in
  force is user-asserted. Put the guard there, not at the two call sites, so
  `measureAndCalibrate` and `reviewAgainstFootprint` cannot diverge.
- `validate.js:330`'s `isPinned` currently reads `=== 'manual'`. Widen it to a
  `PINNED_SOURCES` set including `'line'`. No caller today reaches it with
  `pinned: false` after a line calibration, so this changes no behaviour now —
  it stops the next caller that does from handing the scale back to the pool the
  user overruled.

## Work items

Ordered so each step is independently shippable and the precedence guard lands
before the tool that can trigger it exists.

### 1. Make `calibration.source` real (no UI)

`appStore.js:283`. Replace the string equality guard with an allowlist and
derive `source` from it instead of hardcoding:

```js
const CALIBRATION_SOURCES = new Set(['room-calibration', 'line-calibration']);
```

The guard's purpose — no accidental scale writes from unrelated setters — is
preserved; the constant that was pretending to be provenance stops pretending.
Everything else in this step is a rename.

### 2. Precedence guard

The two edits above, plus a pure predicate they share so it is unit-testable
without a hook:

```js
// validate.js — a scale the user asserted outranks anything the app measured.
export const isUserAsserted = (calibration) =>
  calibration?.quality?.source === 'line' || calibration?.quality?.source === 'manual';
```

Ships before the tool exists and is inert until it does.

### 3. The resolver

`src/utils/detection/validate.js`, beside `scaleIsotropy` and
`resolveRoomScale`. It goes here rather than in a new `utils/scaleLine.js`
because the "one scalar or two" question is already answered here, and two files
answering it differently is the drift this repo's own comments keep flagging
(`ROBUST_KEEP_WINDOW`, `PLAN_SPREAD_TOLERANCE`). `CanvasStage.jsx:20` already
imports from this module, so the UI → detection direction has precedent.

```js
resolveLineScale({ lines, roomSamples = [] }) → { scale: {x, y}, quality, changed }
```

Same return shape as `resolveScaleUpdate`, so `App.jsx`'s write site is a near
copy of `updateScale`. Inside:

- classify each line by angle (5°), keep the most recent per axis. Two
  hand-drawn lines are not a sample set — `robustScale` exists because the *app*
  measured those rooms, and pooling two deliberate user assertions with a median
  would be theatre.
- resolve per the three cases; `scaleIsotropy(sx, sy)` grades the two-line case.
- reject `feet <= 0` and zero-length lines by returning `null`, matching
  `resolveScaleUpdate:316`.

Quality:

```js
{ level, reason, disagreement, adopted: true, source: 'line',
  lineCount, lengthPx, feet, axes }
```

with three reasons:

- `scale-anisotropic` — the two lines are more than 5% apart.
- `short-line` — click precision is ~2 image px, so a 40 px line carries ±5%
  into the scale and a 400 px line carries ±0.5%. Warn below
  `MIN_CONFIDENT_SCALE_LINE_PX = 100` (±2%), and say the number rather than
  just flagging it. Zooming in before clicking genuinely improves this, so the
  threshold is a floor, not a measurement.
- `line-vs-rooms` — when `rooms[]` is non-empty, compare against `robustScale`
  of the same sample pool `roomScaleHint` uses (`App.jsx:80-90`) and report the
  gap. Reported, never applied.

`disagreement` is a log distance in all three, the unit `percentApart`
(`boundaryQuality.js:74`) already expects.

### 4. Store + tool plumbing

- `appStore.js:351`: `setScaleToolActive`, `setCurrentScaleLine`,
  `setScaleLines`, `addScaleLine`, `removeScaleLine`, beside the line-tool
  setters.
- `useToolManager.js`: a `handleScaleToolToggle` shaped like
  `handleLineToolToggle` (`:74`), and `scaleToolActive` added to both
  `deactivateAll`'s body **and** its `undoManager.save()` condition at `:46` —
  omitting the second means switching from Scale to another tool does not
  snapshot.
- `useToolRouter.js`: a click branch beside `:549`, a preview branch beside
  `:290`, a double-click commit beside `:614`, an `Escape` case at `:699`, and
  `Delete` on a selected scale line at `:674`.
- Snapping: reuse `findVertexSnapPoint` (`useSnappingSystem.js:148`) when
  `autoSnapEnabled`, as the perimeter vertex path does at
  `useToolRouter.js:518`, with Shift to bypass (the room-drag convention at
  `:253`). It is corner snapping, which is what "click both ends of this wall"
  wants; it returns null when it finds nothing, so a printed scale bar with no
  corners degrades to a raw click rather than fighting the user. The wall-face
  engine (`wallSnapEngine.js:30`) snaps an *edge* against a span and does not
  fit a bare point — not reused.

### 5. Rendering and entry

- A `ScaleLineLayer`, or a branch in `MeasurementLayer` — either way it calls
  `getMeasurementLineLayout` and adds one thing: when `!calibration.calibrated`,
  the label is `N px`, not a length in feet.
- `LeftPanel`: a **Scale** section, visible when `scaleLines.length` or
  `calibration.calibrated`. It holds the length input (reusing `InchesInput` for
  `unit === 'inches'` and the same `metersToFeet` conversion the Room Size
  fields use at `:89`, so one unit vocabulary), the resulting `px/ft`, and a
  Clear. This is why no canvas-anchored input is needed: the parsing, the
  formatting and the unit toggle already exist here.
- Commit on Enter or blur: `undoManager.save()`, then `applyRoomCalibration(...,
  'line-calibration', quality)`.
- `ToolsPanel.jsx`: a Scale button in the **ungated** group with
  Outline/Rotate/Crop/Eraser — not inside the `hasArea` block. `Ruler` is taken
  by Line; `Scaling` or `Diameter` from lucide.
- `App.jsx:257-349`: an eighth instruction toast (`scale-tool-toast`), added to
  the effect's dependency array *and* its cleanup list.

### 6. Wording

`scaleQualitySummary` (`boundaryQuality.js:138`) needs a `source === 'line'`
branch placed **before** the `quality.level === 'ok' || !quality.reason → null`
early return at `:146`. A clean line calibration has no reason, so without that
ordering it renders nothing — and that panel line is the only durable statement
of where the number came from once the toast has gone. A hand-set scale that
looks identical to an OCR-set one is the same class of failure as a doubtful
trace that looks green.

Four messages, each saying what it means for the area rather than describing the
geometry, per the convention at `:71-73`:

- clean — `Scale set by hand` / "The scale comes from a 24 ft line you drew,
  applied to both directions."
- `scale-anisotropic` — `Across and down differ by ~7%` / "Your two lines say
  the drawing is about 7% more stretched across than down. Both are in use, so
  areas are unaffected — only side lengths follow the direction they run."
- `line-vs-rooms` — reuse the `room-vs-auto` shape at `:153`, which already
  converts a scale gap to its area consequence by doubling the log distance.
- `short-line` — "The line is only 60 px long, so a pixel of click error is
  about 3%. Draw it along the longest wall you can identify, or zoom in first."

## Tests

`src/utils/detection/__tests__/scaleLine.test.js` (vitest; the canvas
interaction has no harness and needs `npm run dev`):

- axis classification either side of 5°, and that a 5° line read as an axis
  length lands within 0.4%;
- one diagonal line → `sx === sy`;
- two perpendicular lines inside tolerance → geometric mean, **and `sx * sy`
  unchanged from the raw pair**, which is the area-invariance the design rests
  on;
- outside tolerance → two scalars plus `scale-anisotropic`;
- a second parallel line supersedes rather than adding an axis;
- `short-line` at the threshold; `feet <= 0` and zero-length → `null`.

`src/store/__tests__/appStore.test.js`:

- `applyRoomCalibration` accepts `'line-calibration'`, still throws on anything
  outside the allowlist, and writes `source` from the argument;
- `scaleLines` survives a snapshot/undo round-trip.

`src/utils/detection/__tests__/` — `isUserAsserted` gates the auto path: this is
the regression that matters most, and it is testable as a pure predicate
precisely so it does not need the hook.

`src/utils/__tests__/projectSerializer.test.js` — round-trip a line calibration
with its `scaleLines`; a file without them still parses.

`npm run bench:detection` and `npm run bench:scale` are both unaffected —
nothing in the detector's path changes — but run both either side anyway;
`bench:scale` is a CI gate (`.github/workflows/deploy.yml`) and it is the one
people forget.

Manual verification: a fixture with readable text (calibrate by line, re-scan,
confirm the hand-set scale survives and the disagreement is stated), and a
text-free image (the actual target case — the fixtures set has none, so this one
is by hand).

## Out of scope

- **Reading a printed scale bar automatically** — OCR of `1/4" = 1'-0"`, or
  measuring a graphic bar's ticks. This tool is the manual half of that, and the
  obvious follow-up.
- **Perspective correction.** Two axis lines buy a uniformly stretched raster
  and nothing more; a photographed page needs a homography and four points.
- **Per-floor scales.** `floorManager` shares one calibration across traces by
  design.
- **Pooling many lines.** Superseding is correct for a handful of deliberate
  assertions; `robustScale` is for measurements the app made.
