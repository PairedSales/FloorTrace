// What the labels on the plan are, and where they go — the canvas's side of
// `utils/labelLayout.js`, which decides where and knows nothing about text.
//
// Three kinds share one page: each outline's name and area (the sticker, put
// where the plan has the least print by `labelAnchor.js` and fixed here), what a
// cut-out takes off, and the length of every wall of the outline in hand. They are
// placed in that order, so a wall length goes round the sticker and not the other
// way about; each is placed with every outline's walls and corners in view, not
// only its own.

import { formatLength, getUnitStyleFromDimensions } from '../../utils/unitConverter';
import {
  LABEL_SHRINKS, isFarOut, outwardNormals, placeLabels, ringObstacles, toLayoutSpace,
  wallLabelCandidates,
} from '../../utils/labelLayout';
import { measureSideLenWidth } from './canvasUtils';

// The label is a fixed size on screen whatever the zoom, so everything here is in
// pixels and is divided by the scale only at the end.
const MIN_FONT_PX = 9;
const MAX_FONT_PX = 22;
const BASE_FONT_PX = 15;
// A tab is its text with 8 px either side.
const TAB_PAD_PX = 16;
const MIN_TAB_WIDTH_PX = 30;
// A wall's own label is kept to this much of its length, so it reads as that
// wall's and not its neighbour's.
const WALL_SHARE = 0.9;

// What a label keeps off, in pixels from the centre of the line or the corner.
// A handle is 6 px of radius and grows to ~10 under the pointer; the stroke of
// an outline is at most 2.5 px.
const HANDLE_RADIUS_PX = 12;
const TOUCH_HANDLE_RADIUS_PX = 15;
const JOINT_RADIUS_PX = 4;
const WALL_REACH_PX = 2;

// Where a cut-out's label may go when its middle is taken: round it, near first.
const CUTOUT_OFFSETS = (() => {
  const out = [{ dx: 0, dy: 0, cost: 0 }];
  for (const r of [26, 52]) {
    for (let k = 0; k < 8; k += 1) {
      const a = (k * Math.PI) / 4;
      out.push({ dx: Math.cos(a) * r, dy: Math.sin(a) * r, cost: r });
    }
  }
  return out;
})();

/** The size wall lengths are written at: as big as the plan's own print, within reason. */
export const wallFontPx = (detectedDimensions) => {
  const dims = (detectedDimensions ?? []).filter((d) => d?.bbox);
  if (!dims.length) return BASE_FONT_PX;
  const printed = dims.reduce((sum, d) => sum + d.bbox.height, 0) / dims.length;
  return Math.min(MAX_FONT_PX, Math.max(BASE_FONT_PX, printed));
};

const tabHeight = (font) => Math.max(font * 1.45, 18);
const tabWidth = (text, font) => Math.max(MIN_TAB_WIDTH_PX, measureSideLenWidth(text, font) + TAB_PAD_PX);

/**
 * The sizes one wall's length can be written at, largest first. The largest is
 * the one that fits its wall (down to the smallest legible type); the rest are
 * what the label may fall back to when the largest has nowhere to go.
 */
export const wallLabelTiers = (text, lengthPx, idealFont) => {
  const maxWidth = Math.max(MIN_TAB_WIDTH_PX, lengthPx * WALL_SHARE);
  let font = idealFont;
  if (tabWidth(text, font) > maxWidth) {
    let lo = MIN_FONT_PX;
    let hi = font;
    for (let i = 0; i < 10; i += 1) {
      const mid = (lo + hi) / 2;
      if (tabWidth(text, mid) > maxWidth) hi = mid; else lo = mid;
    }
    font = Math.max(MIN_FONT_PX, lo);
  }
  const tiers = [];
  for (const shrink of LABEL_SHRINKS) {
    const f = Math.max(MIN_FONT_PX, font * shrink);
    if (tiers.length && Math.abs(tiers[tiers.length - 1].font - f) < 0.25) continue;
    tiers.push({ font: f, w: tabWidth(text, f), h: tabHeight(f) });
  }
  return tiers;
};

