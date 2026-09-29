// Building, versioning and verifying the manifest (`realManifest build`,
// `amend`, `verify`, `hash`). The schema and its reader are lib/manifest.mjs
// (version 1); what is added here is optional fields, so `bench:real` reads the
// files this writes exactly as it read the ones written by hand:
//
//   book        the cap unit (see pipelineCatalog.mjs), the unit a split is assigned by
//   site        the site an aggregator's plans came from, when the log says
//   year        the year the page is from
//   source      {url, crop, size} (or {file, ...} for a plan drafted from a file); the
//               75 plans that predate the sourcing log are {embedded: true}: their
//               image lives in the plan and there is nothing to fetch
//   annotation  {annotators, adjudicator, adjudicated, agreement, verifiedBy, checked
//               [, disputeId]}: the plan's own record, plus the agreement figures
//               `finalize-*` and `adjudicated` kept in keys-wip/NAME.record.json
//
// The file is a pure function of the plans, splits.json and the log: nothing in
// it says when it was built (the log does), keys are sorted and the layout is
// fixed, so the same inputs are the same bytes and the same hash. Only plans
// whose record is `checked` enter: the manifest is the list of keys somebody
// verified, and `bench:real` scores nothing else.
import fs from 'fs';
import path from 'path';
import {
  ERAS, MANIFEST_VERSION, SPLITS, keyCheck, loadManifest, manifestFileFor, sha256,
} from './manifest.mjs';
import { BOOK_CAP, SITE_CAP } from './sourceLog.mjs';
import {
  checkName, readJson, wipFile, writeFileAtomic,
} from './keyFiles.mjs';
import {
  listPlans, loadCatalog, manifestLogFor, manifestVersionsFor, splitsFileFor,
} from './pipelineCatalog.mjs';
import { parseBy, planFacts } from './pipelineStages.mjs';
import { stableStringify } from './stableJson.mjs';
import { plural } from './pipelineTable.mjs';

// The set before the sourcing log existed: 75 plans from 17 books, images embedded.
export const ORIGINAL_SET = 75;
export const FINAL_PLANS = 400;
export const MIN_BOOKS = 34;
export const MIN_LABELLED_SHARE = 0.9;

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const recordOf = (dir, name) => {
  const file = wipFile(name, '.record.json', dir);
  if (!fs.existsSync(file)) return null;
  try {
    return readJson(file);
  } catch {
    return null;
  }
};

// Where a plan's image came from, as the manifest records it.
const sourceOf = (planSource, logged, warnings) => {
  if (planSource && (planSource.url || planSource.file)) {
    if (logged?.url && planSource.url && logged.url !== planSource.url) {
      warnings.push(`the plan's own source (${planSource.url}) is not the URL the log has (${logged.url}): the plan's is recorded`);
    }
    return clean({
      url: planSource.url, file: planSource.file, crop: planSource.crop, size: planSource.size,
    });
  }
  if (logged?.url) return clean({ url: logged.url, crop: logged.crop, size: logged.size });
  return { embedded: true };
};

/**
 * One plan's manifest entry, or `{problems}` saying why it cannot have one.
 * `info` is what the catalog knows of the plan (its book, era, split...);
 * `prior` (amend) is the entry the manifest already has, whose book, era and
 * split are kept: a dispute changes a key, never where a plan sits.
 * Returns `{entry, problems, warnings}`.
 */
