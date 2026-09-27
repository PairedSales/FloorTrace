import { describe, expect, it } from 'vitest';
import { boundaryConstraints, nonGlaExcludeRegions } from '../traceInputs';

const garageLabel = { keyword: 'garage', bbox: { x: 600, y: 300, width: 80, height: 20 } };

const state = {
  exteriorLabels: [garageLabel],
  rooms: [
    { name: 'KITCHEN', rect: { left: 100, top: 100, right: 300, bottom: 250 } },
    { name: 'GARAGE', rect: { left: 560, top: 250, right: 760, bottom: 450 } },
    { name: 'UNPLACED' },
  ],
  detectedDimensions: [
    { text: "12'4\" x 10'2\"", bbox: { x: 150, y: 150, width: 60, height: 16 } },
    // The size printed under the garage's keyword is the garage's.
    { text: "20'7\" x 22'0\"", bbox: { x: 610, y: 305, width: 60, height: 16 } },
    { text: 'no box' },
  ],
};

describe('what the tracer is told about a plan', () => {
  it('excludes every non-GLA label, keyword and all', () => {
    expect(nonGlaExcludeRegions(state)).toEqual([{ ...garageLabel.bbox, keyword: 'garage' }]);
  });

  it('asserts only living rooms and living labels as inside', () => {
    const { rooms, interiorPoints } = boundaryConstraints(state);
    expect(rooms.map((r) => r.name)).toEqual(['KITCHEN']);
    expect(interiorPoints).toEqual([{ x: 180, y: 158, name: "12'4\" x 10'2\"" }]);
  });

  it('asks nothing of a plan with nothing read off it', () => {
    expect(nonGlaExcludeRegions({})).toEqual([]);
    expect(boundaryConstraints({})).toEqual({ rooms: [], interiorPoints: [] });
  });
});
