// The commands of scripts/realPipeline.mjs, as functions of a context
// `{dir, root, out}` (the set folder, the checkout, a line printer), so the
// tests run each against a scratch folder. The CLI only parses the command name
// and prints errors; the manual is its header.
//
// These are the mechanical steps between the agents' steps of the key protocol:
// they run over hundreds of plans, print one line per plan, exit 1 when any plan
// ended in an error, a refusal or a failed check (a pair that merely disagrees
// is not one), and delete no plan, key, record or log (`packets` replaces a
// packet's image of another type, as the key tool's `blind` does). They read the
// plans, so they are for the orchestrator and never for a role that draws or
// checks a key blind.
import fs from 'fs';
import path from 'path';
import { blind, compare, UsageError } from './keyCommands.mjs';
import {
  checkName, decodeBytes, planImageBytes, readJson, wipDir, wipFile, writeFileAtomic, writeJson,
} from './keyFiles.mjs';
import { mulberry32, byName, shuffled } from './prng.mjs';
import { listPlans, loadCatalog } from './pipelineCatalog.mjs';
import {
  isExplicit, parseArgs, quiet, selectPlans, withSelect,
} from './pipelineSelect.mjs';
import {
  agreementOf, checkFinal, compareIsFresh, compareView, planFacts, readCompare, isUncheckedDraft, reviewersOf, statusOf, wipIndex,
} from './pipelineStages.mjs';
import { pct, plural, table } from './pipelineTable.mjs';
import { freeze, backup } from './pipelineRelease.mjs';
import { stats } from './pipelineStats.mjs';

const exists = (file) => fs.existsSync(file);
const VERIFIED_DOUBLE = 'blind double annotation';
const VERIFIED_SINGLE = 'single annotation';

// The exit status of a batch: 1 when any plan ended badly.
const codeOf = (bad) => (bad ? 1 : 0);

const authorOf = (dir, name, role) => {
  const file = wipFile(name, `.${role}.json`, dir);
  if (!exists(file)) return null;
  try {
    const author = readJson(file).author;
    return typeof author === 'string' && author ? author : null;
  } catch {
    return null;
  }
};

// The record `apply` reads (`NAME.record.json`), written as the orchestrator's.
const writeRecord = (dir, name, record) => writeJson(wipFile(name, '.record.json', dir), record);

// The final key as a copy of annotation A's, with its record: the spec byte for
// byte (so the notes and author are A's), the snapped file with its role changed to
// say what it now is. The snapped file goes last, being the file whose existence
// says "there is a final key": a run that dies half way leaves a plan the next run
// does again, never one with a final key and no record.
const finalizeFromA = async (dir, name, record) => {
  await writeRecord(dir, name, record);
  await writeFileAtomic(wipFile(name, '.final.json', dir), fs.readFileSync(wipFile(name, '.a.json', dir)));
  const snapped = readJson(wipFile(name, '.a.snapped.json', dir));
  await writeJson(wipFile(name, '.final.snapped.json', dir), { ...snapped, role: 'final', copiedFrom: 'a' });
};

// ---- status ---------------------------------------------------------------------

const ROLE_WORDS = {
  none: '-', ok: 'ok', existing: 'existing', unsnapped: 'unsnapped',
};
const cellRole = (r) => ROLE_WORDS[r.state] ?? r.state;
const cellCompare = (c) => {
  if (c.state === 'disagree') return `DISAGREE ${c.failed.join(',')}`;
  return { none: '-', agree: 'agree', stale: 'stale', unreadable: 'unreadable' }[c.state] ?? c.state;
};
const cellCheck = (c) => {
  if (c.state === 'none') return '-';
  if (c.state === 'unknown') return '?';
  return `${c.state}${c.stale ? '(old)' : ''}`;
};
const cellReview = (r) => {
  if (r.state === 'rejected' || r.state === 'revised') return `${r.state}(${r.rejections})`;
  return r.state === 'none' ? '-' : r.state;
};

