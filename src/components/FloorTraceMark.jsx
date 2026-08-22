import { MARK_BOX, MARK_FRAME, MARK_WALLS, MARK_STROKE } from './markGeometry';

/**
 * The app's mark, as inline geometry.
 *
 * It used to be `logo.svg` — a 41 kB SVG whose entire body was one base64 PNG,
 * shipped twice (once as the favicon, once bundled) to draw a glyph about
 * 7×11 CSS px on screen. That is ~62 kB gzipped of a ~168 kB critical path for
 * a mark smaller than a word.
 *
 * Drawn in `currentColor`, which also fixes a bug the size hid: the embedded
 * artwork was a pure-white glyph on transparency, and the light theme's panel
 * is `247 248 250` — so the mark was invisible in light mode and nobody could
 * see that it was missing.
 *
 * The shape is an outline with interior walls, kept to three strokes because it
 * is rendered at 15 px. The coordinates live in `markGeometry.js` because the
 * favicons are rasterised from them (`npm run icons`) — a mark redrawn by hand
 * for the tab is a mark that quietly stops matching the one in the menu bar.
 */
const FloorTraceMark = ({ className = '', title }) => (
  <svg
    viewBox={`0 0 ${MARK_BOX} ${MARK_BOX}`}
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth={MARK_STROKE}
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? 'img' : 'presentation'}
    aria-hidden={title ? undefined : 'true'}
  >
    {title && <title>{title}</title>}
    <rect
      x={MARK_FRAME.x}
      y={MARK_FRAME.y}
      width={MARK_FRAME.size}
      height={MARK_FRAME.size}
      rx={MARK_FRAME.r}
    />
    {MARK_WALLS.map(([[x1, y1], [x2, y2]]) => (
      <path key={`${x1},${y1},${x2},${y2}`} d={`M${x1} ${y1}L${x2} ${y2}`} />
    ))}
  </svg>
);

export default FloorTraceMark;
