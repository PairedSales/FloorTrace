/**
 * After-the-fact check that the roles of the real-plan set stayed inside their
 * rules (integrity rules 2 and 4): scans the tool calls of every agent of a
 * workflow run for what its role may not touch (.claude/hooks/blindRules.mjs,
 * the same rule table as the live guard). A workflow's subagents start as
 * general-purpose agents and cannot carry the guard's hook, so the orchestrator
 * runs this on each annotation, review, sourcing or engineering workflow: it is
 * the control for them.
 *
 * Usage:  node scripts/auditBlind.mjs TRANSCRIPT_DIR [--json]
 *             [--ignore-prefix build,audit,...] [--manifest FILE]
 *   TRANSCRIPT_DIR   the workflow's folder (journal.jsonl + agent-<id>.jsonl)
 *   --ignore-prefix  labels that are deliberately not audited (see below)
 *   --manifest FILE  <set folder>/orchestration/manifest.json: the plans it puts
 *                    in the test split are refused to `eng:` agents by name
 *
 * THE LABEL CONTRACT. An agent's role comes from its label in the journal, which
 * the workflow script sets: `<prefix>:<plan>`.
 *
 *   a: b:      annotator A / B (its own letter's key files are allowed, no other)
 *   adj: final: adjudicator (`final:` is the label the pilot workflow used)
 *   rev:       reviewer
 *   src:       sourcer
 *   eng:       engineer (never the test split, never a key edit)
 *   app:       app checker (never a key edit)
 *
 * A label with any other prefix, or none, is LISTED and makes the exit non-zero:
 * an audit that skips agents it does not recognise reads as clean while it has
 * not looked. To declare labels that are not audited on purpose (a workflow's
 * builders, auditors, fixers), name their prefixes: `--ignore-prefix
 * build,audit,fix,resume`. The summary counts them, so a whole workflow ignored
 * is visible. A role's own prefix cannot be ignored.
 *
 * What is read: the inputs of Bash, PowerShell, Monitor, Read, Grep and Glob
 * calls (the tools the live guard's matcher covers). Tools it does not read
 * (MCP tools, WebFetch, ...) are listed per agent, without failing the run.
 * A transcript that is missing or has lines that will not parse is a finding.
 *
 * Exit: 0 clean; 1 a violation, an unrecognised agent, a missing or unreadable
 * transcript; 2 a bad command line, a TRANSCRIPT_DIR that is not a workflow
 * folder (or lists no agents), or an unreadable manifest.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { SCANNED_TOOLS, violation } from '../.claude/hooks/blindRules.mjs';

export const ROLE_OF_PREFIX = {
  a: { role: 'annotator', letter: 'a' },
  b: { role: 'annotator', letter: 'b' },
  adj: { role: 'adjudicator' },
  final: { role: 'adjudicator' },
  rev: { role: 'reviewer' },
  src: { role: 'sourcer' },
  eng: { role: 'engineer' },
  app: { role: 'app-checker' },
};
const SCANNED = new Set(SCANNED_TOOLS);
// Tools that only write or answer: not worth a line in the report.
const QUIET = new Set(['Write', 'Edit', 'StructuredOutput']);

class UsageError extends Error {}

const readJsonl = (file) => {
  const records = [];
  let unparsed = 0;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      unparsed += 1;
    }
  }
  return { records, unparsed };
};

/** One agent's transcript records read against its role: violations, calls read, tools not read. */
export const scanRecords = (records, { role, letter }, { testPlans } = {}) => {
  const violations = [];
  const notScanned = {};
  let calls = 0;
  for (const record of records) {
    const content = record.message?.content;
    if (record.message?.role !== 'assistant' || !Array.isArray(content)) continue;
    for (const part of content) {
      if (part.type !== 'tool_use') continue;
      if (!SCANNED.has(part.name)) {
        if (!QUIET.has(part.name)) notScanned[part.name] = (notScanned[part.name] ?? 0) + 1;
        continue;
      }
      calls += 1;
      const why = violation(role, part.input ?? {}, { letter, testPlans });
      if (why) violations.push({ tool: part.name, why, input: JSON.stringify(part.input).slice(0, 300) });
    }
  }
  return { violations, calls, notScanned };
};

/** Violations in one agent's transcript records, given its role. */
export const auditRecords = (records, spec, options) => scanRecords(records, spec, options).violations;

const prefixOf = (label) => {
  const text = String(label ?? '').trim();
  const at = text.indexOf(':');
  return { prefix: (at < 0 ? text : text.slice(0, at)).toLowerCase(), plan: at < 0 ? '' : text.slice(at + 1) };
};

/**
 * Every agent of a workflow folder: `audited` (role, calls read, violations),
 * `unknown` (a label the audit does not recognise, or none) and `ignored`
 * (a prefix declared not audited). Throws a UsageError for a folder that is not
 * a workflow's.
 */
