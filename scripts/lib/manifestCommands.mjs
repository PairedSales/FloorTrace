// The commands of scripts/realManifest.mjs, as functions of a context
// `{dir, root, out}` so the tests run each against a scratch set folder. The CLI
// only parses the command name and prints errors; the manual is its header.
import fs from 'fs';
import path from 'path';
import {
  manifestFileFor, manifestHash, sha256,
} from './manifest.mjs';
import { UsageError, parseArgs } from './keyCommands.mjs';
import { readJson, writeFileAtomic } from './keyFiles.mjs';
import { loadCatalog, manifestLogFor, manifestVersionsFor, splitsFileFor } from './pipelineCatalog.mjs';
import { plural } from './pipelineTable.mjs';
import {
  DEFAULT_TARGET_TEST, DEFAULT_TOTAL, assignSplits, assignmentLines, rosterFromSet, splitsText, validateRoster,
} from './splitAssign.mjs';
import { stableStringify } from './stableJson.mjs';
import {
  amendedManifest, buildManifest, commitManifest, countsOf, countsText, verifyManifest,
} from './manifestBuild.mjs';

const intOption = (opts, name, { min = 0 } = {}) => {
  const raw = opts[name];
  if (raw === undefined) return undefined;
  if (!/^\d+$/.test(raw) || Number(raw) < min) throw new UsageError(`--${name} must be a whole number of at least ${min} (got "${raw}")`);
  return Number(raw);
};

const list = (names, n = 12) => `${names.slice(0, n).join(', ')}${names.length > n ? ` and ${names.length - n} more` : ''}`;
const sha8 = (text) => sha256(Buffer.from(text)).slice(0, 8);

// ---- assign-splits --------------------------------------------------------------

const readRosterFile = (file) => {
  const json = readJson(path.resolve(file));
  return Array.isArray(json) ? json : json?.books;
};

// The bytes of a splits file as they would be with `createdAt` set to another
// time: a re-run that would change nothing must not change the file, so the
// existing file's time is kept when everything else is the same.
const sameBesidesTime = (existing, text) => {
  try {
    const parsed = JSON.parse(existing);
    const { createdAt } = parsed;
    const probe = JSON.parse(text);
    probe.createdAt = createdAt;
    return stableStringify(parsed) === stableStringify(probe) ? createdAt : null;
  } catch {
    return null;
  }
};

export const assignSplitsCommand = async (argv, ctx) => {
  const { opts } = parseArgs(argv, {
    values: ['roster', 'seed', 'target-test', 'total', 'created-at'], repeat: ['pin-dev'], flags: ['write', 'replace', 'pin-existing'],
  }, 'assign-splits');
  const seed = intOption(opts, 'seed');
  if (seed === undefined) throw new UsageError('assign-splits needs --seed N, a whole number: the split must be reproducible');
  const targetTest = intOption(opts, 'target-test') ?? DEFAULT_TARGET_TEST;
  const total = intOption(opts, 'total', { min: 1 }) ?? DEFAULT_TOTAL;
  if (opts['created-at'] !== undefined && Number.isNaN(Date.parse(opts['created-at']))) throw new UsageError(`--created-at must be a date (2026-09-29T12:00:00Z), got "${opts['created-at']}"`);
  if (opts.roster && opts['pin-existing']) throw new UsageError('--pin-existing reads the set folder\'s own plans, so it cannot be given with --roster: name the books with --pin-dev');
  const catalog = loadCatalog(ctx.dir, { manifest: false });
  let roster;
  let warnings = [];
  if (opts.roster) roster = validateRoster(readRosterFile(opts.roster));
  else {
    ({ rows: roster, warnings } = rosterFromSet(ctx.dir, catalog));
  }
  const pinDev = (opts['pin-dev'] ?? []).flatMap((s) => s.split(',')).map((s) => s.trim()).filter(Boolean);
  if (opts['pin-existing']) {
    // A book with no plan in the sourcing log is one of the set that predates it.
    const logged = new Set([...catalog.logged.keys()].map((n) => catalog.unitOf(n)));
    for (const r of roster) if (!logged.has(r.book) && !pinDev.includes(r.book)) pinDev.push(r.book);
  }
  const result = assignSplits(roster, {
    seed, targetTest, total, pinDev,
  });
  for (const line of assignmentLines(result)) ctx.out(line);
  for (const w of warnings) ctx.out(`WARNING: ${w}`);
  if (!opts.write) {
    ctx.out('dry run: nothing written (add --write to write orchestration/splits.json)');
    return 0;
  }
  const file = splitsFileFor(ctx.dir);
  const createdAt = opts['created-at'] ?? new Date().toISOString();
  let text = splitsText(result, { createdAt, roster });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file, 'utf8');
    const kept = sameBesidesTime(existing, text);
    if (kept) {
      text = splitsText(result, { createdAt: kept, roster });
      if (text === existing) {
        ctx.out(`splits.json is already this assignment: unchanged -> ${file}`);
        return 0;
      }
      // The same assignment in another layout (hand edited): written again in the fixed one.
    } else if (!opts.replace) {
      throw new Error(`${file} already holds another assignment (seed ${JSON.parse(existing).seed}): assigning again would move books between dev and test after plans were drawn against the old one. --replace writes this one and keeps the old as splits-superseded-<hash>.json beside it`);
    }
    const old = path.join(path.dirname(file), `splits-superseded-${sha8(existing)}.json`);
    await writeFileAtomic(old, existing);
    ctx.out(`the previous splits.json is kept -> ${old}`);
  }
  await writeFileAtomic(file, text);
  ctx.out(`written -> ${file}`);
  return 0;
};

