// The decisions behind `bench:real` (scripts/realBenchmark.mjs), pure so they
// are tested without the set or a child process: what the options mean, which
// plans a run may touch, how sharded results merge, what the aggregates and
// timings are, and when two runs may be compared.
//
// The rule they enforce most carefully is integrity rule 4: nobody tunes
// against the test split. It is gated here (`resolveSelection`), never loaded
// for a dev run, and never printed per plan (`realBenchmark.mjs`).
import { ERAS, SPLITS, hasPlan } from './manifest.mjs';
import {
  SCOREBOARD, pct, scoreboardLines,
} from './verdict.mjs';

// Set by the orchestrator alone, for a milestone run.
export const TEST_SPLIT_ENV = 'FLOORTRACE_TEST_SPLIT_OK';
export const MAX_JOBS = 64;

// A mistake in what was asked for, printed as is and exiting 2.
export class UsageError extends Error {}

const VALUE_OPTIONS = ['dir', 'out', 'compare', 'split', 'only', 'watch', 'jobs', 'manifest'];
const FLAG_OPTIONS = ['draw', 'fixtures', 'worker'];

// An unknown option is an error: `--splt test` silently ignored would run
// something other than what was asked.
export const parseArgs = (argv, defaults = {}) => {
  const args = {
    out: 'latest', jobs: 1, only: null, split: null, ...defaults,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const key = arg.replace(/^--/, '');
    if (!arg.startsWith('--') || !(VALUE_OPTIONS.includes(key) || FLAG_OPTIONS.includes(key))) {
      throw new UsageError(`unknown option ${arg}`);
    }
    if (FLAG_OPTIONS.includes(key)) {
      args[key] = true;
    } else {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) throw new UsageError(`--${key} needs a value`);
      i += 1;
      if (key === 'only') {
        args.only = [...(args.only ?? []), ...value.split(',').map((n) => n.trim()).filter(Boolean)];
        if (!args.only.length) throw new UsageError('--only needs at least one plan name');
      } else args[key] = value;
    }
  }
  if (args.split !== null && ![...SPLITS, 'all'].includes(args.split)) {
    throw new UsageError(`--split is dev, test or all, not ${args.split}`);
  }
  const jobs = typeof args.jobs === 'number' ? args.jobs : (/^\d+$/.test(args.jobs) ? Number(args.jobs) : NaN);
  if (!(jobs >= 1 && jobs <= MAX_JOBS)) throw new UsageError(`--jobs is a whole number from 1 to ${MAX_JOBS}, not ${args.jobs}`);
  args.jobs = jobs;
  return args;
};

// The order runs are reported in: the folder's file order, as it always was.
export const fileOrder = (a, b) => {
  const x = `${a}.floorplan`;
  const y = `${b}.floorplan`;
  if (x < y) return -1;
  return x > y ? 1 : 0;
};

const testGateMessage = 'the test split is run only by the orchestrator, at milestones, and reports'
  + ' aggregates only (integrity rule 4: nobody tunes against test). Run --split dev, or name dev plans.'
  + ` The orchestrator sets ${TEST_SPLIT_ENV}=1.`;

const named = (list) => list.join(', ');

/**
 * Which plans a run covers, before any is opened.
 *
 * `names` are the plans in the folder. With a manifest a run covers a split
 * (default dev), `--only` names plans directly (each in the split, when one is
 * asked for), and `--watch` keeps the named list's plans that lie in the
 * chosen split. Without one every plan is scored, as before, and a split
 * cannot be asked for. The test split needs `TEST_SPLIT_ENV` however it is
 * reached: by `--split test|all`, or by naming one of its plans.
 *
 * Returns `entries` in file order: `{name, split, era, keySha256, state}`,
 * state `run`, `missing` (in the manifest and the chosen set, no file), or
 * `unlisted` (in the folder, not in the manifest: never scored, listed).
 * Names are looked up as the manifest and the watch file hold them, never
 * through the prototype: `--only constructor` is no plan, not a plan of that name.
 */
