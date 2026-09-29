// PreToolUse guard for the blind roles of the real-plan set (.claude/agents/):
// annotator, adjudicator, reviewer, sourcer. A tool call whose inputs would
// show them the app's trace, a benchmark result, or another key is refused
// (rules: blindRules.mjs). It reads the hook payload on stdin and exits 2
// (blocking, the reason on stderr) on a violation.
//
// It fails CLOSED. Claude Code lets a tool call through when a hook exits with
// anything but 2, so every way this script can fail (an unknown role, a rules
// file that will not load, an exception, unreadable stdin) is an exit 2 with a
// message. The frontmatter's command adds `|| exit 2` for what happens before
// this script runs at all (a missing file, no node).
//
// Usage (agent frontmatter, with `shell: bash`):
//   node "$CLAUDE_PROJECT_DIR/.claude/hooks/blind-guard.mjs" <role> || exit 2
import fs from 'fs';

const refuse = (message) => {
  process.stderr.write(`${message}\n`);
  process.exit(2);
};

try {
  // Imported here rather than at the top: a rules file that will not load is
  // then a refusal (2), where a failed static import ends in exit 1, which
  // lets the call through.
  const { BLIND_ROLES, violation } = await import('./blindRules.mjs');
  const role = process.argv[2];
  if (!BLIND_ROLES.includes(role)) {
    throw new Error(`unknown role ${JSON.stringify(role)} (expected one of ${BLIND_ROLES.join(', ')})`);
  }
  const raw = fs.readFileSync(0, 'utf8');
  // A payload that will not parse is scanned as raw text rather than let
  // through: a guard that fails open on a malformed call guards nothing.
  let inputs = raw;
  try {
    inputs = JSON.parse(raw).tool_input ?? {};
  } catch {
    // keep the raw text
  }
  const why = violation(role, inputs);
  if (why) {
    refuse(`blind-guard (${role}): refused: ${why}. Keys are drawn and checked from the ink alone `
      + '(integrity rule 2). Use the blind packet and the key tool.');
  }
} catch (error) {
  refuse(`blind-guard: it failed (${error?.message ?? error}), so it refuses the call: it fails closed. Tell the orchestrator.`);
}
process.exit(0);
