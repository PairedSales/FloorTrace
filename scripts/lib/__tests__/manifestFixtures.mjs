// Frozen synthetic plans and a whole finished set of 400, for the manifest tests.
// Not a test file: the suites import it.
import { applyPlan } from '../realKeys.mjs';
import { KEY, makeSet, newPlan, planEvent, writeLog } from './pipelineHarness.mjs';

export const CHECKED = { by: 'AI review', at: '2026-09-29T10:00:00.000Z', via: 'final review' };

/** A plan as `apply` leaves it: the key written, the record checked. */
export const frozenPlan = (name, {
  source = null, dims = 1, by = 'annotators: a-1, b-1; adjudicator: none', verifiedBy = 'blind double annotation', extra = {},
} = {}) => {
  const project = newPlan(name, { source, dims });
  applyPlan(project, KEY, {
    by, verifiedBy, checked: CHECKED, at: '2026-09-29T10:00:00.000Z', notes: 'House with an attached garage.', ...extra,
  }, { force: true });
  return project;
};

const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
const stem = (prefix, i, yy) => `${prefix}${LETTERS[i % 26]}${LETTERS[Math.floor(i / 26)]}${String(yy).padStart(2, '0')}`;
const wayback = (n) => `https://web.archive.org/web/20210101000000id_/https://builder.example/plans/${n}.png`;
const source = (url) => ({ url, crop: [0, 0, 460, 300], size: [460, 300] });

/**
 * A finished set: 17 books of 75 plans that predate the log (embedded images),
 * 21 more plan books (165 plans) and 16 modern sites (160 plans), every plan
 * frozen; the log written for the 325 new ones. Returns `{set, names}`. Splits and
 * the manifest are the caller's to make.
 */
export const finishedSet = ({ modernBooks = 16, perBook = 10 } = {}) => {
  const set = makeSet();
  const events = [];
  const names = [];
  const add = (name, project) => {
    set.addPlan(name, project);
    names.push(name);
  };
  const legacyPlans = [5, 5, 5, 5, 5, 5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 4, 3];
  const legacyYears = [14, ...Array(8).fill(57), ...Array(8).fill(62)];
  legacyPlans.forEach((n, i) => {
    for (let k = 1; k <= n; k += 1) add(`${stem('leg', i, legacyYears[i])}-n${k}`, frozenPlan(`${stem('leg', i, legacyYears[i])}-n${k}`));
  });
  const newPlans = [...Array(12).fill(8), ...Array(6).fill(9), ...Array(3).fill(5)];
  const decades = [1900, 1910, 1920, 1930, 1940, 1950, 1960];
  newPlans.forEach((n, i) => {
    const decade = decades[i % decades.length];
    const yy = (decade % 100) + 3;
    const prefix = stem('vin', i, yy);
    for (let k = 1; k <= n; k += 1) {
      const name = `${prefix}-n${k}`;
      const url = `https://archive.org/download/${prefix}/page/n${k}`;
      add(name, frozenPlan(name, { source: source(url) }));
      events.push(planEvent(name, {
        book: `Book ${prefix}`, publisher: `Press ${i % 5}`, year: 1900 + yy, decade, leaf: k, url,
      }));
    }
  });
  for (let i = 0; i < modernBooks; i += 1) {
    const prefix = stem('mod', i, 21);
    for (let k = 1; k <= perBook; k += 1) {
      const name = `${prefix}-${1000 + k}`;
      const url = wayback(name);
      add(name, frozenPlan(name, { source: source(url) }));
      events.push(planEvent(name, {
        book: `Site ${prefix}`, publisher: `Builder ${i}`, era: '2020-2022', year: 2021, decade: 2020, leaf: null, url, site: `${prefix}.example`,
      }));
    }
  }
  writeLog(set, events);
  return { set, names };
};
