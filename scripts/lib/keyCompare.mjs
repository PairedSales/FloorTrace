// Two independently drawn keys, compared (scripts/realKeyTool.mjs `compare`),
// under the protocol's rule for whether they agree:
//   (a) the same multiset of outline types;
//   (b) the building outlines (gla + below-grade) at IoU >= 99%;
//   (c) the non-GLA outlines at IoU >= 97%, per type (garage, porch);
//   (d) no boundary point more than 3 px from the other key's boundary of the
//       same class (building, non-GLA, unfinished).
//
// IoU is the union of a type's outlines on a 0.5 px raster (lib/keyGeometry.mjs),
// exact to far better than the ±0.2% the protocol needs. Boundary distance
// samples each key's boundary about every 1 px and measures to the other key's
// boundary of the same class, in both directions; the p95 pools both.
import { CLASS_OF, OUTLINE_TYPES } from './keySpec.mjs';
import {
  areasOf, bboxOf, distanceToSegments, sampleRing, segmentsOf,
} from './keyGeometry.mjs';

export const AGREEMENT = {
  buildingIou: 0.99,
  nonGlaIou: 0.97,
  maxDistance: 3,
};
const CLUSTER_GAP = 15;

const ringsOf = (outlines, types) => outlines.filter((o) => types.includes(o.type)).map((o) => o.v);
const typesInClass = (cls) => OUTLINE_TYPES.filter((t) => CLASS_OF[t] === cls);
const CLASSES = ['building', 'nonGla', 'unfinished'];

const countTypes = (outlines) => {
  const counts = {};
  for (const o of outlines) counts[o.type] = (counts[o.type] ?? 0) + 1;
  return counts;
};

// The value below which `share` of the sorted values fall.
export const percentile = (sorted, share) => {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(share * sorted.length) - 1))];
};

// Points farther than `tolerance`, grouped into regions: points within
// CLUSTER_GAP px of one another (through others) are one region.
const clusterPoints = (points) => {
  const parent = points.map((_, i) => i);
  const find = (i) => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cur = i;
    while (parent[cur] !== root) {
      const next = parent[cur];
      parent[cur] = root;
      cur = next;
    }
    return root;
  };
  const cells = new Map();
  points.forEach((p, i) => {
    const cx = Math.floor(p.at[0] / CLUSTER_GAP);
    const cy = Math.floor(p.at[1] / CLUSTER_GAP);
    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        for (const j of cells.get(`${cx + dx},${cy + dy}`) ?? []) {
          if (Math.hypot(points[j].at[0] - p.at[0], points[j].at[1] - p.at[1]) <= CLUSTER_GAP) parent[find(i)] = find(j);
        }
      }
    }
    const key = `${cx},${cy}`;
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
  });
  const groups = new Map();
  points.forEach((p, i) => {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(p);
  });
  return [...groups.values()];
};

const pct = (x) => `${(x * 100).toFixed(2)}%`;

/**
 * Compares two keys, each `[{type, v}]`. Returns
 * `{agree, failed, counts, iou, boundary, regions, criteria}`:
 * - `iou.byType[type]` and `iou.building` / `iou.nonGla` / `iou.unfinished`
 *   are `{iou, a, b, inter, union}` (areas in px²);
 * - `boundary` is `{max, p95, aToB, bToA, byClass}`, each `{max, p95, n}`;
 * - `regions` are the disagreement regions, worst first: `{id, bbox, maxDistance,
 *   at, side, class, points}`, or `{missing: 'A'|'B', bbox, …}` for an outline
 *   whose class the other key does not have at all;
 * - `criteria` lists (a)-(d) as `{id, ok, text}`; `failed` the texts of those not ok.
 */
