# Tools and options — backlog

Ideas not yet built, with the reason each is worth building and the code it
would touch. Sized S / M relative to each other, not in hours.

Seven items have been removed from this list because they shipped: trace types
with broken-out totals, the warnings panel, visible undo/redo buttons, canvas
keyboard shortcuts, the copy-all area summary, the void / hole-punch tool, and
two-point scale calibration. Their design documents are gone with them — the
code is the better copy.

1. **Room labels on canvas — M.**
   Place text like `Bedroom · 12'×14' · 168 sf`, positioned automatically from
   `rooms[]` where available. Turns the app from an area calculator into a sketch
   someone can hand to a client. The data already exists for every room the
   detector has placed.

2. **Layer visibility toggles — S–M.**
   Dimension labels, room rectangles, holes, measurement lines, and the
   wall/boundary mask as a debug underlay. `showSideLengths` is still the only
   visibility toggle today. The worker already forwards a whitelist of debug
   fields; showing the evidence is how a user understands *why* a trace went
   wrong instead of just being told it is doubtful.

3. **Snap controls — S.**
   Radius/strength, and what it snaps to (wall face / vertex / grid /
   orthogonal), plus `Shift` to constrain to 90°/45° while dragging and `Alt` to
   subtract. `autoSnapEnabled` is one boolean today.

4. **Orthogonalize on commit, with a tolerance — S.**
   Force rectilinear, which most plans actually are, and which
   [polygon.js](../src/utils/detection/polygon.js) already fits toward.

5. **Side-length precision — S.**
   The area half of this shipped: `areaDisplayValue`
   ([unitConverter.js](../src/utils/unitConverter.js)) rounds every printed area
   to whole square feet, and every breakdown row and total goes through it. Side
   lengths in decimal-feet mode still print `12.4 ft` — a tenth of a foot is
   finer than the input justifies. The `inches` unit mode already prints
   `12'5"`; the question is whether decimal mode should round to the same
   resolution rather than offering a digit the measurement cannot support.

6. **Arbitrary rotation angle — S.**
   A numeric field alongside the existing 45° steps (`canvasRotation` in
   [appStore.js](../src/store/appStore.js)).

7. **Type-a-dimension edge editor — M.**
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

8. **Manual non-GLA carve — M.**
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

   Note that this is the *region* half of the problem. Typing a whole outline
   shipped (`traceTypes.js`); typing a region inside one did not.

9. **Cross-check tool — M.**
   Compare the sum of detected room areas against the traced footprint, compare
   each polygon side against the nearest parsed dimension label, and report the
   discrepancies. `rooms[]` and `detectedDimensions` are two independent
   measurements of the same building and nothing currently reconciles them; a
   footprint that disagrees with its own room labels is the strongest available
   signal that a confident-looking trace is wrong. Cheap variant: run auto-trace
   and draw-mode on the same plan and show the square-foot delta —
   `probe:exterior draw` already proves the two paths are comparable.

10. **Reading a printed scale bar automatically — M.**
    OCR of `1/4" = 1'-0"`, or measuring a graphic bar's ticks. The two-point
    scale tool that shipped is the manual half of this, and this is its obvious
    follow-up. Deferred deliberately at the time, not forgotten.
