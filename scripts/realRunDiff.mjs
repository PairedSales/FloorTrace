/**
 * Did two `bench:real` runs score the same? Compares the `results` of two run
 * files plan by plan, ignoring `ms` and `meta`: the proof that a change to the
 * benchmark, or a run on more workers, moved no number.
 *
 * Usage:  node scripts/realRunDiff.mjs A B
 *   A, B   run names under datasets/real_runs/ (`--out` of the run), or paths
 *
 * Exits 0 when identical, 1 when not (the plans that differ are listed), 2 when
 * a file cannot be read or holds no results (nothing was compared).
 */
import fs from 'fs';
import path from 'path';
import { DATASETS_DIR } from './lib/cubicasa.mjs';
import { diffRuns } from './lib/realBench.mjs';

const load = (name) => {
  const file = fs.existsSync(name) ? name : path.join(DATASETS_DIR, 'real_runs', `${name}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    throw new Error(`${file} cannot be read: ${err.message}`);
  }
};

const [a, b] = process.argv.slice(2);
if (!a || !b) {
  console.error('usage: node scripts/realRunDiff.mjs A B   (run names under datasets/real_runs/, or paths)');
  process.exit(2);
}
let diff;
try {
  diff = diffRuns(load(a), load(b));
} catch (err) {
  console.error(err.message);
  process.exit(2);
}
const { plans, onlyLeft, onlyRight, differing } = diff;
if (!onlyLeft.length && !onlyRight.length && !differing.length) {
  console.log(`identical: ${plans} results, ignoring ms and meta`);
} else {
  console.log(`DIFFERENT: ${plans} results in ${a}`);
  if (onlyLeft.length) console.log(`  only in ${a}: ${onlyLeft.join(', ')}`);
  if (onlyRight.length) console.log(`  only in ${b}: ${onlyRight.join(', ')}`);
  if (differing.length) console.log(`  differing: ${differing.join(', ')}`);
  process.exitCode = 1;
}
