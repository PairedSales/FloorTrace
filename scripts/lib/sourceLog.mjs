// The sourcing log of the real set: every plan drafted, every page rejected,
// every book looked at (scripts/realSource.mjs `log` and `report`). Sourcers
// cannot write into the set folder with their file tool, so the tool does the
// writing, and it checks what it is given: a log that says a plan came from a
// place it did not, or that a page was dropped for the wrong reason, is worse
// than none.
//
// <set>/orchestration/sources.jsonl is the record: one JSON object per line,
// only ever appended to (a replaced plan's old line is marked, never removed).
// <set>/orchestration/sources.md is regenerated from it after every write and
// by `report`. Writers take a lock file first, since several sourcers log at
// once, and every write retries while Google Drive holds a file.
//
// One book is one spelling, and the diversity caps are counted so that many
// sourcers logging at once cannot pass them unnoticed: a plan's --book must
// look like the name's stem (pacific25 for "Pacific 1925") or name a `book`
// entry, a stem already logged under one spelling is not logged under another,
// and the report counts plans per book, per stem or --unit (a designer code
// on an aggregator site) and per --site, whatever spelling was typed.
//
// A rejection's reason comes from a closed list of inclusion rules. How well
// the app traces a page is not on it, and `other:` text that talks about the
// tracer, the scan or the labels is refused: a page qualifies before it is
// drafted, never by how the app handles it (the orchestrator's integrity rule 6).
import fs from 'fs';
import path from 'path';
import { writeFileAtomic, planFile, realDir } from './keyFiles.mjs';
import { checkUrl, acquireLock, realClock } from './sourceNet.mjs';
import { parseWaybackUrl } from './sourceArchive.mjs';
import { MAX_IMAGE_DIMENSION, MIN_TRACEABLE_DIMENSION } from '../../src/utils/imageLoader.js';

export const ERAS = ['vintage', '2020-2022'];
// At most 12 plans from one book, publisher or builder (the unit: a book, a
// name stem, or the designer code an aggregator site's plans carry) and no
// site above 60 in all.
export const BOOK_CAP = 12;
export const SITE_CAP = 60;
export const VINTAGE_NAME = /^[a-z]+[0-9]{2}-n[0-9]+[ab]?$/;
export const MODERN_NAME = /^[a-z]+[0-9]{2}-[a-z0-9._-]+$/;
export const REJECT_REASONS = ['3d', 'elevation', 'site-plan', 'too-small', 'hand-lettered', 'not-us-home', 'duplicate-house', 'not-a-plan'];
// The words people use for the same rules.
const REASON_ALIASES = {
  '3-d': '3d', perspective: '3d', elevations: 'elevation', 'site-plans': 'site-plan', site: 'site-plan',
  small: 'too-small', blurred: 'too-small', 'too-blurred': 'too-small', 'hand-lettering': 'hand-lettered', 'script-lettered': 'hand-lettered',
  'script-lettering': 'hand-lettered', 'not-a-us-home': 'not-us-home', 'not-a-us-house': 'not-us-home', 'not-us': 'not-us-home',
  duplicate: 'duplicate-house', 'same-house': 'duplicate-house', 'not-plan': 'not-a-plan',
};
// `other:` text about the tracer, the scan or the labels is a quality-of-trace
// reason in other words.
const TRACE_WORDS = /\b(trace[sd]?|tracer|tracing|verdict|iou|bench\w*|scor(?:e|es|ed|ing)|ocr|labels?|app)\b/i;
const TRACE_MESSAGE = 'a reason that talks about the tracer, the scan or the labels is not an inclusion rule: a page qualifies before it is drafted, never by how the app handles it (integrity rule 6). Draft the page; if it truly breaks a rule, give that rule';


const SLUG = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const isInt = (n) => Number.isInteger(n);
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const keyOf = (text) => str(text).toLowerCase().replace(/\s+/g, ' ');
const UNIT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

/** The book part of a plan name: `pacific25` of `pacific25-n41`, `dongardner21` of `dongardner21-1234`. */
export const nameStem = (name) => /^([a-z]+[0-9]{2})-/.exec(String(name ?? ''))?.[1] ?? null;

