// Which books go to `dev` and which to `test` (`realManifest assign-splits`).
//
// Whole books, publishers and builders (the sourcing log's cap UNITS) go to one
// split, so `test` measures drawing styles the tracer was never tuned on. The
// procedure is fixed and seeded, so the same roster and seed always give the
// same assignment, and stratified, so that both splits hold both eras and every
// decade a stratum has more than one book for:
//
//  1. Books named in `pinDev` (the 17 that were analysed before there was a
//     test split: they cannot be blind data) are dev, and their plans count
//     toward dev.
//  2. The strata are era x decade, in a fixed order. Each stratum's other books
//     are shuffled by a stream seeded from the run's seed and the stratum's own
//     name (never from the whole roster), after being sorted by name, so the
//     order within a stratum depends on its own books alone.
//  3. Going through a stratum in that order, a book goes to test when that brings
//     the running count of test plans closer to the running target: the share
//     `targetTest / total` of all the plans seen so far, this stratum's included.
//     Books are whole, so a stratum ends up to about one book off its share, and
//     the running target carries what a stratum could not give to the next one:
//     the total lands within about half a book of `targetTest`.
import crypto from 'crypto';
import { ERAS } from './manifest.mjs';
import { byName, mulberry32, seedOf, shuffled } from './prng.mjs';
import { listPlans } from './pipelineCatalog.mjs';
import { stableStringify } from './stableJson.mjs';
import { table } from './pipelineTable.mjs';

export const DEFAULT_TARGET_TEST = 150;
export const DEFAULT_TOTAL = 400;

const isInt = (n) => Number.isInteger(n);

/**
 * The roster `[{book, era, decade, plans, publisher?, site?}]`, checked: an
 * Error lists every problem. Returns the rows sorted by book.
 */
export const validateRoster = (rows) => {
  if (!Array.isArray(rows) || !rows.length) throw new Error('the roster must be a non-empty array of {book, era, decade, plans, publisher}');
  const problems = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const at = `roster[${i}]${r?.book ? ` (${r.book})` : ''}`;
    if (typeof r?.book !== 'string' || !r.book.trim()) problems.push(`${at}: book must be a non-empty string`);
    else if (seen.has(r.book)) problems.push(`${at}: book ${r.book} appears twice (one row per book)`);
    else seen.add(r.book);
    if (!ERAS.includes(r?.era)) problems.push(`${at}: era must be ${ERAS.join(' or ')} (got ${JSON.stringify(r?.era)})`);
    if (!isInt(r?.decade) || r.decade % 10 !== 0) problems.push(`${at}: decade must be a whole decade such as 1960 (got ${JSON.stringify(r?.decade)})`);
    if (!isInt(r?.plans) || r.plans < 1) problems.push(`${at}: plans must be a whole number of at least 1 (got ${JSON.stringify(r?.plans)})`);
    if (r?.publisher != null && typeof r.publisher !== 'string') problems.push(`${at}: publisher must be text or null`);
    if (r?.site != null && typeof r.site !== 'string') problems.push(`${at}: site must be text or null`);
  });
  if (problems.length) throw new Error(`the roster is not usable: ${problems.slice(0, 6).join('; ')}${problems.length > 6 ? `; and ${problems.length - 6} more` : ''}`);
  return rows.map((r) => ({
    book: r.book,
    era: r.era,
    decade: r.decade,
    plans: r.plans,
    publisher: r.publisher ?? null,
    ...(r.site ? { site: r.site } : {}),
  })).sort((a, b) => byName(a.book, b.book));
};

/**
 * The roster of the plans in the set folder: per book (cap unit), its era, the
 * decade most of its plans are from, its publisher and its plans. `{rows,
 * warnings}`; a book whose plans are of two eras is an Error (a unit is one era).
 */
