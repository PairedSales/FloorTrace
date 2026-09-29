/**
 * The real set's answer keys as one small file, so they can travel without
 * their plans.
 *
 * A plan's answer key is saved in its `.floorplan`, beside the megabyte or so of
 * image it was drawn on (datasets/README.md). A session that cannot write those
 * files where the set is kept — a cloud session that reaches it through a
 * connector able to upload only small files — hands its keys over in this file,
 * and `apply` writes them into the plans where they are. Each key travels with
 * the plan's record of who drew it (`answerKey`: by, at, notes), and with where
 * its image came from (`source`), when the plan was made from one: `apply`
 * makes a plan the folder does not have yet from its source, the way
 * scripts/realDrafts.mjs does, so a set grows by this file and not its images.
 *
 * Usage:  node scripts/realKeys.mjs export|apply [options]
 *   export        the keys file, from every plan whose outlines someone has
 *                 drawn or corrected; a plan still holding the app's untouched
 *                 trace has no key yet and is left out
 *   apply         the keys file into its plans. A plan still holding the app's
 *                 untouched trace takes its key; one someone has corrected
 *                 differently is left alone and listed. A plan the folder does
 *                 not have is made from its source first. Also repairs the
 *                 first drafts' trace record, which kept them from opening
 *   --dir PATH    the .floorplan files (default datasets/real/, beside CubiCasa)
 *   --keys FILE   the keys file (default answer-keys.json in --dir)
 *   --force       apply over outlines someone has corrected
 */
import fs from 'fs';
import path from 'path';
import { DATASETS_DIR } from './lib/cubicasa.mjs';
import { KEYS_VERSION, applyPlan, keyOf } from './lib/realKeys.mjs';

const parseArgs = (argv) => {
  const args = { command: argv[0], dir: path.join(DATASETS_DIR, 'real') };
  for (let i = 1; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (key === 'dir' || key === 'keys') {
      args[key] = argv[i + 1];
      i += 1;
    } else if (key === 'force') args.force = true;
  }
  args.keys ??= path.join(args.dir, 'answer-keys.json');
  return args;
};

const planNames = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith('.floorplan')).sort().map((f) => path.basename(f, '.floorplan'))
  : []);

const readPlan = (dir, name) => {
  const file = path.join(dir, `${name}.floorplan`);
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
};

// One plan to a line: the file stays readable, and a change to one key is a
// one-line diff.
const lines = (map) => Object.entries(map).map(([name, value]) => `${JSON.stringify(name)}:${JSON.stringify(value)}`).join(',\n');
const writeKeys = (file, plans, about, sources) => {
  const sourced = Object.keys(sources).length ? `,"sources":{\n${lines(sources)}\n}` : '';
  fs.writeFileSync(file, `{"version":${KEYS_VERSION},"plans":{\n${lines(plans)}\n},"about":{\n${lines(about)}\n}${sourced}}\n`);
};

const exportKeys = (args) => {
  const plans = {};
  const about = {};
  const sources = {};
  const drafts = [];
  for (const name of planNames(args.dir)) {
    const project = readPlan(args.dir, name);
    const key = keyOf(project?.floors?.[0]?.state);
    if (!key) {
      drafts.push(name);
      continue;
    }
    plans[name] = key;
    if (project.answerKey) about[name] = project.answerKey;
    if (project.source) sources[name] = project.source;
  }
  writeKeys(args.keys, plans, about, sources);
  console.log(`${Object.keys(plans).length} answer keys -> ${args.keys}`);
  if (drafts.length) console.log(`no key yet, still the app's own trace: ${drafts.join(', ')}`);
};

const applyKeys = async (args) => {
  const keys = JSON.parse(fs.readFileSync(args.keys, 'utf8'));
  if (keys.version !== KEYS_VERSION) {
    throw new Error(`${args.keys} is version ${keys.version}; this script reads version ${KEYS_VERSION}`);
  }
  const report = { applied: [], unchanged: [], kept: [], missing: [], repaired: [], made: [], unmade: [] };
  // Loaded only when a plan has to be made: it is the whole OCR graph.
  let drafting = null;
  for (const [name, outlines] of Object.entries(keys.plans)) {
    let project = readPlan(args.dir, name);
    if (!project && keys.sources?.[name]) {
      drafting ??= await import('./lib/realDraft.mjs');
      try {
        ({ project } = await drafting.draftFromSource(name, keys.sources[name], args.dir));
        report.made.push(name);
      } catch (error) {
        report.unmade.push(`${name} (${error.message})`);
      }
    }
    const { outcome, repaired, write } = applyPlan(project, outlines, keys.about?.[name], { force: args.force });
    report[outcome].push(name);
    if (repaired) report.repaired.push(name);
    if (!write) continue;
    project.metadata = { ...project.metadata, updatedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(args.dir, `${name}.floorplan`), JSON.stringify(project));
  }
  await drafting?.terminateOcrWorker();
  if (report.made.length) console.log(`made ${report.made.length} from their sources: ${report.made.join(', ')}`);
  if (report.unmade.length) console.log(`could not make: ${report.unmade.join('; ')}`);
  console.log(`applied ${report.applied.length}, already there ${report.unchanged.length}`);
  if (report.repaired.length) {
    console.log(`repaired ${report.repaired.length} the app refused to open (a trace level that was not a string)`);
  }
  if (report.kept.length) {
    console.log(`kept, corrected differently in the plan (--force replaces): ${report.kept.join(', ')}`);
  }
  if (report.missing.length) console.log(`not in ${args.dir}: ${report.missing.join(', ')}`);
};

const args = parseArgs(process.argv.slice(2));
if (args.command === 'export') exportKeys(args);
else if (args.command === 'apply') await applyKeys(args);
else {
  console.error('usage: node scripts/realKeys.mjs export|apply [--dir PATH] [--keys FILE] [--force]');
  process.exitCode = 2;
}
