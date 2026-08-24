// What a workfile exhibit says, decided here so the renderer only draws.
//
// Every number comes from the same selector the Measurement panel reads — the
// exhibit is the artifact an appraisal workfile keeps, so it must not be able
// to state a different square footage from the screen it was made on. The same
// rule applies to doubt: a trace the detector rated poor, a scale the rooms
// disagreed about and a void that fell outside its outline all reach the page.

import { computeAreaByType, computeWorkspaceArea } from '../../store/appStore';
import {
  calculateArea, getCentroid, holeRings, isSubtracted, displayedBreakdownTotal,
} from '../areaCalculator';
import {
  formatArea, formatLength, getUnitStyleFromDimensions,
  areaDisplayValue, formatAreaValue,
} from '../unitConverter';
import { TRACE_TYPES, DEFAULT_TRACE_TYPE, traceTypeLabel } from '../traceTypes';
import { qualitySummary, rankedWarnings, scaleQualitySummary } from '../boundaryQuality';
import { liveVoids, staleVoidCount } from '../traceIssues';
import { scaleProvenance } from '../scaleProvenance';

// Re-exported: it moved to a leaf module so the dock can state the same
// sentence without pulling this file's lazy graph into the entry chunk.
export { scaleProvenance };

export const EXHIBIT_DEFAULTS = {
  sideLengths: true,
  outlineLabels: true,
  annotations: true,
  summary: true,
};

const DATE_OPTS = { year: 'numeric', month: 'long', day: 'numeric' };

export const exhibitDate = (now) => new Date(now).toLocaleDateString(undefined, DATE_OPTS);