/** The counts behind the per-stage summary of `status`. */
export const summarizeStatus = (rows) => {
  const ok = rows.filter((r) => !r.error);
  const n = (fn) => ok.filter(fn).length;
  return {
    plans: rows.length,
    errors: rows.length - ok.length,
    packet: n((r) => r.packet === 'ok'),
    packetStale: n((r) => r.packet === 'STALE'),
    a: n((r) => r.a.state !== 'none'),
    aExisting: n((r) => r.a.state === 'existing'),
    aUnsnapped: n((r) => r.a.state === 'unsnapped'),
    b: n((r) => r.b.state !== 'none'),
    bUnsnapped: n((r) => r.b.state === 'unsnapped'),
    compared: n((r) => r.compare.state === 'agree' || r.compare.state === 'disagree'),
    agree: n((r) => r.compare.state === 'agree'),
    disagree: n((r) => r.compare.state === 'disagree'),
    compareStale: n((r) => r.compare.state === 'stale'),
    final: n((r) => r.final),
    checkPass: n((r) => r.check.state === 'PASS'),
    checkFail: n((r) => r.check.state === 'FAIL'),
    checkOther: n((r) => ['ERROR', 'unknown'].includes(r.check.state)),
    reviewed: n((r) => r.review.rounds > 0),
    approved: n((r) => r.review.state === 'approved'),
    approvedStale: n((r) => r.review.state === 'approved-STALE'),
    rejected: n((r) => r.review.state === 'rejected'),
    revised: n((r) => r.review.state === 'revised'),
    rounds: ok.reduce((sum, r) => sum + r.review.rounds, 0),
    frozen: n((r) => r.frozen === 'yes'),
    draft: n((r) => r.frozen === 'draft'),
  };
};

const summaryLines = (s) => table([
  { stage: 'packet', done: s.packet, of: s.plans, detail: `${s.packetStale} stale` },
  { stage: 'A', done: s.a, of: s.plans, detail: `${s.aExisting} existing draft, ${s.aUnsnapped} not snapped` },
  { stage: 'B', done: s.b, of: s.plans, detail: `${s.bUnsnapped} not snapped` },
  { stage: 'compare', done: s.compared, of: Math.min(s.a, s.b), detail: `agree ${s.agree}, DISAGREE ${s.disagree}, stale ${s.compareStale}` },
  { stage: 'final', done: s.final, of: s.plans, detail: '' },
  { stage: 'check', done: s.checkPass + s.checkFail, of: s.final, detail: `PASS ${s.checkPass}, FAIL ${s.checkFail}${s.checkOther ? `, not run or error ${s.checkOther}` : ''}` },
  { stage: 'review', done: s.approved, of: s.final, detail: `approved ${s.approved}, rejected ${s.rejected}, revised since rejection ${s.revised}, approval stale ${s.approvedStale}; ${plural(s.rounds, 'round')}` },
  { stage: 'frozen', done: s.frozen, of: s.plans, detail: `${s.draft} hold an unchecked draft key` },
], [
  { title: 'stage', get: (r) => r.stage },
  { title: 'done', get: (r) => r.done, right: true },
  { title: 'of', get: (r) => r.of, right: true },
  { title: 'detail', get: (r) => r.detail },
]);

export const status = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect({ flags: ['json', 'no-check', 'recheck'] }), 'status');
  if (opts['no-check'] && opts.recheck) throw new UsageError('--no-check and --recheck cannot be given together');
  const catalog = loadCatalog(ctx.dir);
  const names = selectPlans({ positional, opts }, ctx, catalog);
  const index = wipIndex(ctx.dir);
  const check = opts.recheck ? 'fresh' : opts['no-check'] ? 'skip' : 'cached';
  const rows = [];
  for (const name of names) {
    try {
      rows.push(await statusOf(name, {
        ctx, catalog, index, check,
      }));
    } catch (error) {
      rows.push({ name, error: error.message });
    }
  }
  const summary = summarizeStatus(rows);
  if (opts.json) {
    ctx.out(JSON.stringify({ plans: rows, summary }, null, 1));
    return codeOf(summary.errors);
  }
  const good = rows.filter((r) => !r.error);
  for (const line of table(good, [
    { title: 'plan', get: (r) => r.name },
    { title: 'split', get: (r) => r.split ?? '-' },
    { title: 'packet', get: (r) => (r.packet === 'none' ? '-' : r.packet) },
    { title: 'A', get: (r) => cellRole(r.a) },
    { title: 'B', get: (r) => cellRole(r.b) },
    { title: 'compare', get: (r) => cellCompare(r.compare) },
    { title: 'final', get: (r) => (r.final ? 'ok' : '-') },
    { title: 'check', get: (r) => cellCheck(r.check) },
    { title: 'review', get: (r) => cellReview(r.review) },
    { title: 'rnd', get: (r) => r.review.rounds || '-', right: true },
    { title: 'frozen', get: (r) => ({ yes: 'yes', draft: 'draft', no: '-' })[r.frozen] },
  ])) ctx.out(line);
  for (const r of rows.filter((x) => x.error)) ctx.out(`ERROR ${r.name}: ${r.error}`);
  ctx.out('');
  for (const line of summaryLines(summary)) ctx.out(line);
  return codeOf(summary.errors);
};

