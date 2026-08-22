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
 * The shape is the one the empty state already uses for "a plan": an outline
 * with interior walls. Kept to three strokes because it is rendered at 15 px.
 */
const FloorTraceMark = ({ className = '', title }) => (
  <svg
    viewBox="0 0 16 16"
    className={className}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    role={title ? 'img' : 'presentation'}
    aria-hidden={title ? undefined : 'true'}
  >
    {title && <title>{title}</title>}
    <rect x="1.75" y="1.75" width="12.5" height="12.5" rx="1.5" />
    <path d="M6.75 2v5.25" />
    <path d="M6.75 7.25h7.5" />
  </svg>
);

export default FloorTraceMark;
