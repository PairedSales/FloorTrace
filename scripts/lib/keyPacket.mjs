// The blind packet: what an annotator may know about a plan besides its image
// (scripts/realKeyTool.mjs `blind`), and the labels `check` tests a key against.
//
// A key is drawn blind: without the app's trace, its scale or any judgement of
// how it does. So the packet is built by naming what it takes (the image and
// three lists of what the scan read), never by removing what it must not carry.
// A field a later scan adds to the plan cannot leak into it.
//
// The kinds are decided once, when `blind` writes the packet, by `labelKind`, and
// `labelKind` leans on the app's own `matchExteriorFeature`
// (src/utils/dimensions/exteriorLabels.js): a change to those words moves the
// kinds of every packet written after it. `check` reads the packet's labels and
// not `labelsOf(state)`, so a key drawn against a packet is judged by the kinds its
// annotators saw whatever the app's words become; a plan with no packet is judged
// by `labelKind` as it stands.
import { matchExteriorFeature } from '../../src/utils/dimensions/exteriorLabels.js';
import { planImageBytes, extOfMime, decodeBytes } from './keyFiles.mjs';

// Words that make a label non-GLA beyond the app's own exterior-feature list
// (garage, carport, porch, patio, deck, terrace, stoop, breezeway, balcony…).
const ALSO_NON_GLA = /\b(screened|porte[-\s]?cochere|loggia)\b/i;

/**
 * `'nonGla'` for a label whose words name garage, carport, porch, patio, deck,
 * terrace, stoop, breezeway, balcony, screened space… (the app's exterior
 * feature words, `matchExteriorFeature`, plus a few), else `'room'`. The one
 * definition `blind` and `check` share.
 */
export const labelKind = (text) => (typeof text === 'string' && (matchExteriorFeature(text) || ALSO_NON_GLA.test(text))
  ? 'nonGla'
  : 'room');

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const round3 = (x) => (finite(x) ? Math.round(x * 1000) / 1000 : null);

const bboxOf = (b) => (b && finite(b.x) && finite(b.y) && finite(b.width) && finite(b.height)
  ? { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) }
  : null);

// A size line sits directly under the name of its space: the gap between the
// name's box and the size's box is about a line, and the two are centred. So a
// dimension label under GARAGE is the garage's own size, not a room's. Measured
// on the 75 plans of the set: gaps of 2–33 px under names 14–38 px tall.
const nameAbove = (dim, name) => {
  const gap = dim.y - (name.y + name.height);
  const line = Math.max(name.height, dim.height);
  const dx = Math.abs((dim.x + dim.width / 2) - (name.x + name.width / 2));
  return gap >= -0.3 * name.height && gap <= 1.3 * line && dx <= 0.6 * Math.max(name.width, dim.width);
};

/**
 * What the scan read, as labels: `{id, kind, source, text, bbox, …}`.
 * `d<i>` are the room sizes (`widthFt`, `heightFt` as printed), `e<i>` the
 * garage/porch/patio… names (`keyword`), `a<i>` the level names (`levelType`,
 * `keyword`; `kind: 'level'`, never tested against an outline). A size printed
 * under an exterior name is `kind: 'nonGla'` and says which (`nameLabel`).
 * The index is the label's place in the plan's own list.
 */
export const labelsOf = (state) => {
  const exterior = [];
  (state?.exteriorLabels ?? []).forEach((l, i) => {
    const bbox = bboxOf(l?.bbox);
    if (!bbox) return;
    exterior.push({
      id: `e${i}`, kind: 'nonGla', source: 'exterior', keyword: String(l.keyword ?? ''), text: String(l.text ?? ''), bbox,
    });
  });
  const dimensions = [];
  (state?.detectedDimensions ?? []).forEach((l, i) => {
    const bbox = bboxOf(l?.bbox);
    if (!bbox) return;
    const text = String(l.text ?? '');
    const label = {
      id: `d${i}`,
      kind: labelKind(text) === 'nonGla' || labelKind(String(l.ocrText ?? '')) === 'nonGla' ? 'nonGla' : 'room',
      source: 'dimension',
      text,
      bbox,
      widthFt: round3(l.width),
      heightFt: round3(l.height),
    };
    if (label.kind === 'room') {
      const owner = exterior.find((e) => nameAbove(bbox, e.bbox));
      if (owner) {
        label.kind = 'nonGla';
        label.nameLabel = owner.id;
      }
    }
    dimensions.push(label);
  });
  const levels = [];
  (state?.areaLabels ?? []).forEach((l, i) => {
    const bbox = bboxOf(l?.bbox);
    if (!bbox) return;
    levels.push({
      id: `a${i}`, kind: 'level', source: 'level', levelType: String(l.type ?? ''), keyword: String(l.keyword ?? ''), text: String(l.text ?? ''), bbox,
    });
  });
  return [...dimensions, ...exterior, ...levels];
};

/**
 * How the labels a plan's scan reads now (`live`) differ from a packet's
 * (`packet`), as one sentence each: an id the scan no longer reads, one it
 * newly reads, one whose text, kind or box moved. Empty when they agree.
 */
export const labelDrift = (packet, live) => {
  const now = new Map(live.map((l) => [l.id, l]));
  const out = [];
  const box = (l) => [l.bbox.x, l.bbox.y, l.bbox.width, l.bbox.height].join(',');
  for (const p of packet) {
    const l = now.get(p.id);
    now.delete(p.id);
    if (!l) out.push(`${p.id} "${p.text}" is in the packet, and the scan no longer reads it`);
    else if (l.kind !== p.kind || l.text !== p.text || box(l) !== box(p)) {
      out.push(`${p.id} is ${p.kind} "${p.text}" at ${box(p)} in the packet, ${l.kind} "${l.text}" at ${box(l)} in the scan now`);
    }
  }
  for (const l of now.values()) out.push(`${l.id} "${l.text}" is in the scan now, and not in the packet`);
  return out;
};

/**
 * A plan's blind packet: `{image: {bytes, mime, ext}, labels: {labels}, meta:
 * {name, width, height}}`. `image` is the plan's exact bytes, so coordinates
 * are the key's. Reads the image and the three label lists and nothing else of
 * the plan.
 */
export const buildPacket = async (project, name) => {
  const state = project?.floors?.[0]?.state;
  const { bytes, mime } = planImageBytes(project);
  const { width, height } = await decodeBytes(bytes, mime);
  return {
    image: { bytes, mime, ext: extOfMime(mime) },
    labels: { labels: labelsOf(state) },
    meta: { name, width, height },
  };
};
