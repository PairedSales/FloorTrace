// Exterior-tracer behaviour on the synthetic scenarios (shape truth by
// construction). Prints IoU / area error / confidence per scenario so a
// redesign can be measured rather than asserted.
//
// Usage: node scripts/syntheticProbe.mjs [scenario ...]
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { polygonArea } from '../src/utils/detection/polygon.js';
import {
  sliderHouse, uPlanHouse, dimensionStringHouse, courtyardHouse, legendPlan,
  garageHouse, nestedFloorsPlan, mixedThicknessHouse,
  createImage, outerFaceRect, strokeAround,
  polygonIou, bboxIou, bboxOf, areaError,
} from '../src/utils/detection/__tests__/synthetic.js';

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const signed = (v) => `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1)}%`;

const report = (name, traced, truth, extra = '') => {
  if (!traced?.outer) {
    console.log(`${name.padEnd(34)} NO BOUNDARY`);
    return;
  }
  const iou = polygonIou(traced.outer.polygon, truth);
  const err = (polygonArea(traced.outer.polygon) - polygonArea(truth)) / polygonArea(truth);
  const bIou = bboxIou(bboxOf(traced.outer.overlay), [
    Math.min(...truth.map((p) => p.x)), Math.min(...truth.map((p) => p.y)),
    Math.max(...truth.map((p) => p.x)), Math.max(...truth.map((p) => p.y)),
  ]);
  const q = traced.quality;
  const conf = q ? q.confidence.toFixed(2) : 'n/a';
  const warn = q?.warnings?.length ? ` [${q.warnings.map((w) => w.code).join(',')}]` : '';
  console.log(
    `${name.padEnd(34)} IoU=${pct(iou).padStart(6)} bboxIoU=${pct(bIou).padStart(6)} `
    + `area=${signed(err).padStart(8)} verts=${String(traced.outer.polygon.length).padStart(3)} `
    + `conf=${conf}${warn} ${extra}`,
  );
};

const scenarios = {
  slider: () => {
    for (const span of [150, 170, 185, 200, 240, 300]) {
      const { img, truth } = sliderHouse(span);
      report(`slider ${span}px`, traceFloorplanBoundaryCore(img), truth);
    }
  },
  unotch: () => {
    const { img, truth } = uPlanHouse();
    report('U-plan notch', traceFloorplanBoundaryCore(img), truth);
  },
  dimstring: () => {
    for (const offset of [0, 40, 60, 90]) {
      const { img, truth } = offset === 0 ? dimensionStringHouse(1e9) : dimensionStringHouse(offset);
      report(`dim string ${offset ? `${offset}px` : 'control'}`, traceFloorplanBoundaryCore(img), truth);
    }
  },
  courtyard: () => {
    const { img, truth, hole, label } = courtyardHouse();
    const plain = traceFloorplanBoundaryCore(img);
    report('courtyard (no label)', plain, truth, `holes=${plain?.floors?.[0]?.holes?.length ?? 0}`);
    const labelled = traceFloorplanBoundaryCore(img, { excludeRegions: [label] });
    const holes = labelled?.floors?.[0]?.holes ?? [];
    report('courtyard (labelled)', labelled, truth, `holes=${holes.length}`);
    if (holes.length) {
      console.log(`   hole area ${polygonArea(holes[0]).toFixed(0)} vs truth ${polygonArea(hole).toFixed(0)}`);
      console.log(`   net area ${(polygonArea(labelled.outer.polygon) - polygonArea(holes[0])).toFixed(0)} vs truth ${(polygonArea(truth) - polygonArea(hole)).toFixed(0)}`);
    }
  },
  legend: () => {
    const { img, truth } = legendPlan();
    const traced = traceFloorplanBoundaryCore(img);
    report('legend inside L notch', traced, truth, `floors=${traced?.floors?.length}`);
  },
  garage: () => {
    for (const th of [1, 2, 3, 5, 8]) {
      const { img, truth } = garageHouse(th);
      const traced = traceFloorplanBoundaryCore(img);
      report(`garage door ${th}px`, traced, truth, `excluded=${traced?.excludedRegions}`);
    }
  },
  nested: () => {
    const { img, floors } = nestedFloorsPlan();
    const traced = traceFloorplanBoundaryCore(img);
    console.log(`nested floors: got ${traced?.floors?.length ?? 0}, expect 2`);
    (traced?.floors ?? []).forEach((f, i) => {
      if (f.outer) report(`  nested floor ${i}`, { outer: f.outer, quality: traced.quality }, floors[i]);
    });
  },
  // Draw mode: the same scenarios traced from a sloppy brush stroke instead of
  // from the page. The stroke is offset outward and wobbled, so a high IoU
  // here means the outline snapped to the wall rather than following the hand.
  draw: () => {
    const cases = [
      ['slider 300px', ...Object.values(sliderHouse(300)).slice(0, 2)],
      ['U-plan notch', ...Object.values(uPlanHouse()).slice(0, 2)],
    ];
    const { img: legendImg, truth: legendTruth } = legendPlan();
    cases.push(['legend in notch', legendImg, legendTruth]);

    for (const [name, img, truth] of cases) {
      for (const jitter of [0, 6, 12]) {
        report(
          `${name} (jitter ${jitter}px)`,
          traceFloorplanBoundaryCore(img, {
            brush: { strokes: [strokeAround(truth, { offset: 10, jitter, step: 8 })], radius: 22 },
          }),
          truth,
        );
      }
    }

    // Brush width must not change the answer.
    const { img, truth } = sliderHouse(0);
    for (const [offset, radius] of [[10, 14], [20, 24], [50, 55], [70, 75]]) {
      report(
        `stroke off=${offset} r=${radius}`,
        traceFloorplanBoundaryCore(img, {
          brush: { strokes: [strokeAround(truth, { offset, jitter: 4, step: 8 })], radius },
        }),
        truth,
      );
    }

    // Nothing drawn under the stroke: the outline must still come back, marked.
    const blank = createImage(800, 600);
    const blankTruth = outerFaceRect(150, 120, 650, 480, 8);
    report(
      'blank paper (freehand)',
      traceFloorplanBoundaryCore(blank, {
        brush: { strokes: [strokeAround(blankTruth, { jitter: 3, step: 8 })], radius: 20 },
      }),
      blankTruth,
    );
  },
  mixed: () => {
    const { img, outerTruth, innerTruth } = mixedThicknessHouse();
    const traced = traceFloorplanBoundaryCore(img);
    report('mixed-thickness outer', traced, outerTruth);
    if (traced?.inner) {
      console.log(
        `mixed-thickness inner              IoU=${pct(polygonIou(traced.inner.polygon, innerTruth))} `
        + `area=${signed((polygonArea(traced.inner.polygon) - polygonArea(innerTruth)) / polygonArea(innerTruth))}`,
      );
    }
  },
};

const requested = process.argv.slice(2);
const names = requested.length ? requested : Object.keys(scenarios);
for (const name of names) {
  if (!scenarios[name]) {
    console.log(`unknown scenario: ${name}`);
    continue;
  }
  console.log(`\n--- ${name} ---`);
  scenarios[name]();
}
void areaError;