export const entryFor = ({
  facts, info, logged, record, prior = null,
}) => {
  const problems = [];
  const warnings = [];
  const { answerKey } = facts;
  if (!facts.key) problems.push('the plan holds no key (only the app\'s own trace)');
  const base = prior
    ? {
      book: prior.book, site: prior.site, publisher: prior.publisher, era: prior.era, decade: prior.decade, year: prior.year, split: prior.split,
    }
    : {
      book: info.book, site: info.site, publisher: info.publisher, era: info.era, decade: info.decade, year: info.year, split: info.split,
    };
  if (!SPLITS.includes(base.split)) problems.push(`its book ${base.book} is not in splits.json`);
  if (!ERAS.includes(base.era)) {
    // A plan with a source of its own is not one of the original 75, whatever its
    // name looks like: the log has to say what it is.
    problems.push(facts.source && !logged
      ? 'its era is unknown: the plan has a source of its own but sources.jsonl has no line for it (realSource log plan writes one)'
      : 'its era is unknown (it is not in sources.jsonl and not named like a plan-book page of the original set)');
  }
  if (!Number.isInteger(base.decade)) problems.push('its decade is unknown');

  const by = parseBy(answerKey?.by);
  const annotators = by?.annotators?.length ? by.annotators : record?.annotators;
  if (!Array.isArray(annotators) || !annotators.length) problems.push(`its record names no annotators (by ${JSON.stringify(answerKey?.by ?? null)}, and no usable record file)`);
  const adjudicator = by ? by.adjudicator : (record?.adjudicator ?? null);
  if (by && record && (!same(record.annotators, by.annotators) || (record.adjudicator ?? null) !== by.adjudicator)) {
    warnings.push(`keys-wip record names ${JSON.stringify(record.annotators)} / adjudicator ${JSON.stringify(record.adjudicator ?? null)}, the plan's own record ${JSON.stringify(by.annotators)} / ${JSON.stringify(by.adjudicator)}: the plan's is recorded`);
  }
  const verifiedBy = answerKey?.verifiedBy ?? record?.verifiedBy;
  if (!verifiedBy) problems.push('its record does not say how it was verified (verifiedBy)');
  if (problems.length) return { problems, warnings };
  return {
    problems,
    warnings,
    entry: {
      book: base.book,
      ...(base.site ? { site: base.site } : {}),
      publisher: base.publisher ?? null,
      era: base.era,
      decade: base.decade,
      ...(base.year != null ? { year: base.year } : {}),
      split: base.split,
      source: sourceOf(facts.source, logged, warnings),
      keySha256: facts.keySha,
      annotation: {
        annotators,
        adjudicator: adjudicator ?? null,
        adjudicated: adjudicator != null,
        agreement: record?.agreement ?? null,
        verifiedBy,
        checked: answerKey.checked,
        ...(answerKey.disputeId ? { disputeId: answerKey.disputeId } : {}),
      },
    },
  };
};

/** The manifest object, its bytes and its hash, for a `plans` map and the split file it came from. */
export const manifestOf = (plans, splits) => {
  const manifest = {
    version: MANIFEST_VERSION,
    seed: splits?.seed ?? null,
    createdAt: splits?.createdAt ?? null,
    plans,
  };
  const text = stableStringify(manifest);
  return { manifest, text, hash: sha256(Buffer.from(text)) };
};

export const countsOf = (manifest) => {
  const entries = Object.values(manifest.plans);
  const n = (fn) => entries.filter(fn).length;
  return {
    plans: entries.length,
    dev: n((e) => e.split === 'dev'),
    test: n((e) => e.split === 'test'),
    vintage: n((e) => e.era === 'vintage'),
    modern: n((e) => e.era === '2020-2022'),
  };
};

export const countsText = (c) => `${plural(c.plans, 'plan')}: dev ${c.dev} / test ${c.test}; vintage ${c.vintage} / 2020-2022 ${c.modern}`;

/**
 * The manifest of the set folder: every plan whose record is `checked`.
 * `{manifest, text, hash, unchecked, problems: [{name, text}], warnings}`.
 * A plan that is not `checked` is listed in `unchecked` and left out; one that
 * is checked but cannot have an entry is a problem.
 */