// ---- build ----------------------------------------------------------------------

export const build = async (argv, ctx) => {
  const { opts } = parseArgs(argv, { values: ['reason'], flags: ['allow-partial'] }, 'build');
  const built = buildManifest(ctx.dir);
  for (const w of built.warnings) ctx.out(`WARNING: ${w}`);
  if (built.problems.length) {
    for (const p of built.problems) ctx.out(`ERROR ${p.name}: ${p.text}`);
    throw new Error(`${plural(new Set(built.problems.map((p) => p.name)).size, 'checked plan')} cannot have a manifest entry; nothing was written`);
  }
  if (built.unchecked.length) {
    ctx.out(`${plural(built.unchecked.length, 'plan')} not checked${opts['allow-partial'] ? ', left out' : ''}: ${list(built.unchecked)}`);
    if (!opts['allow-partial']) throw new Error('the manifest holds only checked keys, and some plans are not: finish them, or build the manifest of the rest with --allow-partial; nothing was written');
  }
  if (!Object.keys(built.manifest.plans).length) throw new Error('no plan is checked yet, so there is nothing to put in a manifest; nothing was written');
  const reason = opts.reason ?? (opts['allow-partial'] ? 'partial build' : 'build');
  const result = await commitManifest(ctx.dir, built, { reason });
  ctx.out(`manifest: ${countsText(countsOf(built.manifest))}`);
  if (result.changed) {
    ctx.out(`manifest version ${result.version} written (${reason}) -> ${manifestFileFor(ctx.dir)}`);
    ctx.out(`archived -> ${path.join(manifestVersionsFor(ctx.dir), `manifest-${result.hash.slice(0, 12)}.json`)}; logged -> ${manifestLogFor(ctx.dir)}`);
  } else ctx.out(`manifest unchanged: the file already is this manifest (version ${result.version ?? 'not logged'})`);
  ctx.out(`manifest hash ${result.hash}`);
  return 0;
};

// ---- verify ---------------------------------------------------------------------

export const verify = async (argv, ctx) => {
  const { opts } = parseArgs(argv, { flags: ['final', 'allow-partial'] }, 'verify');
  const { rules, pass } = verifyManifest(ctx.dir, { final: Boolean(opts.final), allowPartial: Boolean(opts['allow-partial']) });
  for (const r of rules) ctx.out(`${r.status.padEnd(4)}  ${r.id.padEnd(22)} ${r.text}`);
  const failed = rules.filter((r) => r.status === 'FAIL').length;
  ctx.out(pass ? `VERIFY PASS${opts.final ? ' (final)' : ''}` : `VERIFY FAIL (${failed})`);
  return pass ? 0 : 1;
};

// ---- hash -----------------------------------------------------------------------

export const hash = async (argv, ctx) => {
  parseArgs(argv, {}, 'hash');
  const file = manifestFileFor(ctx.dir);
  const h = manifestHash(file);
  if (!h) throw new Error(`there is no manifest ${file}`);
  ctx.out(h);
  return 0;
};

// ---- amend ----------------------------------------------------------------------

export const amend = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['reason'] }, 'amend');
  if (positional.length !== 1) throw new UsageError('usage: amend PLAN --reason TEXT');
  const reason = String(opts.reason ?? '').trim();
  if (!reason) throw new UsageError('amend needs --reason TEXT: the log says why the manifest changed');
  const [name] = positional;
  const built = amendedManifest(ctx.dir, name);
  for (const w of built.warnings) ctx.out(`WARNING: ${name}: ${w}`);
  const result = await commitManifest(ctx.dir, built, { reason: `${reason} (dispute ${built.disputeId}, ${name})` });
  ctx.out(`amend ${name}: dispute ${built.disputeId}; key ${built.before?.slice(0, 8) ?? 'none'} -> ${built.after.slice(0, 8)}`);
  ctx.out(result.changed ? `manifest version ${result.version} written` : `manifest unchanged: it already holds ${name}'s current key and record (version ${result.version ?? 'not logged'})`);
  ctx.out(`manifest hash ${result.hash}`);
  return 0;
};

export const COMMANDS = {
  'assign-splits': assignSplitsCommand, build, verify, hash, amend,
};