/** Whether a `--book` text could be the book a name stem stands for: it holds the stem's letters, or they are its initials. */
export const bookAgreesWithStem = (book, stem) => {
  const letters = /^[a-z]+/.exec(stem ?? '')?.[0];
  if (!letters) return false;
  const words = str(book).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const initials = words.filter((w) => /^[a-z]/.test(w)).map((w) => w[0]).join('');
  return words.join('').includes(letters) || initials.includes(letters);
};

/**
 * How many leaves the plan's book has, if anything known says: the cached
 * metadata of its archive.org item (`cachedLeaves(id)`), else the latest `book`
 * entry of the log for that item or book. `{count, from}`, or null.
 */
export const knownLeafCount = (events, { book, id, cachedLeaves }) => {
  let cached = null;
  if (id && cachedLeaves) {
    try {
      cached = cachedLeaves(id);
    } catch {
      cached = null; // an identifier the archive layer will not build a URL from
    }
  }
  if (cached) return { count: cached, from: `the cached metadata of ${id}` };
  const entry = [...events].reverse().find((e) => e?.event === 'book' && isInt(e.leaves) && e.leaves > 0
    && ((id && e.id === id) || keyOf(e.book) === keyOf(book)));
  return entry ? { count: entry.leaves, from: `the log entry for "${entry.book}"` } : null;
};

/** A reject reason as the closed list has it, or a thrown error saying what the list is. */
export const normalizeReason = (raw) => {
  const text = str(raw);
  if (/^other:/i.test(text)) {
    const detail = text.slice(text.indexOf(':') + 1).trim();
    if (!detail) throw new Error('reason "other:" needs its text: other:<why>');
    if (TRACE_WORDS.test(detail)) throw new Error(`reason "${text}": ${TRACE_MESSAGE}`);
    return `other:${detail}`;
  }
  const key = text.toLowerCase().replace(/[\s_]+/g, '-');
  const reason = REJECT_REASONS.includes(key) ? key : REASON_ALIASES[key];
  if (!reason) {
    const hint = TRACE_WORDS.test(text) ? `; ${TRACE_MESSAGE}` : '';
    throw new Error(`reason "${text}" is not on the list: ${REJECT_REASONS.join(', ')}, or other:<text>${hint}`);
  }
  return reason;
};

/** `X,Y,W,H` (or an array) as four integers: x and y from 0, width and height above 0. */
export const parseCrop = (value) => {
  const parts = Array.isArray(value) ? value : String(value).split(',').map((s) => (s.trim() === '' ? NaN : Number(s)));
  if (parts.length !== 4 || !parts.every(isInt) || parts[0] < 0 || parts[1] < 0 || parts[2] < 1 || parts[3] < 1) {
    throw new Error(`crop "${value}" must be X,Y,W,H: four whole numbers, x and y at least 0, width and height at least 1`);
  }
  return parts;
};

export const parseSize = (value) => {
  const parts = Array.isArray(value) ? value : String(value).split(/[,x]/).map((s) => (s.trim() === '' ? NaN : Number(s)));
  if (parts.length !== 2 || !parts.every((n) => isInt(n) && n > 0)) throw new Error(`size "${value}" must be W,H: two whole numbers above 0`);
  return parts;
};

/** The size a drafted crop comes out: the crop itself, scaled to fit when a side is over the app's cap (realDraft's fitImage). */
export const sizeAfterFit = ([, , w, h]) => {
  if (w <= MAX_IMAGE_DIMENSION && h <= MAX_IMAGE_DIMENSION) return [w, h];
  const scale = Math.min(MAX_IMAGE_DIMENSION / w, MAX_IMAGE_DIMENSION / h);
  return [Math.round(w * scale), Math.round(h * scale)];
};

// The line scripts/realDrafts.mjs prints for a plan.
const BUILDER_LINE = /^(?<name>\S+): (?<labels>\d+) labels?(?: \((?<cut>\d+) regions? cut off\))?, (?<rooms>\d+) rooms? set the scale, (?<scale>.+?), (?<outlines>\d+) outline\(s\), trace (?<level>\S+)/;

export const parseBuilderLine = (line) => {
  const m = BUILDER_LINE.exec(str(line));
  if (!m) return null;
  return {
    name: m.groups.name,
    labels: Number(m.groups.labels),
    cutOff: Number(m.groups.cut ?? 0),
    rooms: Number(m.groups.rooms),
    scale: m.groups.scale,
    outlines: Number(m.groups.outlines),
    level: m.groups.level,
  };
};