export const buildManifest = (dir) => {
  const catalog = loadCatalog(dir, { manifest: false });
  if (catalog.errors.splits) throw catalog.errors.splits;
  if (!catalog.splits) throw new Error(`there is no ${path.relative(dir, splitsFileFor(dir))}: run realManifest assign-splits --write first (a plan's split comes from it)`);
  const plans = {};
  const unchecked = [];
  const problems = [];
  const warnings = [];
  for (const name of listPlans(dir)) {
    const facts = planFacts(dir, name);
    if (!facts.answerKey?.checked) {
      unchecked.push(name);
      continue;
    }
    const result = entryFor({
      facts, info: catalog.infoOf(name), logged: catalog.logged.get(name), record: recordOf(dir, name),
    });
    for (const text of result.problems) problems.push({ name, text });
    for (const text of result.warnings) warnings.push(`${name}: ${text}`);
    if (result.entry) plans[name] = result.entry;
  }
  for (const c of catalog.unitClashes()) {
    warnings.push(`the designer code ${c.unit} is used by ${c.sites.join(' and ')}: one book here, in one split and under one cap of ${BOOK_CAP}; give one a distinct --unit`);
  }
  return {
    ...manifestOf(plans, catalog.splits), unchecked, problems, warnings,
  };
};

// ---- the log and the archive ----------------------------------------------------

const LOG_HEADER = [
  '# Manifest log',
  '',
  'One row per manifest version, appended by `node scripts/realManifest.mjs build` and `amend`. The hash is the SHA-256 of `manifest.json` as built; `manifest-versions/manifest-<first 12 digits>.json` keeps that version.',
  '',
  '| version | hash | date | reason | counts |',
  '|---|---|---|---|---|',
].join('\n');

