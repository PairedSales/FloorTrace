// What the pipeline tools know about each plan of the set besides its keys: its
// book, era, decade, publisher and split, read from the places they are kept
// (orchestration/manifest.json once frozen, splits.json before that,
// sources.jsonl for plans drafted by the sourcing tool) and, for the 75 plans
// that were in the set before the sourcing log existed, from their names. A plan
// counts as one of those 75 only when it has no line in the log AND no source of
// its own (`isLegacy`): a plan the sourcing tool drafted whose log line has not
// been written yet is not a vintage plan of 19yy because its name ends in two
// digits, and stays without an era until the log says what it is.
//
// The book of a plan is its cap UNIT (the sourcing log's own word): the name's
// stem for a plan-book page (`pacific25` of `pacific25-n41`), the designer code
// (`--unit`) on an aggregator site, else the logged book. Whole units go to one
// split, and at most 12 plans come from one. Two sites that use one designer
// code share a unit here: `unitClashes` finds them so a sourcer can rename one.
import fs from 'fs';
import path from 'path';
import { isActivePlan, nameStem, readLog, sourcesFiles } from './sourceLog.mjs';
import { loadManifest, manifestFileFor, hasPlan, SPLITS } from './manifest.mjs';
import { planFile, readJson } from './keyFiles.mjs';

