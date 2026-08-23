import {
  Brush, Waypoints, SquareDashedBottom, Scaling, Ruler, Compass,
  Pentagon, Crop, Eraser, CircleMinus, MousePointerClick,
} from 'lucide-react';

// What each tool mode is called, what it asks the user to do, and how it
// commits. Data rather than markup, in its own module so the components that
// read it stay pure component exports (react-refresh/only-export-components).
// Three read it now: the desktop `StatusBar`, which *is* the context bar, the
// mobile `MobileToolContext`, and nothing else — `select` is deliberately absent
// from the table, and both of them treat that absence as "no mode is running".
// Order matters only for the first match; the tool flags are mutually
// exclusive by construction (useToolManager.deactivateAll).
//
// `touchHint` is the same instruction in the gestures a phone actually has.
// It is a separate string rather than a find-and-replace of "click" because
// the *shape* of the instruction changes, not just the verb: double-click to
// close a shape becomes tap-the-first-point-again, and the desktop's
// "Enter when done" becomes a button that is already on screen.
export const TOOL_MODES = {
  draw: {
    icon: Brush,
    name: 'Painting the outline',
    hint: 'Paint roughly over the exterior walls, then finish.',
    touchHint: 'Drag over the exterior walls. Pinch to zoom while you work.',
    brush: 'draw',
    doneLabel: 'Trace my outline',
    doneKey: 'Enter',
  },
  vertex: {
    icon: Waypoints,
    name: 'Placing corners',
    hint: 'Click each corner of the exterior. Click the first one again to close.',
    touchHint: 'Tap each corner of the exterior. Tap the first one again to close.',
    doneLabel: 'Close outline',
    doneKey: 'Enter',
  },
  void: {
    icon: SquareDashedBottom,
    name: 'Cutting out a void',
    hint: 'Drag a rectangle over a courtyard or light well, or click corner by corner.',
    touchHint: 'Drag a box over a courtyard or light well, or tap corner by corner.',
    doneLabel: 'Close void',
    doneKey: 'Enter',
  },
  cornerEraser: {
    icon: CircleMinus,
    name: 'Removing corners',
    hint: 'Drag over the outline corners you want gone. Three always remain.',
    touchHint: 'Drag over the outline corners you want gone. Three always remain.',
    // Shares `eraserBrushSize` with the image eraser: the slider means the same
    // thing in both — how wide a swathe the drag takes.
    brush: 'eraser',
  },
  scale: {
    icon: Scaling,
    name: 'Setting the scale',
    hint: 'Click both ends of a length you know, then type it into the Scale card.',
    touchHint: 'Tap both ends of a length you know, then type it in the Measurement panel.',
  },
  line: {
    icon: Ruler,
    name: 'Measuring a length',
    hint: 'Click a start point and an end point.',
    touchHint: 'Tap a start point and an end point.',
  },
  angle: {
    icon: Compass,
    name: 'Measuring an angle',
    hint: 'Drag the arms or the vertex onto the two walls.',
  },
  area: {
    icon: Pentagon,
    name: 'Drawing an area',
    hint: 'Click each corner. Enter or double-click the first point to close.',
    touchHint: 'Tap each corner, then Close area.',
    doneLabel: 'Close area',
    doneKey: 'Enter',
  },
  crop: {
    icon: Crop,
    name: 'Cropping the plan',
    hint: 'Drag the region you want to keep.',
  },
  eraser: {
    icon: Eraser,
    name: 'Erasing clutter',
    hint: 'Drag over legends or notes to white them out of the plan.',
    touchHint: 'Drag over legends or notes to white them out. Pinch to zoom while you work.',
    brush: 'eraser',
  },
  // Not a tool flag: this one is on whenever the read labels are on screen as
  // pills, which is the state the automatic scale leaves behind only when it
  // could not choose, or that "Select room" returns to deliberately.
  pick: {
    icon: MousePointerClick,
    name: 'Choosing a room',
    hint: 'Click a dimension label to measure that room and take the scale from it.',
  },
};
