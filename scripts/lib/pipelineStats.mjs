// The four numbers every milestone report carries, computed from the files
// (`realPipeline stats`): how often two blind annotators agreed, how often the
// adjudicator had to write the key, how often the final review sent a key back,
// and how the disputes after the freeze went. They are the error bars on the
// score, so each is counted from what was recorded, never from what anyone
// remembers.
//
// Disputes live in `orchestration/disputes.md`, prose for people with one
// machine-readable line per dispute (and per change of its status: the latest
// line for an id wins, so a dispute filed `open` and later `decided` is written
// twice):
//
//   DISPUTE <id> plan=NAME status=decided outcome=changed direction=toward-tracer
//
//   status     open | decided
//   outcome    changed | kept          only when decided (absent while open)
//   direction  toward-tracer | away | neutral
//              for a key that changed: whether the change moved the key toward the
//              app's trace, away from it, or neither. Optional when the key was kept.
//
// The line may sit in a list item, a quote or backticks. A line that starts with
// DISPUTE and is not that is reported and counted as malformed, since a tally
// that skips lines it cannot read overstates whatever it can.
import fs from 'fs';
import { readJson, wipFile } from './keyFiles.mjs';
import { disputesFileFor, listPlans, loadCatalog } from './pipelineCatalog.mjs';
import { parseArgs, selectPlans, withSelect } from './pipelineSelect.mjs';
import {
  compareIsFresh, compareView, parseBy, planFacts, readCompare, wipIndex,
} from './pipelineStages.mjs';
import { pct, plural, table } from './pipelineTable.mjs';

export const DISPUTE_STATUS = ['open', 'decided'];
export const DISPUTE_OUTCOME = ['changed', 'kept'];
export const DISPUTE_DIRECTION = ['toward-tracer', 'away', 'neutral'];

// Bullets, quotes and backticks a person may wrap the line in.
const stripMarkup = (line) => line.trim().replace(/^(?:[-*+>]\s+)+/, '').replace(/^`+|`+$/g, '').trim();

/**
 * The disputes in `text`: `{disputes: [{id, plan, status, outcome, direction,
 * line}], malformed: [{line, text, why}]}`. One entry per id, the latest line's.
 */
export const parseDisputes = (text) => {
  const byId = new Map();
  const malformed = [];
  String(text ?? '').split(/\r?\n/).forEach((raw, i) => {
    const line = stripMarkup(raw);
    if (!/^DISPUTE(\s|$)/.test(line)) return;
    const bad = (why) => malformed.push({ line: i + 1, text: line.slice(0, 120), why });
    const tokens = line.split(/\s+/).slice(1);
    const id = tokens.shift();
    if (!id || id.includes('=')) return bad('no id after DISPUTE');
    const fields = {};
    for (const token of tokens) {
      const eq = token.indexOf('=');
      if (eq <= 0) return bad(`"${token}" is not key=value`);
      fields[token.slice(0, eq)] = token.slice(eq + 1);
    }
    if (!fields.plan) return bad('no plan=NAME');
    if (!DISPUTE_STATUS.includes(fields.status)) return bad(`status must be ${DISPUTE_STATUS.join(' or ')} (got ${JSON.stringify(fields.status)})`);
    if (fields.status === 'open' && fields.outcome !== undefined) return bad('an open dispute has no outcome yet');
    if (fields.status === 'decided' && !DISPUTE_OUTCOME.includes(fields.outcome)) return bad(`a decided dispute needs outcome=${DISPUTE_OUTCOME.join('|')} (got ${JSON.stringify(fields.outcome)})`);
    if (fields.direction !== undefined && !DISPUTE_DIRECTION.includes(fields.direction)) return bad(`direction must be ${DISPUTE_DIRECTION.join(', ')} (got ${JSON.stringify(fields.direction)})`);
    if (fields.outcome === 'changed' && fields.direction === undefined) return bad('a changed key needs direction=toward-tracer|away|neutral: the tally of which way changes went is what makes disputes trustworthy');
    byId.set(id, {
      id, plan: fields.plan, status: fields.status, outcome: fields.outcome ?? null, direction: fields.direction ?? null, line: i + 1,
    });
    return null;
  });
  return { disputes: [...byId.values()], malformed };
};

/** The dispute tally: counts, direction of the changes, and a warning when they all favour the tracer. */
export const tallyDisputes = (disputes) => {
  const count = (fn) => disputes.filter(fn).length;
  const changed = disputes.filter((d) => d.outcome === 'changed');
  const direction = Object.fromEntries(DISPUTE_DIRECTION.map((dir) => [dir, changed.filter((d) => d.direction === dir).length]));
  const tally = {
    total: disputes.length,
    open: count((d) => d.status === 'open'),
    decided: count((d) => d.status === 'decided'),
    changed: changed.length,
    kept: count((d) => d.outcome === 'kept'),
    direction,
    plans: new Set(disputes.map((d) => d.plan)).size,
    warning: null,
  };
  // The orchestrator's own warning sign: disputes that always go the tracer's way.
  if (changed.length >= 3 && direction['toward-tracer'] === changed.length) {
    tally.warning = `all ${changed.length} changed keys moved toward the tracer: disputes that always go the tracer's way are a warning sign in their own right`;
  }
  return tally;
};

