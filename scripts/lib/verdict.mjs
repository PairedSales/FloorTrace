// The verdict and the scoreboard (docs/accuracy-roadmap.md), shared by every
// benchmark that has an answer key to hold an outline against: CubiCasa5K
// (scripts/cubicasaBenchmark.mjs) and real listing plans
// (scripts/realBenchmark.mjs). One definition, so a plan judged perfect in one
// is judged perfect by the same rule in the other.
import { labelComponents, openRect } from '../../src/utils/detection/raster.js';
import { QUALITY_GOOD } from '../../src/utils/boundaryQuality.js';

// A trace is perfect when its IoU with the truth reaches PERFECT_IOU; measured
// on CubiCasa's test split, every plan that does has its area within 3%, and
// half within 1%. It is near-perfect when fixing at most FIXES error regions,
// each no more than FIX_MAX_SHARE of the true area, would make it perfect: a
// balcony left in, a closet left out, a wing cut short — what a user sees and
// corrects with one edit. A region bigger than that is a redraw, not a fix.
// Anything else is wrong.
export const PERFECT_IOU = 0.97;
export const FIXES = 2;
export const FIX_MAX_SHARE = 0.2;
// Error no thicker than twice this many truth cells is the outline sitting on
// another face of a wall: no single edit fixes it, so it stays in the residual
// instead of counting as a region.
export const SLIVER_CELLS = 4;
// Regions under this share of the true area are noise, not something to fix.
export const MIN_REGION_SHARE = 0.005;
export const VERDICTS = ['perfect', 'near', 'wrong'];

// The three numbers the tracer's work is steered by, each against its target.
// A wrong verdict the app would chip green — QUALITY_GOOD or better — is the
// answer that looks right, and no one has a reason to check it.
export const SCOREBOARD = [
  { name: 'near-perfect', test: (r) => r.app.verdict !== 'wrong', target: 0.9, higher: true },
  { name: 'perfect', test: (r) => r.app.verdict === 'perfect', target: 0.75, higher: true },
  {
    name: 'wrong but shown as good',
    test: (r) => r.app.verdict === 'wrong' && r.app.confidence >= QUALITY_GOOD,
    target: 0.02,
    higher: false,
  },
];

export const share = (list, test) => (list.length ? list.filter(test).length / list.length : 0);

export const pct = (x) => `${(x * 100).toFixed(1)}%`;

// The trace's error as discrete regions: connected pieces of the difference
// between outline and truth once slivers along the wall faces are trimmed off,
// each with its cause and its size as a share of the true area. Space the
// answer key does not decide (`truth.ignore`) is no one's error.
const errorRegions = (mask, truth, truthCells) => {
  const { width, height } = truth.grid;
  const over = new Uint8Array(mask.length);
  const missed = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) {
    if (truth.ignore?.[i]) continue;
    if (mask[i] && !truth.footprint[i]) over[i] = 1;
    else if (!mask[i] && truth.footprint[i]) missed[i] = 1;
  }
  const regions = [];
  for (const [kind, diff] of [['over', over], ['missed', missed]]) {
    const { labels, components } = labelComponents(openRect(diff, width, height, SLIVER_CELLS), width, height);
    for (const comp of components) {
      if (comp.size < MIN_REGION_SHARE * truthCells) continue;
      let nonGla = 0;
      if (kind === 'over') {
        for (let y = comp.bbox.minY; y <= comp.bbox.maxY; y += 1) {
          for (let x = comp.bbox.minX; x <= comp.bbox.maxX; x += 1) {
            const i = y * width + x;
            if (labels[i] === comp.id && truth.nonGla[i]) nonGla += 1;
          }
        }
      }
      regions.push({
        cause: kind === 'missed' ? 'missed' : (nonGla > comp.size / 2 ? 'nonGla' : 'other'),
        share: comp.size / truthCells,
      });
    }
  }
  return regions.sort((a, b) => b.share - a.share);
};

// Fixing a region takes it out of the union when the outline took it in, and
// adds it to the intersection when the outline left it out.
const verdictOf = (inter, union, truthCells, regions) => {
  if (union && inter / union >= PERFECT_IOU) return 'perfect';
  let i = inter;
  let u = union;
  for (const region of regions.filter((r) => r.share <= FIX_MAX_SHARE).slice(0, FIXES)) {
    if (region.cause === 'missed') i += region.share * truthCells;
    else u -= region.share * truthCells;
  }
  return u && i / u >= PERFECT_IOU ? 'near' : 'wrong';
};

const round = (v, digits) => (Number.isFinite(v) ? Number(v.toFixed(digits)) : null);

/**
 * An outline mask against an answer key on the same grid:
 * `truth = { grid: {width, height, cell}, footprint, nonGla, ignore? }`.
 */
export const scoreMask = (mask, truth) => {
  let inter = 0;
  let union = 0;
  let truthCells = 0;
  let tracedCells = 0;
  let overNonGla = 0;
  let overOther = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (truth.ignore?.[i]) continue;
    if (truth.footprint[i]) truthCells += 1;
    if (mask[i]) tracedCells += 1;
    if (mask[i] && truth.footprint[i]) inter += 1;
    if (mask[i] || truth.footprint[i]) union += 1;
    if (mask[i] && !truth.footprint[i]) {
      if (truth.nonGla[i]) overNonGla += 1;
      else overOther += 1;
    }
  }
  const regions = errorRegions(mask, truth, truthCells);
  return {
    verdict: verdictOf(inter, union, truthCells, regions),
    iou: round(union ? inter / union : 0, 4),
    // Counted on the same cells as the truth, so space nobody decided is left
    // out of both sides.
    areaErr: round(truthCells ? tracedCells / truthCells - 1 : 0, 4),
    // The error by cause, each as a share of the true area: non-GLA space the
    // outline kept, anything else it took in, and living space it left out.
    overNonGla: round(truthCells ? overNonGla / truthCells : 0, 4),
    overOther: round(truthCells ? overOther / truthCells : 0, 4),
    missed: round(truthCells ? (truthCells - inter) / truthCells : 0, 4),
    regions: regions.slice(0, 4).map((r) => ({ cause: r.cause, share: round(r.share, 4) })),
    scoredAreaPx: tracedCells * truth.grid.cell * truth.grid.cell,
  };
};

// The scoreboard as printed, for results carrying `app.verdict` and
// `app.confidence`.
export const scoreboardLines = (list, title) => {
  const lines = [`\nScoreboard: ${list.length} ${title} (docs/accuracy-roadmap.md)`];
  for (const { name, test, target, higher } of SCOREBOARD) {
    const value = share(list, test);
    const met = higher ? value >= target : value <= target;
    lines.push(`   ${name.padEnd(24)} ${pct(value).padStart(6)}   target ${higher ? '>=' : '<='} ${pct(target)}`
      + `${met ? '   met' : ''}`);
  }
  return lines;
};
