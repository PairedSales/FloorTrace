// Which plans a pipeline command works on: the selectors every command shares
// (`--names A,B`, `--book X`, `--split dev|test`, `--all`) and the quiet context
// that lets a command call the key tool's own commands without their output.
//
// Selectors combine as filters: `--names` (or bare plan names) picks exactly
// those plans, else every plan; `--book` and `--split` then keep the plans in
// that book and that split. With none of the four the command refuses, listing
// them: a batch over the whole set must be asked for by `--all`.
import { SPLITS } from './manifest.mjs';
import { UsageError, parseArgs } from './keyCommands.mjs';
import { checkName } from './keyFiles.mjs';
import { listPlans } from './pipelineCatalog.mjs';

export { parseArgs, UsageError };

export const SELECT = { repeat: ['names'], values: ['book', 'split'], flags: ['all'] };

/** A command's argument spec with the selectors added. */
export const withSelect = ({ values = [], repeat = [], flags = [] } = {}) => ({
  values: [...SELECT.values, ...values],
  repeat: [...SELECT.repeat, ...repeat],
  flags: [...SELECT.flags, ...flags],
});

export const SELECTOR_HELP = 'select plans with --names A,B (or plan names), --book X, --split dev|test, or --all';

/**
 * The plan names a command applies to, sorted. `alsoAll` lists flags that
 * count as `--all` for this command (`--all-existing`). `explicit` says the
 * caller named plans, so a command may treat a plan it cannot handle as an
 * error rather than one to pass over.
 */
export const selectPlans = ({ positional = [], opts }, ctx, catalog, { alsoAll = [] } = {}) => {
  const named = [...positional, ...(opts.names ?? []).flatMap((s) => s.split(','))].map((s) => s.trim()).filter(Boolean);
  const broad = Boolean(opts.all) || alsoAll.some((f) => opts[f]);
  if (!named.length && !opts.book && !opts.split && !broad) throw new UsageError(SELECTOR_HELP);
  const all = listPlans(ctx.dir);
  let names = all;
  if (named.length) {
    const unique = [...new Set(named)];
    unique.forEach(checkName);
    const missing = unique.filter((n) => !all.includes(n));
    if (missing.length) throw new Error(`no plan named ${missing.join(', ')} in ${ctx.dir}`);
    names = unique;
  }
  if (opts.split) {
    if (!SPLITS.includes(opts.split)) throw new UsageError(`--split must be ${SPLITS.join(' or ')} (got "${opts.split}")`);
    if (!catalog.hasSplitSource()) {
      const why = catalog.errors.splits ?? catalog.errors.manifest;
      throw new Error(`--split needs orchestration/manifest.json or splits.json (run realManifest assign-splits --write)${why ? `: ${why.message}` : ''}`);
    }
    names = names.filter((n) => catalog.infoOf(n).split === opts.split);
  }
  if (opts.book) {
    const inBook = names.filter((n) => catalog.matchesBook(n, opts.book));
    if (!inBook.length) throw new Error(`no plan in book ${opts.book} (books here: ${catalog.books(names).join(', ') || 'none'})`);
    names = inBook;
  }
  if (!names.length) throw new Error('the selection holds no plans');
  return [...names].sort();
};

/** Whether the caller named plans one by one. */
export const isExplicit = ({ positional = [], opts }) => positional.length > 0 || (opts.names ?? []).length > 0;

/** A context that collects what a key tool command prints, for the command that calls it. */
export const quiet = (ctx) => {
  const lines = [];
  return { ctx: { ...ctx, out: (line) => lines.push(line) }, lines };
};
