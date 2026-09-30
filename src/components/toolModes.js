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
    hint: 'Paint roughly over the outside walls — it only needs to be close.',
    touchHint: 'Drag over the outside walls. Pinch to zoom while you work.',
    brush: 'draw',
    doneLabel: 'Draw the outline',
    doneKey: 'Enter',
  },
  vertex: {
    icon: Waypoints,
    name: 'Clicking corners',
    hint: 'Click each outside corner in turn. Click the first corner again to finish.',
    touchHint: 'Tap each outside corner in turn. Tap the first one again to finish.',
    doneLabel: 'Finish outline',
    doneKey: 'Enter',
  },
  void: {
    icon: SquareDashedBottom,
    name: 'Cutting out an area',
    hint: 'Drag a box over the courtyard or open area, or click its corners one by one.',
    touchHint: 'Drag a box over the courtyard or open area, or tap its corners one by one.',
    doneLabel: 'Finish cut-out',
    doneKey: 'Enter',
  },
  cornerEraser: {
    icon: CircleMinus,
    name: 'Removing corners',
    hint: 'Drag over the corners you want to remove. At least three always stay.',
    touchHint: 'Drag over the corners you want to remove. At least three always stay.',
    // Shares `eraserBrushSize` with the image eraser: the slider means the same
    // thing in both — how wide a swathe the drag takes.
    brush: 'eraser',
  },
  scale: {
    icon: Scaling,
    name: 'Setting the scale',
    hint: 'Click both ends of a length you know, then type the length in the Scale section.',
    touchHint: 'Tap both ends of a length you know, then type it in the Measurement panel.',
  },
  line: {
    icon: Ruler,
    name: 'Measuring a distance',
    hint: 'Click where the distance starts, then where it ends.',
    touchHint: 'Tap where the distance starts, then where it ends.',
  },
  angle: {
    icon: Compass,
    name: 'Measuring an angle',
    hint: 'Drag the ends or the corner of the angle onto the two walls.',
  },
  area: {
    icon: Pentagon,
    name: 'Measuring an area',
    hint: 'Click each corner of the area. Click the first corner again to finish.',
    touchHint: 'Tap each corner, then Finish area.',
    doneLabel: 'Finish area',
    doneKey: 'Enter',
  },
  crop: {
    icon: Crop,
    name: 'Cropping the plan',
    hint: 'Drag a box around the part of the plan you want to keep.',
  },
  eraser: {
    icon: Eraser,
    name: 'Erasing marks',
    hint: 'Drag over notes or a legend to white them out of the plan.',
    touchHint: 'Drag over notes or a legend to white them out. Pinch to zoom while you work.',
    brush: 'eraser',
  },
  // Not a tool flag: this one is on whenever the read labels are on screen as
  // pills, which is the state the automatic scale leaves behind only when it
  // could not choose, or that "Pick a different room" returns to deliberately.
  pick: {
    icon: MousePointerClick,
    name: 'Choosing a room',
    hint: 'Click a room size on the plan to set the scale from that room.',
  },
};