// ---- packets --------------------------------------------------------------------

export const packets = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect(), 'packets');
  const names = selectPlans({ positional, opts }, ctx, loadCatalog(ctx.dir));
  const rows = [];
  for (const name of names) {
    const q = quiet(ctx);
    try {
      await blind([name], q.ctx);
      rows.push({ name, note: (q.lines.at(-1) ?? '').replace(/^packet for [^:]*: /, '') });
    } catch (error) {
      rows.push({ name, note: `ERROR ${error.message}`, bad: true });
    }
  }
  for (const line of table(rows, [{ title: 'plan', get: (r) => r.name }, { title: 'packet', get: (r) => r.note }])) ctx.out(line);
  const bad = rows.filter((r) => r.bad).length;
  ctx.out(`${plural(rows.length - bad, 'packet')} written${bad ? `, ${bad} failed` : ''} -> ${path.join(wipDir(ctx.dir), 'packets')}`);
  return codeOf(bad);
};

// ---- import-existing --------------------------------------------------------------

const range = (n) => Array.from({ length: n }, (_, i) => i);

/**
 * The spec and snapped file that make a plan's stored draft key annotation A:
 * the outlines as they are stored, every edge in `fix` (an earlier snap placed
 * them), the record's notes, and `existingDraft: true`. Throws a message a row
 * shows when the key cannot be written as a spec (holes have no place in one).
 */
export const existingA = async (facts) => {
  const outlines = facts.key.map((o) => {
    if (o.holes?.length) throw new Error('an outline has holes, which a spec cannot hold: draw this plan\'s A by hand');
    return {
      type: o.type,
      ...(o.name ? { name: o.name } : {}),
      v: o.points,
      fix: range(o.points.length),
    };
  });
  const spec = {
    author: 'existing-draft',
    existingDraft: true,
    notes: typeof facts.answerKey.notes === 'string' ? facts.answerKey.notes : '',
    outlines,
  };
  const { bytes, mime } = planImageBytes(facts.project);
  const { width, height } = await decodeBytes(bytes, mime);
  const snapped = {
    role: 'a',
    author: 'existing-draft',
    existingDraft: true,
    image: { width, height },
    outlines: outlines.map((o) => ({ type: o.type, v: o.v })),
    flagged: [],
    warnings: [],
  };
  return { spec, snapped };
};

export const importExisting = async (argv, ctx) => {
  const parsed = parseArgs(argv, withSelect({ flags: ['all-existing'] }), 'import-existing');
  const { positional, opts } = parsed;
  const catalog = loadCatalog(ctx.dir);
  const names = selectPlans({ positional, opts }, ctx, catalog, { alsoAll: ['all-existing'] });
  const explicit = isExplicit(parsed);
  const rows = [];
  for (const name of names) {
    const row = { name, status: '', note: '' };
    rows.push(row);
    try {
      const facts = planFacts(ctx.dir, name);
      const refuse = (note) => Object.assign(row, { status: explicit ? 'REFUSED' : 'skip', note });
      if (facts.answerKey?.checked) {
        // A checked key is never the pipeline's to replace, named or not.
        Object.assign(row, { status: 'REFUSED', note: `the key is already checked (${facts.answerKey.checked.by}, ${facts.answerKey.checked.at}): a checked key changes only through a dispute` });
      } else if (!facts.key) refuse('no key yet: the plan holds the app\'s own trace');
      else if (!isUncheckedDraft(facts)) refuse(`the stored key is not an unchecked draft (record by "${facts.answerKey?.by ?? 'none'}")`);
      else {
        const { spec, snapped } = await existingA(facts);
        const specFile = wipFile(name, '.a.json', ctx.dir);
        let prior = null;
        if (exists(specFile)) {
          try {
            prior = readJson(specFile);
          } catch {
            prior = { unreadable: true };
          }
        }
        if (prior && !prior.existingDraft && !prior.unreadable) {
          Object.assign(row, { status: 'REFUSED', note: `annotation A was already written by ${prior.author ? `"${prior.author}"` : 'someone with no author'}: import-existing will not replace it` });
        } else {
          const snappedFile = wipFile(name, '.a.snapped.json', ctx.dir);
          const same = (file, value) => exists(file) && JSON.stringify(readJson(file)) === JSON.stringify(value);
          const snappedNamed = { name, ...snapped };
          if (same(specFile, spec) && same(snappedFile, snappedNamed)) Object.assign(row, { status: 'unchanged', note: `${spec.outlines.length} outline(s)` });
          else {
            await writeJson(specFile, spec);
            await writeJson(snappedFile, snappedNamed);
            Object.assign(row, { status: prior ? 'updated' : 'written', note: `${spec.outlines.length} outline(s), ${snapped.image.width}x${snapped.image.height}` });
          }
        }
      }
    } catch (error) {
      Object.assign(row, { status: 'ERROR', note: error.message });
    }
  }
  for (const line of table(rows, [{ title: 'plan', get: (r) => r.name }, { title: 'A', get: (r) => r.status }, { title: 'note', get: (r) => r.note }])) ctx.out(line);
  const count = (s) => rows.filter((r) => r.status === s).length;
  ctx.out(`${count('written')} written, ${count('updated')} updated, ${count('unchanged')} unchanged, ${count('skip')} skipped, ${count('REFUSED')} refused, ${count('ERROR')} errors (the plans were not changed)`);
  return codeOf(count('REFUSED') + count('ERROR'));
};