export const auditDir = (dir, { ignore = [], testPlans } = {}) => {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) throw new UsageError(`${dir} is not a folder`);
  const journal = path.join(dir, 'journal.jsonl');
  if (!fs.existsSync(journal)) throw new UsageError(`${dir} has no journal.jsonl: it is not a workflow's transcript folder`);
  const ignored = new Set(ignore.map((p) => String(p).trim().toLowerCase()).filter(Boolean));
  for (const prefix of ignored) {
    if (ROLE_OF_PREFIX[prefix]) throw new UsageError(`--ignore-prefix ${prefix}: that is a role's own label prefix (${ROLE_OF_PREFIX[prefix].role}), which is always audited`);
  }
  const byAgent = new Map();
  for (const record of readJsonl(journal).records) {
    if (record.type === 'started' && record.agentId) byAgent.set(record.agentId, record);
  }
  if (!byAgent.size) throw new UsageError(`${journal} lists no started agents: there is nothing to audit`);

  const audited = [];
  const unknown = [];
  const skipped = [];
  for (const { agentId, label } of byAgent.values()) {
    const { prefix, plan } = prefixOf(label);
    if (prefix && ignored.has(prefix)) {
      skipped.push({ label, agentId });
      continue;
    }
    const spec = ROLE_OF_PREFIX[prefix];
    if (!spec) {
      unknown.push({ label: label ?? null, agentId, why: prefix ? `the prefix "${prefix}" is not one of ${Object.keys(ROLE_OF_PREFIX).join(', ')}` : 'it has no label' });
      continue;
    }
    const file = path.join(dir, `agent-${agentId}.jsonl`);
    if (!fs.existsSync(file)) {
      audited.push({ label, agentId, ...spec, plan, calls: 0, violations: [], notScanned: {}, missing: true });
      continue;
    }
    const { records, unparsed } = readJsonl(file);
    audited.push({ label, agentId, ...spec, plan, ...scanRecords(records, spec, { testPlans }), ...(unparsed ? { unparsed } : {}) });
  }
  return { audited, unknown, ignored: skipped };
};

const parseArgs = (argv) => {
  const args = { dir: null, json: false, ignore: [], manifest: null };
  const value = (i, name) => {
    if (argv[i] === name) {
      if (i + 1 >= argv.length) throw new UsageError(`${name} needs a value`);
      return [argv[i + 1], i + 1];
    }
    return [argv[i].slice(name.length + 1), i];
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--ignore-prefix' || arg.startsWith('--ignore-prefix=')) {
      const [v, next] = value(i, '--ignore-prefix');
      args.ignore.push(...v.split(','));
      i = next;
    } else if (arg === '--manifest' || arg.startsWith('--manifest=')) {
      const [v, next] = value(i, '--manifest');
      args.manifest = v;
      i = next;
    } else if (arg.startsWith('--')) throw new UsageError(`unknown option ${arg}`);
    else if (args.dir === null) args.dir = arg;
    else throw new UsageError(`one TRANSCRIPT_DIR, not also ${arg}`);
  }
  if (args.dir === null) throw new UsageError('TRANSCRIPT_DIR is required');
  return args;
};

const testPlansOf = (file) => {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UsageError(`--manifest ${file} cannot be read: ${error.message}`);
  }
  if (!manifest?.plans || typeof manifest.plans !== 'object') throw new UsageError(`--manifest ${file} has no "plans"`);
  return Object.entries(manifest.plans).filter(([, plan]) => plan?.split === 'test').map(([name]) => name);
};

/** The audit as a command: returns the exit status; `out`/`err` receive the lines. */
export const main = (argv, { out = console.log, err = console.error } = {}) => {
  try {
    const args = parseArgs(argv);
    const testPlans = args.manifest ? testPlansOf(args.manifest) : undefined;
    const report = auditDir(args.dir, { ignore: args.ignore, testPlans });
    const dirty = report.audited.filter((r) => r.violations.length || r.missing || r.unparsed);
    const failed = dirty.length + report.unknown.length > 0;
    if (args.json) {
      out(JSON.stringify(report, null, 1));
      return failed ? 1 : 0;
    }
    const calls = report.audited.reduce((sum, r) => sum + r.calls, 0);
    out(`${report.audited.length} role agents audited (${calls} tool calls read), ${dirty.length} with findings`
      + `${report.unknown.length ? `; ${report.unknown.length} NOT RECOGNISED, so not audited` : ''}`
      + `${report.ignored.length ? `; ${report.ignored.length} ignored by --ignore-prefix` : ''}`);
    for (const r of dirty) {
      out(`  ${r.label} (${r.role}${r.letter ? ` ${r.letter}` : ''})`
        + `${r.missing ? ': transcript missing' : ''}${r.unparsed ? `: ${r.unparsed} transcript line(s) would not parse` : ''}`);
      for (const v of r.violations) out(`    ${v.tool}: ${v.why}: ${v.input}`);
    }
    for (const u of report.unknown) out(`  ${u.label === null ? '(no label)' : u.label} [agent ${u.agentId}]: ${u.why}; declare it deliberate with --ignore-prefix`);
    for (const r of report.audited) {
      const tools = Object.entries(r.notScanned);
      if (tools.length) out(`  note: ${r.label} used tools the audit does not read: ${tools.map(([t, n]) => `${t} x${n}`).join(', ')}`);
    }
    if (!args.manifest && report.audited.some((r) => r.role === 'engineer')) {
      out('  note: engineer agents were audited without --manifest, so test-split plan names were not checked');
    }
    return failed ? 1 : 0;
  } catch (error) {
    // Whatever goes wrong, the run does not end as a clean audit or as a
    // violation (1): a folder that cannot be read is a run that audited nothing.
    err(`auditBlind: ${error instanceof UsageError ? error.message : (error.stack ?? error)}`);
    if (error instanceof UsageError) err('usage: node scripts/auditBlind.mjs TRANSCRIPT_DIR [--json] [--ignore-prefix build,audit,...] [--manifest FILE]');
    return 2;
  }
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = main(process.argv.slice(2));