const nowIso = (clock) => new Date(clock.now()).toISOString();

const toInt = (value, what, problems) => {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!isInt(n)) {
    problems.push(`${what} "${value}" must be a whole number`);
    return null;
  }
  return n;
};

const planSource = (name, dir) => {
  const file = planFile(name, dir);
  if (!fs.existsSync(file)) return { file, exists: false };
  try {
    return { file, exists: true, source: JSON.parse(fs.readFileSync(file, 'utf8')).source ?? null };
  } catch (error) {
    return { file, exists: true, source: null, unreadable: error.message };
  }
};

/**
 * A plan event from what the sourcer gave (`input`: name, book, publisher, era,
 * year, decade, leaf, url, crop, size, line, tag), or an Error listing every
 * problem at once. `events` are the log so far: they say which names are taken
 * (`activeNames` says it directly; superseded plans do not count), which
 * spelling of a book a stem was logged under, which `book` entries exist and how
 * many leaves a book has; `replace` lets a name repeat. `cachedLeaves(id)` is
 * the leaf count of an archive.org item from cached metadata, or null. `dir` is
 * the set folder: when the plan is there, its own recorded source must agree
 * with the log. Returns `{event, warnings}`.
 */
export const buildPlanEvent = (input, {
  events = [], activeNames = activePlanNames(events), replace = false, dir, verify = true, clock = realClock, cachedLeaves,
} = {}) => {
  const problems = [];
  const warnings = [];
  const name = str(input.name);
  const book = str(input.book);
  const era = str(input.era);
  const line = str(input.line);
  const url = str(input.url);
  if (!name) problems.push('--name is needed');
  if (!book) problems.push('--book is needed');
  if (!ERAS.includes(era)) problems.push(`--era must be ${ERAS.join(' or ')}`);
  if (!line) problems.push('--line is needed: the builder line realDrafts printed, whole');
  if (!url) problems.push('--url is needed: the URL the plan was drafted from');
  const year = toInt(input.year, '--year', problems);
  if (input.year === undefined || input.year === '') problems.push('--year is needed');
  let leaf = toInt(input.leaf, '--leaf', problems);
  if (leaf !== null && leaf < 0) problems.push('--leaf must be 0 or more');

  if (name) {
    const pattern = era === 'vintage' ? VINTAGE_NAME : MODERN_NAME;
    if (ERAS.includes(era) && !pattern.test(name)) {
      problems.push(era === 'vintage'
        ? `name "${name}" must look like <book><yy>-n<leaf>[a|b] (letters, two digits, -n, the leaf), as popular63-n44a`
        : `name "${name}" must look like <site><yy>-<plan id> (lowercase letters, two digits, -, then letters, digits . _ -), as dongardner21-1234`);
    }
    const yy = /^[a-z]+([0-9]{2})-/.exec(name)?.[1];
    if (yy && year !== null && Number(yy) !== year % 100) problems.push(`name "${name}" carries the year ${yy}, but --year is ${year}`);
    if (era === 'vintage') {
      const nameLeaf = /-n([0-9]+)[ab]?$/.exec(name)?.[1];
      if (nameLeaf !== undefined && leaf !== null && Number(nameLeaf) !== leaf) problems.push(`name "${name}" says leaf ${nameLeaf}, but --leaf is ${leaf}`);
      if (nameLeaf !== undefined && leaf === null) leaf = Number(nameLeaf);
    }
    if (activeNames.has(name) && !replace) problems.push(`a plan named ${name} is already logged (--replace logs it again, marking the old entry superseded)`);
    const stem = nameStem(name);
    if (stem && book) {
      const declared = events.some((e) => e?.event === 'book' && keyOf(e.book) === keyOf(book));
      if (!declared && !bookAgreesWithStem(book, stem)) {
        problems.push(`--book "${book}" does not look like the name's stem ${stem} and no \`log book --book "${book}"\` entry exists: name the book as its plans' names do, or log the book first, so that one book is one spelling`);
      }
      const clash = events.find((e) => isActivePlan(e) && e.name !== name && nameStem(e.name) === stem && keyOf(e.book) !== keyOf(book));
      if (clash) problems.push(`the stem ${stem} is already logged under the book "${clash.book}", not "${book}": use that spelling (a different book needs a different name stem)`);
    }
  }
  const unit = str(input.unit);
  if (unit && !UNIT.test(unit)) problems.push(`--unit "${unit}" must be a code of letters, digits, . _ - (at most 40), like a designer code`);
  const site = str(input.site);
  if (site.length > 80) problems.push('--site must be at most 80 characters');
  if (year !== null) {
    if (era === '2020-2022' && (year < 2020 || year > 2022)) problems.push(`era 2020-2022 needs a year from 2020 to 2022 (got ${year})`);
    if (era === 'vintage' && (year < 1800 || year > 2019)) problems.push(`era vintage needs a year before 2020 (got ${year})`);
  }
  if (input.decade !== undefined && input.decade !== '') {
    const d = toInt(input.decade, '--decade', problems);
    if (d !== null && year !== null && d !== Math.floor(year / 10) * 10) problems.push(`--decade ${d} does not hold the year ${year}`);
  }

  if (url) {
    try {
      checkUrl(url, '--url');
      if (era === '2020-2022') {
        const wb = parseWaybackUrl(url);
        if (!wb) problems.push('a modern plan\'s --url must be the capture\'s original-bytes URL: https://web.archive.org/web/<14-digit timestamp>id_/<image URL>');
        else if (year !== null && wb.year !== year) problems.push(`--url is a capture from ${wb.year}, but --year is ${year}`);
      } else if (era === 'vintage') {
        const page = /^https:\/\/archive\.org\/download\/([^/]+)\/page\/n(\d+)(?:\.jpe?g)?$/.exec(url);
        if (page && leaf !== null && Number(page[2]) !== leaf) problems.push(`--url is leaf ${page[2]}, but the leaf is ${leaf}`);
        // archive.org answers a leaf past the last with the last page, so a
        // mistyped leaf is a plausible page unless the book's length says.
        const known = leaf !== null ? knownLeafCount(events, { book, id: page?.[1] ?? null, cachedLeaves }) : null;
        if (known && leaf >= known.count) {
          problems.push(`leaf ${leaf} is past the end of ${book} (${known.count} leaves, 0..${known.count - 1}, from ${known.from}): archive.org answers a leaf past the last with the last page, so this entry would name a page that is not there`);
        }
      }
    } catch (error) {
      problems.push(error.message);
    }
  }

  let crop = null;
  try {
    crop = parseCrop(input.crop ?? '');
  } catch (error) {
    problems.push(error.message);
  }
  let size = null;
  if (input.size !== undefined && input.size !== '') {
    try {
      size = parseSize(input.size);
    } catch (error) {
      problems.push(error.message);
    }
  }
  const drafted = line ? parseBuilderLine(line) : null;
  if (line && !drafted) problems.push('--line is not a line realDrafts prints ("<name>: N labels, M rooms set the scale, <scale>, K outline(s), trace <level> -> <file>"): paste it whole');
  if (drafted && name && drafted.name !== name) problems.push(`--line is for ${drafted.name}, not ${name}`);

  // The plan's own record of where it came from must say what the log says.
  if (name && verify && dir && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    const plan = planSource(name, dir);
    if (!plan.exists) warnings.push(`no plan named ${name} in the set folder yet: draft it first, or this entry describes a plan that does not exist`);
    else if (plan.unreadable) warnings.push(`the plan ${name} could not be read (${plan.unreadable}): its source was not checked`);
    else if (!plan.source) warnings.push(`the plan ${name} records no source: its url, crop and size were not checked`);
    else {
      const { url: planUrl, crop: planCrop, size: planSize } = plan.source;
      if (url && planUrl && planUrl !== url) problems.push(`the plan ${name} was drafted from ${planUrl}, not ${url}`);
      if (crop && planCrop && planCrop.join(',') !== crop.join(',')) problems.push(`the plan ${name} was drafted with crop ${planCrop.join(',')}, not ${crop.join(',')}`);
      if (planSize) {
        if (size && size.join(',') !== planSize.join(',')) problems.push(`the plan ${name} is ${planSize.join('x')}, not ${size.join('x')}`);
        size ??= planSize;
      }
    }
  }
  if (!size && crop) size = sizeAfterFit(crop);
  if (size && Math.max(...size) < MIN_TRACEABLE_DIMENSION) {
    warnings.push(`the plan is ${size.join('x')}, under about ${MIN_TRACEABLE_DIMENSION} px across: that breaks an inclusion rule (too-small), so log a rejection of the page rather than a plan`);
  }
  if (drafted) {
    if (drafted.cutOff > 0) warnings.push(`${drafted.cutOff} regions were cut off: draft it again with --force when the machine is quiet, then log --replace`);
    if (drafted.labels === 0) warnings.push('no labels were read: check the crop (too tight? rotated? low resolution?) before accepting; a truly hand-lettered page is logged as a rejection (hand-lettered)');
    if (/^no scale/i.test(drafted.scale)) warnings.push('no scale was set from the labels');
  }
  if (problems.length) throw new Error(problems.join('; '));

  const event = {
    event: 'plan',
    at: nowIso(clock),
    name,
    book,
    publisher: str(input.publisher) || null,
    era,
    year,
    decade: Math.floor(year / 10) * 10,
    leaf,
    url,
    crop,
    size,
    unit: unit || null,
    site: site || null,
    labels: drafted.labels,
    scale: drafted.scale,
    cutOff: drafted.cutOff,
    line,
    tag: str(input.tag) || null,
  };
  return { event, warnings };
};