// ---- compare-all ------------------------------------------------------------------

const CRITERIA = [
  ['types', 'types'], ['building', 'building IoU'], ['non-GLA', 'non-GLA IoU'], ['distance', 'distance'],
];

export const compareAll = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect({ flags: ['redo'] }), 'compare-all');
  const names = selectPlans({ positional, opts }, ctx, loadCatalog(ctx.dir));
  const index = wipIndex(ctx.dir);
  const rows = [];
  let unpaired = 0;
  for (const name of names) {
    if (!index.has(name, '.a.snapped.json') || !index.has(name, '.b.snapped.json')) {
      unpaired += 1;
      continue;
    }
    try {
      let recomputed = false;
      // A comparison older than either key it compared is of keys that are gone.
      if (opts.redo || !index.has(name, '.compare.json') || !compareIsFresh(ctx.dir, name)) {
        await compare([name], quiet(ctx).ctx);
        recomputed = true;
      }
      rows.push({ name, view: compareView(readCompare(ctx.dir, name)), recomputed });
    } catch (error) {
      rows.push({ name, error: error.message });
    }
  }
  const compared = rows.filter((r) => !r.error);
  const cell = (r) => (r.error ? 'ERROR' : r.view.agree ? 'agree' : 'DISAGREE');
  for (const line of table(rows, [
    { title: 'plan', get: (r) => r.name },
    { title: 'compare', get: cell },
    { title: 'min IoU', get: (r) => (r.error || r.view.minIou === null ? '-' : `${(r.view.minIou * 100).toFixed(2)}%`), right: true },
    { title: 'worst px', get: (r) => (r.error || r.view.maxDistance === null ? '-' : r.view.maxDistance.toFixed(2)), right: true },
    { title: 'failed', get: (r) => (r.error ? r.error : r.view.failed.join(', ')) },
    { title: '', get: (r) => (r.recomputed ? '' : '(kept)') },
  ])) ctx.out(line);
  const agree = compared.filter((r) => r.view.agree).length;
  ctx.out('');
  ctx.out(`${compared.length} compared, ${agree} agree (${pct(agree, compared.length)}), ${compared.length - agree} DISAGREE`);
  const failing = (word) => compared.filter((r) => r.view.failed.includes(word)).length;
  ctx.out(`failed: ${CRITERIA.map(([word, label]) => `${label} ${failing(word)}`).join(', ')}`);
  if (unpaired) ctx.out(`${plural(unpaired, 'plan')} without both A and B snapped, not compared`);
  return codeOf(rows.length - compared.length);
};

// ---- finalize ---------------------------------------------------------------------

const checkWords = (c) => (c.pass ? 'PASS' : `FAIL${c.firstFail ? ` ${c.firstFail}` : ` (${c.failures})`}`);