// What a label is called in `labelPlacements`. A wall's also carries where the
// wall was (`wallSig`), so a label left where the user put it is dropped when the
// wall it measured is moved or deleted, and never hangs in space.
export const wallKey = (outlineId, index) => `wall:${outlineId}:${index}`;
export const stickerKey = (outlineId) => `sticker:${outlineId}`;
export const cutoutKey = (key) => `cutout:${key}`;
export const wallSig = (a, b) => `${a.x.toFixed(1)},${a.y.toFixed(1)},${b.x.toFixed(1)},${b.y.toFixed(1)}`;

const rectAround = (x, y, w, h) => ({ x0: x - w / 2, y0: y - h / 2, x1: x + w / 2, y1: y + h / 2 });

/**
 * Place every label on the plan.
 *
 * @param {object} input
 * @param {{id:string, vertices:{x:number,y:number}[], holes?:{x:number,y:number}[][]}[]} input.outlines
 *   every outline that is drawn
 * @param {string|null} input.activeId the outline whose corners are handles and whose wall lengths are drawn
 * @param {{x:number,y:number}[]|null} [input.activeVertices] that outline as it is now (mid-drag),
 *   when it differs from the one in `outlines`
 * @param {number} input.scale screen px per image px
 * @param {number} input.rotation the plan's turn, in degrees
 * @param {{x:number,y:number}|null} input.feetPerPixel
 * @param {object[]} [input.detectedDimensions]
 * @param {string} input.unit
 * @param {boolean} [input.wallLengths] whether the wall lengths are drawn
 * @param {boolean} [input.handles] whether the active outline's corners are drawn as handles
 * @param {boolean} [input.touch]
 * @param {{x:number,y:number,width:number,height:number}[]} [input.stickers] each outline's name
 *   and area: the middle in the image, and the size in pixels
 * @param {{key:string, centre:{x:number,y:number}, width:number, height:number}[]} [input.cutouts]
 * @param {Object} [input.moved] labels the user has dragged and that are still good
 *   for this zoom (`movedLabelsAt`), by key: they are where they were put, and the rest go round them
 * @returns {{walls: (null|object)[], stickers: Map<string,{x:number,y:number}>, cutouts: Map<string,{x:number,y:number}>}} `walls` has an entry per
 *   wall of the active outline, in its order: where its label goes (in the image) and how big it is
 */
