// PreToolUse guard for the blind roles of the real-plan set (.claude/agents/):
// annotator, adjudicator, reviewer, sourcer. A tool call whose inputs would
// show them the app's trace, a benchmark result, or another key is refused
// (rules: blindRules.mjs). It reads the hook payload on stdin and exits 2
// (blocking, with the reason on stderr) on a violation.
//
// Usage (agent frontmatter): node "$CLAUDE_PROJECT_DIR/.claude/hooks/blind-guard.mjs" <role>
import fs from 'fs';
import { violation } from './blindRules.mjs';

const role = process.argv[2] ?? 'annotator';
const raw = fs.readFileSync(0, 'utf8');
// A payload that will not parse is scanned as raw text rather than let through:
// a guard that fails open on a malformed call guards nothing.
let inputs = raw;
try {
  inputs = JSON.stringify(JSON.parse(raw).tool_input ?? {});
} catch {
  // keep the raw text
}
const why = violation(role, inputs);
if (why) {
  process.stderr.write(`blind-guard (${role}): refused — this would show you ${why}. `
    + 'Keys are drawn and checked from the ink alone (integrity rule 2). Use the blind packet and the key tool.\n');
  process.exit(2);
}
process.exit(0);
