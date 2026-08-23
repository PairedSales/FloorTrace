import { describe, expect, it } from 'vitest';
import { planStage } from '../planStage.js';
import { summariseIssues } from '../traceIssues.js';
import { warning } from '../detection/scoring.js';

const ring = () => [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];

const trace = (over = {}) => ({ id: 't1', vertices: ring(), ...over });
const stageOf = (result, id) => result.stages.find((s) => s.id === id);

const base = { image: 'data:image/png;base64,x', calibrated: true, area: 900 };

describe('planStage', () => {
  it('reads done on a clean, calibrated, traced plan', () => {
    const traces = [trace({ quality: { confidence: 0.95, warnings: [] } })];
    const result = planStage({ ...base, perimeterTraces: traces, issues: summariseIssues(traces, null, []) });
    expect(stageOf(result, 'outline').state).toBe('done');
    expect(stageOf(result, 'report').state).toBe('done');
    expect(result.primary).toBeNull();
  });

  // The guard the whole "count doubt once" workstream exists to make true: a
  // stage that shows a warning triangle must land on a panel that has something
  // to say. The two used to be derived separately and disagree — the spine
  // showed Outline in `warn` above a card reading "All clear".
  it('never warns a stage without the panel counting something', () => {
    const cases = [
      [trace({ quality: { confidence: 0.71, warnings: [] } })],
      [trace({ quality: { confidence: 0.3, warnings: [warning('unsealed', {}, 'error')] } })],
      [trace({ holes: [{ ring: ring(), stale: true }], quality: { confidence: 0.95, warnings: [] } })],
    ];
    for (const traces of cases) {
      const issues = summariseIssues(traces, null, []);
      const result = planStage({ ...base, perimeterTraces: traces, issues });
      const warned = result.stages.filter((s) => s.state === 'warn');
      if (warned.length) expect(issues.count).toBeGreaterThan(0);
    }
  });

  // The reasonless `fair` band: 2 of the 9 real fixtures land here, and it used
  // to produce an amber spine over a green "Nothing to check".
  it('counts a doubtful outline that carries no warning to say why', () => {
    const traces = [trace({ quality: { confidence: 0.71, warnings: [] } })];
    const issues = summariseIssues(traces, null, []);
    expect(issues.count).toBe(1);
    expect(planStage({ ...base, perimeterTraces: traces, issues }).stages
      .find((s) => s.id === 'outline').state).toBe('warn');
  });

  it('lets a stale void reach the report stage', () => {
    const traces = [trace({ holes: [{ ring: ring(), stale: true }] })];
    const issues = summariseIssues(traces, null, []);
    const result = planStage({ ...base, perimeterTraces: traces, issues });
    expect(stageOf(result, 'report').state).toBe('warn');
  });

  it('does not count an outline the user has hidden', () => {
    const traces = [trace({ visible: false, quality: { confidence: 0.2, warnings: [warning('unsealed', {}, 'error')] } })];
    expect(summariseIssues(traces, null, []).count).toBe(0);
  });

  it('does not treat a hand-placed outline as a failed one', () => {
    const traces = [trace()];
    expect(summariseIssues(traces, null, []).count).toBe(0);
  });

  describe('the primary never repeats the action that just failed', () => {
    it('offers the brush after a trace that produced nothing', () => {
      const result = planStage({
        ...base, perimeterTraces: [], area: 0,
        lastTraceOutcome: { level: 'failed', reason: 'no wall could be read' },
      });
      expect(result.primary).toBe('outline-paint');
      expect(stageOf(result, 'outline').state).toBe('failed');
    });

    it('offers a hand-set scale after a scan that read nothing', () => {
      const result = planStage({ ...base, calibrated: false, perimeterTraces: [], area: 0, ocrFailed: true });
      expect(result.primary).toBe('scale-manual');
      expect(stageOf(result, 'scale').state).toBe('failed');
    });

    it('still offers the ordinary verbs when nothing has failed', () => {
      expect(planStage({ ...base, calibrated: false, perimeterTraces: [], area: 0 }).primary).toBe('scale');
      expect(planStage({ ...base, perimeterTraces: [], area: 0 }).primary).toBe('outline');
    });

    it('tells a failed trace apart from a plan nobody has tried', () => {
      const untried = planStage({ ...base, perimeterTraces: [], area: 0 });
      const failed = planStage({
        ...base, perimeterTraces: [], area: 0, lastTraceOutcome: { level: 'failed' },
      });
      expect(stageOf(untried, 'outline').title).not.toBe(stageOf(failed, 'outline').title);
    });
  });
});