export const resolveSelection = ({
  names, manifest, watch, args, env = process.env, manifestFile = 'the manifest',
}) => {
  const inFolder = new Set(names);
  const only = args.only ?? null;
  const asked = args.split ?? null;
  // First, before any name is looked up: whatever else is wrong with the
  // request, the test split is not something to probe.
  if (manifest && (asked === 'test' || asked === 'all') && env[TEST_SPLIT_ENV] !== '1') {
    throw new UsageError(testGateMessage);
  }
  let watchNames = null;
  if (args.watch) {
    if (!watch) throw new UsageError(`--watch ${args.watch}: there is no watch.json beside ${manifestFile}`);
    if (Object.hasOwn(watch.lists, args.watch)) watchNames = watch.lists[args.watch];
    else {
      throw new UsageError(`--watch ${args.watch}: no such list; watch.json has ${named(Object.keys(watch.lists)) || 'none'}`);
    }
  }

  if (!manifest) {
    if (asked && asked !== 'all') throw new UsageError(`--split ${asked} reads the manifest, and there is none at ${manifestFile}`);
    const unknown = [...(only ?? []), ...(watchNames ?? [])].filter((n) => !inFolder.has(n));
    if (unknown.length) throw new UsageError(`no such plan in the folder: ${named([...new Set(unknown)])}`);
    let pick = names;
    if (only) pick = pick.filter((n) => only.includes(n));
    if (watchNames) pick = pick.filter((n) => watchNames.includes(n));
    return {
      split: 'all',
      entries: pick.map((name) => ({
        name, split: null, era: null, keySha256: null, state: 'run',
      })),
    };
  }

  const plans = manifest.plans;
  const listed = (name) => hasPlan(manifest, name);
  const splitFilter = asked ?? (only ? null : 'dev');
  const inSplit = (name) => !splitFilter || splitFilter === 'all' || plans[name].split === splitFilter;
  let picked;
  if (only) {
    for (const name of new Set([...only, ...(watchNames ?? [])])) {
      if (listed(name)) continue;
      throw new UsageError(inFolder.has(name)
        ? `${name} is not in the manifest`
        : `no such plan: ${name}`);
    }
    for (const name of only) {
      if (!inSplit(name)) throw new UsageError(`${name} is in split ${plans[name].split}, not ${splitFilter}`);
    }
    picked = [...new Set(only)];
  } else {
    if (watchNames) {
      const unknown = watchNames.filter((n) => !listed(n));
      if (unknown.length) throw new UsageError(`watch list ${args.watch} names plans that are not in the manifest: ${named(unknown)}`);
    }
    picked = Object.keys(plans).filter(inSplit);
  }
  if (watchNames) picked = picked.filter((n) => watchNames.includes(n) && inSplit(n));
  if (picked.some((n) => plans[n].split === 'test') && env[TEST_SPLIT_ENV] !== '1') {
    throw new UsageError(testGateMessage);
  }
  const entries = picked.map((name) => ({
    name,
    split: plans[name].split,
    era: plans[name].era,
    keySha256: plans[name].keySha256 ?? null,
    state: inFolder.has(name) ? 'run' : 'missing',
  }));
  if (!only && !watchNames) {
    for (const name of names) {
      if (!listed(name)) {
        entries.push({
          name, split: null, era: null, keySha256: null, state: 'unlisted',
        });
      }
    }
  }
  entries.sort((a, b) => fileOrder(a.name, b.name));
  const splits = new Set(entries.filter((e) => e.state !== 'unlisted').map((e) => e.split));
  return {
    split: splitFilter ?? (splits.size > 1 ? 'all' : ([...splits][0] ?? 'dev')),
    entries,
  };
};

/**
 * The test plans a folder holds that a set manifest names, when no manifest
 * sits beside the folder. A copy of the set made without its `orchestration/`
 * folder would otherwise run every plan, test ones included, with no gate and
 * no silence; the count (never the names) is what a refusal says.
 */
export const testPlansHeldWithoutManifest = (names, setManifest) => (setManifest
  ? names.filter((n) => hasPlan(setManifest, n) && setManifest.plans[n].split === 'test').length
  : 0);

/**
 * The `only` a run records in the main results file: without the test plans it
 * names, and how many those were. The file's test plans are meant to stay
 * anonymous there; `<out>.test.json` keeps the whole request.
 */