// The tail every finalizing command shares: the check of the final key it just
// wrote, as a row, and whether that plan now needs the adjudicator.
const checkedRow = async (name, ctx, row) => {
  try {
    const c = await checkFinal(name, ctx, { fresh: true });
    Object.assign(row, { check: checkWords(c), needsAdjudication: !c.pass });
  } catch (error) {
    Object.assign(row, { check: `ERROR ${error.message}`, needsAdjudication: true });
  }
  return row;
};

const finalizeTable = (rows, ctx) => {
  for (const line of table(rows, [
    { title: 'plan', get: (r) => r.name },
    { title: 'final', get: (r) => r.action },
    { title: 'check', get: (r) => r.check ?? '' },
    { title: '', get: (r) => (r.needsAdjudication ? 'needs adjudication' : '') },
  ])) ctx.out(line);
};

const skippedLine = (skipped) => {
  const reasons = [...skipped].sort(([a], [b]) => byName(a, b)).map(([why, n]) => `${n} ${why}`);
  return reasons.length ? `skipped: ${reasons.join('; ')}` : null;
};

export const finalizeAgreed = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect(), 'finalize-agreed');
  const names = selectPlans({ positional, opts }, ctx, loadCatalog(ctx.dir));
  const index = wipIndex(ctx.dir);
  const skipped = new Map();
  const skip = (why) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  const rows = [];
  for (const name of names) {
    if (!index.has(name, '.a.snapped.json') || !index.has(name, '.b.snapped.json')) skip('without both A and B');
    else if (index.has(name, '.final.snapped.json')) skip('already have a final');
    else if (!index.has(name, '.compare.json')) skip('not compared yet (run compare-all)');
    else if (!compareIsFresh(ctx.dir, name)) skip('with a stale comparison (run compare-all --redo)');
    else {
      const row = { name, action: '', check: null };
      rows.push(row);
      try {
        const record = readCompare(ctx.dir, name);
        if (!compareView(record).agree) {
          Object.assign(row, { action: 'DISAGREE', check: 'needs the adjudicator', needsAdjudication: true });
          continue;
        }
        const [a, b] = [authorOf(ctx.dir, name, 'a'), authorOf(ctx.dir, name, 'b')];
        if (!a || !b) {
          Object.assign(row, { action: 'REFUSED', check: `${a ? 'B' : 'A'}'s spec names no author: the reviewer's independence cannot be enforced` });
        } else if (a === b) {
          Object.assign(row, { action: 'REFUSED', check: `A and B are both by "${a}": that is one annotator, not two` });
        } else {
          await finalizeFromA(ctx.dir, name, {
            annotators: [a, b], adjudicator: null, verifiedBy: VERIFIED_DOUBLE, agreement: agreementOf(record),
          });
          row.action = 'written';
          await checkedRow(name, ctx, row);
        }
      } catch (error) {
        Object.assign(row, { action: 'ERROR', check: error.message });
      }
    }
  }
  finalizeTable(rows, ctx);
  const done = rows.filter((r) => r.action === 'written');
  const needs = rows.filter((r) => r.needsAdjudication);
  const refused = rows.filter((r) => ['REFUSED', 'ERROR'].includes(r.action));
  ctx.out(`${done.length} finalized from A (${done.filter((r) => !r.needsAdjudication).length} PASS), ${needs.length} need the adjudicator, ${refused.length} refused or failed`);
  const line = skippedLine(skipped);
  if (line) ctx.out(line);
  // A pair that disagreed is the protocol working (the adjudicator is next), and
  // `compare-all` exits 0 on it: a chained run must not stop there. 1 is for a plan
  // the command could not finalize, and for a final key that fails its check.
  return codeOf(refused.length + done.filter((r) => r.needsAdjudication).length);
};

// The plans a finalizing command is told to leave alone: `--except A,B` (repeatable)
// and `--except-file FILE` (names split at commas and white space; the summary line
// `sample` prints first is skipped, so its output can be saved as it is). Every name
// must be a plan of the set: a misspelt exception would finalize the plan it meant to spare.
const exceptedPlans = (opts, ctx) => {
  if (opts.except === undefined && opts['except-file'] === undefined) return null;
  const words = (opts.except ?? []).flatMap((s) => s.split(','));
  if (opts['except-file'] !== undefined) {
    let text;
    try {
      text = fs.readFileSync(path.resolve(opts['except-file']), 'utf8');
    } catch (error) {
      throw new Error(`cannot read --except-file ${opts['except-file']}: ${error.code ?? error.message}`);
    }
    for (const line of text.split(/\r?\n/)) if (!/^seed \d+:/.test(line)) words.push(...line.split(/[\s,]+/));
  }
  const names = [...new Set(words.map((s) => s.trim()).filter(Boolean))];
  names.forEach(checkName);
  const all = new Set(listPlans(ctx.dir));
  const missing = names.filter((n) => !all.has(n));
  if (missing.length) throw new Error(`--except names ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ` and ${missing.length - 8} more` : ''}, which ${missing.length === 1 ? 'is' : 'are'} not in ${ctx.dir}: a misspelt exception would finalize the plan it was meant to spare`);
  return new Set(names);
};