export const compareKeys = (a, b, options = {}) => {
  const rule = { ...AGREEMENT, ...options };
  const countsA = countTypes(a);
  const countsB = countTypes(b);
  const iou = { byType: {} };
  for (const type of OUTLINE_TYPES) {
    if (!countsA[type] && !countsB[type]) continue;
    iou.byType[type] = areasOf(ringsOf(a, [type]), ringsOf(b, [type]));
  }
  for (const cls of CLASSES) {
    const types = typesInClass(cls);
    if (!a.some((o) => types.includes(o.type)) && !b.some((o) => types.includes(o.type))) continue;
    iou[cls] = areasOf(ringsOf(a, types), ringsOf(b, types));
  }

  // Boundary distances, class by class.
  const boundary = { byClass: {} };
  const far = [];
  const all = { aToB: [], bToA: [] };
  const missing = [];
  for (const cls of CLASSES) {
    const types = typesInClass(cls);
    const ringsA = ringsOf(a, types);
    const ringsB = ringsOf(b, types);
    const sides = [['A', 'aToB', ringsA, ringsB], ['B', 'bToA', ringsB, ringsA]];
    const pooled = [];
    for (const [side, key, from, to] of sides) {
      if (!from.length) continue;
      if (!to.length) {
        for (const ring of from) missing.push({ missing: side, class: cls, bbox: bboxOf([ring]) });
        continue;
      }
      const segs = segmentsOf(to);
      for (const ring of from) {
        for (const p of sampleRing(ring, 1)) {
          const d = distanceToSegments(p, segs);
          all[key].push(d);
          pooled.push(d);
          if (d > rule.maxDistance) far.push({ at: p, d, side, class: cls });
        }
      }
    }
    if (pooled.length) {
      pooled.sort((x, y) => x - y);
      boundary.byClass[cls] = { max: pooled[pooled.length - 1], p95: percentile(pooled, 0.95), n: pooled.length };
    }
  }
  const summary = (list) => {
    const sorted = [...list].sort((x, y) => x - y);
    return { max: sorted.length ? sorted[sorted.length - 1] : 0, p95: percentile(sorted, 0.95), n: sorted.length };
  };
  boundary.aToB = summary(all.aToB);
  boundary.bToA = summary(all.bToA);
  const pool = summary([...all.aToB, ...all.bToA]);
  boundary.max = pool.max;
  boundary.p95 = pool.p95;

  const regions = clusterPoints(far).map((points) => {
    const worst = points.reduce((best, p) => (p.d > best.d ? p : best), points[0]);
    return {
      bbox: bboxOf([points.map((p) => p.at)]),
      maxDistance: worst.d,
      at: worst.at,
      side: worst.side,
      class: worst.class,
      points: points.length,
    };
  }).sort((x, y) => y.maxDistance - x.maxDistance);
  regions.push(...missing);
  regions.forEach((r, i) => { r.id = i + 1; });

  const typesA = Object.keys(countsA).sort().flatMap((t) => Array(countsA[t]).fill(t));
  const typesB = Object.keys(countsB).sort().flatMap((t) => Array(countsB[t]).fill(t));
  const sameTypes = typesA.join(',') === typesB.join(',');
  const criteria = [{
    id: 'a',
    ok: sameTypes,
    text: sameTypes
      ? `outline types match (${typesA.join(', ') || 'none'})`
      : `outline types differ: A has [${typesA.join(', ')}], B has [${typesB.join(', ')}]`,
  }];
  const building = iou.building ?? { iou: 1 };
  criteria.push({
    id: 'b',
    ok: building.iou >= rule.buildingIou,
    text: `building IoU ${pct(building.iou)} ${building.iou >= rule.buildingIou ? '>=' : '<'} ${pct(rule.buildingIou)}`,
  });
  for (const type of ['garage', 'porch']) {
    const t = iou.byType[type];
    if (!t) continue;
    criteria.push({
      id: 'c',
      ok: t.iou >= rule.nonGlaIou,
      text: `${type} IoU ${pct(t.iou)} ${t.iou >= rule.nonGlaIou ? '>=' : '<'} ${pct(rule.nonGlaIou)}`,
    });
  }
  const worst = regions.find((r) => r.maxDistance !== undefined);
  const distanceOk = boundary.max <= rule.maxDistance && !missing.length;
  criteria.push({
    id: 'd',
    ok: distanceOk,
    text: distanceOk
      ? `largest boundary distance ${boundary.max.toFixed(2)} px <= ${rule.maxDistance} px`
      : `boundary distance: ${worst ? `largest ${worst.maxDistance.toFixed(2)} px (> ${rule.maxDistance} px) in ${regions.filter((r) => r.maxDistance !== undefined).length} region(s)` : ''}${missing.length ? `${worst ? '; ' : ''}${missing.length} outline(s) whose class the other key lacks` : ''}`,
  });
  const failed = criteria.filter((c) => !c.ok).map((c) => c.text);
  return {
    agree: failed.length === 0,
    failed,
    counts: { a: countsA, b: countsB },
    iou,
    boundary,
    regions,
    criteria,
  };
};