export function layoutLabels({
  outlines, activeId, activeVertices = null, scale, rotation, feetPerPixel, detectedDimensions, unit,
  wallLengths = true, handles = true, touch = false, stickers = [], cutouts = [], moved = {},
}) {
  const result = { walls: [], stickers: new Map(), cutouts: new Map() };
  if (!(scale > 0)) return result;
  const space = toLayoutSpace(rotation, scale);

  // What to keep off: every outline's walls, its cut-outs', and the active
  // outline's corners, which are handles.
  const obstacles = { segments: [], discs: [], rects: [] };
  let activeRing = null;
  for (const outline of outlines) {
    const isActive = outline.id === activeId;
    const vertices = isActive && activeVertices ? activeVertices : outline.vertices;
    if (!vertices || vertices.length < 3) continue;
    const ring = vertices.map(space.forward);
    if (isActive) activeRing = ring;
    const corner = isActive && handles ? (touch ? TOUCH_HANDLE_RADIUS_PX : HANDLE_RADIUS_PX) : JOINT_RADIUS_PX;
    const mine = ringObstacles(ring, { reach: WALL_REACH_PX, corner });
    obstacles.segments.push(...mine.segments);
    obstacles.discs.push(...mine.discs);
    for (const hole of outline.holes ?? []) {
      if (!hole || hole.length < 3) continue;
      obstacles.segments.push(...ringObstacles(hole.map(space.forward), { reach: WALL_REACH_PX, corner: 0 }).segments);
    }
  }

  // The names and areas are already where they are going, or where the user
  // put them.
  for (const s of stickers) {
    const put = moved[stickerKey(s.id)];
    const at = put ?? s;
    result.stickers.set(s.id, { x: at.x, y: at.y });
    const m = space.forward(at);
    obstacles.rects.push(rectAround(m.x, m.y, s.width, s.height));
  }

  // The crowding rule applies to the outline in hand: a thumbnail of it is
  // where the labels cannot be told apart whatever is done.
  const crowdsOk = isFarOut(activeRing);

  const held = { segments: [], discs: [], rects: obstacles.rects.slice() };

  // Cut-outs: only the labels already down are in the way, because their own
  // dashed edge is what the label is *for*.
  const cutoutRequests = [];
  for (const c of cutouts) {
    const put = moved[cutoutKey(c.key)];
    if (put) {
      result.cutouts.set(c.key, { x: put.x, y: put.y });
      const m = space.forward(put);
      obstacles.rects.push(rectAround(m.x, m.y, c.width, c.height));
      held.rects.push(rectAround(m.x, m.y, c.width, c.height));
      continue;
    }
    const m = space.forward(c.centre);
    cutoutRequests.push({
      id: c.key,
      candidates: CUTOUT_OFFSETS.map((o) => ({
        x: m.x + o.dx, y: m.y + o.dy, w: c.width, h: c.height, cost: o.cost,
      })),
    });
  }
  const cutoutPlaces = placeLabels(cutoutRequests, held, { crowdsOk });
  for (const [key, at] of cutoutPlaces) {
    const back = space.back(at);
    result.cutouts.set(key, { x: back.x, y: back.y });
    obstacles.rects.push(rectAround(at.x, at.y, at.w, at.h));
  }

  if (!wallLengths || !feetPerPixel || !activeRing) return result;

  const vertices = activeVertices ?? outlines.find((o) => o.id === activeId)?.vertices;
  const unitStyle = getUnitStyleFromDimensions(detectedDimensions, unit);
  const ideal = wallFontPx(detectedDimensions);
  const normals = outwardNormals(activeRing);

  const texts = [];
  const tiersOf = [];
  const requests = [];
  const fixedWalls = new Map();
  for (let i = 0; i < activeRing.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const dxFeet = (b.x - a.x) * feetPerPixel.x;
    const dyFeet = (b.y - a.y) * feetPerPixel.y;
    const text = formatLength(Math.hypot(dxFeet, dyFeet), unit, unitStyle);
    texts.push(text);
    const pa = activeRing[i];
    const pb = activeRing[(i + 1) % activeRing.length];
    const tiers = wallLabelTiers(text, Math.hypot(pb.x - pa.x, pb.y - pa.y), ideal);
    tiersOf.push(tiers);

    // Where the user put it, as long as it is still that wall: a place left
    // behind by a corner that has moved is no longer anyone's.
    const put = moved[wallKey(activeId, i)];
    if (put && put.sig === wallSig(a, b)) {
      const m = space.forward(put);
      obstacles.rects.push(rectAround(m.x, m.y, tiers[0].w, tiers[0].h));
      fixedWalls.set(i, { x: put.x, y: put.y });
      continue;
    }
    requests.push({ id: i, candidates: wallLabelCandidates(pa, pb, normals[i], tiers) });
  }

  const places = placeLabels(requests, obstacles, { crowdsOk });
  result.walls = texts.map((text, i) => {
    const put = fixedWalls.get(i);
    if (put) {
      const tier = tiersOf[i][0];
      return {
        key: wallKey(activeId, i),
        sig: wallSig(vertices[i], vertices[(i + 1) % vertices.length]),
        formattedLength: text,
        fontSize: tier.font / scale,
        labelWidth: tier.w / scale,
        labelHeight: tier.h / scale,
        finalCx: put.x,
        finalCy: put.y,
        clear: true,
        moved: true,
      };
    }
    const at = places.get(i);
    if (!at) return null;
    const tier = tiersOf[i][at.tier];
    const back = space.back(at);
    return {
      key: wallKey(activeId, i),
      sig: wallSig(vertices[i], vertices[(i + 1) % vertices.length]),
      formattedLength: text,
      fontSize: tier.font / scale,
      labelWidth: tier.w / scale,
      labelHeight: tier.h / scale,
      finalCx: back.x,
      finalCy: back.y,
      clear: at.clear,
      moved: false,
    };
  });
  return result;
}