const bump = (map, key, agree) => {
  const cell = map.get(key) ?? map.set(key, { compared: 0, agree: 0 }).get(key);
  cell.compared += 1;
  if (agree) cell.agree += 1;
};
const rateObject = (map) => Object.fromEntries([...map].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * The statistics over `names`: `{plans, agreement: {compared, agree, stale,
 * byEra, byBook}, adjudication: {finalized, adjudicated}, reviews: {reviews,
 * rejections, plans, rounds}, disputes: {...tally, malformed}}`.
 */
export const collectStats = (dir, catalog, names) => {
  const index = wipIndex(dir);
  const overall = { compared: 0, agree: 0 };
  const byEra = new Map();
  const byBook = new Map();
  let stale = 0;
  let finalized = 0;
  let adjudicated = 0;
  for (const name of names) {
    const info = catalog.infoOf(name);
    if (index.has(name, '.compare.json')) {
      if (!compareIsFresh(dir, name)) stale += 1;
      else {
        const { agree } = compareView(readCompare(dir, name));
        overall.compared += 1;
        if (agree) overall.agree += 1;
        bump(byEra, info.era ?? 'unknown', agree);
        bump(byBook, info.book, agree);
      }
    }
    // Finalized: a record was written for the final key, or the key is frozen.
    let adjudicator = null;
    let isFinal = false;
    if (index.has(name, '.record.json')) {
      isFinal = true;
      const record = readJson(wipFile(name, '.record.json', dir));
      adjudicator = record.adjudicated === true || record.adjudicator ? (record.adjudicator ?? 'yes') : null;
    } else {
      const facts = planFacts(dir, name);
      if (facts.answerKey?.checked) {
        isFinal = true;
        adjudicator = parseBy(facts.answerKey.by)?.adjudicator ?? null;
      }
    }
    if (isFinal) {
      finalized += 1;
      if (adjudicator) adjudicated += 1;
    }
  }
  let reviews = 0;
  let rejections = 0;
  let reviewedPlans = 0;
  const rounds = {};
  for (const name of names) {
    const numbers = index.reviews.get(name) ?? [];
    if (!numbers.length) continue;
    reviewedPlans += 1;
    const bucket = numbers.length >= 3 ? '3+' : String(numbers.length);
    rounds[bucket] = (rounds[bucket] ?? 0) + 1;
    for (const n of numbers) {
      reviews += 1;
      if (readJson(wipFile(name, `.review-${n}.json`, dir)).decision === 'reject') rejections += 1;
    }
  }
  const file = disputesFileFor(dir);
  const { disputes, malformed } = parseDisputes(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '');
  return {
    plans: names.length,
    agreement: {
      ...overall, stale, byEra: rateObject(byEra), byBook: rateObject(byBook),
    },
    adjudication: { finalized, adjudicated },
    reviews: {
      reviews, rejections, plans: reviewedPlans, rounds,
    },
    disputes: { ...tallyDisputes(disputes), malformed, list: disputes },
  };
};

const rate = (c) => `${c.agree}/${c.compared} (${pct(c.agree, c.compared)})`;

export const statsLines = (s) => {
  const lines = [`stats over ${plural(s.plans, 'plan')}`];
  const a = s.agreement;
  lines.push(`agreement      ${a.agree} of ${a.compared} compared agree (${pct(a.agree, a.compared)})${a.stale ? `; ${plural(a.stale, 'stale comparison')} not counted` : ''}`);
  for (const [era, c] of Object.entries(a.byEra)) lines.push(`  ${era.padEnd(12)} ${rate(c)}`);
  const d = s.adjudication;
  lines.push(`adjudication   ${d.adjudicated} of ${d.finalized} finalized needed the adjudicator (${pct(d.adjudicated, d.finalized)})`);
  const r = s.reviews;
  const rounds = Object.entries(r.rounds).sort(([x], [y]) => (x < y ? -1 : 1)).map(([n, c]) => `${n}:${c}`).join(' ');
  lines.push(`final review   ${r.rejections} of ${plural(r.reviews, 'review')} sent a key back (${pct(r.rejections, r.reviews)}); ${plural(r.plans, 'plan')} reviewed, rounds per plan ${rounds || 'none'}`);
  const x = s.disputes;
  lines.push(`disputes       ${x.total} (open ${x.open}, decided ${x.decided}: changed ${x.changed}, kept ${x.kept}); changed keys moved toward the tracer ${x.direction['toward-tracer']}, away ${x.direction.away}, neutral ${x.direction.neutral}`);
  if (x.warning) lines.push(`WARNING: ${x.warning}`);
  for (const m of x.malformed) lines.push(`WARNING: disputes.md line ${m.line} is not a dispute line (${m.why}): ${m.text}`);
  const books = Object.entries(a.byBook);
  if (books.length) {
    lines.push('', 'agreement by book:');
    for (const line of table(books, [
      { title: 'book', get: ([book]) => book },
      { title: 'agree', get: ([, c]) => c.agree, right: true },
      { title: 'of', get: ([, c]) => c.compared, right: true },
      { title: 'rate', get: ([, c]) => pct(c.agree, c.compared), right: true },
    ])) lines.push(`  ${line}`);
  }
  return lines;
};

export const stats = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, withSelect({ flags: ['json'] }), 'stats');
  const catalog = loadCatalog(ctx.dir);
  const selected = positional.length || opts.names || opts.book || opts.split || opts.all;
  const names = selected ? selectPlans({ positional, opts }, ctx, catalog) : listPlans(ctx.dir);
  const s = collectStats(ctx.dir, catalog, names);
  if (opts.json) ctx.out(JSON.stringify(s, null, 1));
  else for (const line of statsLines(s)) ctx.out(line);
  return s.disputes.malformed.length ? 1 : 0;
};
