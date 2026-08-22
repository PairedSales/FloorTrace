/**
 * The mark's geometry, in its own 16×16 viewBox.
 *
 * Shared by `FloorTraceMark.jsx` and `scripts/generateIcons.mjs` so the tab
 * icon cannot drift from the one in the menu bar — the favicons are generated
 * from these numbers rather than drawn a second time. Imports nothing, which
 * is what makes it safe to reach from the eager shell.
 */
export const MARK_BOX = 16;

// The outline. `size`/`r` are the rect's side and corner radius.
export const MARK_FRAME = { x: 1.75, y: 1.75, size: 12.5, r: 1.5 };

// The interior walls, as segments. The first starts at y=2 rather than on the
// frame so the two strokes meet without a seam at their round caps.
export const MARK_WALLS = [
  [[6.75, 2], [6.75, 7.25]],
  [[6.75, 7.25], [14.25, 7.25]],
];

export const MARK_STROKE = 1.5;