export const finalizeSingle = async (argv, ctx) => {
  const parsed = parseArgs(argv, withSelect({ values: ['except-file'], repeat: ['except'], flags: ['no-sample'] }), 'finalize-single');
  const { positional, opts } = parsed;
  if (opts['no-sample'] && (opts.except !== undefined || opts['except-file'] !== undefined)) throw new UsageError('--no-sample says there is no B sample to leave out, so it cannot be given with --except or --except-file');
  const excepted = exceptedPlans(opts, ctx);
  // The 30% of dev that get a B are plans with an A and no B yet, exactly what this
  // command finalizes, and `sample` writes nothing the command could read: so a
  // selection that is not a list of names must say which plans still await a B.
  if (!isExplicit(parsed) && !excepted && !opts['no-sample']) {
    throw new UsageError('finalize-single finalizes every selected plan that has an A and no B, and cannot tell which of them are the sample still awaiting their B (sample writes nothing): leave those out with --except A,B or --except-file FILE (the output of `sample`), name the plans to finalize with --names, or say there is no sample with --no-sample');
  }
  const catalog = loadCatalog(ctx.dir);
  const names = selectPlans({ positional, opts }, ctx, catalog);
  const index = wipIndex(ctx.dir);
  const skipped = new Map();
  const skip = (why) => skipped.set(why, (skipped.get(why) ?? 0) + 1);
  const rows = [];
  for (const name of names) {
    if (excepted?.has(name)) skip('left out by --except (awaiting their B)');
    else if (!index.has(name, '.a.snapped.json')) skip('without A');
    else if (index.has(name, '.final.snapped.json')) skip('already have a final');
    else if (index.has(name, '.b.json') || index.has(name, '.b.snapped.json')) skip('with a B (compare-all, not a single annotation)');
    else {
      const row = { name, action: '', check: null };
      rows.push(row);
      try {
        const a = authorOf(ctx.dir, name, 'a');
        const existing = readJson(wipFile(name, '.a.json', ctx.dir)).existingDraft === true;
        const { split } = catalog.infoOf(name);
        if (split !== 'dev') {
          Object.assign(row, { action: 'REFUSED', check: `single annotation is for the dev split; this plan's split is ${split ?? 'not assigned'} (every test plan gets a B)` });
        } else if (existing) {
          Object.assign(row, { action: 'REFUSED', check: 'annotation A is the existing draft, drawn with the app\'s trace in view: every existing plan needs an independent B' });
        } else if (!a) {
          Object.assign(row, { action: 'REFUSED', check: 'A\'s spec names no author: the reviewer\'s independence cannot be enforced' });
        } else {
          await finalizeFromA(ctx.dir, name, { annotators: [a], adjudicator: null, verifiedBy: VERIFIED_SINGLE });
          row.action = 'written';
          await checkedRow(name, ctx, row);
        }
      } catch (error) {
        Object.assign(row, { action: 'ERROR', check: error.message });
      }
    }
  }
  finalizeTable(rows, ctx);
  const done = rows.filter((r) => r.action === 'written');
  const bad = rows.filter((r) => r.needsAdjudication || ['REFUSED', 'ERROR'].includes(r.action));
  ctx.out(`${done.length} finalized from A alone (${done.filter((r) => !r.needsAdjudication).length} PASS), ${bad.length} need attention`);
  const line = skippedLine(skipped);
  if (line) ctx.out(line);
  return codeOf(bad.length);
};

