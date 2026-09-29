// What the roles of the real-plan set (.claude/agents/) may not touch, as data:
// one rule table for the PreToolUse guard (blind-guard.mjs) and the
// after-the-fact transcript audit (scripts/auditBlind.mjs).
//
// The four BLIND roles (annotator, adjudicator, reviewer, sourcer) draw, check
// and source answer keys from the ink alone (the orchestrator's integrity rule
// 2): they never see the app's trace, a benchmark result, or another agent's
// key. The engineer and the app checker see the trace by necessity, so their
// rules are the narrower ones the protocol gives them: neither edits a key, and
// the engineer never touches the test split (integrity rule 4).
//
// This is a speed bump for an honest agent about to open the wrong file, not a
// sandbox. It reads the text of a tool call's inputs and cannot know what a
// command will do: a path built in a variable, or a string assembled in code,
// gets past it.
//
// The set folder is an ALLOW-list per role. A deny-list of tokens missed the
// ways an honest agent is shown forbidden data (a `..` in a path, a wildcard, a
// search rooted at the folder), so any path under the set folder is refused
// unless the role's list names it.

export const BLIND_ROLES = ['annotator', 'adjudicator', 'reviewer', 'sourcer'];
export const ROLES = [...BLIND_ROLES, 'engineer', 'app-checker'];
// The tools whose inputs are read. The `matcher:` in each blind role's
// frontmatter must list exactly these (a test checks), and the audit scans
// their calls. Bash, PowerShell and Monitor run commands; Read, Grep and Glob
// open or search files. What an agent writes (Write, Edit) is its own notes.
export const SCANNED_TOOLS = ['Bash', 'PowerShell', 'Monitor', 'Read', 'Grep', 'Glob'];

// ---- reading a tool call's inputs ---------------------------------------------

// The strings of a tool call's inputs. Only the top-level `description` of a
// call is skipped: it is free text about the call, and an agent explaining that
// it avoids a folder must not be refused for naming it.
const leaves = (value, out = [], top = true) => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) for (const v of value) leaves(v, out, false);
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) if (!(top && key === 'description')) leaves(v, out, false);
  }
  return out;
};

// `seg/../` removed, so a path that reaches the set folder or leaves it by a
// `..` reads as the path it is. A segment that is itself `..` stays (`../..`).
const collapseDots = (text) => {
  let out = text.replace(/\/\.(?=\/)/g, '');
  for (let previous = null; previous !== out;) {
    previous = out;
    out = out.replace(/(?<![^\s/;|&()<>,=])(?!\.\.?\/)[^/\s;|&()<>,=]+\/\.\.(?:\/|(?=[\s;|&()<>,=]|$))/g, '');
  }
  return out;
};

/**
 * The text every rule matches: the call's strings, lower-cased, backslashes as
 * slashes (a JSON-encoded path arrives with them doubled), every quote and
 * backtick dropped (so `"C:\a b\realKeyTool.mjs" view` and `keys-'wip'` read as
 * plain text), `//` as `/`, and `..` segments resolved. `inputs` is the tool
 * call's `tool_input` object, or a string (a payload that would not parse).
 */
