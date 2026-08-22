// Which reported subtotal each outline belongs to, read off the plan's own
// printed labels. The vocabulary lives in dimensions/areaLabels.js and the OCR
// pass collects the hits; this module is only the arbitration — which outline
// owns which label, and what the labels an outline owns together say it is.

import { pointInPolygon } from './detection/polygon.js';
import { normalizeTraceType } from './traceTypes.js';

const centerOf = (bbox) => ({
  x: bbox.x + bbox.width / 2,
  y: bbox.y + bbox.height / 2,
});

const boundsOf = (vertices) => {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const v of vertices) {
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
  }
  return { minX, minY, maxX, maxY };
};

const boundsArea = (b) => (b.maxX - b.minX) * (b.maxY - b.minY);

// How far outside an outline a caption may sit and still be read as its title,
// measured in the text's own line heights — the gap a sheet leaves under a plan
// scales with the type it is set in, not with the page.
const TITLE_BAND = 6;

// Vertical gap from an outline to a label that is centred over it. Infinity for
// a label off to one side: a caption is centred on the plan it names, so
// anything beside the outline is a legend row however close it happens to sit.
const titleGap = (bounds, label) => {
  const c = centerOf(label.bbox);
  const pad = (bounds.maxX - bounds.minX) * 0.1;
  if (c.x < bounds.minX - pad || c.x > bounds.maxX + pad) return Infinity;
  return Math.max(
    bounds.minY - (label.bbox.y + label.bbox.height),
    label.bbox.y - bounds.maxY,
    0,
  );
};

/**
 * What each outline's own labels say it is.
 *
 * Labels inside an outline decide it; a title outside decides only an outline
 * that has none of its own. Returns one verdict per outline that has evidence —
 * an outline with none is simply absent, which is not the same as a verdict of
 * GLA and is what lets a caller tell "no labels here" from "these labels say
 * living area".
 *
 * @param {Array} traces  perimeter traces, `vertices` in original image px
 * @param {Array} labels  `{type, keyword, text, bbox}` from the OCR pass
 * @returns {Array<{id: string, type: string, from: 'inside'|'title', keyword: string, text: string}>}
 */
export function classifyTraces(traces, labels) {
  const shaped = (traces || [])
    .filter((t) => t?.id && t.vertices?.length >= 3)
    .map((t) => ({ trace: t, bounds: boundsOf(t.vertices), inside: [], title: [] }));
  if (!shaped.length) return [];

  const outside = [];
  for (const label of labels || []) {
    if (!label?.bbox || !label.type) continue;
    const c = centerOf(label.bbox);
    // Innermost wins. A garage or an addition traced as its own outline sits
    // inside the outline it was cut from, and the label belongs to the smaller
    // of the two — list order says nothing about which that is.
    let host = null;
    for (const s of shaped) {
      if (!pointInPolygon(c, s.trace.vertices)) continue;
      if (!host || boundsArea(s.bounds) < boundsArea(host.bounds)) host = s;
    }
    if (host) host.inside.push(label);
    else outside.push(label);
  }

  for (const label of outside) {
    const band = TITLE_BAND * Math.max(label.bbox.height, 1);
    const near = shaped.filter((s) => titleGap(s.bounds, label) <= band);
    // Exactly one outline in range, or the label says nothing about which one
    // it names. Sheets caption their plans above as often as below, so on a
    // multi-plan page a nearest-wins tiebreak reliably picks the neighbour:
    // fixtures/ExampleFloorplan2 prints "FLOOR 2" nearer to the plan below it
    // than to the one it belongs to.
    if (near.length === 1) near[0].title.push(label);
  }

  const verdicts = [];
  for (const s of shaped) {
    const evidence = s.inside.length ? s.inside : s.title;
    if (!evidence.length) continue;
    const votes = new Map();
    for (const label of evidence) {
      const type = normalizeTraceType(label.type);
      const bucket = votes.get(type) ?? { count: 0, label };
      bucket.count += 1;
      votes.set(type, bucket);
    }
    const ranked = [...votes.entries()].sort((a, b) => b[1].count - a[1].count);
    // A tie is the labels contradicting each other about their own outline.
    // Leaving the type alone is the only answer to that which is not a coin toss.
    if (ranked.length > 1 && ranked[0][1].count === ranked[1][1].count) continue;
    const [type, { label }] = ranked[0];
    verdicts.push({
      id: s.trace.id,
      type,
      from: s.inside.length ? 'inside' : 'title',
      keyword: label.keyword,
      text: label.text,
    });
  }
  return verdicts;
}
