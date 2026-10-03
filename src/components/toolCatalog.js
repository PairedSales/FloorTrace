import {
  Ruler, Pentagon, Compass, Waypoints, SquareDashedBottom, Crop, Eraser, CircleMinus,
  Scaling, RotateCw, RotateCcw, Brush, Shuffle, ScanSearch, Plus, Trash2, VectorSquare, Image,
} from 'lucide-react';

/**
 * Everything the user can do to a plan, grouped by what they are trying to
 * get done.
 *
 * Its own module — like `toolModes.js`, and for the same reason: two shells
 * render this list (the desktop action bar as four menus, the mobile sheet as a
 * grid of named tiles) and a shared constant living inside one of them makes
 * that file stop being a component-only export.
 *
 * ## Jobs, not a row of tools
 *
 * The desktop used to show this as a rail of ten icons with a word under each,
 * and the same corrections again as buttons on the panel's cards under
 * different names ("Paint" on the rail, "Paint over the outside walls" on the
 * card). The groups below are the questions a person actually arrives with —
 * *the outline is wrong*, *I want to measure something*, *the plan itself needs
 * tidying* — and each is one menu in the action bar, in which every row has a
 * name and a sentence. (*The scale is wrong* is the fourth, and it is answered
 * on the panel: see the `scale` group.)
 *
 * ## Tools and commands
 *
 * A **tool** is a mode: it stays on, the action bar turns into its instruction
 * bar, and it ends with Done or Cancel. A **command** happens once and is over
 * ("Find the outline again"). Both sit in the same menus because the user does
 * not care which is which, but they are separate lists here because only tools
 * have a digit, a running state (`TOOL_MODES[id]`) and a tile on the phone.
 *
 * `menu` is the order the desktop shows them in, by id, with `'-'` for a rule;
 * a group without one is not a menu. The phone renders `tools` alone; its
 * commands live in its own menu sheet.
 *
 * ## Digits
 *
 * **The digits run 1–9 straight down the tools.** Nothing derives a digit from
 * an index — a mapping that moves with app state is the thing being avoided,
 * not a mapping written down once — so renumbering means editing the `digit`
 * fields here; `useKeyboardShortcuts`, `keyboardGuard` and the help page all
 * read them from this list.
 *
 * ## Words
 *
 * `label` is the row's name and the accessible name. `short` is the phone
 * tile's one-word label. `hint` says what the thing is *for*. None of them is
 * what the action bar prints once a tool is running: that is
 * `TOOL_MODES[id].name`, which names the *state* ("Painting the outline") —
 * one is a thing you pick, the other a thing you are doing.
 *
 * `needsArea` doubles as the disabled reason. Everything disables in place
 * rather than disappearing, so a row never moves out from under the pointer.
 */