// yyyy-mm-dd in the user's own timezone. `toISOString` is UTC and stamps the
// previous day on any evening west of Greenwich, which on a dated workfile
// exhibit is the one kind of wrong that is hard to notice and hard to defend.
export const exhibitDateStamp = (now) => {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

// Per edge: its length, and the unit normal the label is offset along. Taken
// from the polygon's winding rather than index parity, which is the same rule
// PerimeterLayer uses — so a length sits on the same side of the same wall in
// the export as it did on screen, which for these windings is the inside. The
// export deliberately copies the screen here rather than improving on it: the
// exhibit has to look like the thing the user approved.
const edgeLabels = (vertices, feetPerPixel, unit, unitStyle) => {
  let sum = 0;
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    sum += (b.x - a.x) * (b.y + a.y);
  }
  const sideSign = sum > 0 ? 1 : -1;

  return vertices.flatMap((a, i) => {
    const b = vertices[(i + 1) % vertices.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthPx = Math.hypot(dx, dy);
    if (!(lengthPx > 0)) return [];
    const feet = Math.hypot(dx * feetPerPixel.x, dy * feetPerPixel.y);
    const angle = Math.atan2(dy, dx);
    return [{
      text: formatLength(feet, unit, unitStyle),
      x: (a.x + b.x) / 2,
      y: (a.y + b.y) / 2,
      nx: Math.sin(angle) * sideSign,
      ny: -Math.cos(angle) * sideSign,
      lengthPx,
    }];
  });
};

// Through `traceIssues`, not re-derived: CLAUDE.md makes "the count is derived
// once" an invariant for this exact quantity, and the exhibit printing a
// different number of stale voids from the dock is the failure that rule
// exists to prevent.
const voidNote = (holes, feetPerPixel, unit) => {
  const trace = { holes: holes ?? [] };
  const live = liveVoids(trace);
  const stale = staleVoidCount(trace);
  if (!live.length && !stale) return null;
  const deducted = live.reduce((sum, h) => {
    const ring = holeRings([h])[0];
    return sum + (ring?.length >= 3 ? calculateArea(ring, feetPerPixel) : 0);
  }, 0);
  const { value, suffix } = formatArea(deducted, unit);
  const parts = [];
  if (live.length) parts.push(`−${live.length} void${live.length === 1 ? '' : 's'} (${value} ${suffix})`);
  if (stale) parts.push(`${stale} outside the outline, not deducted`);
  return parts.join(' · ');
};

const scaleLines = (state) => {
  const fpp = state.calibration?.feetPerPixel;
  const calibrated = state.calibration?.calibrated;
  const pxPerFoot = calibrated && fpp?.x > 0 && fpp?.y > 0
    ? { x: 1 / fpp.x, y: 1 / fpp.y }
    : null;
  const anisotropic = pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6;

  return {
    value: pxPerFoot
      ? (anisotropic
        ? `${pxPerFoot.x.toFixed(2)} × ${pxPerFoot.y.toFixed(2)} px/ft`
        : `1 ft = ${pxPerFoot.x.toFixed(1)} px`)
      : 'Not set',
    // Derived from what the calibration actually says about itself, not from
    // how many rooms happen to be in the store. `rooms.length` counts every
    // room the detector ever confirmed, so a scale pinned to one hand-picked
    // room printed "Measured from 6 rooms" — and the count went *up* at the
    // moment the pool stopped being used, because picking a room pushes it
    // onto `rooms` before calibrating from it alone.
    provenance: scaleProvenance(state),
  };
};

/**
 * How this outline came to be, in one phrase.
 *
 * `quality.source` and `quality.remediation` are written on every trace and
 * survive a `.floorplan` round trip, and until now printed nowhere — so on the
 * one document that leaves the app and is read by somebody who was not here, a
 * hand-painted outline and an automatic one looked identical, and a re-searched
 * one carried no sign that the first attempt had been rejected.
 */
export const outlineProvenance = (trace) => {
  const q = trace?.quality;
  // No record at all means nothing measured it: the user placed these corners.
  if (!q) return 'placed by hand';
  if (q.edited) {
    return q.source === 'drawn'
      ? 'traced from your painted outline, then adjusted by hand'
      : 'traced automatically, then adjusted by hand';
  }
  const retry = q.remediation;
  if (retry?.accepted && retry.before && retry.after) {
    const recovered = (retry.after.held ?? 0) - (retry.before.held ?? 0);
    if (recovered > 0) {
      return `traced again after the first attempt left ${recovered} known `
        + `room${recovered === 1 ? '' : 's'} outside`;
    }
    return 'traced again after the first attempt was rejected';
  }
  return q.source === 'drawn' ? 'traced from your painted outline' : 'traced automatically';
};

// The doubts, ranked by how much of the reported area they put in question.
// Report-scoped problems first: a double-counted floor is wrong by a whole
// storey, which no per-outline confidence figure conveys.
const buildFlags = (state, areas, outlines, measured = true) => {
  const flags = [];

  // First, because it invalidates everything under it.
  if (!measured) {
    flags.push({
      severity: 'error',
      text: 'No outline has been traced on this plan, so no area has been measured.',
    });
  }
  if (!state.calibration?.calibrated) {
    flags.push({
      severity: 'error',
      text: 'No scale was set, so nothing on this page is to scale.',
    });
  }

  for (const d of areas.doubleCounted ?? []) {
    flags.push({
      severity: 'error',
      text: `${d.innerName} sits inside ${d.outerName} — its area is counted twice in the total.`,
    });
  }

  const scaleNote = scaleQualitySummary(state.calibration?.quality);
  if (scaleNote?.level === 'check') {
    flags.push({ severity: 'warn', text: `Scale: ${scaleNote.detail}` });
  }

  // Every warning on every outline, not only those whose score fell below the
  // good threshold. The `level === 'good'` skip dropped **error-severity**
  // findings from the exported workfile whenever the score happened to sit
  // above 0.75 — which is exactly the wrong-answer-that-looks-green case, on
  // the one surface a third party reads without the app in front of them.
  for (const outline of outlines) {
    const q = outline.quality;
    if (!q) continue;
    const reasons = rankedWarnings(q.warnings).filter((w) => w.severity !== 'info');

    // The score rides on the first row for this outline rather than in a row
    // of its own: a reviewer needs the reason and the number together, and
    // repeating "42% wall match" above every one of four findings is noise.
    const score = q.edited ? 'edited by hand'
      : q.percent === null ? 'unverified'
        : `${q.percent}% wall match`;

    for (const w of reasons) {
      // An acknowledged flag is not dropped, it is re-filed. A workfile that
      // records a finding was considered is stronger than one that never had
      // it, and dropping it would make the acknowledge control a way of
      // quietly cleaning the page.
      flags.push({
        severity: w.acknowledged ? 'reviewed' : (w.severity === 'error' ? 'error' : 'warn'),
        text: `${outline.name} (${score}): ${w.label} — ${w.detail}.`,
      });
    }

    // Nothing explained why, so the score has to speak for itself.
    if (!reasons.length && q.level !== 'good' && !q.edited) {
      flags.push({
        severity: q.level === 'fair' ? 'warn' : 'error',
        text: `${outline.name}: ${score}`
          + `${q.reason ? ` — ${q.reason}` : ''}.`,
      });
    }
  }

  const staleVoids = (state.perimeterTraces ?? [])
    .reduce((sum, t) => sum + staleVoidCount(t), 0);
  if (staleVoids > 0) {
    flags.push({
      severity: 'warn',
      text: staleVoids === 1
        ? 'One cut-out falls outside its outline, so it is not deducted from the area.'
        : `${staleVoids} cut-outs fall outside their outlines, so they are not deducted `
          + 'from the area.',
    });
  }

  return flags;
};

/**
 * The whole exhibit, as data. `state` is the app store's state; `now` is passed
 * in rather than read so the same state always produces the same page.
 */
// `areas` is an option rather than something this file reaches for, so an
// exhibit can be built from a state that is not the live store — and so it can
// never be handed the numbers of whichever plan happened to read the memo last.
// It defaults to computing them, which is why every existing caller is unchanged.
export function buildExhibitModel(state, {
  now = Date.now(),
  options = {},
  areas = computeAreaByType(state),
} = {}) {
  const opts = { ...EXHIBIT_DEFAULTS, ...options };
  const unit = state.unit ?? 'decimal';
  const feetPerPixel = state.calibration?.feetPerPixel ?? { x: 1, y: 1 };
  const calibrated = !!state.calibration?.calibrated;
  const unitStyle = getUnitStyleFromDimensions(state.detectedDimensions, unit);

  const drawn = (state.perimeterTraces ?? []).filter(
    (t) => t.visible && t.vertices?.length >= 3
  );
  // Whether anything was actually measured. A page with no outline on it is
  // not a measurement of zero, and this exhibit goes into a workfile.
  const measured = drawn.length > 0;

  const outlines = drawn.map((trace) => {
    const area = calculateArea(trace.vertices, feetPerPixel, trace.holes);
    const { value, suffix } = formatArea(area, unit);
    const typeLabel = traceTypeLabel(trace.type);
    return {
      id: trace.id,
      name: trace.name,
      color: trace.color || '#BD93F9',
      // Dropped when the user has named the outline after its own type — a row
      // reading "Garage / Garage" spends a line saying nothing.
      typeLabel: typeLabel === trace.name ? null : typeLabel,
      areaText: calibrated ? `${value} ${suffix}` : '—',
      quality: trace.quality ? qualitySummary(trace.quality) : null,
      provenance: outlineProvenance(trace),
      voids: voidNote(trace.holes, feetPerPixel, unit),
    };
  });

  const noGla = areas.gla === 0 && areas.total > 0;
  // The printed total is the sum of the printed rows, not the raw sum rounded
  // on its own — a breakdown that does not reach its own total reads as a
  // measurement error to whoever checks it with a calculator.
  const totalDisplay = displayedBreakdownTotal(areas.byType, unit);
  const total = formatAreaValue(totalDisplay, unit);
  const headline = noGla
    ? total
    : formatAreaValue(areaDisplayValue(areas.gla, unit), unit);
  const glaCount = areas.counts[DEFAULT_TRACE_TYPE] ?? 0;

  // The property this plan belongs to, when it belongs to one. `state` is the
  // live store for an export and a plain object in tests, so the roll-up is
  // computed rather than read off a memo — the same reason `computeAreaByType`
  // has an un-memoised twin.
  const workspace = state.documentOrder?.length
    ? computeWorkspaceArea(state, areas)
    : null;
  const property = workspace?.isMultiPlan
    ? {
      planCount: workspace.plans.length,
      position: (workspace.plans.findIndex((p) => p.isActive) + 1) || 1,
      levels: workspace.counts?.[DEFAULT_TRACE_TYPE] ?? 0,
      gla: formatAreaValue(areaDisplayValue(workspace.gla, unit), unit),
      total: formatAreaValue(displayedBreakdownTotal(workspace.byType, unit), unit),
      plans: workspace.plans.map((p) => ({
        label: p.label,
        isActive: p.isActive,
        value: formatAreaValue(areaDisplayValue(p.total, unit), unit).value,
      })),
    }
    : null;

  const rows = TRACE_TYPES
    .filter((t) => (areas.byType[t.id] ?? 0) > 0)
    .map((t) => ({
      label: t.label,
      color: t.color,
      value: formatAreaValue(areaDisplayValue(areas.byType[t.id], unit), unit).value,
      count: areas.counts[t.id] ?? 0,
    }));

  // The plan layer: everything drawn over the image, in original image pixels.
  // Coordinates stay in image space; the renderer owns the transform, so the
  // same model serves the full-size export and the dialog's preview.
  const plan = {
    rotation: state.canvasRotation ?? 0,
    traces: drawn.map((trace, i) => ({
      color: trace.color || '#BD93F9',
      vertices: trace.vertices,
      holes: holeRings(trace.holes ?? []).flatMap((ring, j) => (
        ring?.length >= 3
          ? [{ ring, stale: !isSubtracted((trace.holes ?? [])[j]) }]
          : []
      )),
      edges: opts.sideLengths && calibrated
        ? edgeLabels(trace.vertices, feetPerPixel, unit, unitStyle)
        : [],
      badge: opts.outlineLabels
        ? {
          ...getCentroid(trace.vertices),
          text: `${trace.name}${outlines[i].areaText === '—' ? '' : ` · ${outlines[i].areaText}`}`,
        }
        : null,
    })),
    lines: opts.annotations
      ? (state.measurementLines ?? []).map((line) => {
        const dx = (line.end.x - line.start.x) * feetPerPixel.x;
        const dy = (line.end.y - line.start.y) * feetPerPixel.y;
        return {
          start: line.start,
          end: line.end,
          text: calibrated ? formatLength(Math.hypot(dx, dy), unit, unitStyle) : null,
        };
      })
      : [],
    shapes: opts.annotations
      ? (state.customShapes ?? [])
        .filter((s) => s.closed && s.vertices?.length >= 3)
        .map((s) => {
          const { value, suffix } = formatArea(calculateArea(s.vertices, feetPerPixel), unit);
          return {
            vertices: s.vertices,
            text: calibrated ? `${value} ${suffix}` : null,
          };
        })
      : [],
  };

  return {
    options: opts,
    title: (state.projectName ?? '').trim(),
    date: exhibitDate(now),
    calibrated,
    headline: {
      label: noGla ? 'Total area' : 'Gross Living Area',
      // A page with no outline on it used to positively assert "Gross Living
      // Area / 0 ft²", one keystroke after opening a plan, with no flag. A
      // measurement that was never made is not a measurement of zero.
      value: (calibrated && measured) ? headline.value : '—',
      suffix: (calibrated && measured) ? headline.suffix : '',
      caption: !measured
        ? 'No outline has been traced on this plan'
        : noGla
          ? 'No outline is marked as living area'
        : `${glaCount} level${glaCount === 1 ? '' : 's'} · measured to the `
          + `${state.useInteriorWalls ? 'interior' : 'exterior'} wall face`
          // A page that reports one plan's figure while the property has more
          // than one plan reads as the property's figure, and a workfile keeps
          // both pages side by side. Say which plan this is and what the whole
          // house comes to, on the page itself.
          + (property ? ` · this plan is ${property.position} of ${property.planCount}` : ''),
    },
    rows,
    total: total.value,
    totalSuffix: total.suffix,
    property,
    showBreakdown: rows.length > 1,
    scale: scaleLines(state),
    outlines,
    flags: buildFlags(state, areas, outlines, measured),
    plan,
    disclaimer: 'Areas are grouped in the ANSI Z765 style and are derived from a traced '
      + 'sketch — this is a working measurement, not a certified survey.',
  };
}

// Windows and macOS both reject these, and a colon in a US date silently
// truncated the name on Windows rather than failing loudly.
const ILLEGAL = /[\\/:*?"<>|]+/g;

export function exhibitFilename(model, now = Date.now(), extension = 'png') {
  const base = (model.title || 'Floor plan').replace(ILLEGAL, ' ').replace(/\s+/g, ' ').trim();
  return `${base || 'Floor plan'} ${exhibitDateStamp(now)}.${extension}`;
}
