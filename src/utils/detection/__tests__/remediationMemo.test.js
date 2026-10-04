// What the search memo may and may not do for a second-chance trace.
//
// Two properties, and the first was broken. The memo names a network by its
// place in the partition, and a `join` pass makes a partition of its own — so a
// later attempt was answered with the candidates of whichever network had held
// the same index before: the first partition's, or an earlier trace's different
// join. Only where there is a memo, which is the browser and never the Node
// benchmarks; `bench:detection` could not have seen it. The second is the
// speed-up that replaced it: an attempt is handed the rungs an earlier attempt
// measured on the same network, and that has to be the same answer, not a
// similar one.

import { describe, expect, it, beforeEach } from 'vitest';
import { traceFloorplanBoundaryCore } from '../pipeline.js';
import { clearDetectionCache } from '../cache.js';
import { analyzeFloorplan } from '../analyze.js';
import { partitionWallNetworks } from '../boundary.js';
import { generateCandidates } from '../candidates.js';
import { windowedHouse } from './synthetic.js';
import { loadFixtures } from './searchMemoShared.js';

const constraintsOf = (labels) => ({
  rooms: [],
  interiorPoints: labels.map((l) => ({ x: l.x, y: l.y, name: l.name })),
});

// Everything but the two things a memo is allowed to change.
const told = (traced) => JSON.parse(JSON.stringify(traced, (key, value) => (
  key === 'elapsedMs' || key === 'searchMemo' ? undefined : value
)));

describe('a memoised second-chance trace says what a cold one says', () => {
  beforeEach(() => clearDetectionCache());

  // The app's order: the room clamp traces the image with no constraints at
  // all, and the perimeter trace follows on the same key with the scan's labels.
  for (const gap of [70, 100, 140]) {
    it(`after an unconstrained trace of the same image (${gap}px openings)`, () => {
      const { img, labels } = windowedHouse(gap);
      const constraints = constraintsOf(labels);
      const cold = traceFloorplanBoundaryCore(img, { constraints });

      traceFloorplanBoundaryCore(img, { cacheKey: 'plan' });
      const warm = traceFloorplanBoundaryCore(img, { cacheKey: 'plan', constraints });

      expect(cold.quality.remediation.accepted).toBe('join');
      expect(told(warm)).toEqual(told(cold));
    });

    // Read the sizes again and a different set of labels is outside: the join
    // is a different join, on the same image and so on the same memo.
    it(`after a trace of the same image with other labels (${gap}px openings)`, () => {
      const { img, labels } = windowedHouse(gap);
      const fewer = constraintsOf(labels.slice(0, 1));
      const cold = traceFloorplanBoundaryCore(img, { constraints: fewer });

      traceFloorplanBoundaryCore(img, { cacheKey: 'plan', constraints: constraintsOf(labels) });
      const warm = traceFloorplanBoundaryCore(img, { cacheKey: 'plan', constraints: fewer });

      expect(told(warm)).toEqual(told(cold));
    });
  }
});

describe('a rung handed over from an earlier search is the rung', () => {
  // The fixtures whose perimeter trace runs an `escalate` pass on the app's
  // own path, where it is most of the trace.
  const images = loadFixtures(['ExampleFloorplan4.png', 'ExampleFloorplan5.png', 'ExampleFloorplan7.png']);

  const seen = (generated) => ({
    search: generated.search,
    candidates: generated.candidates.map((c) => ({
      variant: c.variant,
      policy: c.policy,
      radius: c.radius,
      bridgedSpan: c.bridgedSpan,
      seal: c.seal,
      enclosed: c.enclosed,
      completeness: c.completeness,
      area: c.entry.area,
      bbox: c.entry.bbox,
      frame: c.entry.frame,
      componentId: c.entry.componentId,
      components: c.measured.components,
    })),
  });

  for (const [name, image] of images) {
    it(`gives an escalated search the same candidates on ${name}`, () => {
      const analysis = analyzeFloorplan(image, { maxDimension: 1400 });
      const { width, height, wallThickness, boundaryMask } = analysis;
      const nets = partitionWallNetworks(boundaryMask, width, height, wallThickness, 8);
      expect(nets.length).toBeGreaterThan(0);

      let handedOver = 0;
      for (const net of nets) {
        // The first search, as the base attempt leaves it.
        const base = generateCandidates(net, analysis, {});
        base.rescue.structural();

        // The escalated one: twice the ladder, every rescue forced.
        const wider = { maxCloseRadius: base.maxRadius * 2 };
        const fresh = generateCandidates(net, analysis, wider);
        const reusing = generateCandidates(net, analysis, { ...wider, priorRungs: base.rungs });
        for (const generated of [fresh, reusing]) {
          generated.rescue.structural();
          generated.rescue.span();
        }

        expect(seen(reusing)).toEqual(seen(fresh));
        for (let i = 0; i < fresh.candidates.length; i += 1) {
          const a = fresh.candidates[i].measured.labels;
          const b = reusing.candidates[i].measured.labels;
          expect(b.length).toBe(a.length);
          let same = true;
          for (let k = 0; k < a.length && same; k += 1) same = a[k] === b[k];
          expect(same).toBe(true);
        }
        handedOver += reusing.candidates
          .filter((c) => base.candidates.some((b) => b.measured === c.measured)).length;
      }
      // Otherwise the comparison above compared two fresh searches.
      expect(handedOver).toBeGreaterThan(0);
    });
  }
});