export const buildRejectEvent = (input, { clock = realClock } = {}) => {
  const problems = [];
  const book = str(input.book);
  if (!book) problems.push('--book is needed');
  const leaf = toInt(input.leaf, '--leaf', problems);
  const url = str(input.url);
  if (leaf === null && !url) problems.push('a rejection needs the page: --leaf N or --url URL');
  let reason = null;
  try {
    reason = normalizeReason(input.reason ?? '');
  } catch (error) {
    problems.push(error.message);
  }
  if (url) {
    try {
      checkUrl(url, '--url');
    } catch (error) {
      problems.push(error.message);
    }
  }
  if (problems.length) throw new Error(problems.join('; '));
  return {
    event: 'reject', at: nowIso(clock), book, leaf, url: url || null, reason, tag: str(input.tag) || null,
  };
};

export const buildBookEvent = (input, { clock = realClock } = {}) => {
  const problems = [];
  const book = str(input.book);
  if (!book) problems.push('--book is needed');
  const year = toInt(input.year, '--year', problems);
  const leaves = toInt(input.leaves, '--leaves', problems);
  if (problems.length) throw new Error(problems.join('; '));
  return {
    event: 'book', at: nowIso(clock), book, id: str(input.id) || null, publisher: str(input.publisher) || null, year, leaves, note: str(input.note) || null,
  };
};