export const adjudicated = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['adjudicator'] }, 'adjudicated');
  if (!positional.length) throw new UsageError('usage: adjudicated NAME --adjudicator TAG');
  if (positional.length > 1) throw new UsageError('adjudicated takes one plan: adjudicated NAME --adjudicator TAG');
  const [name] = positional;
  checkName(name);
  const tag = String(opts.adjudicator ?? '').trim();
  if (!tag) throw new UsageError('adjudicated needs --adjudicator TAG (the adjudicator\'s agent id)');
  for (const suffix of ['.final.snapped.json', '.final.json']) {
    if (!exists(wipFile(name, suffix, ctx.dir))) throw new Error(`${name}${suffix} does not exist: the adjudicator writes the final key with snap --role final first`);
  }
  const annotators = ['a', 'b'].map((role) => authorOf(ctx.dir, name, role));
  if (annotators.some((a) => !a)) {
    throw new Error(`${name}: ${annotators[0] ? 'B' : 'A'}'s spec is missing or names no author, and the record names the annotators from the specs' authors`);
  }
  if (annotators.includes(tag)) throw new Error(`the adjudicator ${tag} drew ${name}'s annotation ${annotators[0] === tag ? 'A' : 'B'}: an adjudicator is a fresh agent`);
  // The other direction of the reviewer's independence: `review` refuses an
  // adjudicator, and this refuses a reviewer being named the adjudicator after the
  // fact (which would make an approval by the very agent that settled the key).
  if (reviewersOf(ctx.dir, name, wipIndex(ctx.dir)).includes(tag)) throw new Error(`${tag} has reviewed ${name}'s final key: a reviewer is not its adjudicator, and the adjudicator is a fresh agent`);
  const finalAuthor = authorOf(ctx.dir, name, 'final');
  const compareRecord = exists(wipFile(name, '.compare.json', ctx.dir)) ? readCompare(ctx.dir, name) : null;
  await writeRecord(ctx.dir, name, {
    annotators,
    adjudicator: tag,
    verifiedBy: VERIFIED_DOUBLE,
    agreement: compareRecord ? agreementOf(compareRecord) : null,
    adjudicated: true,
  });
  const row = await checkedRow(name, ctx, { name, action: 'written' });
  if (finalAuthor && finalAuthor !== tag) ctx.out(`note: the final spec's author is "${finalAuthor}", not "${tag}"`);
  finalizeTable([row], ctx);
  return codeOf(row.needsAdjudication);
};

// ---- sample -----------------------------------------------------------------------

// A plan that was in the set before the sourcing log (`catalog.isLegacy`: no
// source of its own and no line in the log), or one whose A is the existing draft.
const isExistingPlan = (dir, name, catalog) => {
  const aFile = wipFile(name, '.a.json', dir);
  if (exists(aFile)) {
    try {
      if (readJson(aFile).existingDraft === true) return true;
    } catch {
      // Unreadable: judged by the plan below.
    }
  }
  return catalog.isLegacy(name);
};

export const sample = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect({ values: ['fraction', 'seed'], flags: ['exclude-existing'] }), 'sample');
  const fraction = Number(opts.fraction);
  if (opts.fraction === undefined || !(fraction > 0 && fraction <= 1)) throw new UsageError('sample needs --fraction F, a share above 0 and up to 1 (0.3 for 30%)');
  if (opts.seed === undefined || !/^\d+$/.test(opts.seed)) throw new UsageError('sample needs --seed N, a whole number: the sample is only worth anything if it can be drawn again');
  const seed = Number(opts.seed);
  const catalog = loadCatalog(ctx.dir);
  let names = selectPlans({ positional, opts }, ctx, catalog);
  let excluded = 0;
  if (opts['exclude-existing']) {
    const keep = names.filter((n) => !isExistingPlan(ctx.dir, n, catalog));
    excluded = names.length - keep.length;
    names = keep;
  }
  if (!names.length) throw new Error('nothing to sample from: the selection holds no plans once the existing ones are left out');
  // Sorted first, so the draw depends on the plans and the seed and never on the
  // order the folder lists them in.
  const pool = [...names].sort(byName);
  const size = Math.max(1, Math.round(fraction * pool.length));
  const picked = shuffled(pool, mulberry32(seed)).slice(0, size).sort(byName);
  ctx.out(`seed ${seed}: ${plural(size, 'plan')} of ${pool.length} (${pct(size, pool.length)}, fraction ${fraction})${excluded ? `; ${excluded} existing plans left out` : ''}`);
  ctx.out(picked.join(','));
  return 0;
};

export const COMMANDS = {
  status,
  packets,
  'import-existing': importExisting,
  'compare-all': compareAll,
  'finalize-agreed': finalizeAgreed,
  'finalize-single': finalizeSingle,
  adjudicated,
  sample,
  stats,
  freeze,
  backup,
};
