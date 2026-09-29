/**
 * After-the-fact check that the blind roles stayed blind (integrity rule 2):
 * scans the tool calls of every agent of a workflow run for the places a blind
 * role may not touch (.claude/hooks/blindRules.mjs, the same rules as the live
 * guard). A subagent started as a general-purpose agent cannot carry the
 * guard's hook, so the orchestrator runs this on each annotation workflow.
 *
 * Usage:  node scripts/auditBlind.mjs TRANSCRIPT_DIR [--json]
 *   TRANSCRIPT_DIR  the workflow's folder (journal.jsonl + agent-*.jsonl)
 *
 * An agent's role comes from its label in the journal, `<prefix>:<plan>`:
 * `a:`/`b:` annotators (their own letter is allowed), `adj:` adjudicator,
 * `rev:` reviewer, `src:` sourcer. Any other label is not audited. Exit 1 on
 * a violation, with the agent, tool and offending input.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { violation } from '../.claude/hooks/blindRules.mjs';

const ROLE_OF_PREFIX = {
  a: { role: 'annotator', letter: 'a' },
  b: { role: 'annotator', letter: 'b' },
  adj: { role: 'adjudicator' },
  rev: { role: 'reviewer' },
  src: { role: 'sourcer' },
};
// The tools the live guard's matcher covers.
const SCANNED = new Set(['Bash', 'PowerShell', 'Read', 'Grep', 'Glob']);

const readJsonl = (file) => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => {
  try {
    return JSON.parse(l);
  } catch {
    return null;
  }
}).filter(Boolean);

/** Violations in one agent's transcript records, given its role. */
export const auditRecords = (records, { role, letter }) => {
  const found = [];
  for (const record of records) {
    const content = record.message?.content;
    if (record.message?.role !== 'assistant' || !Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type !== 'tool_use' || !SCANNED.has(part.name)) continue;
      const why = violation(role, JSON.stringify(part.input ?? {}), { letter });
      if (why) found.push({ tool: part.name, why, input: JSON.stringify(part.input).slice(0, 300) });
    }
  }
  return found;
};

/** Every agent of a workflow folder, with its role and violations. */
export const auditDir = (dir) => {
  const started = readJsonl(path.join(dir, 'journal.jsonl')).filter((r) => r.type === 'started');
  const report = [];
  for (const { agentId, label } of started) {
    const [prefix, plan] = String(label ?? '').split(':');
    const spec = ROLE_OF_PREFIX[prefix];
    if (!spec) continue;
    const file = path.join(dir, `agent-${agentId}.jsonl`);
    if (!fs.existsSync(file)) {
      report.push({ label, agentId, ...spec, plan, missing: true, violations: [] });
      continue;
    }
    report.push({ label, agentId, ...spec, plan, violations: auditRecords(readJsonl(file), spec) });
  }
  return report;
};

const main = () => {
  const [dir, ...flags] = process.argv.slice(2);
  if (!dir) {
    console.error('usage: node scripts/auditBlind.mjs TRANSCRIPT_DIR [--json]');
    process.exitCode = 2;
    return;
  }
  const report = auditDir(dir);
  if (flags.includes('--json')) console.log(JSON.stringify(report, null, 1));
  const dirty = report.filter((r) => r.violations.length || r.missing);
  if (!flags.includes('--json')) {
    console.log(`${report.length} blind-role agents audited, ${dirty.length} with findings`);
    for (const r of dirty) {
      console.log(`  ${r.label} (${r.role}${r.letter ? ` ${r.letter}` : ''})${r.missing ? ': transcript missing' : ''}`);
      for (const v of r.violations) console.log(`    ${v.tool}: would show ${v.why}: ${v.input}`);
    }
  }
  if (dirty.length) process.exitCode = 1;
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