// ---- the files -------------------------------------------------------------

export const sourcesFiles = (dir = realDir()) => {
  const base = path.join(dir, 'orchestration');
  return {
    jsonl: path.join(base, 'sources.jsonl'),
    md: path.join(base, 'sources.md'),
    lock: path.join(base, '.sources.lock'),
  };
};

/** The log's lines as objects (`raw` keeps every line as written, torn ones included). */
export const readLog = (file) => {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const raw = text.split('\n').filter((l) => l.trim() !== '');
  const events = raw.map((line, i) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === 'object' ? { ...value, _line: i } : null;
    } catch {
      return null;
    }
  });
  return { raw, events };
};

export const isActivePlan = (e) => e?.event === 'plan' && !e.superseded;
export const activePlanNames = (events) => new Set(events.filter(isActivePlan).map((e) => e.name));

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
const appendRetry = async (file, text, { retries = 6, delayMs = 200, clock = realClock } = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let attempt = 0; ; attempt += 1) {
    try {
      // A torn last line (a writer killed mid-append) must not swallow this one.
      const prefix = fs.existsSync(file) && fs.statSync(file).size > 0 && fs.readFileSync(file, 'utf8').slice(-1) !== '\n' ? '\n' : '';
      fs.appendFileSync(file, `${prefix}${text}`);
      return;
    } catch (error) {
      if (!BUSY.has(error?.code) || attempt >= retries) throw error;
      await clock.sleep(delayMs * (attempt + 1));
    }
  }
};

// ---- the report ------------------------------------------------------------