export const rosterFromSet = (dir, catalog) => {
  const groups = new Map();
  const warnings = [];
  const present = new Set(listPlans(dir));
  for (const name of present) {
    const info = catalog.infoOf(name);
    if (!info.era || info.decade === null) {
      warnings.push(`${name}: no era or decade (it is neither in sources.jsonl nor named like a plan-book page): left out of the roster`);
      continue;
    }
    const g = groups.get(info.book) ?? groups.set(info.book, {
      book: info.book, plans: 0, eras: new Set(), decades: new Map(), publisher: null, site: null,
    }).get(info.book);
    g.plans += 1;
    g.eras.add(info.era);
    g.decades.set(info.decade, (g.decades.get(info.decade) ?? 0) + 1);
    g.publisher ??= info.publisher;
    g.site ??= info.site;
  }
  for (const name of catalog.logged.keys()) {
    if (!present.has(name)) warnings.push(`${name} is in sources.jsonl but has no plan file in the set folder: not counted`);
  }
  const rows = [...groups.values()].map((g) => {
    if (g.eras.size > 1) throw new Error(`book ${g.book} holds plans of two eras (${[...g.eras].join(', ')}): a book is one era`);
    const decade = [...g.decades].sort(([da, na], [db, nb]) => nb - na || da - db)[0][0];
    if (g.decades.size > 1) warnings.push(`book ${g.book} spans decades ${[...g.decades.keys()].sort().join(', ')}: counted in ${decade}, where most of its plans are`);
    return {
      book: g.book, era: [...g.eras][0], decade, plans: g.plans, publisher: g.publisher, site: g.site,
    };
  });
  return { rows: validateRoster(rows), warnings };
};

/**
 * The assignment: `{seed, params, books, strata, totals}`. `books[book]` is
 * `{split, era, decade, publisher, plans[, site][, pinned]}`; `strata` and
 * `totals` say how close each stratum and the whole came to its share.
 */
export const assignSplits = (roster, {
  seed, targetTest = DEFAULT_TARGET_TEST, total = DEFAULT_TOTAL, pinDev = [],
} = {}) => {
  if (!isInt(seed) || seed < 0) throw new Error('assign-splits needs a seed, a whole number: the split must be reproducible');
  if (!(targetTest >= 0) || !(total > 0)) throw new Error('--target-test and --total must be numbers (test plans wanted, and the size of the finished set)');
  const rows = validateRoster(roster);
  const pins = new Set(pinDev);
  const unknown = [...pins].filter((b) => !rows.some((r) => r.book === b));
  if (unknown.length) throw new Error(`--pin-dev names ${unknown.join(', ')}, which the roster does not hold (books: ${rows.map((r) => r.book).join(', ')})`);
  const share = Math.min(1, targetTest / total);

  const strataMap = new Map();
  for (const r of rows) {
    const key = `${r.era}|${r.decade}`;
    if (!strataMap.has(key)) strataMap.set(key, { era: r.era, decade: r.decade, rows: [] });
    strataMap.get(key).rows.push(r);
  }
  const strata = [...strataMap.values()].sort((a, b) => ERAS.indexOf(a.era) - ERAS.indexOf(b.era) || a.decade - b.decade);

  const books = {};
  const report = [];
  let seen = 0;
  let testSoFar = 0;
  for (const s of strata) {
    const plans = s.rows.reduce((n, r) => n + r.plans, 0);
    seen += plans;
    const runningTarget = share * seen;
    const free = s.rows.filter((r) => !pins.has(r.book));
    let testPlans = 0;
    const testBooks = new Set();
    for (const r of shuffled(free, mulberry32(seedOf(`${seed}|${s.era}|${s.decade}`)))) {
      // Closer to the running target with this book than without it.
      if (Math.abs(testSoFar + r.plans - runningTarget) < Math.abs(testSoFar - runningTarget)) {
        testBooks.add(r.book);
        testSoFar += r.plans;
        testPlans += r.plans;
      }
    }
    for (const r of s.rows) {
      books[r.book] = {
        split: testBooks.has(r.book) ? 'test' : 'dev',
        era: r.era,
        decade: r.decade,
        publisher: r.publisher,
        plans: r.plans,
        ...(r.site ? { site: r.site } : {}),
        ...(pins.has(r.book) ? { pinned: true } : {}),
      };
    }
    report.push({
      era: s.era,
      decade: s.decade,
      books: s.rows.length,
      plans,
      dev: plans - testPlans,
      test: testPlans,
      target: share * plans,
      deviation: testPlans - share * plans,
    });
  }
  const plansTotal = rows.reduce((n, r) => n + r.plans, 0);
  return {
    seed,
    params: {
      targetTest, total, share, pinDev: [...pins].sort(byName),
    },
    books,
    strata: report,
    totals: {
      books: rows.length,
      plans: plansTotal,
      test: testSoFar,
      dev: plansTotal - testSoFar,
      target: share * plansTotal,
      deviation: testSoFar - share * plansTotal,
    },
  };
};

