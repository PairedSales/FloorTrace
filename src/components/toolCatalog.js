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
 * **The digits run 1–9 straight down this list.** Both this file and
 * useKeyboardShortcuts used to claim they matched and they did not: the rail
 * read 7, 4, 8, 9, 1, 3, 2, 5, 6 top to bottom, because digits had been handed
 * out in the order the tools were built and the rail was later regrouped
 * around them. Nothing derives a digit from an index — a mapping that moves
 * with app state is the thing being avoided, not a mapping written down twice
 * — so renumbering means editing both lists together.
 *
 * Group order is the core job first and the utilities last: Select is the rest
 * state, Outline is what the app is for, Measure needs an outline to act on,
 * and the image tools are prep you reach for occasionally. Within a group,
 * whatever must happen first comes first — Set scale above the measurements it
 * gives meaning to, Cut out below the outline it punches a hole in.
 *
 * `short` is the compact, imperative name of the *tool* ("Place corners").
 * `label` stays the fuller phrase and stays the accessible name at every
 * density. Neither is what the status bar prints once the tool is running: that
 * is `TOOL_MODES[id].name`, which names the *state* ("Placing corners"), and the
 * two are deliberately worded differently — one is a thing you pick, the other
 * is a thing you are doing.
 *
 * **Every tool carries a `hint`.** The rail is icon-only, so hovering or
 * focusing a button prints `short` and `hint` in the status bar — that is the
 * only place a tool says what it does now that the labelled density is gone.
 * `line`, `area` and `crop` had no hint while the words could be switched on
 * beside the icon; a missing one is now a tool that answers nothing. It says
 * what the tool is *for*, in contrast to `TOOL_MODES[id].hint`, which says what
 * to do once the tool is running.
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
      { id: 'draw',    digit: '1',  icon: Brush,              short: 'Paint outline', label: 'Paint the outline',
        hint: 'Paint over the exterior walls and let FloorTrace read them' },
      { id: 'vertex',  digit: '2',  icon: Spline,             short: 'Place corners', label: 'Place corners',
        hint: 'Place the exterior outline corner by corner' },
      { id: 'void',    digit: '3',  icon: SquareDashedBottom, short: 'Cut out', label: 'Cut out a void',
        hint: 'Punch a courtyard or light well out of an outline',
        needsArea: 'Cutting a void needs a traced outline first.' },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    tools: [
      { id: 'scale',   digit: '4',  icon: Scaling,            short: 'Set scale', label: 'Set the scale',
        hint: 'Set the scale from a length you know' },
      { id: 'line',    digit: '5',  icon: Ruler,              short: 'Measure', label: 'Measure a length',
        hint: 'Measure the distance between two points',
        needsArea: 'Measuring needs a traced outline first.' },
      // Area above Angle: this app exists to produce an area, and an angle is
      // the rarest thing in the rail.
      { id: 'area',    digit: '6',  icon: Pentagon,           short: 'Area', label: 'Draw an area',
        hint: 'Measure a patio, deck or any shape you outline',
        needsArea: 'Drawing an area needs a traced outline first.' },
      { id: 'angle',   digit: '7',  icon: Compass,            short: 'Angle', label: 'Measure an angle',
        hint: 'Measure the angle between two walls',
        needsArea: 'Measuring an angle needs a traced outline first.' },
    ],
  },
  {
    id: 'image',
    title: 'Plan image',
    tools: [
      { id: 'crop',    digit: '8',  icon: Crop,               short: 'Crop', label: 'Crop the plan',
        hint: 'Keep only the part of the image you drag over' },
      { id: 'eraser',  digit: '9',  icon: Eraser,             short: 'Erase', label: 'Erase clutter',
        hint: 'Remove legends or notes that confuse detection' },
      // The desktop rail rotates the other way on right-click; the mobile sheet
      // splits it into two buttons, because a phone has no second button.
      // Digitless, and last, which is what keeps the 1–9 run unbroken.
      { id: 'rotate',  digit: null, icon: RotateCw,           short: 'Rotate', label: 'Rotate 45°',
        hint: 'Right-click to rotate the other way' },
    ],
  },
];