export const openOnly = (only, entries) => {
  if (!only) return { only: null, onlyTest: 0 };
  const test = new Set(entries.filter((e) => e.split === 'test').map((e) => e.name));
  const open = only.filter((n) => !test.has(n));
  return { only: open.length ? open : null, onlyTest: only.length - open.length };
};

/**
 * A line for the run when plans in the manifest carry no `keySha256`: their
 * keys are not checked, and a scoreboard that reads as guarded should say
 * where it is not. A count only, so it can be printed for the test split.
 */
export const unpinnedLine = (entries) => {
  const listed = entries.filter((e) => e.state === 'run' && e.split);
  const unpinned = listed.filter((e) => !e.keySha256).length;
  return unpinned
    ? `   key check: ${unpinned} of ${listed.length} manifest plans carry no keySha256, so their keys are not checked`
    : null;
};

/**
 * Results in the order of `order` (plan names), from completions in whatever
 * order the workers finished: a run with any number of jobs reads as a serial
 * one. A plan that never came back is an error row, not a plan that vanished.
 */
export const mergeInOrder = (order, completions) => {
  const byName = new Map(completions.map((c) => [c.name, c]));
  return order.map((name) => byName.get(name) ?? { name, error: 'no result came back from the worker' });
};

// The q-th quantile of `values` (linear between ranks; 0.5 is the median);
// null for none.
export const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

const spread = (values) => (values.length
  ? { median: Math.round(quantile(values, 0.5)), p90: Math.round(quantile(values, 0.9)) }
  : null);

// Median and 90th-percentile trace time, app and bare, over scored plans.
export const timingOf = (scored) => ({
  app: spread(scored.map((r) => r.app.ms)),
  bare: spread(scored.map((r) => r.bare.ms)),
});

export const isScored = (row) => !row.skipped && !row.error;

const round4 = (x) => Number(x.toFixed(4));
const meanOf = (list, pick) => (list.length ? round4(list.reduce((sum, r) => sum + pick(r), 0) / list.length) : null);
const shareOf = (list, count) => ({ count, share: list.length ? round4(count / list.length) : null });

// The scoreboard's numbers for scored plans: counts and shares, the mean error
// by cause, the timings.
export const summaryOf = (scored) => ({
  plans: scored.length,
  measures: Object.fromEntries(SCOREBOARD.map(({ name, test }) => [name, shareOf(scored, scored.filter(test).length)])),
  bareNearPerfect: shareOf(scored, scored.filter((r) => r.bare.verdict !== 'wrong').length),
  causes: {
    overNonGla: meanOf(scored, (r) => r.app.overNonGla),
    overOther: meanOf(scored, (r) => r.app.overOther),
    missed: meanOf(scored, (r) => r.app.missed),
  },
  timing: timingOf(scored),
});

/**
 * Everything a run says about a set of plans without saying which: what goes
 * into a run file for the test split. `eraOf(name)` reads the manifest.
 */
export const aggregateOf = (rows, eraOf = null) => {
  const scored = rows.filter(isScored);
  return {
    ...summaryOf(scored),
    errors: rows.filter((r) => r.error).length,
    skipped: rows.filter((r) => r.skipped).length,
    eras: eraOf ? Object.fromEntries(ERAS.map((era) => [era, summaryOf(scored.filter((r) => eraOf(r.name) === era))])) : null,
  };
};

// A run may be compared with a baseline only under the same manifest. Two runs
// from before manifests, or made with none, both have null. Null when they may.
export const compareRefusal = (baselineMeta, currentHash, name) => {
  const was = baselineMeta?.manifestHash ?? null;
  if (was === currentHash) return null;
  return `cannot compare with ${name}: it was measured under manifest ${was ?? 'none'},`
    + ` this run under manifest ${currentHash ?? 'none'}. A comparison holds only within one manifest.`;
};

// A value with its object keys in order and its `ms` (wall-clock time, which
// differs run to run) left out.
const withoutMs = (value) => {
  if (Array.isArray(value)) return value.map(withoutMs);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).filter((k) => k !== 'ms').sort().map((k) => [k, withoutMs(value[k])]));
  }
  return value;
};

