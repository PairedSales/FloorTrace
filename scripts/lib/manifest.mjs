// The real set's manifest: which plan is in which split and era, and the
// fingerprint of the key each was frozen with. `bench:real` reads it; the
// orchestrator writes it. Every scoreboard number names the manifest it was
// measured under (its hash), so two runs are comparable only when the set,
// the splits and the keys are the same.
//
// `<set folder>/orchestration/manifest.json` (set folder = datasets/real/),
// version 1:
//
//   {
//     "version": 1,
//     "seed": 20260928,                       opaque: the split's shuffle seed
//     "createdAt": "2026-...",                opaque
//     "plans": {
//       "aladdin62-n15": {
//         "book": "aladdin62",                a book, publisher or builder
//         "publisher": "Aladdin",             opaque, as are decade, source and
//         "decade": 1960,                     annotation: whoever writes the
//         "era": "vintage",                   manifest keeps what it likes there
//         "split": "dev",
//         "source": {"url": "...", "crop": [x, y, w, h], "size": [w, h]},
//         "keySha256": "<hex>",
//         "annotation": {"annotators": ["A", "B"], "agreement": {}, "adjudicated": false,
//                        "verifiedBy": "blind double annotation",
//                        "checked": {"by": "AI review", "at": "...", "via": "final review"}}
//       }
//     }
//   }
//
// Read and validated here: `split` ("dev" or "test"), `era` ("vintage" or
// "2020-2022"), `keySha256` (optional: the SHA-256 of `JSON.stringify(key)`,
// `key` being what `realKeys.keyOf` returns, checked at every run when present)
// and `book` (optional). A mistyped split would drop a plan from every run
// without a word, so it is an error at read time, not a plan nobody scores.
//
// What `keySha256` guards is the KEY only: a plan whose outlines were edited
// after the manifest froze them is not scored. It does not cover the plan's
// image, its labels or its scale, so a rescan or a recalibration of a plan
// moves its score without tripping the check. The manifest hash covers the
// manifest's own bytes, not the plan files.
//
// `orchestration/watch.json` holds the watch lists, plans that show one failure
// for a fix to be tried on first: {"lists": {"<mechanism>": ["plan", ...]}}.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DATASETS_DIR } from './cubicasa.mjs';

export const MANIFEST_VERSION = 1;
export const SPLITS = ['dev', 'test'];
export const ERAS = ['vintage', '2020-2022'];

export const REAL_DIR = path.join(DATASETS_DIR, 'real');
export const MANIFEST_FILE = path.join(REAL_DIR, 'orchestration', 'manifest.json');
export const WATCH_FILE = path.join(REAL_DIR, 'orchestration', 'watch.json');

// The manifest of a set folder, and the watch lists that sit beside a manifest.
export const manifestFileFor = (dir) => path.join(dir, 'orchestration', 'manifest.json');
export const watchFileFor = (manifestFile) => path.join(path.dirname(manifestFile), 'watch.json');

export const sha256 = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// The fingerprint of an answer key as `realKeys.keyOf` returns it (null, a
// plan still holding the app's own trace, has none).
export const keySha256 = (key) => (key ? sha256(JSON.stringify(key)) : null);

// Why a plan's current key is not the one the manifest froze, or null when it
// is (or the manifest carries no fingerprint for the plan). A plan scored
// against another key would move the scoreboard without the tracer moving.
export const keyCheck = (expected, key) => {
  if (!expected) return null;
  const now = keySha256(key);
  if (now === expected) return null;
  return `key changed since the manifest (was ${expected.slice(0, 8)}, is ${now ? now.slice(0, 8) : 'none'})`;
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// PowerShell writes a byte-order mark that JSON.parse refuses. The hash is of
// the bytes as they are; only the parse skips it.
const stripBom = (text) => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);

const problemsIn = (json) => {
  const problems = [];
  if (!isObject(json.plans)) return ['"plans" is not an object'];
  for (const [name, plan] of Object.entries(json.plans)) {
    if (!isObject(plan)) problems.push(`${name}: not an object`);
    else {
      if (!SPLITS.includes(plan.split)) problems.push(`${name}: split ${JSON.stringify(plan.split)} is not ${SPLITS.join(' or ')}`);
      if (!ERAS.includes(plan.era)) problems.push(`${name}: era ${JSON.stringify(plan.era)} is not ${ERAS.join(' or ')}`);
      if (plan.keySha256 !== undefined && !/^[0-9a-f]{64}$/.test(plan.keySha256)) problems.push(`${name}: keySha256 is not 64 hex digits`);
      if (plan.book !== undefined && typeof plan.book !== 'string') problems.push(`${name}: book is not a string`);
    }
  }
  return problems;
};

// The manifest in `text`, or a clear error naming `source`.
export const parseManifest = (text, source = 'manifest') => {
  let json;
  try {
    json = JSON.parse(stripBom(text));
  } catch (err) {
    throw new Error(`${source} is not valid JSON: ${err.message}`);
  }
  if (!isObject(json)) throw new Error(`${source} is not a JSON object`);
  if (json.version !== MANIFEST_VERSION) {
    throw new Error(`${source} has version ${JSON.stringify(json.version)}; this reads version ${MANIFEST_VERSION}`);
  }
  const problems = problemsIn(json);
  if (problems.length) {
    throw new Error(`${source} is malformed: ${problems.slice(0, 5).join('; ')}`
      + `${problems.length > 5 ? `; and ${problems.length - 5} more` : ''}`);
  }
  return json;
};

// The manifest and its hash from one read of the file, so the hash is of the
// bytes that were parsed; null when there is no file. `required` is for a file
// somebody named: a manifest that is not there is then an error, not a run
// without one (which would be a run with no split and no test-split gate).
export const loadManifest = (file = MANIFEST_FILE, { required = false } = {}) => {
  if (!fs.existsSync(file)) {
    if (required) throw new Error(`the manifest ${file} does not exist`);
    return null;
  }
  const bytes = fs.readFileSync(file);
  return { manifest: parseManifest(bytes.toString('utf8'), file), hash: sha256(bytes), file };
};

export const readManifest = (file = MANIFEST_FILE) => loadManifest(file)?.manifest ?? null;

// SHA-256 hex of the file's bytes; null when there is no manifest.
export const manifestHash = (file = MANIFEST_FILE) => (fs.existsSync(file) ? sha256(fs.readFileSync(file)) : null);

// A plan is listed only by a name the manifest holds itself: `plans.constructor`
// is a function, not a plan called "constructor".
export const hasPlan = (manifest, name) => Boolean(manifest?.plans) && Object.hasOwn(manifest.plans, name);
export const planSplit = (manifest, name) => (hasPlan(manifest, name) ? manifest.plans[name].split : null);
export const planEra = (manifest, name) => (hasPlan(manifest, name) ? manifest.plans[name].era : null);

// The watch lists, `{lists: {mechanism: [plan, ...]}}`; null when there is no file.
export const readWatch = (file = WATCH_FILE) => {
  if (!fs.existsSync(file)) return null;
  let json;
  try {
    json = JSON.parse(stripBom(fs.readFileSync(file, 'utf8')));
  } catch (err) {
    throw new Error(`${file} is not valid JSON: ${err.message}`);
  }
  const lists = json?.lists;
  const ok = isObject(lists) && Object.values(lists).every((l) => Array.isArray(l) && l.every((n) => typeof n === 'string'));
  if (!ok) throw new Error(`${file} must be {"lists": {"<mechanism>": ["plan", ...]}}`);
  return json;
};
