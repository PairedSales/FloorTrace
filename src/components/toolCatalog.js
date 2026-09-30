import {
  MousePointer2, Ruler, Pentagon, Compass, Waypoints, SquareDashedBottom,
  Crop, Eraser, CircleMinus, Scaling, RotateCw, Brush,
} from 'lucide-react';

/**
 * The tool inventory, in the order the digit shortcuts assign.
 *
 * Its own module — like `toolModes.js`, and for the same reason: two components
 * render this list (the desktop rail as a labelled column, the mobile sheet as
 * a grid of named tiles) and a shared constant living inside one of them makes
 * that file stop being a component-only export.
 *
 * **The digits run 1–9 straight down this list.** Nothing derives a digit from
 * an index — a mapping that moves with app state is the thing being avoided,
 * not a mapping written down once — so renumbering means editing the `digit`
 * fields here; `useKeyboardShortcuts`, `keyboardGuard` and the help page all
 * read them from this list.
 *
 * **The rail shows the tools an appraiser actually reaches for, with words.**
 * It used to be twelve bare icons whose only explanation appeared in the status
 * bar on hover — a compass, a waypoint chain and a dashed square mean nothing to
 * someone who has not already learned them. The rail now labels every button,
 * and the three tools almost nobody needs (an angle, deleting corners in bulk,
 * turning the plan) sit in the `overflow` group behind a "More" button, where
 * they stop competing with the ones that do the job. They keep their order and
 * the run still reads straight down: the overflow group is last, so the digit
 * it carries is the last one.
 *
 * Group order is the core job first and the utilities last: Adjust is the rest
 * state, Outline is what the app is for, Measure needs an outline to act on,
 * and the plan clean-up tools are prep you reach for occasionally. Within a
 * group, whatever must happen first comes first — Scale above the measurements
 * it gives meaning to, Cut out below the outline it takes an area out of.
 *
 * `short` is the rail's label — one word where one will do, because it sits
 * under the icon in a 72 px column. `label` is the fuller phrase and the
 * accessible name. Neither is what the status bar prints once the tool is
 * running: that is `TOOL_MODES[id].name`, which names the *state* ("Painting
 * the outline") — one is a thing you pick, the other a thing you are doing.
 *
 * **Every tool carries a `hint`**: what the tool is *for*, shown in the status
 * bar and the button's tooltip when the pointer rests on it, in contrast to
 * `TOOL_MODES[id].hint`, which says what to do once the tool is running.
 *
 * `needsArea` doubles as the disabled reason. Every tool disables in place
 * rather than disappearing, so a button never moves out from under the pointer.
 */
export const TOOL_GROUPS = [
  {
    id: 'edit',
    title: 'Adjust',
    tools: [
      { id: 'select',  digit: null, icon: MousePointer2,      short: 'Adjust', label: 'Adjust the outline',
        hint: 'Drag a corner, a cut-out or a shape to move it' },
    ],
  },
  {
    id: 'outline',
    title: 'Outline',
    tools: [
      { id: 'draw',    digit: '1',  icon: Brush,              short: 'Paint', label: 'Paint the outline',
        hint: 'Paint roughly over the outside walls and FloorTrace draws the outline' },
      { id: 'vertex',  digit: '2',  icon: Waypoints,          short: 'Corners', label: 'Click the corners',
        hint: 'Click each outside corner to draw the outline yourself' },
      { id: 'void',    digit: '3',  icon: SquareDashedBottom, short: 'Cut out', label: 'Cut out an open area',
        hint: 'Take a courtyard or an open-to-below area out of the outline',
        needsArea: 'Draw an outline first, then cut an area out of it.' },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    tools: [
      { id: 'scale',   digit: '4',  icon: Scaling,            short: 'Scale', label: 'Set the scale',
        hint: 'Set the scale from a length you know' },
      { id: 'line',    digit: '5',  icon: Ruler,              short: 'Measure', label: 'Measure a distance',
        hint: 'Measure the distance between two points',
        needsArea: 'Measuring needs an outline first.' },
      { id: 'area',    digit: '6',  icon: Pentagon,           short: 'Area', label: 'Measure an area',
        hint: 'Measure a deck, a patio or any shape you outline',
        needsArea: 'Measuring an area needs an outline first.' },
    ],
  },
  {
    id: 'image',
    title: 'Clean up the plan',
    tools: [
      { id: 'crop',    digit: '7',  icon: Crop,               short: 'Crop', label: 'Crop the plan',
        hint: 'Keep only the part of the plan you drag over' },
      // Paints over the plan itself. A legend or a note inside the building is
      // a documented way to lose a trace, and this is how it comes off the page.
      { id: 'eraser',  digit: '8',  icon: Eraser,             short: 'Erase', label: 'Erase marks on the plan',
        hint: 'White out notes or a legend that confuse the automatic outline' },
    ],
  },
  {
    id: 'more',
    title: 'More tools',
    // Behind the rail's "More" button rather than on it.
    overflow: true,
    tools: [
      { id: 'angle',   digit: '9',  icon: Compass,            short: 'Angle', label: 'Measure an angle',
        hint: 'Measure the angle between two walls',
        needsArea: 'Measuring an angle needs an outline first.' },
      // Deletes the outline's own corners in bulk. A single corner is deleted
      // by right-clicking it, which is what nearly everyone needs.
      { id: 'cornerEraser', digit: null, icon: CircleMinus, short: 'Remove corners', label: 'Remove outline corners',
        hint: 'Drag over corners of the outline to delete them',
        needsArea: 'Removing corners needs an outline first.' },
      // One entry here; the rail's overflow and the mobile sheet both offer it
      // as two explicit directions, since neither can lean on a right-click.
      { id: 'rotate',  digit: null, icon: RotateCw,           short: 'Rotate', label: 'Rotate the plan 45°',
        hint: 'Turn the plan 45° at a time' },
    ],
  },
];