export const TOOL_GROUPS = [
  {
    id: 'outline',
    title: 'Outline',
    icon: VectorSquare,
    hint: 'Redraw the outline, cut an area out of it, or add another one',
    tools: [
      { id: 'draw',    digit: '1',  icon: Brush,              short: 'Paint', label: 'Paint over the walls',
        hint: 'Paint roughly over the outside walls and FloorTrace draws the outline' },
      { id: 'vertex',  digit: '2',  icon: Waypoints,          short: 'Corners', label: 'Click the corners',
        hint: 'Draw the outline yourself, one outside corner at a time' },
      { id: 'void',    digit: '3',  icon: SquareDashedBottom, short: 'Cut out', label: 'Cut out an open area',
        hint: 'Take a courtyard or an open-to-below area out of the outline',
        needsArea: 'Draw an outline first, then cut an area out of it.' },
      // Deletes the outline's own corners in bulk. A single corner is deleted
      // by right-clicking it, which is what nearly everyone needs.
      { id: 'cornerEraser', digit: null, icon: CircleMinus,   short: 'Remove corners', label: 'Remove several corners',
        hint: 'Drag over corners of the outline to delete them',
        needsArea: 'Removing corners needs an outline first.' },
    ],
    commands: [
      // The search's runner-up footprints. Listed only while there is one.
      { id: 'alternative', icon: Shuffle, label: 'Try another outline',
        hint: 'FloorTrace found more than one possible outline; this swaps in the next one' },
      { id: 'findOutline', icon: ScanSearch, label: 'Find the outline again',
        hint: 'Let FloorTrace look again — useful after cropping the plan or erasing marks' },
      { id: 'addOutline', icon: Plus, label: 'Add another outline',
        hint: 'For a garage, a porch or another level on this plan' },
    ],
    menu: ['draw', 'vertex', 'alternative', 'findOutline', '-', 'void', 'cornerEraser', '-', 'addOutline'],
  },
  {
    // Not a menu on the desktop. The scale is a number the area is worked out
    // from, not something drawn, so the ways to change it sit in the results
    // panel's scale step, beside the scale they change. The tool is listed
    // here for its digit and for the phone's tool sheet.
    id: 'scale',
    title: 'Scale',
    icon: Scaling,
    tools: [
      { id: 'scale',   digit: '4',  icon: Scaling,            short: 'Scale', label: 'Set scale from a known length',
        hint: 'Click both ends of something whose length you know, then type its length' },
    ],
  },
  {
    id: 'measure',
    title: 'Measure',
    icon: Ruler,
    hint: 'Measure a distance, an area or an angle on the plan',
    tools: [
      { id: 'line',    digit: '5',  icon: Ruler,              short: 'Distance', label: 'Measure a distance',
        hint: 'The distance between two points',
        needsArea: 'Measuring needs an outline first.' },
      { id: 'area',    digit: '6',  icon: Pentagon,           short: 'Area', label: 'Measure an area',
        hint: 'A deck, a patio or any shape you outline',
        needsArea: 'Measuring an area needs an outline first.' },
      { id: 'angle',   digit: '7',  icon: Compass,            short: 'Angle', label: 'Measure an angle',
        hint: 'The angle between two walls',
        needsArea: 'Measuring an angle needs an outline first.' },
    ],
    commands: [
      // Listed only while there is something to clear.
      { id: 'clearMeasurements', icon: Trash2, label: 'Clear your measurements', danger: true,
        hint: 'Remove every distance and shape you measured on this plan' },
    ],
    menu: ['line', 'area', 'angle', '-', 'clearMeasurements'],
  },
  {
    // `image`, not `plan`: `keyboardGuard` reads this id to find the digits
    // that rewrite the plan image, which must wait for a running job.
    id: 'image',
    title: 'Edit plan',
    icon: Image,
    hint: 'Crop, clean up or turn the plan itself',
    tools: [
      { id: 'crop',    digit: '8',  icon: Crop,               short: 'Crop', label: 'Crop the plan',
        hint: 'Keep only the part of the plan you drag over' },
      // Paints over the plan itself. A legend or a note inside the building is
      // a documented way to lose a trace, and this is how it comes off the page.
      { id: 'eraser',  digit: '9',  icon: Eraser,             short: 'Erase', label: 'Erase marks on the plan',
        hint: 'White out notes or a legend that confuse the automatic outline' },
      // One entry here; both shells offer it as two explicit directions, since
      // a direction hidden behind a right-click is a direction nobody finds.
      { id: 'rotate',  digit: null, icon: RotateCw,           short: 'Rotate', label: 'Turn the plan',
        hint: 'Turn the plan 45° at a time' },
    ],
    commands: [
      { id: 'rotateRight', icon: RotateCw, label: 'Turn the plan right', keys: 'R',
        hint: 'Rotate it 45° clockwise' },
      { id: 'rotateLeft', icon: RotateCcw, label: 'Turn the plan left', keys: 'Shift+R',
        hint: 'Rotate it 45° the other way' },
    ],
    menu: ['crop', 'eraser', '-', 'rotateRight', 'rotateLeft'],
  },
];
