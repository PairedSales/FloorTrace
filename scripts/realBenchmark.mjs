/**
 * Real listing plans: the tracer against outlines a person has checked.
 *
 * Each `.floorplan` in the folder is one plan. To make one: open the plan in
 * FloorTrace and let it scan and trace; correct every outline to the exterior
 * face of the walls, set each outline's type (GLA, garage, porch/patio…), and
 * save the project. The saved image is the input and the corrected outlines
 * are the answer key. The labels the scan read are what the app handed the
 * tracer, so the app's own trace is replayed exactly — `utils/traceInputs.js`
 * builds its inputs here as in the app — and is judged by the same verdict as
 * CubiCasa5K (`lib/verdict.mjs`). CubiCasa is Finnish drawings; this is the
 * scoreboard on the plans FloorTrace is for.
 *
 * Usage:  npm run bench:real -- [options]
 *   --dir PATH       the .floorplan files (default datasets/real/, beside CubiCasa)
 *   --fixtures       also the plans in fixtures/ with a polygon truth, traced
 *                    the way bench:detection's constrained run traces them
 *   --out NAME       results file (default latest), under datasets/real_runs/
 *   --compare NAME   per-plan verdict moves against an earlier results file;
 *                    refused (exit 2) when that run was made under another manifest
 *   --draw           an overlay per plan: truth green, app red, bare orange
 *   --split S        dev, test or all, from the manifest (default dev; all
 *                    when there is no manifest). test and all are the
 *                    orchestrator's, at milestones: they need FLOORTRACE_TEST_SPLIT_OK=1
 *   --only A,B,…     exactly these plans (one in the test split needs the same variable)
 *   --watch LIST     the plans of a list in watch.json, within the chosen split
 *   --jobs N         score plans on N worker processes; results and file are
 *                    the same as a serial run's, timings are not
 *   --manifest PATH  a manifest other than <dir>/orchestration/manifest.json
 *
 * The manifest (lib/manifest.mjs) says which split and era each plan is in.
 * Every run prints and records the commit, split, manifest hash and job
 * count. The test split is never printed per plan, drawn, or written to the
 * main results file: it appears as an aggregate there, and per plan only in
 * <out>.test.json.
 *
 * Answer key: GLA and below-grade outlines are the building (a basement is
 * still traced; its type decides the total, not the tracer), garage and
 * porch/patio outlines are non-GLA, unfinished outlines are not scored. A hole
 * is subtracted unless it is stale. A plan whose outlines are still the app's
 * untouched trace (a draft, `realDrafts.mjs`) has no key yet and is not scored:
 * held against its own trace, it would count as perfect. The truth masks and
 * the scoring are in lib/realScore.mjs and lib/verdict.mjs.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATASETS_DIR } from './lib/cubicasa.mjs';
import { ERAS, SPLITS, loadManifest, manifestFileFor, readWatch, watchFileFor } from './lib/manifest.mjs';
import {
  UsageError, aggregateDeltaLines, aggregateOf, boardLines, causeLine, compareRefusal, identityLine, isScored,
  mergeInOrder, moveLines, parseArgs, resolveSelection, summaryOf, timingLines, timingOf,
} from './lib/realBench.mjs';
import { runPlan, writeFileRetry } from './lib/realBenchPlan.mjs';
import { runPool } from './lib/realBenchPool.mjs';
import { VERDICTS, pct, scoreboardLines } from './lib/verdict.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SCRIPT), '..');
const RUNS_DIR = path.join(DATASETS_DIR, 'real_runs');

// The commit the run measures, and whether the working tree differs from it.
const gitState = () => {
  const git = (...args) => execFileSync('git', args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  try {
    return { commit: git('rev-parse', '--short', 'HEAD'), dirty: git('status', '--porcelain') !== '' };
  } catch {
    return { commit: null, dirty: null };
  }
};

const readJson = (file, what) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new UsageError(`${what} ${file} cannot be read: ${err.message}`);
  }
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2), { dir: path.join(DATASETS_DIR, 'real') });
  const manifestFile = args.manifest ? path.resolve(args.manifest) : manifestFileFor(args.dir);
  let loaded;
  let watch = null;
  try {
    loaded = loadManifest(manifestFile);
    if (args.watch) watch = readWatch(watchFileFor(manifestFile));
  } catch (err) {
    throw new UsageError(err.message);
  }
  const manifest = loaded?.manifest ?? null;
  const manifestHash = loaded?.hash ?? null;

  const names = fs.existsSync(args.dir)
    ? fs.readdirSync(args.dir).filter((f) => f.endsWith('.floorplan')).sort().map((f) => path.basename(f, '.floorplan'))
    : [];
  const fixtureDir = path.join(ROOT, 'fixtures');
  const fixtures = args.fixtures
    ? fs.readdirSync(fixtureDir).filter((f) => f.endsWith('.truth.json')).sort()
      .map((f) => path.join(fixtureDir, f))
    : [];
  if (!names.length && !fixtures.length) {
    throw new UsageError(`No .floorplan files in ${args.dir}. Open a plan in FloorTrace, correct its outlines,`
      + ' set their types and save the project there — see datasets/README.md. --fixtures scores fixtures/.');
  }

  // Which plans, decided before any is opened: a dev run never loads a test plan.
  const selection = resolveSelection({
    names, manifest, watch, args, manifestFile,
  });
  const drawDir = args.draw ? path.join(RUNS_DIR, args.out) : null;
  const entries = selection.entries.map((e) => {
    const file = path.join(args.dir, `${e.name}.floorplan`);
    if (e.state === 'missing') return { ...e, row: { name: e.name, error: `in the manifest, but ${e.name}.floorplan is not in ${args.dir}` } };
    if (e.state === 'unlisted') return { ...e, row: { name: e.name, skipped: 'not in the manifest' } };
    return {
      ...e,
      job: {
        name: e.name, kind: 'project', file, expectKey: e.keySha256, drawDir: e.split === 'test' ? null : drawDir,
      },
    };
  });
  for (const file of fixtures) {
    const name = `fixture:${path.basename(file, '.truth.json')}`;
    entries.push({
      name, split: null, era: null, job: { name, kind: 'fixture', file, drawDir },
    });
  }
  const jobs = entries.filter((e) => e.job).map((e) => e.job);
  if (!entries.length) throw new UsageError('nothing to run: that selection holds no plan');

  // A baseline from another manifest is refused before the run, not after it.
  let baseline = null;
  if (args.compare) {
    const baselineFile = path.join(RUNS_DIR, `${args.compare}.json`);
    if (fs.existsSync(baselineFile)) {
      baseline = readJson(baselineFile, 'the baseline');
      const refusal = compareRefusal(baseline.meta, manifestHash, args.compare);
      if (refusal) throw new UsageError(refusal);
    }
  }

  const workers = Math.min(args.jobs, Math.max(1, jobs.length));
  const git = gitState();
  const planCount = entries.filter((e) => e.state !== 'unlisted').length;
  console.log(identityLine({
    ...git, split: selection.split, manifestHash, plans: planCount, jobs: workers,
  }));

  let completed;
  if (workers > 1) completed = await runPool(SCRIPT, jobs, workers);
  else {
    completed = [];
    for (const job of jobs) completed.push(await runPlan(job));
  }
  const byName = new Map(mergeInOrder(jobs.map((j) => j.name), completed).map((r) => [r.name, r]));
  for (const e of entries) e.row ??= byName.get(e.name);

  const rows = entries.map((e) => e.row);
  const isTest = (e) => e.split === 'test';
  const openRows = entries.filter((e) => !isTest(e)).map((e) => e.row);
  const testRows = entries.filter(isTest).map((e) => e.row);
  const scored = rows.filter(isScored);
  const openScored = openRows.filter(isScored);
  const eraOf = (name) => manifest?.plans?.[name]?.era ?? null;
  const splitOf = (name) => manifest?.plans?.[name]?.split ?? null;

  const lines = [`\n=== Real plans: ${scored.length} scored of ${rows.length} ===`];
  if (scored.length) {
    lines.push(...scoreboardLines(scored, 'real plans'));
    lines.push(`   bare near-perfect ${pct(scored.filter((r) => r.bare.verdict !== 'wrong').length / scored.length)}`);
    lines.push(causeLine(summaryOf(scored)), ...timingLines(timingOf(scored), workers));
    if (manifest) {
      for (const era of ERAS) lines.push(...boardLines(scored.filter((r) => eraOf(r.name) === era), `${era} plans`));
      if (testRows.length && openRows.length) {
        for (const split of SPLITS) {
          lines.push(...boardLines(scored.filter((r) => splitOf(r.name) === split),
            `${split}-split plans${split === 'test' ? ' (aggregate only)' : ''}`));
        }
      }
    }
    lines.push('\nPer plan (app trace):');
    for (const r of openScored) {
      lines.push(`   ${r.name.padEnd(32)} ${r.app.verdict.padEnd(7)} IoU ${pct(r.app.iou).padStart(6)}`
        + `  area ${(r.app.areaErr >= 0 ? '+' : '') + pct(r.app.areaErr)}  conf ${pct(r.app.confidence)}`
        + `  ${r.app.regions.map((g) => `${g.cause} ${pct(g.share)}`).join(', ')}`);
    }
  }
  for (const r of openRows.filter((x) => x.skipped || x.error)) lines.push(`   ${r.name}: ${r.skipped ?? `ERROR ${r.error}`}`);
  const outFile = path.join(RUNS_DIR, `${args.out}.json`);
  const testFile = path.join(RUNS_DIR, `${args.out}.test.json`);
  if (testRows.length) {
    const failed = testRows.filter((r) => r.error).length;
    lines.push(`   test split: ${testRows.filter(isScored).length} scored, ${failed} errors, `
      + `${testRows.filter((r) => r.skipped).length} skipped; per plan only in ${path.basename(testFile)}`);
    if (args.draw) lines.push(`   --draw: no overlay for the ${testRows.length} test plans`);
  }

  const timing = {
    ...timingOf(scored), plans: scored.length, jobs: workers, parallel: workers > 1,
  };
  const testAggregate = testRows.length ? { ...aggregateOf(testRows, eraOf), jobs: workers } : null;
  if (args.compare) {
    if (baseline) {
      lines.push(`\n=== Against ${args.compare} ===`);
      const was = baseline.meta ?? {};
      if (was.commit) {
        lines.push(`   baseline: commit ${was.commit}${was.dirty ? '+dirty' : ''}, split ${was.split ?? '?'}, `
          + `manifest ${was.manifestHash ? was.manifestHash.slice(0, 12) : 'none'}`);
      }
      lines.push(...moveLines(baseline.results, openScored, VERDICTS));
      if (testAggregate && baseline.testAggregate) lines.push(...aggregateDeltaLines(baseline.testAggregate, testAggregate));
    } else lines.push(`\nno results named ${args.compare} to compare against`);
  }
  for (const line of lines) console.log(line);

  const meta = {
    date: new Date().toISOString(),
    dir: args.dir,
    ...git,
    split: selection.split,
    only: args.only,
    watch: args.watch ?? null,
    manifestHash,
    jobs: workers,
    timing,
  };
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  writeFileRetry(outFile, JSON.stringify({ meta, results: openRows, ...(testAggregate ? { testAggregate } : {}) }));
  const shown = (file) => (path.relative(ROOT, file).startsWith('..') ? file : path.relative(ROOT, file));
  console.log(`results: ${shown(outFile)}`);
  if (testRows.length) {
    writeFileRetry(testFile, JSON.stringify({ meta, results: testRows }));
    console.log(`test results (per plan): ${shown(testFile)}`);
  }
  // A plan that could not be scored is not a quiet gap in the scoreboard.
  if (rows.some((r) => r.error)) process.exitCode = 1;
};

// A worker: score the plans the parent sends, one at a time (lib/realBenchPool.mjs).
const runWorker = () => {
  if (!process.send) {
    console.error('--worker is started by --jobs, not by hand');
    process.exit(2);
  }
  // A parent that has gone (it finished, or was stopped) is not an error to report.
  const say = (message) => process.send(message, (err) => {
    if (err) process.exit(0);
  });
  process.on('disconnect', () => process.exit(0));
  process.on('message', async ({ job }) => {
    say({ result: await runPlan(job) });
  });
  say({ type: 'ready' });
};

if (process.argv.slice(2).includes('--worker')) runWorker();
else {
  main().catch((err) => {
    if (!(err instanceof UsageError)) throw err;
    console.error(err.message);
    process.exitCode = 2;
  });
}