export const normalise = (inputs) => collapseDots(
  (typeof inputs === 'string' ? inputs : leaves(inputs).join('\n'))
    .replace(/\\\\/g, '/')
    .replace(/\\["']/g, '')
    .replace(/\\/g, '/')
    .replace(/["'`]/g, '')
    .replace(/\/{2,}/g, '/')
    .toLowerCase(),
);

// ---- what no blind role may touch, wherever it is named ---------------------------

// A plan file holds the app's trace beside its image, the run folders hold
// verdicts, the answer-keys file holds every key, and the tracer's own commands
// print the trace. The environment variables re-point the set folder.
const SHOWS = [
  [/\.floorplan\b/, "a .floorplan file holds the app's trace (use the blind packet's image)"],
  [/real_runs|cubicasa5k_runs/, 'benchmark results'],
  [/datasets\/real-/, 'a backup of the set, which holds the plans and their keys'],
  [/answer-keys/, 'the keys file'],
  [/perimetertraces/, "the app's trace"],
  [/bench:[a-z]+|(?:real|cubicasa|detection|scale|ocr)benchmark|tracedebug|drawboundary|probe:exterior/, 'the tracer or a benchmark'],
  [/floortrace_real_dir|floortrace_datasets|floortrace_test_split_ok/, 'a re-pointed set folder or the test-split override'],
];

// Refusals that are not "it would show you X".
const REFUSED = [
  [/(?<![\w-])(?:cd|pushd|chdir|set-location)[ \t]+[^;&|\n]*?(?:datasets\/real(?![\w.-])|keys-wip\/)/,
    'the set folder is not a working directory: name full paths (a relative path from there is not checked)'],
  // A search rooted at the folder that holds the set (`Grep path=datasets`, a
  // recursive Select-String over it) reads keys and traces without naming them.
  [/(?<=\/)datasets(?:\/[*?][^\s;|&()<>,=]*|\/)?(?=[\s;|&()<>,=]|$)/, 'a search across the whole datasets folder reads what a blind role may not: name the folder you need'],
];

const ORCHESTRATION = /orchestration/;

// ---- the set folder, allowed per role ---------------------------------------------

// Every path under the set folder is refused unless it is under a role's OPEN
// folder (anything below it, wildcards included) or is one of its FILES. Paths
// are relative to the set folder, `..` resolved. `letter` is the annotator's own
// annotation ('a' or 'b') when the caller knows it (the audit does); the live
// guard does not, and so allows neither annotator's key: `snap` copies the
// snapped output into the agent's scratch folder for it to draw.
const PACKETS = 'keys-wip/packets';
const OPEN = { annotator: PACKETS, adjudicator: PACKETS, reviewer: PACKETS, sourcer: 'inbox' };
const FILES = (role, letter) => {
  switch (role) {
    case 'annotator': return letter ? [new RegExp(`^keys-wip/[^/]+\\.${letter}\\.[^/]+$`)] : [];
    case 'adjudicator': return [/^keys-wip\/[^/]+\.(?:a|b|final)\.[^/]+$/, /^keys-wip\/[^/]+\.compare\.json$/];
    case 'reviewer': return [/^keys-wip\/[^/]+\.final\.[^/]+$/, /^keys-wip\/[^/]+\.review-\d+\.json$/];
    default: return [];
  }
};
const ALLOWED_TEXT = {
  annotator: (letter) => `${PACKETS}/<plan>/${letter ? ` and your own ${letter} key` : " (your own snapped key is the tool's scratch copy, not the set folder)"}`,
  adjudicator: () => `${PACKETS}/<plan>/, keys-wip/<plan>.{a,b,final}.* and keys-wip/<plan>.compare.json`,
  reviewer: () => `${PACKETS}/<plan>/, keys-wip/<plan>.final.* and keys-wip/<plan>.review-<n>.json`,
  sourcer: () => 'inbox/ (log and draft through realSource.mjs and realDrafts.mjs)',
};

// The paths under the set folder that a call names, relative to it: from
// `datasets/real` (absolute, relative, or reached by `..`), and from a relative
// `keys-wip/`.
const setPaths = (text) => {
  const rels = [];
  for (const m of text.matchAll(/datasets\/real(?![\w.-])([^\s;|&()<>,=]*)/g)) rels.push(m[1]);
  for (const m of text.matchAll(/(?<![\w.-])keys-wip\/([^\s;|&()<>,=]*)/g)) rels.push(`keys-wip/${m[1]}`);
  return rels.map((rel) => rel.replace(/^\/+|\/+$/g, ''));
};

const setFolderViolation = (role, letter, text) => {
  const open = OPEN[role];
  const files = FILES(role, letter);
  for (const rel of setPaths(text)) {
    const refuse = (why) => `${why} (${rel || 'the folder itself'}): ${role}s open only ${ALLOWED_TEXT[role](letter)}`;
    if (rel === open || rel.startsWith(`${open}/`)) continue;
    if (/[*?[\]{}$%]/.test(rel)) return refuse('a wildcard or variable in a set-folder path (a search over the folder reads keys and traces): name the file');
    if (!files.some((f) => f.test(rel))) return refuse('a set-folder path outside your allow-list');
  }
  return null;
};

// ---- the key tool and the other scripts, per role ---------------------------------

// The subcommands of `realKeyTool.mjs` each blind role runs. Anything else is
// refused, so a command a later builder adds stays closed to a blind role until
// it is listed here: `sheet`, `score` and `apply` show or freeze the stored key,
// `compare` shows where another annotator's key differs, `review` records a
// reviewer's decision, `snap` moves a key; `blind` writes a blind packet (the
// image and the labels, nothing about the trace) and is blind-safe by design.
const KEY_TOOL_COMMANDS = {
  annotator: ['view', 'probe', 'snap', 'check', 'labels', 'blind'],
  adjudicator: ['view', 'probe', 'snap', 'check', 'labels', 'blind', 'compare'],
  reviewer: ['view', 'probe', 'check', 'labels', 'blind', 'review'],
  sourcer: ['view', 'probe'],
};

// The `--role` a `snap` or `check` may carry: an annotator's own annotation
// (never `final`, which `check` defaults to), the adjudicator's `final` for
// `snap`, the reviewer's `final` for `check`.
const roleArgViolation = (role, letter, sub, args) => {
  const given = /--role[= ]\s*([a-z]+)/.exec(args)?.[1];
  if (role === 'annotator' && (sub === 'snap' || sub === 'check')) {
    if (!given) return `\`${sub}\` without --role: say --role ${letter ?? 'a|b'} (check defaults to the final key)`;
    if (given !== 'a' && given !== 'b') return `\`${sub} --role ${given}\`: an annotator's role is a or b`;
    if (letter && given !== letter) return `\`${sub} --role ${given}\`: you are annotator ${letter}`;
  }
  if (role === 'adjudicator' && sub === 'snap' && given !== 'final') return "`snap` without --role final would replace an annotator's key";
  if (role === 'reviewer' && sub === 'check' && given && given !== 'final') return "`check --role a|b` shows an annotator's key: check the final one";
  return null;
};

const KEY_TOOL = /realkeytool(?:\.mjs)?(?:[ \t]+([a-z]+))?([^\n;|&]*)/g;

const keyToolViolation = (role, letter, text) => {
  const allowed = KEY_TOOL_COMMANDS[role];
  for (const [, sub, args] of text.matchAll(KEY_TOOL)) {
    if (/(?<![\w-])--(?:trace|keys)(?![\w-])/.test(args)) return "it would show you the app's trace or the stored keys";
    if (!sub) continue; // --help
    if (!allowed.includes(sub)) return `the key tool's \`${sub}\` is not one of the commands ${role}s run (${allowed.join(', ')})`;
    const why = roleArgViolation(role, letter, sub, args);
    if (why) return why;
  }
  return null;
};

// Scripts that print verdicts, rewrite a plan, or carry keys between the plans
// and the keys file are never a blind role's; the drafter is the sourcer's.
const scriptViolation = (role, text) => {
  if (/realrundiff/.test(text)) return 'realRunDiff prints per-plan verdicts';
  if (/realkeys(?:\.mjs)?(?![\w-])/.test(text)) return 'realKeys carries keys between the plans and the keys file';
  if (role !== 'sourcer' && /realdrafts/.test(text)) return "realDrafts rewrites a plan and prints the trace level: it is the sourcer's";
  return null;
};

const blindViolation = (role, letter, text) => {
  for (const [pattern, why] of SHOWS) if (pattern.test(text)) return `it would show you ${why}`;
  for (const [pattern, why] of REFUSED) if (pattern.test(text)) return why;
  const why = setFolderViolation(role, letter, text) ?? keyToolViolation(role, letter, text) ?? scriptViolation(role, text);
  if (why) return why;
  if (ORCHESTRATION.test(text)) {
    return role === 'sourcer'
      ? "the orchestrator's working folder is not yours: log through realSource.mjs"
      : "it would show you the orchestrator's working folder";
  }
  return null;
};

// ---- the engineer and the app checker ---------------------------------------------

// Neither edits a key (`apply` writes one into a plan). The engineer never
// touches the test split: no `--split test|all`, no override of the gate, no
// `<out>.test.json` (a test run keeps its plans there), and, when the caller
// has the manifest, no plan the manifest puts in the test split.
const KEY_EDIT = [/(?:realkeytool|realkeys)(?:\.mjs)?[ \t]+apply(?![\w-])/, 'a key changes only through a dispute, never by an apply from here'];
const WORK_RULES = {
  engineer: [
    KEY_EDIT,
    [/(?<![\w-])--split[= ]\s*(?:test|all)(?![\w-])/, 'the test split is not the engineer\'s: --split dev only (integrity rule 4)'],
    [/floortrace_test_split_ok/, 'the override of the test-split gate is the orchestrator\'s'],
    [/\.test\.json(?![\w-])/, "a test run's results are the orchestrator's (aggregates only)"],
    [/realdrafts/, 'a draft rewrites a plan and, beside a benchmark, loses labels to CPU contention: not an engineer\'s'],
  ],
  'app-checker': [KEY_EDIT],
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const workViolation = (role, text, testPlans) => {
  for (const [pattern, why] of WORK_RULES[role]) if (pattern.test(text)) return why;
  if (role === 'engineer' && testPlans?.length) {
    const alternatives = testPlans.map((n) => escapeRegExp(String(n).toLowerCase())).join('|');
    const named = new RegExp(`(?<![\\w-])(?:${alternatives})(?![\\w-])`).exec(text);
    if (named) return `${named[0]} is a test-split plan: an engineer never opens one (aggregates only, integrity rule 4)`;
  }
  return null;
};

/**
 * Why a tool call's inputs are forbidden to `role`, or null. `inputs` is the
 * call's `tool_input` (or the text of a payload that would not parse). `letter`
 * is an annotator's own annotation when known; `testPlans` the manifest's test
 * split, for the engineer. An unknown role is an error, never "no rules": a
 * typo in an agent file would otherwise drop its guard without a word.
 */
export const violation = (role, inputs, { letter, testPlans } = {}) => {
  if (!ROLES.includes(role)) throw new Error(`unknown role "${role}" (the roles are ${ROLES.join(', ')})`);
  if (letter !== undefined && letter !== 'a' && letter !== 'b') throw new Error(`unknown annotation letter "${letter}" (a or b)`);
  const text = normalise(inputs);
  return BLIND_ROLES.includes(role) ? blindViolation(role, letter, text) : workViolation(role, text, testPlans);
};
