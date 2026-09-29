// `freeze` and `backup` of realPipeline: the step that writes keys into plans.
//
// `freeze` is the batch form of the key tool's `apply`. It applies only what
// the key tool would apply (an approved review of this very key and spec, a
// passing check, a record), says why it did not apply the rest, and refuses a
// stale approval by name: an approval of a key that has since changed is the
// quietest way for an unchecked key to enter the set. After the batch it runs
// `realKeys export` (so answer-keys.json holds the new keys) and, on request,
// backs the set folder up.
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { apply } from './keyCommands.mjs';
import { wipFile } from './keyFiles.mjs';
import { loadCatalog } from './pipelineCatalog.mjs';
import { byName } from './prng.mjs';
import { backupSet } from './pipelineBackup.mjs';
import {
  parseArgs, quiet, selectPlans, UsageError, withSelect,
} from './pipelineSelect.mjs';
import {
  checkFinal, planFacts, reviewView, wipIndex,
} from './pipelineStages.mjs';
import { plural, table } from './pipelineTable.mjs';

const exists = (file) => fs.existsSync(file);

// Why a plan cannot be frozen yet (`wait`, not an error: the pipeline has not got
// there) or must not be (`refuse`), or null when it may be. Only the cheap
// reads: the check itself is `apply`'s.
const readiness = (dir, name, index, facts) => {
  if (facts.answerKey?.checked) return { wait: 'already frozen' };
  if (!index.has(name, '.final.snapped.json')) return { wait: 'no final key yet' };
  const review = reviewView(dir, name, index);
  if (review.state === 'none') return { wait: 'no review yet' };
  if (review.state === 'rejected') return { wait: `latest review (${review.latest}) rejected it: ${review.reason ?? 'no reason'}` };
  if (review.state === 'revised') return { wait: 'the key was revised after a rejection and needs a fresh review' };
  if (review.state === 'approved-STALE') {
    return { refuse: `STALE approval: the final key or its notes changed after review-${review.latest} approved them; it needs a fresh review` };
  }
  if (review.state !== 'approved') return { refuse: `the latest review cannot be read (${review.state})` };
  if (!exists(wipFile(name, '.record.json', dir))) return { refuse: `${name}.record.json does not exist (finalize-agreed, finalize-single or adjudicated writes it)` };
  return null;
};

// `realKeys export`, run as the script (it is a script, not a library: importing
// it would run it).
const exportKeys = (ctx) => {
  const script = path.join(ctx.root, 'scripts', 'realKeys.mjs');
  const run = spawnSync(process.execPath, [script, 'export', '--dir', ctx.dir], { encoding: 'utf8' });
  if (run.status !== 0) throw new Error(`realKeys export failed (exit ${run.status}): ${(run.stderr || run.stdout || '').trim().split('\n').at(-1)}`);
  return (run.stdout || '').trim().split('\n')[0];
};

const mb = (bytes) => `${(bytes / 1048576).toFixed(1)} MB`;

export const backupLines = (r) => [
  `backup -> ${r.dest}`,
  `${plural(r.files, 'file')}, ${mb(r.bytes)}; verified: file count matches, answer-keys.json SHA-256 ${r.hashes['answer-keys.json']?.slice(0, 12) ?? 'absent (none in the set)'}, manifest SHA-256 ${r.hashes[path.join('orchestration', 'manifest.json')]?.slice(0, 12) ?? 'absent (none yet)'}`,
];

export const backup = async (argv, ctx) => {
  const { opts } = parseArgs(argv, { values: ['name'] }, 'backup');
  const result = await backupSet(ctx.dir, opts.name ? { name: opts.name } : {});
  for (const line of backupLines(result)) ctx.out(line);
  return 0;
};

export const freeze = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect({ values: ['backup-name'], flags: ['dry', 'backup'] }), 'freeze');
  if (opts.dry && (opts.backup || opts['backup-name'])) throw new UsageError('--dry writes nothing, so there is nothing to back up: drop --backup');
  const names = selectPlans({ positional, opts }, ctx, loadCatalog(ctx.dir));
  const index = wipIndex(ctx.dir);
  const waiting = new Map();
  const rows = [];
  for (const name of names) {
    try {
      const facts = planFacts(ctx.dir, name);
      const why = readiness(ctx.dir, name, index, facts);
      if (why?.wait) {
        const key = why.wait.replace(/\(\d+\)/, '(n)').replace(/: .*$/, '');
        waiting.set(key, (waiting.get(key) ?? 0) + 1);
      } else if (why?.refuse) rows.push({ name, action: 'REFUSED', note: why.refuse });
      else if (opts.dry) {
        // The check is what `apply` would run first; a dry run says how it would go.
        const c = await checkFinal(name, ctx, { fresh: true });
        rows.push(c.pass
          ? { name, action: 'would freeze', note: `check PASS (${c.warnings} warning(s), ${c.waived} waived)` }
          : { name, action: 'REFUSED', note: `check FAIL: ${c.firstFail ?? `${c.failures} failure(s)`}` });
      } else {
        const q = quiet(ctx);
        await apply([name], q.ctx);
        rows.push({ name, action: 'frozen', note: (q.lines[0] ?? '').replace(`${name}: `, ''), done: true });
      }
    } catch (error) {
      rows.push({ name, action: 'REFUSED', note: error.message });
    }
  }
  for (const line of table(rows, [
    { title: 'plan', get: (r) => r.name },
    { title: 'freeze', get: (r) => r.action },
    { title: 'note', get: (r) => r.note },
  ])) ctx.out(line);
  const frozen = rows.filter((r) => r.done).length;
  const refused = rows.filter((r) => r.action === 'REFUSED').length;
  ctx.out(`${opts.dry ? `${rows.filter((r) => r.action === 'would freeze').length} would be frozen (dry run: nothing written)` : `${frozen} frozen`}, ${refused} refused${waiting.size ? `; not ready: ${[...waiting].sort(([a], [b]) => byName(a, b)).map(([why, n]) => `${n} ${why}`).join('; ')}` : ''}`);
  let bad = refused;
  if (frozen) {
    try {
      ctx.out(exportKeys(ctx));
    } catch (error) {
      ctx.out(`ERROR ${error.message}`);
      bad += 1;
    }
    if (opts.backup || opts['backup-name']) {
      try {
        const result = await backupSet(ctx.dir, opts['backup-name'] ? { name: opts['backup-name'] } : {});
        for (const line of backupLines(result)) ctx.out(line);
      } catch (error) {
        ctx.out(`ERROR backup: ${error.message}`);
        bad += 1;
      }
    } else ctx.out('not backed up: run `node scripts/realPipeline.mjs backup` (or freeze with --backup) before more keys go in');
    ctx.out('next: node scripts/realManifest.mjs build');
  } else if (!opts.dry && (opts.backup || opts['backup-name'])) ctx.out('nothing was frozen, so no backup was made');
  return bad ? 1 : 0;
};
