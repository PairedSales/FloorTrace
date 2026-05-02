/** Font family and style used for OCR pill badge text (must match the Konva Text element). */
export const OCR_PILL_FONT_FAMILY = 'Inter, system-ui, sans-serif';
export const OCR_PILL_FONT_STYLE = 'bold';
/** Font family and style used for side-length pill badge text (must match the Konva Text element). */
export const SIDE_LEN_FONT_FAMILY = 'Inter, system-ui, sans-serif';
export const SIDE_LEN_FONT_STYLE = '500';
/** Cached canvas 2D context used for text measurement – avoids repeated DOM element creation. */
const _measureCtx = document.createElement('canvas').getContext('2d');
/** Measure the rendered pixel width of a text string using the Canvas 2D API. */
export function measureTextWidth(text, fontSize) {
  _measureCtx.font = `${OCR_PILL_FONT_STYLE} ${fontSize}px ${OCR_PILL_FONT_FAMILY}`;
  return _measureCtx.measureText(text).width;
}
/** Measure the pixel width of a side-length pill label using the Canvas 2D API. */
export function measureSideLenWidth(text, fontSize) {
  _measureCtx.font = `${SIDE_LEN_FONT_STYLE} ${fontSize}px ${SIDE_LEN_FONT_FAMILY}`;
  return _measureCtx.measureText(text).width;
}
/** Base dot radius (canvas units) for the OCR anchor dot before scale division. */
export const OCR_DOT_BASE_RADIUS = 3;
/** Minimum rendered dot radius in pixels for the OCR anchor dot. */
export const OCR_DOT_MIN_RADIUS = 2;

/** Conversion factor from square meters to square centimeters. */
export const SQ_M_TO_SQ_CM = 10000;
/** Threshold (m²) below which custom shape areas are shown in cm² instead of m². */
export const MIN_SQ_M_DISPLAY = 0.1;

/** Cycling colors for measurement lines (Dracula color scheme).
 *  `label` is a complementary Dracula color used for area shape text labels. */
export const LINE_COLORS = [
  { normal: '#FFB86C', selected: '#FFCA99', label: '#BD93F9' }, // Orange shape → Purple label
  { normal: '#8BE9FD', selected: '#A8F0FF', label: '#FFB86C' }, // Cyan shape → Orange label
  { normal: '#50FA7B', selected: '#7AFFA0', label: '#FF79C6' }, // Green shape → Pink label
  { normal: '#BD93F9', selected: '#D2B8FC', label: '#F1FA8C' }, // Purple shape → Yellow label
  { normal: '#FF79C6', selected: '#FFA8D9', label: '#50FA7B' }, // Pink shape → Green label
];

/** Layout for measurement line: split stroke so it never crosses the label; offset label when the segment is too short.
 *  @param {object} options
 *  @param {boolean} [options.forceAbove=false] Always lift the label above the line (used during live preview). 
 *  @param {string|null} [options.unitStyle=null] Specific format style inferred from OCR. */
export const getMeasurementLineLayout = (line, scale, pixelsPerFoot, unit, { forceAbove = false, unitStyle = null } = {}) => {
  const { formatLength } = getMeasurementLineLayout._deps;
  const dx = line.end.x - line.start.x;
  const dy = line.end.y - line.start.y;
  const lenPx = Math.sqrt(dx * dx + dy * dy);
  const lengthFeet = lenPx * pixelsPerFoot;
  const textStr = `${formatLength(lengthFeet, unit, unitStyle)}`;
  const fontSize = 12 / scale;
  const ux = lenPx > 1e-6 ? dx / lenPx : 1;
  const uy = lenPx > 1e-6 ? dy / lenPx : 0;
  const mx = (line.start.x + line.end.x) / 2;
  const my = (line.start.y + line.end.y) / 2;
  // Normal (perpendicular) to the line, chosen to point "above" (negative-y in screen space).
  let nx = -uy;
  let ny = ux;
  if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; }

  const approxPad = 6 / scale;
  const approxCharW = fontSize * 0.58;
  const approxTextWidth = Math.max(textStr.length * approxCharW, fontSize * 2.5);
  const approxTextHeight = fontSize * 1.25;

  const extentAlongLine =
    (approxTextWidth * Math.abs(ux) + approxTextHeight * Math.abs(uy)) / 2 + approxPad;
  const maxHalfGap = Math.max(0, lenPx / 2 - 0.5 / scale);
  const halfGap = Math.min(extentAlongLine, maxHalfGap);
  const needsPerpendicularLift = forceAbove || maxHalfGap < extentAlongLine - 1e-3;
  const halfExtentOnNormal =
    (approxTextWidth / 2) * Math.abs(nx) + (approxTextHeight / 2) * Math.abs(ny);
  const liftPerp = needsPerpendicularLift ? halfExtentOnNormal + 4 / scale : 0;

  const labelX = mx + nx * liftPerp;
  const labelY = my + ny * liftPerp;

  const line1End = { x: mx - ux * halfGap, y: my - uy * halfGap };
  const line2Start = { x: mx + ux * halfGap, y: my + uy * halfGap };

  return {
    textStr,
    fontSize,
    labelX,
    labelY,
    approxTextWidth,
    approxTextHeight,
    line1Points: [line.start.x, line.start.y, line1End.x, line1End.y],
    line2Points: [line2Start.x, line2Start.y, line.end.x, line.end.y],
  };
};

// Inject formatLength dependency to avoid circular import issues
import { formatLength } from '../../utils/unitConverter';
getMeasurementLineLayout._deps = { formatLength };

/** Helper function to convert screen coordinates to canvas coordinates */
export const getCanvasCoordinates = (stage, scaleRef) => {
  const pos = stage.getPointerPosition();
  if (!pos) return null;
  
  const stagePos = stage.position();
  const currentScale = scaleRef.current;
  
  return {
    x: (pos.x - stagePos.x) / currentScale,
    y: (pos.y - stagePos.y) / currentScale
  };
};

/** Calculate distance from point to line segment */
export const pointToLineDistance = (point, lineStart, lineEnd) => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  const lengthSquared = dx * dx + dy * dy;
  
  if (lengthSquared === 0) {
    const dpx = point.x - lineStart.x;
    const dpy = point.y - lineStart.y;
    return Math.sqrt(dpx * dpx + dpy * dpy);
  }
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / lengthSquared
  ));
  
  const projX = lineStart.x + t * dx;
  const projY = lineStart.y + t * dy;
  
  const dpx = point.x - projX;
  const dpy = point.y - projY;
  
  return Math.sqrt(dpx * dpx + dpy * dpy);
};
