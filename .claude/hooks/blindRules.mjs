// What a blind role of the real-plan set may not touch, as data: shared by the
// PreToolUse guard (blind-guard.mjs) and the after-the-fact transcript audit
// (scripts/auditBlind.mjs), so the two can never disagree about a rule.
//
// The roles (.claude/agents/) draw and check answer keys from the ink alone
// (the orchestrator's integrity rule 2): they never see the app's trace, a
// benchmark result, or another agent's key.

// Backslashes normalised so one pattern covers both path styles; a JSON-encoded
// path arrives with them doubled.
export const normalise = (text) => String(text).replace(/\\\\/g, '/').replace(/\\/g, '/');

// What no blind role may touch: a plan file holds the app's trace beside its
// image, the run folders hold verdicts, the answer-keys file holds every key,
// and the tracer's own commands print the trace.
const ALWAYS = [
  [/\.floorplan\b/i, "a .floorplan file holds the app's trace (use the blind packet's image)"],
  [/real_runs/i, 'benchmark results'],
  [/cubicasa5k_runs/i, 'benchmark results'],
  [/answer-keys/i, 'the keys file'],
  [/perimeterTraces/i, "the app's trace"],
  [/realBenchmark|bench:real|bench:cubicasa|bench:detection|traceDebug|drawBoundary|probe:exterior/i, 'the tracer or a benchmark'],
  [/realKeyTool(?:\.mjs)?["']?\s+(?:view|score)\b[^\n|;&]*--(?:trace|keys)\b/i, "the app's trace or the stored keys"],
];

const ORCHESTRATION = [/orchestration/i, "the orchestrator's working folder"];

// A role that draws a key sees only the packet and its own output: another
// annotator's key, the compare report and the orchestration folder are out. The
// adjudicator is handed both keys deliberately and the reviewer the final one.
// `letter` is the annotator's own annotation ('a' or 'b') when the caller
// knows it (the audit does); the live guard does not, and so allows neither
// annotator's key: the tool copies snapped output into the agent's scratch.
const annotatorRules = (letter) => [
  [letter
    ? new RegExp(`keys-wip(?![\\\\/](?:packets[\\\\/]|[^\\\\/\\s"']*\\.${letter}\\.))`, 'i')
    : /keys-wip(?![\\/]packets[\\/])/i,
  "keys-wip other than the packet (another agent's key or notes)"],
  ORCHESTRATION,
];

const roleRules = (role, letter) => {
  switch (role) {
    case 'annotator': return annotatorRules(letter);
    case 'adjudicator': return [ORCHESTRATION];
    case 'reviewer': return [
      [/keys-wip[\\/][^\\/\s"']+\.[ab]\.(?:snapped\.)?json/i, "the annotators' keys (review the final key only)"],
      ORCHESTRATION,
    ];
    // The sourcer logs through realSource.mjs and never reads the folder itself.
    case 'sourcer': return [[/orchestration/i, "the orchestrator's working folder (log through realSource.mjs)"], [/keys-wip/i, 'keys']];
    default: return [];
  }
};

/** Why a tool call's inputs are forbidden to `role`, or null. */
export const violation = (role, inputs, { letter } = {}) => {
  const text = normalise(inputs);
  for (const [pattern, why] of [...ALWAYS, ...roleRules(role, letter)]) {
    if (pattern.test(text)) return why;
  }
  return null;
};