/**
 * Whether two run files scored the same: their `results`, plan by plan, apart
 * from `ms`. The proof that a change to the benchmark itself, or a run on more
 * workers, moved no number. `meta` is not read: it says when and how, not what.
 * A run with no results proves nothing (two wrong or empty files would
 * "match"), so it throws, naming the side, instead of reporting equality.
 */
export const diffRuns = (a, b) => {
  const side = (run, which) => {
    if (!Array.isArray(run?.results) || !run.results.length) {
      throw new Error(`the ${which} run has no results, so there is nothing to compare`
        + ' (a --split test run keeps its plans in <out>.test.json, which is not compared)');
    }
    return new Map(run.results.map((r) => [r.name, JSON.stringify(withoutMs(r))]));
  };
  const left = side(a, 'first');
  const right = side(b, 'second');
  return {
    plans: left.size,
    onlyLeft: [...left.keys()].filter((n) => !right.has(n)),
    onlyRight: [...right.keys()].filter((n) => !left.has(n)),
    differing: [...left.keys()].filter((n) => right.has(n) && left.get(n) !== right.get(n)),
  };
};

// ---- Output -------------------------------------------------------------

export const identityLine = ({
  commit, dirty, split, manifestHash, plans, jobs,
}) => `bench:real  commit ${commit ?? 'unknown'}${dirty ? '+dirty' : ''}  split ${split}`
  + `  manifest ${manifestHash ? manifestHash.slice(0, 12) : 'none'}  plans ${plans}  jobs ${jobs}`;

// The scoreboard for a slice, and a stated "0 plans" when it is empty.
export const boardLines = (list, title) => (list.length
  ? scoreboardLines(list, title)
  : [`\nScoreboard: 0 ${title}`, '   0 plans: nothing to score']);

export const causeLine = (summary) => (summary.plans
  ? `   mean error by cause: non-GLA space kept ${pct(summary.causes.overNonGla)},`
    + ` other space taken in ${pct(summary.causes.overOther)}, living space left out ${pct(summary.causes.missed)}`
  : null);

export const timingLines = (timing, jobs) => {
  if (!timing?.app) return [];
  const lines = [`   trace time (ms): app median ${timing.app.median}, p90 ${timing.app.p90};`
    + ` bare median ${timing.bare.median}, p90 ${timing.bare.p90}`];
  if (jobs > 1) lines.push(`   (timings taken under parallel load: ${jobs} jobs shared the machine, so a serial run is faster)`);
  return lines;
};

// The verdict moves against an earlier run, the lines `--compare` always printed.
export const moveLines = (baselineRows, scored, order) => {
  const before = new Map(baselineRows.map((r) => [r.name, r]));
  const lines = [];
  for (const r of scored) {
    const b = before.get(r.name);
    if (!b?.app || b.app.verdict === r.app.verdict) continue;
    const moved = order.indexOf(r.app.verdict) < order.indexOf(b.app.verdict) ? 'better' : 'worse';
    lines.push(`   ${moved.padEnd(6)} ${r.name}: ${b.app.verdict} -> ${r.app.verdict}  IoU ${pct(b.app.iou)} -> ${pct(r.app.iou)}`);
  }
  return lines;
};

const delta = (a, b) => (a && b && a.share !== null && b.share !== null
  ? `${pct(a.share).padStart(6)} -> ${pct(b.share).padStart(6)}  (${b.share >= a.share ? '+' : '-'}${(Math.abs(b.share - a.share) * 100).toFixed(1)} points)`
  : 'n/a');

/** The test split's aggregates before and after, and nothing per plan. */
export const aggregateDeltaLines = (before, after) => {
  const lines = ['   test split, aggregate only:'];
  const block = (label, a, b) => {
    lines.push(`   ${label}: ${a.plans} -> ${b.plans} plans`);
    for (const { name } of SCOREBOARD) lines.push(`      ${name.padEnd(24)} ${delta(a.measures[name], b.measures[name])}`);
  };
  block('overall', before, after);
  for (const era of ERAS) {
    if (before.eras?.[era] && after.eras?.[era]) block(era, before.eras[era], after.eras[era]);
  }
  return lines;
};
