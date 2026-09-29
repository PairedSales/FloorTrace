/**
 * Draft plans for the real set: a page image in, the `.floorplan` the app
 * would save after scanning it out, ready for its outlines to be corrected
 * into an answer key (datasets/README.md). Each step is the app's own code —
 * scripts/lib/realDraft.mjs says where the scan differs from the browser's.
 *
 * `node scripts/realKeys.mjs apply` makes the same drafts for any plan its
 * keys file sources that is not in the folder yet, so a set can grow by a
 * small file of sources and keys rather than by its images.
 *
 * Usage:  node scripts/realDrafts.mjs IMAGE... [options]
 *   IMAGE          a .png or .jpg file, or an http(s) URL
 *   --name NAME    the plan's name, for one image (default: the file's name)
 *   --crop X,Y,W,H the part of the page that is the plan
 *   --dir PATH     where drafts are written (default datasets/real/, beside CubiCasa)
 *   --force        replace a plan that is already there
 */
import fs from 'fs';
import path from 'path';
import { DATASETS_DIR } from './lib/cubicasa.mjs';
import { draftFromSource, terminateOcrWorker } from './lib/realDraft.mjs';

const parseArgs = (argv) => {
  const args = { images: [], dir: path.join(DATASETS_DIR, 'real') };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--name' || arg === '--dir' || arg === '--crop') {
      args[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else if (arg === '--force') args.force = true;
    else args.images.push(arg);
  }
  if (args.crop) args.crop = args.crop.split(',').map(Number);
  return args;
};

const run = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (!args.images.length || (args.name && args.images.length > 1)) {
    console.error('usage: node scripts/realDrafts.mjs IMAGE... [--name NAME] [--crop X,Y,W,H] [--dir PATH] [--force]');
    process.exitCode = 2;
    return;
  }
  fs.mkdirSync(args.dir, { recursive: true });
  for (const input of args.images) {
    const isUrl = /^https?:\/\//.test(input);
    const name = args.name ?? path.basename(isUrl ? new URL(input).pathname : input).replace(/\.[^.]+$/, '');
    const file = path.join(args.dir, `${name}.floorplan`);
    if (fs.existsSync(file) && !args.force) {
      console.log(`${name}: already there (--force replaces it)`);
      continue;
    }
    // A file is recorded relative to the folder, as a keys file names it, so
    // the record still finds it where the folder is synced to another machine.
    const source = isUrl ? { url: input } : { file: path.relative(args.dir, path.resolve(input)) };
    if (args.crop) source.crop = args.crop;
    const { project, scan } = await draftFromSource(name, source, args.dir);
    fs.writeFileSync(file, JSON.stringify(project));
    const state = project.floors[0].state;
    const scale = state.calibration.calibrated
      ? `${(1 / state.calibration.feetPerPixel.x).toFixed(2)} px/ft (${state.calibration.quality.level})`
      : 'no scale';
    console.log(`${name}: ${scan.dimensions.length} labels${scan.truncated ? ` (${scan.truncated} regions cut off)` : ''}, `
      + `${state.rooms.length} rooms set the scale, ${scale}, `
      + `${state.perimeterTraces.length} outline(s), trace ${state.lastTraceOutcome.level} -> ${file}`);
  }
};

run().finally(() => terminateOcrWorker());
