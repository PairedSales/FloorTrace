// Two independently drawn keys, compared (scripts/realKeyTool.mjs `compare`),
// under the protocol's rule for whether they agree:
//   (a) the same multiset of outline types, not counting a small unfinished
//       outline (below);
//   (b) the building outlines (gla + below-grade) at IoU >= 99%;
//   (c) the non-GLA outlines at IoU >= 97%, per type (garage, porch);
//   (d) no boundary point more than 3 px from the other key's boundary of the
//       same class (building, non-GLA).
//
// Unfinished space is not scored, so it may not decide agreement by its
// edges: it is in neither (b), (c) nor (d). Whether an unfinished outline
// exists is a judgment (the pilot's annotators split on 12-13 sq ft chimney
// masses), so only a large one is part of (a): one under `unfinishedShare` (2%)
// of ITS OWN key's building area (the summed area of its gla and below-grade
// outlines) is set aside, listed as `informational`, and does not count as a
// type. A larger unfinished outline present in one key only still fails (a).
// (Before this, unfinished was a third class in (d), so a chimney one key
// lacked failed (a) and (d) both.)
//
// IoU is the exact area of what a type's outlines share over the exact area of
// their union (lib/keyGeometry.mjs `areasOf`, with no raster: a 0.5 px raster
// was off by 0.2% on a house of 600-900 px and 0.8% on one of 100-200 px, past
// the protocol's ±0.2%, and the 99% line is where two keys agree or not).
// Boundary distance
// samples each key's boundary about every 1 px and measures to the other key's
// boundary of the same class, in both directions; the p95 pools both.
import { CLASS_OF, OUTLINE_TYPES } from './keySpec.mjs';
import {
  areaOf, areasOf, bboxOf, distanceToSegments, sampleRing, segmentsOf,
} from './keyGeometry.mjs';

export const AGREEMENT = {
  buildingIou: 0.99,
  nonGlaIou: 0.97,
  maxDistance: 3,
  // An unfinished outline under this share of its key's building area does not
  // count as an outline type.
  unfinishedShare: 0.02,
};
const CLUSTER_GAP = 15;

const ringsOf = (outlines, types) => outlines.filter((o) => types.includes(o.type)).map((o) => o.v);
const typesInClass = (cls) => OUTLINE_TYPES.filter((t) => CLASS_OF[t] === cls);
const CLASSES = ['building', 'nonGla', 'unfinished'];
// The classes whose boundaries are held to a distance: what is scored.
const BOUNDARY_CLASSES = ['building', 'nonGla'];

const countTypes = (outlines) => {
  const counts = {};
  for (const o of outlines) counts[o.type] = (counts[o.type] ?? 0) + 1;
  return counts;
};

// The unfinished outlines of `own` that are small beside its building: set
// aside from (a), and reported. `other` says whether the other key has an
// unfinished outline over the same ground, which is what a reader wants to know
// ("B drew it too" or "B has none there").
const smallUnfinished = (own, other, side, rule) => {
  const building = own
    .filter((o) => CLASS_OF[o.type] === 'building')
    .reduce((sum, o) => sum + areaOf(o.v), 0);
  const otherRings = ringsOf(other, ['unfinished']);
  const found = [];
  own.forEach((o, k) => {
    if (o.type !== 'unfinished') return;
    const area = areaOf(o.v);
    if (!(area < rule.unfinishedShare * building)) return;
    found.push({
      key: side,
      outline: k,
      name: o.name ?? null,
      area,
      share: area / building,
      limit: rule.unfinishedShare,
      bbox: bboxOf([o.v]),
      inOther: otherRings.length > 0 && areasOf([o.v], otherRings).inter > 0,
    });
  });
  return found;
};

// The types of the outlines that count, sorted: the multiset criterion (a) reads.
const typeList = (outlines, skipped) => outlines
  .filter((_, k) => !skipped.has(k))
  .map((o) => o.type)
  .sort();

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
 * `{agree, failed, counts, iou, boundary, regions, criteria, informational}`:
 * - `counts` are every outline's type, small unfinished ones included;
 * - `iou.byType[type]` and `iou.building` / `iou.nonGla` / `iou.unfinished`
 *   are `{iou, a, b, inter, union}` (areas in px²); the unfinished one is
 *   informational, in no criterion;
 * - `boundary` is `{max, p95, aToB, bToA, byClass}`, each `{max, p95, n}`, over
 *   the scored classes (building, nonGla);
 * - `regions` are the disagreement regions, worst first: `{id, bbox, maxDistance,
 *   at, side, class, points}`, or `{missing: 'A'|'B', bbox, …}` for an outline
 *   whose class the other key does not have at all (`scored: false` for an
 *   unfinished one, which fails (a) and not (d));
 * - `criteria` lists (a)-(d) as `{id, ok, text}`; `failed` the texts of those not ok;
 * - `informational` lists the small unfinished outlines set aside from (a):
 *   `{key: 'A'|'B', outline, name, area, share, limit, bbox, inOther}`.
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

  // Unfinished outlines too small to count as a type, and so as not to decide (a).
  const smallA = smallUnfinished(a, b, 'A', rule);
  const smallB = smallUnfinished(b, a, 'B', rule);
  const skippedA = new Set(smallA.map((s) => s.outline));
  const skippedB = new Set(smallB.map((s) => s.outline));
  const informational = [...smallA, ...smallB];

  // Boundary distances, class by class: the scored classes only.
  const boundary = { byClass: {} };
  const far = [];
  const all = { aToB: [], bToA: [] };
  const missing = [];
  for (const cls of BOUNDARY_CLASSES) {
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

  // A counted unfinished outline the other key has no counted one to match is
  // a place to look. It is listed with the regions but is not a distance
  // failure: it fails (a), which says so.
  const unscored = [];
  for (const [side, own, other] of [['A', a, b], ['B', b, a]]) {
    const skipped = side === 'A' ? skippedA : skippedB;
    const otherSkipped = side === 'A' ? skippedB : skippedA;
    const theirs = other.filter((o, k) => o.type === 'unfinished' && !otherSkipped.has(k));
    if (theirs.length) continue;
    own.forEach((o, k) => {
      if (o.type === 'unfinished' && !skipped.has(k)) unscored.push({ missing: side, class: 'unfinished', bbox: bboxOf([o.v]), scored: false });
    });
  }

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
  regions.push(...missing, ...unscored);
  regions.forEach((r, i) => { r.id = i + 1; });

  const typesA = typeList(a, skippedA);
  const typesB = typeList(b, skippedB);
  const sameTypes = typesA.join(',') === typesB.join(',');
  const setAside = informational.length
    ? ` (${informational.length} small unfinished outline(s) set aside, under ${pct(rule.unfinishedShare)} of their key's building: informational)`
    : '';
  const criteria = [{
    id: 'a',
    ok: sameTypes,
    text: sameTypes
      ? `outline types match (${typesA.join(', ') || 'none'})${setAside}`
      : `outline types differ: A has [${typesA.join(', ')}], B has [${typesB.join(', ')}]${setAside}`,
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
    informational,
  };
};
