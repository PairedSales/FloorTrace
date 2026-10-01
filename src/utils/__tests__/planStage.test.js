import { describe, expect, it } from 'vitest';
import { alternativeCount, planStage } from '../planStage.js';

const ring = () => [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

const trace = (over = {}) => ({ id: 't1', vertices: ring(), ...over });

const base = { image: 'data:image/png;base64,x', calibrated: true };

describe('planStage', () => {
  it('has no next step to offer on a calibrated, traced plan', () => {
    const result = planStage({ ...base, perimeterTraces: [trace()] });
    expect(result.primary).toBeNull();
    expect(result.tracedCount).toBe(1);
  });

  it('offers nothing with no plan open', () => {
    expect(planStage({ calibrated: false, perimeterTraces: [] }).primary).toBeNull();
  });

  // How the detector rated an outline is not a step. The outline is on the
  // plan; whether it is right is the user's to see.
  it('does not turn a doubtful outline into something to do', () => {
    const doubtful = trace({ quality: { confidence: 0.3, warnings: [{ code: 'unsealed', severity: 'error' }] } });
    expect(planStage({ ...base, perimeterTraces: [doubtful] }).primary).toBeNull();
  });

  it('does not count an outline the user has hidden, or one with no shape yet', () => {
    const traces = [trace({ visible: false }), trace({ id: 't2', vertices: [] })];
    const result = planStage({ ...base, perimeterTraces: traces });
    expect(result.tracedCount).toBe(0);
    expect(result.primary).toBe('outline');
  });

  describe('the primary never repeats the action that just failed', () => {
    // There is no other way to make an outline, so there is no verb: the
    // panel says why and keeps the retry.
    it('offers nothing after a trace that produced nothing', () => {
      const result = planStage({
        ...base, perimeterTraces: [],
        lastTraceOutcome: { level: 'failed', reason: 'no wall could be read' },
      });
      expect(result.primary).toBeNull();
    });

    it('offers a hand-set scale after a scan that read nothing', () => {
      const result = planStage({ ...base, calibrated: false, perimeterTraces: [], ocrFailed: true });
      expect(result.primary).toBe('scale-manual');
    });

    it('still offers the ordinary verbs when nothing has failed', () => {
      expect(planStage({ ...base, calibrated: false, perimeterTraces: [] }).primary).toBe('scale');
      expect(planStage({ ...base, perimeterTraces: [] }).primary).toBe('outline');
    });
  });
});

describe('alternativeCount', () => {
  const alternatives = [{ vertices: ring() }, { vertices: ring() }];

  it('counts the runner-up outlines the search left for the active outline', () => {
    const traces = [trace({ quality: { confidence: 0.9, alternatives } })];
    expect(alternativeCount(traces, 't1')).toBe(2);
    expect(alternativeCount(traces, 'another')).toBe(0);
  });

  it('offers none against an outline a saved plan carries as edited by hand', () => {
    const traces = [trace({ quality: { confidence: 0.9, edited: true, alternatives } })];
    expect(alternativeCount(traces, 't1')).toBe(0);
  });
});
