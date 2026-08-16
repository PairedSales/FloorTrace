import {
  Brush, Spline, SquareDashedBottom, Scaling, Ruler, Compass,
  Pentagon, Crop, Eraser, MousePointer2,
} from 'lucide-react';

// What each tool mode is called, what it asks the user to do, and how it
// commits. Data rather than markup, in its own module so ContextBar can stay
// a pure component export (react-refresh/only-export-components).
// Order matters only for the first match; the tool flags are mutually
// exclusive by construction (useToolManager.deactivateAll).
export const TOOL_MODES = {
  draw: {
    icon: Brush,
    name: 'Painting the outline',
    hint: 'Paint roughly over the exterior walls, then finish.',
    brush: 'draw',
    doneLabel: 'Trace my outline',
    doneKey: 'Enter',
  },
  vertex: {
    icon: Spline,
    name: 'Placing corners',
    hint: 'Click each corner of the exterior. Click the first one again to close.',
    doneLabel: 'Close outline',
    doneKey: 'Enter',
  },
  void: {
    icon: SquareDashedBottom,
    name: 'Cutting out a void',
    hint: 'Drag a rectangle over a courtyard or light well, or click corner by corner.',
    doneKey: 'Enter',
  },
  scale: {
    icon: Scaling,
    name: 'Setting the scale',
    hint: 'Click both ends of a length you know, then type it into the Scale card.',
  },
  line: {
    icon: Ruler,
    name: 'Measuring a length',
    hint: 'Click a start point and an end point.',
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
    doneKey: 'Enter',
  },
  crop: {
    icon: Crop,
    name: 'Cropping the plan',
    hint: 'Drag the region you want to keep.',
  },
  eraser: {
    icon: Eraser,
    name: 'Erasing',
    hint: 'Drag over legends or notes that confuse detection.',
    brush: 'eraser',
  },
  place: {
    icon: MousePointer2,
    name: 'Placing the room',
    hint: 'Click the room on the plan to place the overlay.',
  },
};