// How the log compares book names (its own `keyOf`, which it does not export).
const textKey = (text) => String(text ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

export const orchDir = (dir) => path.join(dir, 'orchestration');
export const splitsFileFor = (dir) => path.join(orchDir(dir), 'splits.json');
export const disputesFileFor = (dir) => path.join(orchDir(dir), 'disputes.md');
export const manifestLogFor = (dir) => path.join(orchDir(dir), 'manifest-log.md');
export const manifestVersionsFor = (dir) => path.join(orchDir(dir), 'manifest-versions');

const EXT = '.floorplan';

/** The plans in the set folder (its top level only: `excluded/` is not the set), sorted. */
export const listPlans = (dir) => (fs.existsSync(dir)
  ? fs.readdirSync(dir).filter((f) => f.endsWith(EXT) && /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(f.slice(0, -EXT.length)))
    .map((f) => f.slice(0, -EXT.length)).sort()
  : []);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * `splits.json` (written by `realManifest assign-splits --write`): `{seed,
 * createdAt, books: {<book>: {split, era, decade, publisher, plans}}}`. Null
 * when there is none; an Error naming the problem when it is not that.
 */
export const readSplits = (dir) => {
  const file = splitsFileFor(dir);
  if (!fs.existsSync(file)) return null;
  const json = readJson(file);
  if (!isObject(json?.books)) throw new Error(`${file} is not a splits file: "books" is not an object`);
  for (const [book, b] of Object.entries(json.books)) {
    if (!isObject(b) || !SPLITS.includes(b.split)) throw new Error(`${file}: book ${JSON.stringify(book)} has split ${JSON.stringify(b?.split)}, not ${SPLITS.join(' or ')}`);
  }
  return json;
};

// The year of a plan the log knows nothing of, from the two digits in its name
// (`aladdin62-n15`, `dwellings14-p101`): the 75 plans that predate the log are
// all from 1914 to 1963, so a name with a year is a vintage plan of 19yy. A plan
// with no such digits (`listing-004`) has no year until something says. Only for
// a plan `isLegacy` vouches for: 2021 web captures are named the same way.
const legacyYear = (name) => {
  const stem = nameStem(name);
  return stem ? 1900 + Number(stem.slice(-2)) : null;
};

/**
 * The lookups over one set folder, read once: `logged` (active plan events by
 * name), `manifest`, `splits`, and `infoOf(name)`:
 * `{name, book, site, publisher, era, decade, year, split, logged}`.
 * A plan in the manifest takes its book, era and split from the manifest (the
 * frozen assignment); otherwise they are worked out from the log, splits.json
 * and the name. A manifest or splits file that cannot be read is kept as an
 * error and thrown only by what needs it. `manifest: false` reads no manifest:
 * `realManifest build` derives the manifest and must not derive it from itself.
 * `isLegacy(name)`: no line in the log and no source in the plan itself, so one
 * of the 75 that predate the log; `hasOwnSource(name)` reads the plan (once, and
 * only for a plan nothing else describes).
 */
export const loadCatalog = (dir, { manifest: useManifest = true } = {}) => {
  const { events } = readLog(sourcesFiles(dir).jsonl);
  const logged = new Map();
  const bookEvents = new Map();
  for (const e of events) {
    if (isActivePlan(e)) logged.set(e.name, e);
    else if (e?.event === 'book' && e.book) bookEvents.set(textKey(e.book), e);
  }
  let manifest = null;
  let splits = null;
  const errors = {};
  if (useManifest) {
    try {
      manifest = loadManifest(manifestFileFor(dir))?.manifest ?? null;
    } catch (error) {
      errors.manifest = error;
    }
  }
  try {
    splits = readSplits(dir);
  } catch (error) {
    errors.splits = error;
  }

  // A plan file that cannot be read counts as sourced: it is not one of the 75
  // until somebody can say so, and the command that needs the plan reports it.
  const sourced = new Map();
  const hasOwnSource = (name) => {
    if (!sourced.has(name)) {
      let own = true;
      try {
        own = Boolean(readJson(planFile(name, dir))?.source);
      } catch {
        // Unreadable: kept as sourced.
      }
      sourced.set(name, own);
    }
    return sourced.get(name);
  };
  const isLegacy = (name) => !logged.has(name) && !hasOwnSource(name);

  const unitOf = (name) => {
    const e = logged.get(name);
    if (e?.unit) return String(e.unit);
    return nameStem(name) ?? e?.book ?? name;
  };

  const infoOf = (name) => {
    const e = logged.get(name);
    const entry = hasPlan(manifest, name) ? manifest.plans[name] : null;
    const book = entry?.book ?? unitOf(name);
    // A plan in the manifest or the log is described by them; only a plan neither
    // knows takes a year from its name, and only when it is one of the 75.
    const year = e?.year ?? entry?.year ?? (e || entry || !isLegacy(name) ? null : legacyYear(name));
    const info = bookEvents.get(textKey(book)) ?? (e ? bookEvents.get(textKey(e.book)) : null);
    return {
      name,
      book,
      site: entry?.site ?? e?.site ?? null,
      publisher: entry?.publisher ?? e?.publisher ?? info?.publisher ?? null,
      era: entry?.era ?? e?.era ?? (year !== null ? 'vintage' : null),
      decade: entry?.decade ?? e?.decade ?? (year !== null ? Math.floor(year / 10) * 10 : null),
      year,
      split: entry?.split ?? splits?.books?.[book]?.split ?? null,
      logged: Boolean(e),
    };
  };

  // Which words select a book: its unit, the book it was logged under, its site.
  const matchesBook = (name, wanted) => {
    const w = textKey(wanted);
    const e = logged.get(name);
    return [infoOf(name).book, e?.book, e?.site].some((v) => v && textKey(v) === w);
  };

  // Units whose plans were logged under more than one site: one book here.
  const unitClashes = () => {
    const sites = new Map();
    for (const e of logged.values()) {
      if (!e.unit) continue;
      const set = sites.get(String(e.unit)) ?? sites.set(String(e.unit), new Set()).get(String(e.unit));
      set.add(e.site || e.book);
    }
    return [...sites].filter(([, set]) => set.size > 1).map(([unit, set]) => ({ unit, sites: [...set].sort() }));
  };

  return {
    dir, logged, manifest, splits, errors, unitOf, infoOf, matchesBook, unitClashes, isLegacy, hasOwnSource,
    // Whether anything says which split a plan is in.
    hasSplitSource: () => Boolean(manifest || splits),
    books: (names) => [...new Set(names.map((n) => infoOf(n).book))].sort(),
  };
};
