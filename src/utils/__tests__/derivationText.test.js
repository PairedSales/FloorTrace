import { describe, expect, it } from 'vitest';
import { buildAreaDerivation } from '../areaDerivation';
import { derivationText } from '../derivationText';

const rect = (w, h) => ([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }]);

const outline = (over = {}) => ({
  id: 'a', name: '1st Floor', type: 'gla', visible: true, vertices: rect(100, 50), holes: [], ...over,
});

// 1 ft = 10 px.
const state = (over = {}) => ({
  unit: 'decimal',
  calibration: {
    calibrated: true,
    feetPerPixel: { x: 0.1, y: 0.1 },
    source: 'room-calibration',
    quality: { source: 'auto', level: 'ok', roomCount: 4 },
  },
  perimeterTraces: [outline()],
  ...over,
});

const text = (over) => derivationText(buildAreaDerivation(state(over)));

describe('derivationText', () => {
  it('carries the whole page, from the scale to the total', () => {
    const out = text();
    expect(out).toContain('Measured from 4 rooms on this plan.');
    expect(out).toContain('Scale in force\t1 ft = 10.00 px');
    expect(out).toContain('LIVING AREA');
    expect(out).toContain('1st Floor\t50.0 ft²');
    expect(out).toContain('\t10.0 × 5.0\t= 50.0');
    expect(out).toContain('TOTAL LIVING AREA (ROUNDED)\t50 ft²');
  });

  // The column is what a reviewer adds by hand, so it has to reach the figure
  // printed over it — the rule the app already applies between outlines.
  it('prints a column that adds to the figure above it', () => {
    const out = text({
      perimeterTraces: [outline({
        vertices: [
          { x: 0, y: 0 }, { x: 313, y: 0 }, { x: 313, y: 187 },
          { x: 140, y: 187 }, { x: 140, y: 264 }, { x: 0, y: 264 },
        ],
      })],
    });
    const [, subtotal] = /1st Floor\t([\d,.]+) ft²/.exec(out);
    const pieces = [...out.matchAll(/\t= (−?[\d,.]+)/g)]
      .map((m) => Number(m[1].replace(/,/g, '').replace('−', '-')));
    expect(pieces.length).toBeGreaterThan(1);
    const summed = pieces.reduce((sum, v) => sum + v, 0);
    expect(Number(summed.toFixed(1))).toBe(Number(subtotal.replace(/,/g, '')));
  });

  it('prints the GLA the derivation reported', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        outline({ vertices: rect(313, 187) }),
        outline({ id: 'b', name: '2nd Floor', vertices: rect(241, 173) }),
      ],
    }));
    expect(derivationText(d))
      .toContain(`TOTAL LIVING AREA (ROUNDED)\t${d.gla.reported.toLocaleString()} ft²`);
  });

  it('writes a right triangle the way the trade writes one', () => {
    const out = text({
      perimeterTraces: [outline({
        vertices: [
          { x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 },
          { x: 100, y: 100 }, { x: 0, y: 0 },
        ],
      })],
    });
    expect(out).toMatch(/\t0\.5 × [\d.]+ × [\d.]+\t= [\d.]+/);
  });

  it('shows a deducted void as a deduction', () => {
    const out = text({
      perimeterTraces: [outline({ holes: [{ id: 'h', ring: rect(20, 10) }] })],
    });
    expect(out).toContain('\t= −2.0');
  });

  it('records a void that was not deducted rather than dropping it', () => {
    const out = text({
      perimeterTraces: [outline({ holes: [{ id: 'h', ring: rect(20, 10), stale: true }] })],
    });
    expect(out).toContain('! A void outside this outline was not deducted.');
  });

  it('lists what was left out of GLA, with its own working', () => {
    const out = text({
      perimeterTraces: [outline(), outline({ id: 'b', name: 'Garage', type: 'garage', vertices: rect(60, 40) })],
    });
    expect(out).toContain('NOT LIVING AREA');
    expect(out).toContain('Garage · Garage\t24.0 ft²');
    expect(out).toContain('\t6.0 × 4.0\t= 24.0');
    expect(out).toContain('TOTAL LIVING AREA (ROUNDED)\t50 ft²');
  });

  it('records an outline that was not counted, with the reason', () => {
    const out = text({
      perimeterTraces: [outline(), outline({ id: 'b', name: 'Shed', visible: false, vertices: rect(10, 10) })],
    });
    expect(out).toContain('Shed — hidden, so it is out of every total');
  });

  it('says an outline was measured along its own walls when it was', () => {
    const angle = (20 * Math.PI) / 180;
    const out = text({
      perimeterTraces: [outline({
        vertices: rect(240, 200).map((p) => ({
          x: p.x * Math.cos(angle) - p.y * Math.sin(angle),
          y: p.x * Math.sin(angle) + p.y * Math.cos(angle),
        })),
      })],
    });
    expect(out).toContain('Measured along the walls, which run 20° off the page.');
  });

  it('states the scale in metres when the panel is in metres', () => {
    const out = derivationText(buildAreaDerivation(state(), 'metric'));
    expect(out).toContain('Scale in force\t1 m = 32.81 px');
    expect(out).toContain('m²');
    expect(out).not.toContain('ft²');
  });

  it('names the fallback assumption rather than calling the figures pixels', () => {
    const out = text({ calibration: null });
    expect(out).toContain('No scale was set — areas are not to scale.');
    expect(out).toContain('assume 1 pixel = 1 foot');
    // The column is still a column, in that assumed unit.
    expect(out).toContain('\t100.0 × 50.0\t= 5,000.0');
  });

  it('explains a total the levels do not reach', () => {
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        outline({ vertices: rect(100, 50.4) }),
        outline({ id: 'b', name: '2nd Floor', vertices: rect(100, 50.4) }),
      ],
    }));
    const out = derivationText(d);
    expect(out).toContain('TOTAL LIVING AREA (ROUNDED)\t101 ft²');
    // 50.4 + 50.4 = 100.8, which rounds to 101 — so the levels do reach it and
    // the note stays off. What must never happen is a note that disagrees.
    expect(Math.round(d.gla.sumOfSubtotals)).toBe(d.gla.reported);
    expect(out).not.toContain('The levels above add to');
  });

  it('reconciles in the unit being printed when they genuinely differ', () => {
    // Three levels each landing just under a half unit: the tenths add to
    // 151.2 and the reported figure rounds the raw sum once.
    const d = buildAreaDerivation(state({
      perimeterTraces: [
        outline({ vertices: rect(100, 50.4) }),
        outline({ id: 'b', name: '2nd Floor', vertices: rect(100, 50.4) }),
        outline({ id: 'c', name: '3rd Floor', vertices: rect(100, 50.4) }),
      ],
    }), 'metric');
    const out = derivationText(d);
    expect(out).toContain('Levels added');
    expect(out).toContain('m²');
    if (Math.round(d.gla.sumOfSubtotals) !== d.gla.reported) {
      expect(out).toContain(`the unrounded sum, ${d.gla.unrounded.toFixed(1)}, rounded once`);
    }
  });
});