/** SHA-256 of the roster as validated, so `splits.json` says what it was made from. */
export const rosterSha256 = (roster) => crypto.createHash('sha256').update(stableStringify(validateRoster(roster))).digest('hex');

/** The bytes of `splits.json` for an assignment made at `createdAt` from `roster`. */
export const splitsText = (result, { createdAt, roster }) => stableStringify({
  seed: result.seed,
  createdAt,
  params: { ...result.params, rosterSha256: rosterSha256(roster) },
  books: result.books,
});

const signed = (x) => `${x >= 0 ? '+' : ''}${x.toFixed(1)}`;

export const assignmentLines = (result) => {
  const lines = [];
  const t = result.totals;
  lines.push(`assign-splits seed ${result.seed}: ${t.books} books, ${t.plans} plans; test target ${result.params.targetTest} of ${result.params.total} (${(result.params.share * 100).toFixed(1)}%), pinned to dev: ${result.params.pinDev.length ? result.params.pinDev.join(', ') : 'none'}`);
  const stratumRows = [...result.strata.map((s) => ({ ...s, decade: `${s.decade}s` })), {
    era: 'total', decade: '', books: t.books, plans: t.plans, dev: t.dev, test: t.test, target: t.target, deviation: t.deviation,
  }];
  lines.push(...table(stratumRows, [
    { title: 'era', get: (r) => r.era },
    { title: 'decade', get: (r) => r.decade },
    { title: 'books', get: (r) => r.books, right: true },
    { title: 'plans', get: (r) => r.plans, right: true },
    { title: 'dev', get: (r) => r.dev, right: true },
    { title: 'test', get: (r) => r.test, right: true },
    { title: 'test target', get: (r) => r.target.toFixed(1), right: true },
    { title: 'deviation', get: (r) => signed(r.deviation), right: true },
  ]));
  lines.push('');
  const cells = ERAS.flatMap((era) => ['dev', 'test'].map((split) => {
    const inCell = Object.values(result.books).filter((b) => b.era === era && b.split === split);
    return { era, split, books: inCell.length, plans: inCell.reduce((n, b) => n + b.plans, 0) };
  }));
  lines.push(...table(cells, [
    { title: 'split', get: (r) => r.split },
    { title: 'era', get: (r) => r.era },
    { title: 'books', get: (r) => r.books, right: true },
    { title: 'plans', get: (r) => r.plans, right: true },
  ]));
  lines.push('');
  lines.push(...table(Object.entries(result.books).sort(([a], [b]) => byName(a, b)), [
    { title: 'book', get: ([book]) => book },
    { title: 'split', get: ([, b]) => b.split },
    { title: 'era', get: ([, b]) => b.era },
    { title: 'decade', get: ([, b]) => b.decade },
    { title: 'plans', get: ([, b]) => b.plans, right: true },
    { title: 'publisher', get: ([, b]) => `${b.publisher ?? '-'}${b.pinned ? ' (pinned dev)' : ''}` },
  ]));
  for (const era of ERAS) {
    for (const split of ['dev', 'test']) {
      if (!Object.values(result.books).some((b) => b.era === era && b.split === split)) lines.push(`WARNING: no ${era} plans in ${split}: both splits must hold both eras`);
    }
  }
  return lines;
};
