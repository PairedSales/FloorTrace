import {
  MousePointer2, Ruler, Pentagon, Compass, Spline, SquareDashedBottom,
  Crop, Eraser, Scaling, RotateCw, Brush,
} from 'lucide-react';

/**
 * The tool inventory, in the order the digit shortcuts assign.
 *
 * Its own module — like `toolModes.js`, and for the same reason: two components
 * render this list now (the desktop rail as a 48 px icon column, the mobile
 * sheet as a grid of named tiles) and a shared constant living inside one of
 * them makes that file stop being a component-only export.
 *
 * The order matches the digit map in useKeyboardShortcuts exactly, and neither
 * renumbers itself by app state. `short` is the compact name and matches the
 * status bar's MODE_LABEL; `label` stays the fuller phrase and stays the
 * accessible name at every density.
 *
 * `needsArea` doubles as the disabled reason. Every tool disables in place
 * rather than disappearing, so a button never moves out from under the pointer
 * — the old ToolsPanel gated four of these behind `hasArea` and reflowed a
 * two-column grid the moment a trace landed.
 */
export const TOOL_GROUPS = [
  {
    id: 'edit',
    title: 'Edit',
    tools: [
      { id: 'select',  digit: null, icon: MousePointer2,      short: 'Select', label: 'Select & adjust',
        hint: 'Drag corners, voids and shapes' },
    ],
  },
  {
    id: 'outline',
    title: 'Outline',
    tools: [
      { id: 'draw',    digit: '7',  icon: Brush,              short: 'Paint outline', label: 'Paint the outline',
        hint: 'Paint over the exterior walls and let FloorTrace read them' },
      { id: 'vertex',  digit: '4',  icon: Spline,             short: 'Place corners', label: 'Place corners',
        hint: 'Place the exterior outline corner by corner' },
      { id: 'void',    digit: '8',  icon: SquareDashedBottom, short: 'Cut out', label: 'Cut out a void',
        hint: 'Punch a courtyard or light well out of an outline',
        needsArea: 'Cutting a void needs a traced outline first.' },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    tools: [
      { id: 'scale',   digit: '9',  icon: Scaling,            short: 'Set scale', label: 'Set the scale',
        hint: 'Set the scale from a length you know' },
      { id: 'line',    digit: '1',  icon: Ruler,              short: 'Measure', label: 'Measure a length',
        needsArea: 'Measuring needs a traced outline first.' },
      { id: 'angle',   digit: '3',  icon: Compass,            short: 'Angle', label: 'Measure an angle',
        needsArea: 'Measuring needs a traced outline first.' },
      { id: 'area',    digit: '2',  icon: Pentagon,           short: 'Area', label: 'Draw an area',
        needsArea: 'Drawing an area needs a traced outline first.' },
    ],
  },
  {
    id: 'image',
    title: 'Plan image',
    tools: [
      { id: 'crop',    digit: '5',  icon: Crop,               short: 'Crop', label: 'Crop the plan' },
      { id: 'eraser',  digit: '6',  icon: Eraser,             short: 'Erase', label: 'Erase clutter',
        hint: 'Remove legends or notes that confuse detection' },
      // The desktop rail rotates the other way on right-click; the mobile sheet
      // splits it into two buttons, because a phone has no second button.
      { id: 'rotate',  digit: null, icon: RotateCw,           short: 'Rotate', label: 'Rotate 45°',
        hint: 'Right-click to rotate the other way' },
    ],
  },
];