const cell = (v) => String(v ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

// What a plan counts toward. The site is --site, else the book; the unit is
// the designer code --unit gives (scoped to its site: two sites may both have a
// designer 940), else the name's stem, so a book typed two ways is still one unit.
const siteName = (p) => str(p.site) || str(p.book);
const unitKey = (p) => (p.unit ? `${keyOf(siteName(p))}/${keyOf(p.unit)}` : (nameStem(p.name) ?? `book:${keyOf(p.book)}`));
const unitLabel = (p) => (p.unit ? `unit ${p.unit} of ${siteName(p)}` : `unit ${nameStem(p.name) ?? p.book}`);

const tally = (plans, keyFn, labelFn) => {
  const groups = new Map();
  for (const p of plans) {
    const key = keyFn(p);
    if (!groups.has(key)) groups.set(key, { label: labelFn(p), plans: [] });
    groups.get(key).plans.push(p);
  }
  return [...groups.values()];
};

/**
 * Every cap the active plans break: per book (the exact --book text, as
 * always, for plans without a --unit), per unit (name stem or --unit; the
 * same plans as a book violation are reported once, as the book) and per site
 * (--site, else the book). `{kind, label, count, cap, names, spellings}`.
 */
export const capViolations = (plans) => {
  const found = [];
  const add = (kind, cap, groups) => {
    for (const g of groups) {
      if (g.plans.length <= cap) continue;
      const spellings = tally(g.plans, (p) => p.book, (p) => p.book).map((b) => [b.label, b.plans.length]);
      found.push({
        kind, cap, label: g.label, count: g.plans.length, names: g.plans.map((p) => p.name), spellings,
      });
    }
  };
  const setOf = (v) => [...v.names].sort().join('|');
  add('book', BOOK_CAP, tally(plans.filter((p) => !p.unit), (p) => p.book, (p) => p.book));
  const bookSets = new Set(found.map(setOf));
  add('unit', BOOK_CAP, tally(plans, unitKey, unitLabel));
  add('site', SITE_CAP, tally(plans, (p) => keyOf(siteName(p)), siteName));
  return found.filter((v) => v.kind !== 'unit' || !bookSets.has(setOf(v)));
};

export const violationText = (v) => {
  if (v.kind === 'book') return `${v.label} (${v.count})`;
  const spelled = v.spellings.length > 1 ? `; typed as ${v.spellings.map(([book, n]) => `"${book}" ${n}`).join(', ')}` : '';
  return `${v.label} (${v.count}${v.kind === 'site' ? `; cap ${v.cap}` : ''}${spelled})`;
};

/**
 * The log as the numbers a sourcer's PR and the orchestrator need: per book
 * and per era counts, the caps broken (`violations`: books, units, sites),
 * and the same as markdown. Superseded plans are set apart and counted nowhere.
 */
export const summarize = (events) => {
  const plans = events.filter(isActivePlan);
  const rejects = events.filter((e) => e?.event === 'reject');
  const bookEvents = new Map();
  for (const e of events) if (e?.event === 'book') bookEvents.set(e.book, e);
  const books = new Map();
  const group = (name, era) => {
    if (!books.has(name)) books.set(name, { book: name, era: era ?? null, plans: [], rejects: [], info: bookEvents.get(name) ?? null });
    const g = books.get(name);
    g.era ??= era ?? null;
    return g;
  };
  for (const e of plans) group(e.book, e.era).plans.push(e);
  for (const e of rejects) group(e.book, null).rejects.push(e);
  for (const [name] of bookEvents) group(name, null);
  const rank = (g) => (ERAS.includes(g.era) ? ERAS.indexOf(g.era) : ERAS.length);
  const groups = [...books.values()].sort((a, b) => rank(a) - rank(b) || a.book.localeCompare(b.book));
  const eras = ERAS.map((era) => {
    const inEra = groups.filter((g) => g.era === era);
    return {
      era,
      books: inEra.filter((g) => g.plans.length).length,
      plans: inEra.reduce((n, g) => n + g.plans.length, 0),
      rejects: inEra.reduce((n, g) => n + g.rejects.length, 0),
    };
  });
  return {
    groups,
    eras,
    total: plans.length,
    rejected: rejects.length,
    superseded: events.filter((e) => e?.event === 'plan' && e.superseded),
    overCap: groups.filter((g) => g.plans.filter((p) => !p.unit).length > BOOK_CAP),
    violations: capViolations(plans),
  };
};

export const renderReport = (events, { at = new Date().toISOString() } = {}) => {
  const s = summarize(events);
  const out = [];
  out.push('# Sources', '');
  out.push(`Generated ${at} from \`sources.jsonl\` by \`node scripts/realSource.mjs report\`. Do not edit: the next \`log\` or \`report\` rewrites this file.`, '');
  out.push('## Totals', '', '| era | books / sites | plans | rejected pages |', '|---|---|---|---|');
  for (const e of s.eras) out.push(`| ${e.era} | ${e.books} | ${e.plans} | ${e.rejects} |`);
  const unerad = s.groups.filter((g) => !g.era).reduce((n, g) => n + g.rejects.length, 0);
  if (unerad) out.push(`| (books with no plan yet) | - | 0 | ${unerad} |`);
  out.push(`| **all** | ${s.groups.filter((g) => g.plans.length).length} | ${s.total} | ${s.rejected} |`, '');
  const perUnit = s.violations.filter((v) => v.cap === BOOK_CAP);
  const perSite = s.violations.filter((v) => v.cap === SITE_CAP);
  out.push(perUnit.length
    ? `**Over the cap of ${BOOK_CAP} plans from one book or site:** ${perUnit.map(violationText).join(', ')}`
    : `No book or site is over the cap of ${BOOK_CAP} plans (counted per book, per name stem and per --unit).`, '');
  out.push(perSite.length
    ? `**Over the cap of ${SITE_CAP} plans from one site:** ${perSite.map(violationText).join(', ')}`
    : `No site is over the cap of ${SITE_CAP} plans.`, '');
  for (const g of s.groups) {
    const info = g.info;
    const head = [g.era, info?.year ?? g.plans[0]?.year, info?.publisher ?? g.plans[0]?.publisher, info?.id ? `id ${info.id}` : null, info?.leaves ? `${info.leaves} leaves` : null]
      .filter(Boolean).join(', ');
    out.push(`## ${cell(g.book)}${head ? ` (${cell(head)})` : ''}`, '');
    if (info?.note) out.push(cell(info.note), '');
    out.push(`${g.plans.length} plan${g.plans.length === 1 ? '' : 's'}${s.overCap.includes(g) ? ` (**over the cap of ${BOOK_CAP}**)` : ''}, ${g.rejects.length} rejected page${g.rejects.length === 1 ? '' : 's'}.`, '');
    const units = tally(g.plans.filter((p) => p.unit), (p) => keyOf(p.unit), (p) => p.unit);
    if (units.length) out.push(`Units (cap ${BOOK_CAP} each): ${units.map((u) => `${cell(u.label)} (${u.plans.length})`).join(', ')}`, '');
    if (g.plans.length) {
      out.push('| plan | leaf / URL | crop x,y,w,h | size | labels | cut off | scale | builder line |', '|---|---|---|---|---|---|---|---|');
      for (const p of g.plans) {
        const where = p.era === 'vintage' ? `n${p.leaf}` : p.url;
        out.push(`| ${cell(p.name)} | ${cell(where)} | ${(p.crop ?? []).join(',')} | ${(p.size ?? []).join('x')} | ${p.labels} | ${p.cutOff} | ${cell(p.scale)} | ${cell(p.line)} |`);
      }
      out.push('');
    }
    if (g.rejects.length) {
      out.push('Rejected pages:', '');
      for (const r of g.rejects) out.push(`- ${r.leaf !== null ? `leaf ${r.leaf}` : ''}${r.leaf !== null && r.url ? ' ' : ''}${r.url ?? ''}: ${cell(r.reason)}${r.tag ? ` (${cell(r.tag)})` : ''}`);
      out.push('');
    }
  }
  if (s.superseded.length) {
    out.push('## Superseded entries', '', 'Plans logged again with `--replace`; the old lines stay in `sources.jsonl`.', '');
    for (const p of s.superseded) out.push(`- ${cell(p.name)} logged ${p.at}, superseded ${p.superseded}`);
    out.push('');
  }
  return `${out.join('\n')}\n`;
};

/** The console summary of `report`: per book, per era, and any book over the cap. */
export const summaryLines = (events) => {
  const s = summarize(events);
  const lines = [];
  for (const g of s.groups) {
    lines.push(`${g.era ?? '?'}  ${g.book}: ${g.plans.length} plan${g.plans.length === 1 ? '' : 's'}, ${g.rejects.length} rejected${s.overCap.includes(g) ? `  OVER THE CAP OF ${BOOK_CAP}` : ''}`);
  }
  for (const e of s.eras) lines.push(`era ${e.era}: ${e.plans} plans from ${e.books} books/sites, ${e.rejects} rejected pages`);
  lines.push(`total: ${s.total} plans, ${s.rejected} rejected pages${s.superseded.length ? `, ${s.superseded.length} superseded entries` : ''}`);
  const perUnit = s.violations.filter((v) => v.cap === BOOK_CAP);
  const perSite = s.violations.filter((v) => v.cap === SITE_CAP);
  lines.push(perUnit.length ? `OVER THE CAP OF ${BOOK_CAP}: ${perUnit.map(violationText).join(', ')}` : `no book or site over the cap of ${BOOK_CAP} (counted per book, per name stem and per --unit)`);
  lines.push(perSite.length ? `OVER THE CAP OF ${SITE_CAP} PER SITE: ${perSite.map(violationText).join(', ')}` : `no site over the cap of ${SITE_CAP}`);
  return lines;
};

// ---- writing ---------------------------------------------------------------

const lockOptions = (clock) => ({ clock, staleMs: 60000, pollMs: 100 });

const writeReport = async (files, events, clock) => {
  await writeFileAtomic(files.md, renderReport(events, { at: nowIso(clock) }));
};

/**
 * Logs one event of `kind` ("plan", "reject" or "book") from the sourcer's
 * `input`, under the lock, and regenerates sources.md. `replace` (plans only)
 * logs a plan again, marking the old entry superseded. `cachedLeaves(id)` gives
 * an archive.org item's leaf count from cached metadata (see buildPlanEvent).
 * A plan that takes its book, unit or site over a cap is logged with a warning
 * (the report prints every cap broken). Returns `{event, warnings, files}`.
 */
export const logEvent = async (kind, input, {
  dir = realDir(), clock = realClock, replace = false, verify = true, cachedLeaves,
} = {}) => {
  const files = sourcesFiles(dir);
  const release = await acquireLock(files.lock, lockOptions(clock));
  try {
    const { raw, events } = readLog(files.jsonl);
    let event;
    let warnings = [];
    if (kind === 'plan') {
      ({ event, warnings } = buildPlanEvent(input, {
        events, replace, dir, verify, clock, cachedLeaves,
      }));
    } else if (kind === 'reject') event = buildRejectEvent(input, { clock });
    else if (kind === 'book') event = buildBookEvent(input, { clock });
    else throw new Error(`unknown event "${kind}" (plan, reject or book)`);

    const stale = kind === 'plan' ? events.filter((e) => isActivePlan(e) && e.name === event.name) : [];
    if (stale.length) {
      // The old line stays, marked; the file is rewritten whole, under the lock.
      const lines = raw.map((line, i) => {
        const old = events[i];
        if (!old || !stale.some((s) => s._line === old._line)) return line;
        const { _line, ...clean } = old;
        return JSON.stringify({ ...clean, superseded: event.at });
      });
      lines.push(JSON.stringify(event));
      await writeFileAtomic(files.jsonl, `${lines.join('\n')}\n`);
    } else {
      await appendRetry(files.jsonl, `${JSON.stringify(event)}\n`, { clock });
    }
    const after = readLog(files.jsonl).events;
    await writeReport(files, after, clock);
    if (kind === 'plan') {
      for (const v of summarize(after).violations.filter((x) => x.names.includes(event.name))) {
        warnings.push(`this plan takes ${violationText(v)} over the cap of ${v.cap}: log no more plans there, and tell the orchestrator`);
      }
    }
    return { event, warnings, files };
  } finally {
    release();
  }
};

/** Regenerates sources.md from the log, under the lock, and returns the events. */
export const regenerate = async ({ dir = realDir(), clock = realClock } = {}) => {
  const files = sourcesFiles(dir);
  const release = await acquireLock(files.lock, lockOptions(clock));
  try {
    const { events } = readLog(files.jsonl);
    await writeReport(files, events, clock);
    return { events, files };
  } finally {
    release();
  }
};