const cell = (text) => String(text ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export const readLogText = (dir) => {
  const file = manifestLogFor(dir);
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
};

/** The log's rows in the order written: `[{version, hash}]`. */
export const logRows = (dir) => [...readLogText(dir).matchAll(/^\|\s*(\d+)\s*\|\s*([0-9a-f]{64})\s*\|/gm)]
  .map((m) => ({ version: Number(m[1]), hash: m[2] }));

/** The version numbers the log holds, ascending. */
export const logVersions = (dir) => logRows(dir).map((r) => r.version).sort((a, b) => a - b);

/**
 * Puts `text` in place as manifest.json, keeps a copy under manifest-versions/,
 * and appends a row to the log. Returns `{changed, logged, hash, version}`:
 * `changed` when manifest.json was written, `logged` when a row was appended.
 *
 * The three writes go in the order that leaves a state a second run finishes:
 * the archive (nothing refers to it yet), then the log row (a version that is
 * not in use yet), and the manifest itself last. A run cut short between any two
 * of them is completed by the next one, and never leaves a manifest in use that
 * the log does not name: a row is appended only when the log's last row is not
 * this hash, and the file written only when it is not already this text.
 */
export const commitManifest = async (dir, { text, hash, manifest }, { reason, now = new Date() }) => {
  const file = manifestFileFor(dir);
  const archive = path.join(manifestVersionsFor(dir), `manifest-${hash.slice(0, 12)}.json`);
  const rows = logRows(dir);
  const last = rows.at(-1) ?? null;
  const inUse = fs.existsSync(file) && sha256(fs.readFileSync(file)) === hash;
  const named = last?.hash === hash;
  if (!fs.existsSync(archive) || sha256(fs.readFileSync(archive)) !== hash) await writeFileAtomic(archive, text);
  let version = last?.version ?? null;
  if (!named) {
    version = Math.max(0, ...rows.map((r) => r.version)) + 1;
    const why = inUse ? `${reason}; logged late, the manifest already was this` : reason;
    const prior = readLogText(dir) || LOG_HEADER;
    const row = `| ${version} | ${hash} | ${now.toISOString()} | ${cell(why)} | ${cell(countsText(countsOf(manifest)))} |`;
    await writeFileAtomic(manifestLogFor(dir), `${prior.replace(/\n*$/, '\n')}${row}\n`);
  }
  if (!inUse) await writeFileAtomic(file, text);
  return {
    changed: !inUse, logged: !named, hash, version,
  };
};

/**
 * The manifest with one plan's entry rebuilt, for a key a dispute changed
 * (`apply --dispute ID` marks the plan's record with the dispute's id). The
 * plan's book, era and split stay as the manifest has them; every other entry
 * stays exactly as it is, so one amendment is one plan's difference.
 */
export const amendedManifest = (dir, name) => {
  checkName(name);
  const loaded = loadManifest(manifestFileFor(dir), { required: true });
  const prior = loaded.manifest.plans?.[name];
  if (!prior || !Object.hasOwn(loaded.manifest.plans, name)) throw new Error(`${name} is not in the manifest: amend changes a plan the manifest holds`);
  const facts = planFacts(dir, name);
  const disputeId = facts.answerKey?.disputeId;
  if (!disputeId) throw new Error(`${name}'s record has no disputeId: a key is amended only by a dispute (realKeyTool apply ${name} --dispute ID writes the mark)`);
  if (!facts.answerKey?.checked) throw new Error(`${name}'s record is not checked`);
  const catalog = loadCatalog(dir, { manifest: false });
  const result = entryFor({
    facts, info: catalog.infoOf(name), logged: catalog.logged.get(name), record: recordOf(dir, name), prior,
  });
  if (result.problems.length) throw new Error(`${name}: ${result.problems.join('; ')}`);
  const plans = { ...loaded.manifest.plans, [name]: result.entry };
  return {
    ...manifestOf(plans, { seed: loaded.manifest.seed, createdAt: loaded.manifest.createdAt }),
    disputeId,
    warnings: result.warnings,
    before: prior.keySha256,
    after: result.entry.keySha256,
  };
};

// ---- verify ---------------------------------------------------------------------

const STREET_WORDS = new Set([
  'st', 'str', 'street', 'ave', 'av', 'avenue', 'rd', 'road', 'dr', 'drive', 'ln', 'lane', 'blvd', 'boulevard', 'ct', 'court',
  'way', 'pl', 'place', 'cir', 'circle', 'ter', 'terrace', 'trl', 'trail', 'pkwy', 'parkway', 'hwy', 'highway',
]);

/**
 * Whether a plan name looks like it holds an address: a run of three or more
 * digits followed (within the next three words, or fused to it) by a street
 * word: `1234-oak-street`, `12345-main-st`. A plan's name is public in the
 * manifest, and no plan is named for where it stands.
 */
export const looksLikeAddress = (name) => {
  const words = String(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((word, i) => {
    if (/^\d{3,}$/.test(word)) return words.slice(i + 1, i + 4).some((w) => STREET_WORDS.has(w));
    const fused = /^\d{3,}([a-z]+)$/.exec(word);
    return Boolean(fused) && [...STREET_WORDS].some((s) => fused[1] === s || (fused[1].length >= s.length + 2 && fused[1].endsWith(s)));
  });
};

const some = (list, n = 5) => `${list.slice(0, n).join(', ')}${list.length > n ? ` and ${list.length - n} more` : ''}`;

/**
 * Checks the manifest against the set folder. Returns `{rules: [{status, id,
 * text}], pass}`; `status` is PASS, FAIL or INFO. `final` adds the dataset
 * rules of the finished set; `allowPartial` makes plans not in the manifest
 * (yet) information and not a failure.
 */
export const verifyManifest = (dir, { final = false, allowPartial = false } = {}) => {
  const rules = [];
  const add = (status, id, text) => rules.push({ status, id, text });
  const finish = () => ({ rules, pass: !rules.some((r) => r.status === 'FAIL') });
  let loaded;
  try {
    loaded = loadManifest(manifestFileFor(dir), { required: true });
  } catch (error) {
    add('FAIL', 'manifest', error.message);
    return finish();
  }
  const { manifest, hash } = loaded;
  const names = Object.keys(manifest.plans).sort();
  // The schema version is the file's own; the version of the manifest is the log's.
  const rows = logRows(dir);
  const logVersion = rows.length ? Math.max(...rows.map((r) => r.version)) : null;
  add('PASS', 'manifest', `${plural(names.length, 'plan')}, hash ${hash.slice(0, 12)}, schema ${manifest.version}, ${logVersion === null ? 'no log' : `log version ${logVersion}`}`);
  if (!rows.length) add('INFO', 'log', `${path.relative(dir, manifestLogFor(dir))} has no rows: this manifest was not written by realManifest build or amend`);
  else if (rows.at(-1).hash !== hash) add('FAIL', 'log', `the manifest in use (${hash.slice(0, 12)}) is not the one the log names last (version ${rows.at(-1).version}, ${rows.at(-1).hash.slice(0, 12)}): run realManifest build to log it`);
  else add('PASS', 'log', `the log's last row (version ${rows.at(-1).version}) is this manifest`);

  const files = new Set(listPlans(dir));
  const missing = names.filter((n) => !files.has(n));
  add(missing.length ? 'FAIL' : 'PASS', 'plans', missing.length ? `${missing.length} manifest plans have no plan file: ${some(missing)}` : 'every plan in the manifest has its plan file');

  const changed = [];
  const unchecked = [];
  const facts = new Map();
  for (const name of names.filter((n) => files.has(n))) {
    const f = planFacts(dir, name);
    const entry = manifest.plans[name];
    facts.set(name, { dims: f.dims });
    if (!entry.keySha256) changed.push(`${name} (the manifest has no keySha256)`);
    else {
      const why = keyCheck(entry.keySha256, f.key);
      if (why) changed.push(`${name} (${why})`);
    }
    if (!f.answerKey?.checked || !entry.annotation?.checked) unchecked.push(name);
  }
  add(changed.length ? 'FAIL' : 'PASS', 'keys', changed.length ? `${changed.length} keys differ from the manifest's fingerprint: ${some(changed)}` : 'every key hashes to its keySha256');
  add(unchecked.length ? 'FAIL' : 'PASS', 'checked', unchecked.length ? `${unchecked.length} records are not checked (plan or manifest): ${some(unchecked)}` : 'every record is checked');
  const strays = [...files].filter((n) => !Object.hasOwn(manifest.plans, n)).sort();
  if (strays.length) add(allowPartial ? 'INFO' : 'FAIL', 'strays', `${strays.length} plan files are not in the manifest: ${some(strays, 8)}`);
  else add('PASS', 'strays', 'every plan file is in the manifest');

  const catalog = loadCatalog(dir, { manifest: false });
  const { splits } = catalog;
  // loadCatalog keeps a splits file it cannot read as an error, not a throw: said here, never silent.
  if (catalog.errors.splits) add('FAIL', 'splits', catalog.errors.splits.message);
  else if (splits) {
    const drift = names.filter((n) => splits.books?.[manifest.plans[n].book]?.split !== manifest.plans[n].split);
    add(drift.length ? 'FAIL' : 'PASS', 'splits', drift.length ? `${drift.length} plans sit in another split than splits.json gives their book: ${some(drift)}` : 'every plan sits in the split splits.json gives its book');
  } else if (!fs.existsSync(splitsFileFor(dir))) add('INFO', 'splits', 'no splits.json to compare the manifest with');

  const splitsOfBook = new Map();
  for (const n of names) {
    const { book, split } = manifest.plans[n];
    if (!splitsOfBook.has(book)) splitsOfBook.set(book, new Set());
    splitsOfBook.get(book).add(split);
  }
  const spanning = [...splitsOfBook].filter(([, s]) => s.size > 1).map(([b]) => b);
  add(spanning.length ? 'FAIL' : 'PASS', 'no book spans splits', spanning.length ? `books in both splits: ${some(spanning)}` : 'every book is whole in one split');

  if (final) {
    const entries = names.map((n) => manifest.plans[n]);
    add(names.length === FINAL_PLANS ? 'PASS' : 'FAIL', 'count', `${plural(names.length, 'plan')} (the finished set has exactly ${FINAL_PLANS})`);
    const perBook = new Map();
    const perSite = new Map();
    for (const e of entries) {
      perBook.set(e.book, (perBook.get(e.book) ?? 0) + 1);
      if (e.site) perSite.set(e.site, (perSite.get(e.site) ?? 0) + 1);
    }
    const overBook = [...perBook].filter(([, n]) => n > BOOK_CAP).map(([b, n]) => `${b} (${n})`);
    add(overBook.length ? 'FAIL' : 'PASS', 'cap per book', overBook.length ? `over ${BOOK_CAP} plans: ${some(overBook)}` : `no book or site unit has more than ${BOOK_CAP} plans (the most: ${Math.max(0, ...perBook.values())})`);
    const overSite = [...perSite].filter(([, n]) => n > SITE_CAP).map(([s, n]) => `${s} (${n})`);
    if (perSite.size) add(overSite.length ? 'FAIL' : 'PASS', 'cap per site', overSite.length ? `over ${SITE_CAP} plans: ${some(overSite)}` : `no site has more than ${SITE_CAP} plans (the most: ${Math.max(...perSite.values())})`);
    add(perBook.size >= MIN_BOOKS ? 'PASS' : 'FAIL', 'books', `${perBook.size} books or site units (at least ${MIN_BOOKS}); ${new Set(entries.map((e) => e.site ?? e.book)).size} distinct sites or books, ${new Set(entries.map((e) => e.publisher).filter(Boolean)).size} named publishers`);
    const by = (split) => entries.filter((e) => e.split === split).length;
    add('INFO', 'split sizes', `test ${by('test')} / dev ${by('dev')} (aimed at about 150 / 250)`);
    const lacking = SPLITS.flatMap((split) => ERAS.filter((era) => !entries.some((e) => e.split === split && e.era === era)).map((era) => `${split} has no ${era} plan`));
    add(lacking.length ? 'FAIL' : 'PASS', 'eras in both splits', lacking.length ? lacking.join('; ') : 'both splits hold both eras');
    const labelled = names.filter((n) => (facts.get(n)?.dims ?? 0) >= 1).length;
    const share = names.length ? labelled / names.length : 0;
    add(share >= MIN_LABELLED_SHARE ? 'PASS' : 'FAIL', 'room-size labels', `${labelled} of ${names.length} plans (${(share * 100).toFixed(1)}%) have at least one detected room size (at least ${MIN_LABELLED_SHARE * 100}%)`);
    const addresses = names.filter(looksLikeAddress);
    add(addresses.length ? 'FAIL' : 'PASS', 'no addresses in names', addresses.length ? `names that look like an address: ${some(addresses)}` : 'no plan name looks like an address');
    const unsourced = entries.map((e, i) => [names[i], e]).filter(([, e]) => !e.source || !(e.source.url || e.source.file || e.source.embedded === true)).map(([n]) => n);
    const embedded = entries.filter((e) => e.source?.embedded === true).length;
    const sourceProblems = [];
    if (unsourced.length) sourceProblems.push(`${unsourced.length} plans have no source: ${some(unsourced)}`);
    if (embedded > ORIGINAL_SET) sourceProblems.push(`${embedded} plans have an embedded image and no source, but only the original ${ORIGINAL_SET} may`);
    add(sourceProblems.length ? 'FAIL' : 'PASS', 'sources', sourceProblems.length ? sourceProblems.join('; ') : `every new plan has a source (${embedded} embedded from the original set)`);
    // Every plan that is not one of the original 75 has its line in the sourcing
    // log: its era, decade and book are read from it, and a plan the log has not
    // caught up with would be taken for a vintage plan by its name.
    const unlogged = names.filter((n) => manifest.plans[n].source?.embedded !== true && !catalog.logged.has(n));
    add(unlogged.length ? 'FAIL' : 'PASS', 'sources logged', unlogged.length ? `${unlogged.length} plans have a source but no line in sources.jsonl: ${some(unlogged)}` : 'every plan with a source has its line in sources.jsonl');
    const modern = entries.filter((e) => e.era === '2020-2022').length;
    add('INFO', '2020-2022', `${modern} plans of the ${names.length - embedded} new ones (the aim is about 160 of 325)`);
  }
  return finish();
};
