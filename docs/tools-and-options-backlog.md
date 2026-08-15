1. **Trace types with broken-out totals — M.**
   Give each trace a type (GLA / below-grade / garage / porch / unfinished) and
   break the totals out by type. `floorsInTotal` currently sums every visible
   trace into a single number
   ([LeftPanel.jsx:110](../src/components/LeftPanel.jsx:110)), so a user tracing
   a house *and* its garage gets one figure they have to mentally unpick. Typed
   traces are what make the output droppable into a report without hand-sorting.
   This is the ANSI Z765 shape without claiming compliance — worth stating that
   distinction in the UI copy rather than implying certification. Touches a field
   on the trace in `floorManager.js`, the `.floorplan` projection,
   `selectCombinedArea`, and the Perimeters list (per-trace colour already exists
   and can be driven by type).

2. **Warnings panel — S.**
   `quality.warnings[]` is carried all the way into the store and surfaced as a
   `title=` tooltip on one line of the traces list
   ([LeftPanel.jsx:386](../src/components/LeftPanel.jsx:386)). An inspectable
   list with click-to-highlight on canvas makes the confidence number actionable.
   `boundaryQuality.js` already ranks warnings by severity.

3. **Room labels on canvas — M.**
   Place text like `Bedroom · 12'×14' · 168 sf`, positioned automatically from
   `rooms[]` where available. Turns the app from an area calculator into a sketch
   someone can hand to a client. The data already exists for every room the
   detector has placed.

4. **Visible undo/redo buttons — S.**
   The keybindings and the mouse-side-button handlers exist in
   [useKeyboardShortcuts.js](../src/hooks/useKeyboardShortcuts.js); the on-screen
   affordance does not.

5. **Canvas keyboard shortcuts — S.**
   `Esc` cancels the active tool, `Space` to pan, `F` to fit, `1`–`7` to switch
   tools or floors, `Delete` on a selected vertex.

6. **Copy-all summary — S.**
   Every trace, its type and its area to the clipboard in one action, next to the
   existing double-click-to-copy on the area box.

7. **Layer visibility toggles — S–M.**
   Dimension labels, room rectangles, holes, measurement lines, and the
   wall/boundary mask as a debug underlay. `showSideLengths` is the only
   visibility toggle today. The worker already forwards a whitelist of debug
   fields; showing the evidence is how a user understands *why* a trace went
   wrong instead of just being told it is doubtful.

8. **Snap controls — S.**
   Radius/strength, and what it snaps to (wall face / vertex / grid /
   orthogonal), plus `Shift` to constrain to 90°/45° while dragging and `Alt` to
   subtract. Auto Snap is one boolean today.

9. **Orthogonalize on commit, with a tolerance — S.**
   Force rectilinear, which most plans actually are, and which `polygon.js`
   already fits toward.

10. **Rounding and precision — S.**
    Side lengths to the nearest inch, area to whole square feet. The app
    currently displays more precision than the input justifies, which reads as
    false confidence.

11. **Arbitrary rotation angle — S.**
    A numeric field alongside the existing 45° steps.

12. **Type-a-dimension edge editor — M.**
    Click a polygon side, type `24' 6"`, and the geometry rebuilds to that length
    with the rest of the outline held. When OCR reads a label correctly but the
    trace lands a few pixels off, the only correction available today is dragging
    a vertex by eye against a zoomed raster. Every appraisal sketch tool has
    numeric edge entry, and the inputs already exist — `detectedDimensions` holds
    the parsed labels, so the edit can be offered pre-filled with the nearest
    one. [InchesInput.jsx](../src/components/InchesInput.jsx) already handles
    feet-inches parsing. **Decide up front what moves** — which end of the edge,
    and whether neighbours stay orthogonal; retrofitting that rule later means
    re-doing the interaction. Rectilinear-preserving is the sane default given
    `polygon.js` already fits de-skewed rectilinear outlines.

13. **Void / hole punch — S–M.**
    Draw a rectangle or polygon inside a perimeter and subtract it from the area.
    `holes[]` already exists on every trace, is already subtracted by
    `calculateArea`, is already serialized, and is already produced by
    `footprint.js` for enclosed voids — but nothing in the UI creates one, and a
    grep over `src/components` finds no layer that *draws* one either. A hole the
    detector finds silently changes the number with nothing on screen to explain
    it; that half is arguably a bug, not a feature request, and is worth fixing
    in [PerimeterLayer.jsx](../src/components/canvas/PerimeterLayer.jsx) even if
    the authoring tool is deferred. A new hole needs validating as inside its
    outer ring and non-overlapping with the others — `validate.js` has the
    nesting checks to borrow — and should carry its own provenance so
    `boundaryQuality.js` can tell a hole the user asserted from one the detector
    guessed.

14. **Manual non-GLA carve — M.**
    Paint (reusing the draw brush) to mark a region as garage / porch / patio,
    with a per-region count / don't-count toggle.
    [nonGla.js](../src/utils/detection/nonGla.js) arbitrates four detectors into
    a footprint carve; when it wins it wins silently, and when it loses there is
    no override at all, so a user who can see a carve is wrong has to crop or
    erase the image to work around it — a destructive edit to fix a
    classification error. Regions must survive into the store and the
    `.floorplan` projection — add the field to `WORKING_STATE_DEFAULTS` and let
    `PERSISTENT_FLOOR_FIELDS` fall out of it rather than hand-listing, which is
    how `exteriorLabels` came to be autosaved but not exported — and must outrank
    the automatic regions on the next re-trace, or the correction evaporates the
    moment anything else is touched.

15. **Two-point scale calibration — S.**
    Drag a line over a printed scale bar or a wall of known length and type the
    true length. Calibration today comes only from OCR'd room labels
    (`calibration.source`, `robustScale`), so a plan with no readable dimension
    text — a scan, a hand sketch, a listing photo — has no path to a scale at
    all. Reuses the Line tool's interaction almost entirely; writes
    `calibration.feetPerPixel` with a new `source` and a `quality` that says
    *user-asserted*. One line calibrates one axis: either apply it isotropically
    and say so, or require two lines for x and y — `scaleIsotropy` in
    `validate.js` is the existing opinion on whether that matters for a given
    plan.

16. **Cross-check tool — M.**
    Compare the sum of detected room areas against the traced footprint, compare
    each polygon side against the nearest parsed dimension label, and report the
    discrepancies. `rooms[]` and `detectedDimensions` are two independent
    measurements of the same building and nothing currently reconciles them; a
    footprint that disagrees with its own room labels is the strongest available
    signal that a confident-looking trace is wrong. Cheap variant: run auto-trace
    and draw-mode on the same plan and show the square-foot delta —
    `probe:exterior draw` already proves the two paths are comparable.
