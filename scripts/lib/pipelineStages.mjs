// Where a plan stands in the key pipeline, read off the files in keys-wip/ and
// the plan itself (`realPipeline status`, and the commands that pick plans by
// stage). One `wipIndex` (a single directory listing) answers "does this file
// exist" for every plan, so a status of 400 plans does not stat 5,000 files, and
// the only per-plan reads are the plan (its record, its key, its image) and the
// small files a stage needs.
//
// The check result is cached beside the key (`NAME.check.json`) under a
// fingerprint of everything the check reads: a check decodes the plan's image
// and snaps the key again, about a second each, and 400 of them on every
// `status` would make the table something nobody runs. `apply` (freeze) never
// uses the cache: it always checks for itself.
import fs from 'fs';
import path from 'path';
import { keyOf } from './realKeys.mjs';
import { keySha256, sha256 } from './manifest.mjs';
import {
  packetDir, planFile, planImageBytes, readJson, wipDir, wipFile, writeJson,
} from './keyFiles.mjs';
import { runCheck } from './keyCommands.mjs';

const statOf = (file) => {
  try {
    return fs.statSync(file);
  } catch {
    return null;
  }
};

/** SHA-256 of a file's bytes, or null when it is not there. */
export const sha256Of = (file) => {
  try {
    return sha256(fs.readFileSync(file));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
};

/**
 * One listing of keys-wip/ and of its packets: `has(name, suffix)`, the review
 * numbers of each plan (`reviews`, sorted), the packet folders (`packets`).
 */
export const wipIndex = (dir) => {
  const wip = wipDir(dir);
  const files = new Set(fs.existsSync(wip) ? fs.readdirSync(wip) : []);
  const reviews = new Map();
  for (const f of files) {
    const m = /^(.+)\.review-(\d+)\.json$/.exec(f);
    if (!m) continue;
    if (!reviews.has(m[1])) reviews.set(m[1], []);
    reviews.get(m[1]).push(Number(m[2]));
  }
  for (const list of reviews.values()) list.sort((a, b) => a - b);
  const pdir = path.join(wip, 'packets');
  return {
    files,
    reviews,
    packets: new Set(fs.existsSync(pdir) ? fs.readdirSync(pdir) : []),
    has: (name, suffix) => files.has(`${name}${suffix}`),
  };
};

// ---- compare ------------------------------------------------------------------

const FAILED_WORDS = {
  a: 'types', b: 'building', c: 'non-GLA', d: 'distance',
};

/** A compare record as the table shows it: `{agree, failed: [words], minIou, maxDistance}`. */
export const compareView = (record) => {
  const failed = [...new Set((Array.isArray(record?.criteria) ? record.criteria : []).filter((c) => !c.ok).map((c) => c.id))].sort();
  // The scored types: unfinished space is in no criterion, so its IoU (a chimney
  // one key drew and the other did not is 0%) is not the figure to glance at.
  const ious = Object.entries(record?.iou?.byType ?? {}).filter(([type]) => type !== 'unfinished').map(([, v]) => v?.iou).filter(Number.isFinite);
  const agree = record?.agree === true;
  return {
    agree,
    failed: agree ? [] : (failed.length ? failed.map((id) => FAILED_WORDS[id] ?? id) : ['?']),
    minIou: ious.length ? Math.min(...ious) : null,
    maxDistance: Number.isFinite(record?.boundary?.max) ? record.boundary.max : null,
  };
};

const round = (x, digits) => (Number.isFinite(x) ? Number(x.toFixed(digits)) : undefined);

/** The figures of a comparison the manifest keeps as the key's agreement record. */
export const agreementOf = (record) => {
  const byType = {};
  for (const [type, v] of Object.entries(record?.iou?.byType ?? {})) byType[type] = round(v?.iou, 4);
  return {
    agree: record?.agree === true,
    iou: {
      building: round(record?.iou?.building?.iou, 4),
      nonGla: round(record?.iou?.nonGla?.iou, 4),
      unfinished: round(record?.iou?.unfinished?.iou, 4),
      byType,
    },
    boundary: { max: round(record?.boundary?.max, 2), p95: round(record?.boundary?.p95, 2) },
    types: record?.counts?.a ?? null,
    comparedAt: record?.at ?? null,
    // Small unfinished outlines the comparison set aside (they are in no criterion):
    // a reviewer may want to know that the keys differed on one.
    ...(record?.informational?.length ? { unfinishedSetAside: record.informational.length } : {}),
  };
};

export const readCompare = (dir, name) => {
  const file = wipFile(name, '.compare.json', dir);
  if (!fs.existsSync(file)) return null;
  return readJson(file);
};

/** Whether NAME.compare.json is newer than both snapped keys it compared. */
export const compareIsFresh = (dir, name) => {
  const c = statOf(wipFile(name, '.compare.json', dir));
  if (!c) return false;
  return ['.a.snapped.json', '.b.snapped.json'].every((suffix) => {
    const s = statOf(wipFile(name, suffix, dir));
    return !s || s.mtimeMs <= c.mtimeMs;
  });
};

// ---- check --------------------------------------------------------------------

// Everything a check reads: the final key and its spec, the plan (labels, scale,
// image) and the blind packet's labels. Null when there is no final key.
export const checkFingerprint = (dir, name) => {
  const key = sha256Of(wipFile(name, '.final.snapped.json', dir));
  if (!key) return null;
  const stamp = (file) => {
    const s = statOf(file);
    return s ? `${s.size}:${s.mtimeMs}` : null;
  };
  return sha256(JSON.stringify([
    key,
    sha256Of(wipFile(name, '.final.json', dir)),
    stamp(planFile(name, dir)),
    stamp(path.join(packetDir(name, dir), 'labels.json')),
  ]));
};

const firstFailure = (items) => {
  const f = items.find((i) => i.status === 'fail');
  return f ? `${f.check} ${f.subject}: ${f.detail}`.slice(0, 160) : null;
};

/**
 * The check of a plan's final key: `{pass, failures, warnings, waived, firstFail,
 * cached}`, null when there is no final key. `fresh` ignores the cache; `run:
 * false` never runs a check (`{unknown: true}` when none is cached, `stale: true`
 * when the cached one is of another key).
 */
export const checkFinal = async (name, ctx, { fresh = false, run = true } = {}) => {
  const fingerprint = checkFingerprint(ctx.dir, name);
  if (!fingerprint) return null;
  const file = wipFile(name, '.check.json', ctx.dir);
  let cached = null;
  try {
    cached = fs.existsSync(file) ? readJson(file) : null;
  } catch {
    cached = null; // A torn cache is only a miss.
  }
  if (!fresh && cached?.fingerprint === fingerprint) return { ...cached, cached: true };
  if (!run) return cached ? { ...cached, stale: true, cached: true } : { unknown: true };
  const result = await runCheck(name, 'final', ctx);
  const record = {
    fingerprint,
    pass: result.failures === 0,
    failures: result.failures,
    warnings: result.warnings,
    waived: result.waived,
    firstFail: firstFailure(result.items),
    at: new Date().toISOString(),
  };
  await writeJson(file, record);
  return { ...record, cached: false };
};

// ---- reviews ------------------------------------------------------------------

/**
 * The reviews of a plan's final key: `{state, rounds, rejections, latest, by,
 * current}`. `approved` and `rejected(n)` are of the key as it stands now; a
 * review of another key, or of a spec whose notes have changed, is `approved-STALE`
 * (it approved something else) or `revised` (a rejection since answered by a new key).
 */
export const reviewView = (dir, name, index) => {
  const numbers = index.reviews.get(name) ?? [];
  if (!numbers.length) return { state: 'none', rounds: 0, rejections: 0 };
  const records = numbers.map((n) => {
    try {
      return readJson(wipFile(name, `.review-${n}.json`, dir));
    } catch {
      return null;
    }
  });
  const rejections = records.filter((r) => r?.decision === 'reject').length;
  const latest = records.at(-1);
  if (!latest) return { state: 'unreadable', rounds: numbers.length, rejections };
  const current = latest.keySha256 === sha256Of(wipFile(name, '.final.snapped.json', dir))
    && latest.specSha256 === sha256Of(wipFile(name, '.final.json', dir));
  const approved = latest.decision === 'approve';
  let state;
  if (approved) state = current ? 'approved' : 'approved-STALE';
  else state = current ? 'rejected' : 'revised';
  return {
    state, rounds: numbers.length, rejections, latest: numbers.at(-1), by: latest.agent ?? null, current, reason: latest.reason ?? null,
  };
};

// ---- the plan -----------------------------------------------------------------

/** What the pipeline reads out of a plan file, once. */
export const planFacts = (dir, name) => {
  const project = readJson(planFile(name, dir));
  const state = project?.floors?.[0]?.state;
  const key = keyOf(state);
  return {
    project,
    state,
    key,
    keySha: keySha256(key),
    answerKey: project?.answerKey ?? null,
    dims: Array.isArray(state?.detectedDimensions) ? state.detectedDimensions.length : 0,
    source: project?.source ?? null,
  };
};

/**
 * The annotators and adjudicator a frozen plan's record names: `apply` writes
 * `by` as `annotators: a, b; adjudicator: x|none`. Null for any other text (a
 * draft's "Claude (draft for review)").
 */
export const parseBy = (by) => {
  const m = /^annotators:\s*(.*?);\s*adjudicator:\s*(.*)$/.exec(String(by ?? ''));
  if (!m) return null;
  const adjudicator = m[2].trim();
  return {
    annotators: m[1].split(',').map((s) => s.trim()).filter(Boolean),
    adjudicator: adjudicator === 'none' || !adjudicator ? null : adjudicator,
  };
};

/** Whether the plan's stored key is a draft nobody has checked: `by` starts with "Claude", no `checked`. */
export const isUncheckedDraft = (facts) => Boolean(facts.key)
  && typeof facts.answerKey?.by === 'string'
  && facts.answerKey.by.startsWith('Claude')
  && !facts.answerKey.checked;

/** `ok` when the packet's image is the plan's, `STALE` when it is another (the plan was drafted again), else `none`. */
export const packetState = (dir, name, index, project) => {
  if (!index.packets.has(name)) return 'none';
  const pdir = packetDir(name, dir);
  if (!fs.existsSync(path.join(pdir, 'meta.json'))) return 'none';
  const image = fs.readdirSync(pdir).find((f) => /^image\.[a-z0-9]+$/i.test(f));
  if (!image) return 'none';
  try {
    return planImageBytes(project).bytes.equals(fs.readFileSync(path.join(pdir, image))) ? 'ok' : 'STALE';
  } catch {
    return 'STALE';
  }
};

const roleView = (dir, name, index, role) => {
  const spec = index.has(name, `.${role}.json`);
  const snapped = index.has(name, `.${role}.snapped.json`);
  if (!spec && !snapped) return { state: 'none', author: null };
  let author = null;
  let existing = false;
  if (spec) {
    try {
      const json = readJson(wipFile(name, `.${role}.json`, dir));
      author = typeof json.author === 'string' ? json.author : null;
      existing = json.existingDraft === true;
    } catch {
      // A spec that will not parse is `snap`'s to report.
    }
  }
  return { state: snapped ? (existing ? 'existing' : 'ok') : 'unsnapped', author };
};

/**
 * One plan's row of `status`: `{name, book, split, packet, a, b, compare, final,
 * check, review, frozen}`. `check` is `'cached'` (default: run a check only when
 * none is cached for this key), `'fresh'` or `'skip'`.
 */
export const statusOf = async (name, { ctx, catalog, index, check = 'cached' }) => {
  const { dir } = ctx;
  const facts = planFacts(dir, name);
  const info = catalog.infoOf(name);
  const compare = (() => {
    if (!index.has(name, '.compare.json')) return { state: 'none', failed: [] };
    try {
      const view = compareView(readCompare(dir, name));
      if (!compareIsFresh(dir, name)) return { ...view, state: 'stale' };
      return { ...view, state: view.agree ? 'agree' : 'disagree' };
    } catch (error) {
      return { state: 'unreadable', failed: [], error: error.message };
    }
  })();
  const final = index.has(name, '.final.snapped.json');
  let checked = { state: 'none' };
  if (final) {
    try {
      const c = await checkFinal(name, ctx, { fresh: check === 'fresh', run: check !== 'skip' });
      if (c?.unknown) checked = { state: 'unknown' };
      else checked = { state: c.pass ? 'PASS' : 'FAIL', stale: Boolean(c.stale), failures: c.failures, warnings: c.warnings, firstFail: c.firstFail };
    } catch (error) {
      checked = { state: 'ERROR', error: error.message };
    }
  }
  return {
    name,
    book: info.book,
    split: info.split,
    era: info.era,
    packet: packetState(dir, name, index, facts.project),
    a: roleView(dir, name, index, 'a'),
    b: roleView(dir, name, index, 'b'),
    compare,
    final,
    check: checked,
    review: final ? reviewView(dir, name, index) : { state: 'none', rounds: index.reviews.get(name)?.length ?? 0, rejections: 0 },
    frozen: facts.answerKey?.checked ? 'yes' : (facts.key ? 'draft' : 'no'),
    checkedAt: facts.answerKey?.checked?.at ?? null,
  };
};
