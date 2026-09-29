// The automatic checks on a final key (scripts/realKeyTool.mjs `check`; the
// protocol's step 5). Each yields pass, warn, waived or fail; a fail sends the
// key back to the adjudicator.
//
//  page       the snapped key records the size of the page it was snapped on; if
//             the plan's image is another size (the plan was drafted again) every
//             coordinate of the key is on the wrong page: a fail. A snapped file
//             that records no size is not judged.
//  closed     every outline has >= 3 distinct vertices and does not cross itself
//  overlap    building (gla, below-grade) and non-GLA (garage, porch) outlines
//             share no more than their boundary: the overlap may not exceed
//             max(2 px x the length of boundary they share, 0.2% of the smaller
//             outline). Unfinished against scored space, and two outlines of one
//             class, only warn.
//  labels     a `room` label (its box's centre) lies inside a gla, below-grade or
//             unfinished outline; a `nonGla` label inside a garage, porch or
//             unfinished one. Inside an outline of the wrong class is a fail; in
//             none, a warn. The spec's `waive` turns either into `waived`, with
//             its reason, for the reviewer to read.
//  faces      every edge not in `fix` (and not a shared boundary) is snapped
//             again: it must move no more than 2 px, and find a band. The
//             snapped key is already on a band, so this cannot tell a wrong
//             band (a garage door's thin line beside the wall) from the right
//             one: so an edge that was not in `fix` and that the snap flagged
//             far, reaches-end, ink-beyond, bridged, partial or unstable when it
//             ran (the snapped file's `flagged` list) warns, for a reviewer to look at, and
//             stays a warning until the edge is drawn on the face or fixed. It
//             is a warning, not a fail: a rough drawing 5 px off its wall,
//             snapped onto the right band, is what the snap is for.
//  stated     a stated area (the spec's, and any the scan's level labels carry)
//             against the key's at the plan's scale: over 5% apart is a fail
//             unless the spec's entry says why (`explained`), then a warn.
import { snapOutlines, otsuOfImage } from './keySnap.mjs';
import { CLASS_OF, isRef, OUTLINE_TYPES } from './keySpec.mjs';
import {
  areaOf, areasOf, bboxOf, pointInRing, ringProblem, sharedBoundaryLength,
} from './keyGeometry.mjs';

export const FACE_TOLERANCE = 2;
export const STATED_TOLERANCE = 0.05;
const OVERLAP_PX = 2;
const OVERLAP_SHARE = 0.002;
const FIXED_SHARE = 0.5;

// The outline types a label of each kind may lie in: its own class, and unfinished
// space, which holds rooms and exterior features alike.
const HOMES_OF = (cls) => OUTLINE_TYPES.filter((t) => CLASS_OF[t] === cls || CLASS_OF[t] === 'unfinished');
const ROOM_HOMES = HOMES_OF('building');
const NON_GLA_HOMES = HOMES_OF('nonGla');

const label = (o, k) => `outline ${k} ${o.type}${o.name ? ` "${o.name}"` : ''}`;
const sqft = (px2, scale) => (scale ? px2 * scale.x * scale.y : null);
const fmtSqft = (x) => `${Math.round(x).toLocaleString('en-US')} sq ft`;

const bboxesMeet = (a, b) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];

// The words for a snap flag, whether the first snap raised it (the snapped
// file's `flagged`) or the fresh snap of the snapped key did. `f` carries the
// figure the flag names: moved, beyond, bridgedBy, share or residual.
const px = (x) => (Number.isFinite(x) ? ` ${Math.abs(x).toFixed(1)} px` : '');
const FLAG_TEXT = {
  far: (f) => `far (moved${px(f.moved)} onto the band it found, which may not be the wall: a thin door or window line, a dimension line?)`,
  'reaches-end': () => 'reaches-end (the band it found ran to the end of the search)',
  'ink-beyond': (f) => `ink-beyond (another band began${px(f.beyond)} beyond the face it used: a hatched or double-line wall, a dimension line, a window frame or sill drawn proud of the wall?)`,
  unstable: (f) => `unstable (its face moved${px(f.residual)} more when read again from where it landed: windows or doors along the edge?)`,
  bridged: (f) => `bridged (its face is the end of a stroke joined across a gap,${px(f.bridgedBy)} from the stroke nearest the drawn line: a window frame drawn proud of the wall?)`,
  partial: (f) => `partial (the stroke its face is read from is only ${Number.isFinite(f.share) ? `${Math.round(f.share * 100)}% ` : ''}as continuous along the edge as the strongest stroke on it: a window frame or sill drawn proud of the wall?)`,
};

// A sq ft figure a level label's text carries ("FIRST FLOOR 1,250 SQ FT"), if
// it does; the scan's own filter keeps these out today, so this is a courtesy.
const SQFT = /(\d[\d,]*(?:\.\d+)?)\s*(?:sq\.?\s?ft\.?|sqft|s\.?f\.?)\b/i;
export const statedFromLabels = (labels) => labels
  .filter((l) => l.kind === 'level')
  .map((l) => ({ match: SQFT.exec(l.text ?? ''), l }))
  .filter(({ match }) => match)
  .map(({ match, l }) => ({ sqft: Number(match[1].replace(/,/g, '')), of: l.keyword || undefined, from: `scan label ${l.id}` }));

/**
 * Runs every check. Inputs:
 *  - `outlines`: the snapped key, `[{type, v}]`;
 *  - `spec`: the annotator's spec (fix/in/R/tilt/bridge, waive, stated) or null;
 *  - `labels`: the labels the key is judged against (the blind packet's, else
 *    `labelsOf(state)`);
 *  - `image`: `{width, height, data}`;
 *  - `snappedSize`: `{width, height}` of the page the key was snapped on (the
 *    snapped file's `image`), or null when it recorded none;
 *  - `scale`: `{x, y}` feet per pixel, or null;
 *  - `flagged`: the snapped file's `[{outline, edge, flags, moved}]`, what the
 *    snap itself noticed;
 *  - `drift`: how the plan's scan now differs from the packet's labels
 *    (`labelDrift`), each a sentence.
 * Returns `{items, failures, warnings, waived, areas}`; an item is
 * `{status, check, subject, detail}`.
 */
export const checkKey = ({
  outlines, spec = null, labels = [], image, snappedSize = null, scale = null, flagged = [], drift = [],
}) => {
  const items = [];
  const add = (status, check, subject, detail) => items.push({ status, check, subject, detail });
  const specOutlines = spec?.outlines ?? [];
  const waived = new Map((spec?.waive ?? []).map((w) => [w.label, w.reason]));

  // ---- page ----------------------------------------------------------------
  if (Number.isFinite(snappedSize?.width) && Number.isFinite(snappedSize?.height)) {
    const same = snappedSize.width === image.width && snappedSize.height === image.height;
    add(same ? 'pass' : 'fail', 'page', `${image.width} x ${image.height} px`, same
      ? 'the key was snapped on a page of the plan\'s size'
      : `the key was snapped on a ${snappedSize.width} x ${snappedSize.height} px page and the plan's image is ${image.width} x ${image.height} px (was the plan drafted again?): its coordinates are on another page; draw the key again and snap it again`);
  }

  // ---- closed --------------------------------------------------------------
  let closedPasses = 0;
  const sound = new Set();
  outlines.forEach((o, k) => {
    const problem = ringProblem(o.v);
    if (problem) add('fail', 'closed', label(o, k), problem.text);
    else {
      closedPasses += 1;
      sound.add(k);
    }
  });
  if (closedPasses) add('pass', 'closed', `${closedPasses} of ${outlines.length} outlines`, 'closed, at least 3 distinct vertices, no self-crossing');

  // ---- overlap -------------------------------------------------------------
  const boxes = outlines.map((o) => bboxOf([o.v]));
  let overlapPasses = 0;
  for (let i = 0; i < outlines.length; i += 1) {
    for (let j = i + 1; j < outlines.length; j += 1) {
      if (!sound.has(i) || !sound.has(j) || !bboxesMeet(boxes[i], boxes[j])) continue;
      const ci = CLASS_OF[outlines[i].type];
      const cj = CLASS_OF[outlines[j].type];
      const { inter } = areasOf([outlines[i].v], [outlines[j].v]);
      const shared = sharedBoundaryLength([outlines[i].v], [outlines[j].v]);
      const allowed = Math.max(OVERLAP_PX * shared, OVERLAP_SHARE * Math.min(areaOf(outlines[i].v), areaOf(outlines[j].v)));
      const detail = `${label(outlines[i], i)} and ${label(outlines[j], j)} overlap by ${inter.toFixed(0)} px2 (allowed ${allowed.toFixed(0)}, the larger of 2 px x the ${shared.toFixed(0)} px they share and 0.2% of the smaller outline)`;
      if (inter <= allowed) {
        overlapPasses += 1;
        continue;
      }
      const scored = (c) => c === 'building' || c === 'nonGla';
      if (ci === 'unfinished' || cj === 'unfinished') {
        if (scored(ci) || scored(cj)) add('warn', 'overlap', 'unfinished', detail);
        else overlapPasses += 1;
      } else if (ci !== cj) add('fail', 'overlap', 'building/non-GLA', detail);
      else add('warn', 'overlap', ci, detail);
    }
  }
  if (overlapPasses) add('pass', 'overlap', `${overlapPasses} pair(s) that touch or nearly`, 'no overlap beyond the shared boundary');

  // ---- labels --------------------------------------------------------------
  if (drift.length) {
    add('warn', 'labels', 'packet', `the plan's scan now reads ${drift.length} label(s) differently from the packet the annotators worked from (${drift.slice(0, 3).join('; ')}${drift.length > 3 ? '; ...' : ''}): judged against the packet's labels. If the plan was drafted again, run blind again and check again`);
  }
  let labelPasses = 0;
  let labelTotal = 0;
  const seenWaive = new Set();
  for (const l of labels) {
    if (l.kind !== 'room' && l.kind !== 'nonGla') continue;
    labelTotal += 1;
    const allowedTypes = l.kind === 'room' ? ROOM_HOMES : NON_GLA_HOMES;
    const centre = [l.bbox.x + l.bbox.width / 2, l.bbox.y + l.bbox.height / 2];
    const holding = outlines.filter((o, k) => sound.has(k) && pointInRing(centre, o.v));
    const what = `${l.kind} "${l.text}" at ${Math.round(centre[0])},${Math.round(centre[1])}`;
    if (holding.some((o) => allowedTypes.includes(o.type))) {
      labelPasses += 1;
      continue;
    }
    const reason = waived.get(l.id);
    if (reason !== undefined) seenWaive.add(l.id);
    if (!holding.length) {
      add(reason !== undefined ? 'waived' : 'warn', 'labels', l.id, `${what} lies in no outline${reason !== undefined ? `; waived: ${reason}` : ''}`);
    } else {
      const inTypes = [...new Set(holding.map((o) => o.type))].join('/');
      add(reason !== undefined ? 'waived' : 'fail', 'labels', l.id, `${what} lies in ${inTypes}, expected ${allowedTypes.join('/')}${reason !== undefined ? `; waived: ${reason}` : ''}`);
    }
  }
  for (const [id, reason] of waived) {
    if (!seenWaive.has(id)) {
      const known = labels.find((l) => l.id === id);
      add('warn', 'labels', id, known ? `waived (${reason}) but the label is in an allowed outline: the waiver is not needed` : `waived (${reason}) but the scan read no label ${id}`);
    }
  }
  if (labelPasses) add('pass', 'labels', `${labelPasses} of ${labelTotal} labels`, 'each lies inside an outline of its kind');

  // ---- faces ---------------------------------------------------------------
  // Edges the second snap already failed, or already warned of by flag: the
  // snap's own flags below say only what this did not.
  const answered = new Set();
  const raised = new Set();
  const mismatch = specOutlines.length && specOutlines.length !== outlines.length;
  if (!spec) {
    add('warn', 'faces', 'spec', 'no spec found beside the snapped key: every edge was re-snapped as if none were fixed');
  } else if (mismatch) {
    add('fail', 'faces', 'spec', `the spec has ${specOutlines.length} outlines and the snapped key ${outlines.length}: snap again`);
  }
  if (!mismatch) {
    // Refs stay refs, so a shared boundary is still shared and follows the
    // outline it refers to.
    const rough = outlines.map((o, k) => {
      const so = specOutlines[k] ?? {};
      return {
        type: o.type,
        v: o.v.map((p, i) => (isRef(so.v?.[i]) ? so.v[i] : p)),
        fix: so.fix,
        in: so.in,
        R: so.R,
        tilt: so.tilt,
        bridge: so.bridge,
      };
    });
    const usable = rough.every((_, k) => sound.has(k));
    if (usable) {
      const again = snapOutlines(image, rough, { dark: otsuOfImage(image) });
      again.forEach((o, k) => {
        const fixedEdges = o.edges.filter((e) => e.fixed);
        const own = o.edges.filter((e) => !e.fixed);
        let good = 0;
        for (const e of own) {
          const at = `${label(outlines[k], k)} edge ${e.edge}`;
          const noted = (flag) => raised.add(`${k}:${e.edge}:${flag}`);
          if (e.flags.includes('no-band')) {
            add('fail', 'faces', at, 'no wall band found within reach of the edge; list it in "fix" if it is meant to be where drawn');
            answered.add(`${k}:${e.edge}`);
          } else if (Math.abs(e.moved) > FACE_TOLERANCE) {
            add('fail', 'faces', at, `sits ${Math.abs(e.moved).toFixed(1)} px ${e.moved > 0 ? 'short of' : 'beyond'} the wall face (limit ${FACE_TOLERANCE} px): snap it again, or list it in "fix" if it is meant to be there`);
            answered.add(`${k}:${e.edge}`);
          } else {
            good += 1;
            if (e.flags.includes('reaches-end')) {
              add('warn', 'faces', at, 'the band runs to the end of the search: look at the edge at full zoom');
              noted('reaches-end');
            }
            if (e.flags.includes('unstable')) {
              add('warn', 'faces', at, `the face moves ${e.residual.toFixed(1)} px more when the edge is read again from where it lies (windows or doors along the edge?): probe the ink and fix the edge on the wall's face`);
              noted('unstable');
            }
            if (e.flags.includes('ink-beyond')) {
              add('warn', 'faces', at, `another band begins ${e.beyond.toFixed(1)} px beyond the face used (hatched or double-line wall, a dimension line, or a window frame or sill drawn proud of the wall?)`);
              noted('ink-beyond');
            }
            for (const flag of ['bridged', 'partial']) {
              if (!e.flags.includes(flag)) continue;
              add('warn', 'faces', at, `flagged ${FLAG_TEXT[flag](e)}: probe the ink at full zoom, and draw the edge on the wall's face or list it in "fix"`);
              noted(flag);
            }
          }
        }
        for (const text of o.warnings ?? []) add('warn', 'faces', label(outlines[k], k), text);
        const listed = new Set(specOutlines[k]?.fix ?? []);
        const own2 = fixedEdges.filter((e) => listed.has(e.edge)).length;
        const shared = fixedEdges.length - own2;
        const fixedText = fixedEdges.length
          ? `; ${own2 ? `${own2} in "fix" (${[...listed].sort((x, y) => x - y).join(', ')})` : ''}${own2 && shared ? ', ' : ''}${shared ? `${shared} shared by reference` : ''}: not checked against the ink`
          : '';
        const half = own2 > FIXED_SHARE * (o.edges.length - shared) && own2 > 1;
        if (half) add('warn', 'faces', label(outlines[k], k), `more than half of its own edges are fixed${fixedText}`);
        else if (good === own.length) add('pass', 'faces', label(outlines[k], k), `${good ? `${good} edge(s) within ${FACE_TOLERANCE} px of a wall face` : 'no edge to snap'}${fixedText}`);
      });
    } else {
      add('warn', 'faces', 'all', 'skipped: an outline above is not a simple polygon');
    }
  }
  // What the snap noticed when it ran. Snapped again, an edge that was captured by
  // the wrong band lies on that band and passes above.
  // (Not when the spec is another key's: its `fix` lists would say nothing of these edges.)
  for (const f of mismatch ? [] : flagged) {
    if (!outlines[f?.outline] || !Array.isArray(f.flags)) continue;
    if ((specOutlines[f.outline]?.fix ?? []).includes(f.edge) || answered.has(`${f.outline}:${f.edge}`)) continue;
    const texts = Object.keys(FLAG_TEXT)
      .filter((flag) => f.flags.includes(flag) && !raised.has(`${f.outline}:${f.edge}:${flag}`))
      .map((flag) => FLAG_TEXT[flag](f));
    if (!texts.length) continue;
    add('warn', 'faces', `${label(outlines[f.outline], f.outline)} edge ${f.edge}`, `the snap flagged it ${texts.join('; ')}; it lies on a band now, so a second snap cannot tell whether that band is the wall: probe the ink at full zoom, then draw the edge on the face and snap again, or list it in "fix"`);
  }

  // ---- areas and stated figures -------------------------------------------
  const areas = { scale, perOutline: [], totals: {} };
  outlines.forEach((o, k) => {
    const px2 = areaOf(o.v);
    areas.perOutline.push({
      outline: k, type: o.type, name: o.name ?? specOutlines[k]?.name ?? null, px2, sqft: sqft(px2, scale),
    });
  });
  for (const type of OUTLINE_TYPES) {
    const own = areas.perOutline.filter((a) => a.type === type);
    if (own.length) areas.totals[type] = { px2: own.reduce((s, a) => s + a.px2, 0), sqft: scale ? own.reduce((s, a) => s + a.sqft, 0) : null };
  }
  const stated = [
    ...(spec?.stated ?? []).map((s) => ({ ...s, from: 'spec' })),
    ...statedFromLabels(labels),
  ];
  for (const s of stated) {
    if (!scale) {
      add('warn', 'stated', `${s.sqft} sq ft`, 'no scale (the plan has no calibration; give --feet-per-pixel): cannot compare');
      continue;
    }
    const wanted = String(s.of ?? '').trim().toLowerCase();
    let basis;
    let note = '';
    const named = areas.perOutline.filter((a) => a.name && a.name.trim().toLowerCase() === wanted);
    if (wanted && named.length) basis = { text: `outline "${s.of}"`, value: named.reduce((t, a) => t + a.sqft, 0) };
    else if (OUTLINE_TYPES.includes(wanted)) basis = { text: `all ${wanted}`, value: areas.totals[wanted]?.sqft ?? 0 };
    else {
      basis = { text: 'total GLA', value: areas.totals.gla?.sqft ?? 0 };
      if (wanted && !['total', 'total gla', 'gla', 'living', 'living area', 'gross living area'].includes(wanted)) {
        note = ` ("${s.of}" names no outline; name your outlines to compare a level on its own)`;
      }
    }
    const gap = (basis.value - s.sqft) / s.sqft;
    const text = `stated ${fmtSqft(s.sqft)}${s.of ? ` of ${s.of}` : ''} (${s.from}) against the key's ${basis.text} ${fmtSqft(basis.value)}: ${gap >= 0 ? '+' : ''}${(gap * 100).toFixed(1)}%${note}`;
    if (Math.abs(gap) <= STATED_TOLERANCE) add('pass', 'stated', `${s.sqft} sq ft`, text);
    else if (s.explained && s.explained.trim()) add('warn', 'stated', `${s.sqft} sq ft`, `${text}; explained: ${s.explained}`);
    else add('fail', 'stated', `${s.sqft} sq ft`, `${text}; over ${STATED_TOLERANCE * 100}% apart and not explained (add "explained" to the stated entry, or fix the outline)`);
  }

  return {
    items,
    failures: items.filter((i) => i.status === 'fail').length,
    warnings: items.filter((i) => i.status === 'warn').length,
    waived: items.filter((i) => i.status === 'waived').length,
    areas,
  };
};
