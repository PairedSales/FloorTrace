// The commands of scripts/realSource.mjs, as functions of a context
// `{dir, root, out, net, clock, env}` (the set folder, the checkout, a line
// printer, the network layer, a clock), so the tests run each one against a
// scratch folder and a fake network. The CLI in realSource.mjs only parses the
// command name and prints errors; the manual is its header.
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { renderView } from './keyView.mjs';
import { writeFileAtomic } from './keyFiles.mjs';
import {
  HttpError, acquireLock, createNet, realClock, sniffImage,
} from './sourceNet.mjs';
import {
  UsageError, cachedLeafCount, checkItemId, checkLeaf, cdxUrl, countScandataLeaves, expandQuery, filterCdx, formatCdxRow, formatSearchRow, itemFileUrl,
  judgeViewable, leafUrl, metadataUrl, parseCdx, parseMetadata, parseSearch, parseYearRange, searchUrl, testLeafOf,
} from './sourceArchive.mjs';
import { logEvent, regenerate, summaryLines } from './sourceLog.mjs';

// ---- arguments ---------------------------------------------------------------

// A command line the tool cannot read at all (exit status 2): an unknown
// option, a missing argument, a value of the wrong form. Well formed and
// failing (the network, a refused URL, a log entry the validators refuse) is
// exit status 1. The class lives in sourceArchive.mjs, whose value checks throw it.
export { UsageError };

/**
 * `argv` split by a command's `{values, flags}`: positional arguments, and
 * `opts` (a value option once, a flag as true). An option the command does not
 * have is an error, never a positional argument.
 */
const parseArgs = (argv, { values = [], flags = [] }, command = 'command') => {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (flags.includes(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      opts[name] = true;
    } else if (values.includes(name)) {
      let value = inline;
      if (value === undefined) {
        i += 1;
        value = argv[i];
        // A value may start with "-" (a negative number) but not with "--".
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      }
      opts[name] = value;
    } else {
      const known = [...values, ...flags].map((n) => `--${n}`).join(' ');
      throw new UsageError(`unknown option --${name} (${command} takes: ${known || 'no options'})`);
    }
  }
  return { positional, opts };
};

const need = (positional, count, usage) => {
  if (positional.length < count) throw new UsageError(`usage: ${usage}`);
  return positional;
};

const intOpt = (opts, name, fallback, { min = 0, max = Infinity } = {}) => {
  if (opts[name] === undefined) return fallback;
  const n = Number(opts[name]);
  if (!Number.isInteger(n) || n < min || n > max) throw new UsageError(`--${name} must be a whole number from ${min}${max === Infinity ? '' : ` to ${max}`}`);
  return n;
};

const tagOf = (opts) => {
  const tag = opts.tag ?? 'default';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) throw new UsageError(`--tag "${tag}" must be letters, digits, . _ - only`);
  return tag;
};

const numbers = (text, count, what) => {
  const parts = String(text).split(',').map((s) => Number(s.trim()));
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) throw new UsageError(`${what} must be ${count} comma-separated numbers (got "${text}")`);
  return parts;
};

const netOf = (ctx) => {
  ctx.net ??= createNet({ env: ctx.env, log: (line) => (ctx.err ?? console.error)(line) });
  return ctx.net;
};
const clockOf = (ctx) => ctx.clock ?? realClock;

// A leaf past the end of a book is no error to archive.org: it answers
// `page/n<k>` for any k with HTTP 200 and the last page's image, so a mistyped
// leaf looks like a real page that is not the one meant. The book's leaf count
// is what tells; it is read from cached metadata only (`meta ID` caches it),
// never by a request of its own.
const leafCountOf = (id, ctx) => cachedLeafCount(id, (url) => netOf(ctx).peekText(url));
const pastTheEnd = (id, n, count) => `leaf ${n} is past the end of ${id}: it has ${count} leaves (0..${count - 1}, from its cached metadata), and archive.org answers a leaf past the last with the last page; nothing was fetched or cached (\`meta ${id} --refresh\` if the count is wrong)`;
const unknownCount = (id) => `note: ${id} has no cached metadata, so a leaf past its end cannot be noticed (archive.org answers one with the last page): run \`meta ${id}\` first`;
const viewsDir = (ctx, tag) => path.join(ctx.root, 'datasets', 'zz-scratch', 'views', tag);
const size = (n) => n.toLocaleString('en-US');

// The pixel size of an image file, without holding the image.
const pixelSize = async (file) => {
  const image = await loadImage(file);
  return [image.width, image.height];
};

// ---- search ------------------------------------------------------------------

const SEARCH_SPEC = { values: ['rows', 'year', 'page', 'sort'], flags: ['refresh', 'raw'] };

const search = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, SEARCH_SPEC, 'search');
  const [query] = need(positional, 1, 'search QUERY [--rows N] [--year FROM-TO] [--page N] [--sort "downloads desc"] [--raw]');
  const url = searchUrl(query, {
    rows: intOpt(opts, 'rows', 20, { min: 1, max: 100 }),
    years: opts.year ? parseYearRange(opts.year) : undefined,
    page: intOpt(opts, 'page', 1, { min: 1 }),
    sort: opts.sort,
    raw: Boolean(opts.raw),
  });
  // parseSearch throws on archive.org's `{"error": ...}` answer to a bad query,
  // and as the validator it keeps that answer out of the cache.
  const { json, cached } = await netOf(ctx).fetchJson(url, { refresh: Boolean(opts.refresh), validate: parseSearch });
  const { found, rows } = parseSearch(json);
  ctx.out(`query: ${expandQuery(query, { raw: Boolean(opts.raw) })}${opts.year ? `  (years ${opts.year})` : ''}`);
  ctx.out(`${found} texts match; showing ${rows.length}${cached ? ' (from the cache; --refresh asks again)' : ''}`);
  for (const r of rows) ctx.out(formatSearchRow(r));
  if (rows.length) ctx.out('borrow-only items answer a page with 403: `meta ID` tests one before you rely on it');
  return 0;
};

// ---- meta --------------------------------------------------------------------

const META_SPEC = { values: [], flags: ['refresh'] };

// An item's metadata, and its leaf count: the metadata's imagecount, else the
// count its _scandata.xml states.
const itemInfo = async (id, ctx, { refresh = false } = {}) => {
  const net = netOf(ctx);
  const { json } = await net.fetchJson(metadataUrl(id), { refresh });
  const info = parseMetadata(json, id);
  let leavesFrom = info.leaves === null ? null : 'the metadata\'s imagecount';
  if (info.leaves === null && info.scandata) {
    const { text } = await net.fetchText(itemFileUrl(id, info.scandata), { refresh });
    info.leaves = countScandataLeaves(text);
    if (info.leaves !== null) leavesFrom = 'the item\'s _scandata.xml';
  }
  return { info, leavesFrom };
};

const meta = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, META_SPEC, 'meta');
  const [id] = need(positional, 1, 'meta ID');
  checkItemId(id);
  const { info, leavesFrom } = await itemInfo(id, ctx, { refresh: Boolean(opts.refresh) });
  const leaf = testLeafOf(info.leaves);
  const url = leafUrl(id, leaf);
  let test;
  let tested = '';
  try {
    const got = await netOf(ctx).fetchImage(url);
    const [w, h] = await pixelSize(got.file);
    test = { leaf, ok: true, what: `${got.mime} ${w}x${h}` };
    tested = `${got.cached ? 'cached' : 'downloaded'}: ${got.file}`;
  } catch (error) {
    test = { leaf, ok: false, what: error instanceof HttpError ? `HTTP ${error.status} from ${new URL(error.url).host}` : error.message };
  }
  const { viewable, reasons } = judgeViewable({ restricted: info.restricted, lending: info.lending, test });
  ctx.out(`id: ${info.id}`);
  ctx.out(`title: ${info.title}`);
  ctx.out(`year: ${info.year ?? 'unknown'}   creator: ${info.creator || '-'}   publisher: ${info.publisher || '-'}`);
  ctx.out(`mediatype: ${info.mediatype ?? '-'}   collections: ${info.collections.join(', ') || '-'}`);
  ctx.out(`leaves: ${info.leaves ?? 'unknown (the metadata gives no imagecount and there is no _scandata.xml to count)'}${leavesFrom && info.leaves !== null ? ` (from ${leavesFrom})` : ''}`);
  ctx.out(`borrow-only flag (access-restricted-item): ${info.restricted ? 'YES' : 'no'}`);
  ctx.out(`lending collections: ${info.lending.length ? info.lending.join(', ') : 'none'}`);
  ctx.out(`page test: leaf ${leaf}, ${url} -> ${test.ok ? `200 ${test.what}` : test.what}${tested ? ` (${tested})` : ''}`);
  ctx.out(`page images: https://archive.org/download/${id}/page/n<leaf>  (the full-resolution page; leaves 0..${info.leaves === null ? '?' : info.leaves - 1})`);
  ctx.out(viewable ? 'viewable: YES (pages are public)' : `viewable: NO (${reasons.join('; ')})`);
  if (!viewable) {
    (ctx.err ?? console.error)(`meta: ${id} is not viewable: ${reasons.join('; ')}`);
    return 1;
  }
  return 0;
};

// ---- leaf --------------------------------------------------------------------

const LEAF_SPEC = { values: ['ext'], flags: [] };

const leaf = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, LEAF_SPEC, 'leaf');
  const [id, n] = need(positional, 2, 'leaf ID N [--ext jpg]');
  const number = checkLeaf(n);
  const count = leafCountOf(checkItemId(id), ctx);
  if (count !== null && number >= count) throw new Error(pastTheEnd(id, number, count));
  const got = await netOf(ctx).fetchImage(leafUrl(id, number, opts.ext));
  const [w, h] = await pixelSize(got.file);
  ctx.out(got.file);
  ctx.out(`${w}x${h} px  ${got.mime}  ${size(got.size)} bytes  ${got.cached ? 'from the cache' : 'downloaded'}`);
  ctx.out(`source URL to record: ${leafUrl(id, number)}`);
  if (count === null) ctx.out(unknownCount(id));
  return 0;
};

// ---- contact -----------------------------------------------------------------

const CONTACT_SPEC = { values: ['step', 'cols', 'rows', 'tag'], flags: [] };
const SHEET_WIDTH = 1600;
const MAX_CONTACT_LEAVES = 96;

/** The leaves FROM..TO, every `step`-th. */
export const leafRange = (from, to, step = 1) => {
  const out = [];
  for (let n = from; n <= to; n += step) out.push(n);
  return out;
};

/**
 * Contact sheets of pages: each page shrunk to its cell and labelled with its
 * leaf number, `cols` across and `rows` down (12 to a sheet by default, so a
 * sheet is about 1,600 px each way and the picture tool shows it near whole).
 * `load(leaf)` gives `{file}` or `{error}`. Returns
 * `[{png, leaves, failed}]`, one per sheet.
 */
const drawContactSheets = async ({
  leaves, cols = 4, rows = 3, title = '', load,
}) => {
  const cellW = Math.floor(SHEET_WIDTH / cols);
  const cellH = Math.round(cellW * 1.3);
  const head = 30;
  const per = cols * rows;
  const sheets = [];
  for (let s = 0; s < leaves.length; s += per) {
    const chunk = leaves.slice(s, s + per);
    const rowsUsed = Math.ceil(chunk.length / cols);
    const canvas = createCanvas(cols * cellW, head + rowsUsed * cellH);
    const g = canvas.getContext('2d');
    g.fillStyle = '#777';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#222';
    g.fillRect(0, 0, canvas.width, head);
    g.fillStyle = '#fff';
    g.font = 'bold 16px sans-serif';
    g.textBaseline = 'middle';
    g.fillText(`${title}   sheet ${Math.floor(s / per) + 1} of ${Math.ceil(leaves.length / per)}`, 10, head / 2);
    g.textBaseline = 'alphabetic';
    g.imageSmoothingQuality = 'high';
    const failed = [];
    for (const [k, n] of chunk.entries()) {
      const x = (k % cols) * cellW;
      const y = head + Math.floor(k / cols) * cellH;
      g.fillStyle = '#bbb';
      g.fillRect(x + 2, y + 2, cellW - 4, cellH - 4);
      const got = await load(n);
      if (got.file) {
        const image = await loadImage(got.file);
        const scale = Math.min((cellW - 8) / image.width, (cellH - 8) / image.height);
        g.drawImage(image, x + 4, y + 4, image.width * scale, image.height * scale);
      } else {
        failed.push(n);
        g.fillStyle = '#a00';
        g.font = '15px sans-serif';
        String(got.error).match(/.{1,34}/g)?.slice(0, 6).forEach((line, i) => g.fillText(line, x + 10, y + 70 + i * 18));
      }
      const tag = `n${n}`;
      g.font = `bold ${Math.max(16, Math.round(cellW / 16))}px sans-serif`;
      const tw = g.measureText(tag).width + 14;
      g.fillStyle = '#d00';
      g.fillRect(x + 4, y + 4, tw, Math.round(cellW / 12));
      g.fillStyle = '#fff';
      g.fillText(tag, x + 11, y + 4 + Math.round(cellW / 12) - 7);
    }
    sheets.push({ png: canvas.toBuffer('image/png'), leaves: chunk, failed });
  }
  return sheets;
};

const contact = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, CONTACT_SPEC, 'contact');
  const [id, fromText, toText] = need(positional, 3, 'contact ID FROM TO [--step S] [--cols C] [--rows R] [--tag T]');
  checkItemId(id);
  const from = checkLeaf(fromText);
  const to = checkLeaf(toText);
  if (to < from) throw new UsageError('contact: TO must not be below FROM');
  const step = intOpt(opts, 'step', 1, { min: 1 });
  const cols = intOpt(opts, 'cols', 4, { min: 1, max: 8 });
  const rows = intOpt(opts, 'rows', 3, { min: 1, max: 6 });
  const tag = tagOf(opts);
  const requested = leafRange(from, to, step);
  // Leaves past the end of the book would each come back as the last page.
  const count = leafCountOf(id, ctx);
  const leaves = count === null ? requested : requested.filter((n) => n < count);
  if (!leaves.length) throw new Error(pastTheEnd(id, requested[0], count));
  if (leaves.length > MAX_CONTACT_LEAVES) {
    throw new UsageError(`contact: ${leaves.length} leaves is over ${MAX_CONTACT_LEAVES} in one call (each is a ~4 MB download the first time): use --step, or ask for a smaller range`);
  }
  const net = netOf(ctx);
  const sheets = await drawContactSheets({
    leaves,
    cols,
    rows,
    title: `${id}  leaves ${from}-${to}${step > 1 ? ` step ${step}` : ''}`,
    load: async (n) => {
      try {
        return await net.fetchImage(leafUrl(id, n));
      } catch (error) {
        return { error: `n${n}: ${error.message}` };
      }
    },
  });
  if (leaves.length < requested.length) {
    const past = requested.slice(leaves.length);
    ctx.out(`WARNING: leaves n${past[0]}..n${past.at(-1)} are past the end of ${id} (${count} leaves, 0..${count - 1}, from its cached metadata): skipped, nothing was fetched or cached for them`);
  }
  const paths = [];
  for (const [i, sheet] of sheets.entries()) {
    const name = `contact-${id}-${from}-${to}${step > 1 ? `-s${step}` : ''}${sheets.length > 1 ? `-p${i + 1}` : ''}.png`;
    const out = path.join(viewsDir(ctx, tag), name);
    await writeFileAtomic(out, sheet.png);
    paths.push(out);
    ctx.out(out);
    ctx.out(`leaves ${sheet.leaves.map((n) => `n${n}`).join(' ')}${sheet.failed.length ? `   (could not fetch: ${sheet.failed.map((n) => `n${n}`).join(' ')})` : ''}`);
  }
  if (count === null) ctx.out(unknownCount(id));
  const failedAll = sheets.every((s) => s.failed.length === s.leaves.length);
  if (failedAll) {
    (ctx.err ?? console.error)(`contact: no leaf could be fetched (is ${id} borrow-only? \`meta ${id}\` tests it)`);
    return 1;
  }
  return 0;
};

// ---- grid --------------------------------------------------------------------

const GRID_SPEC = { values: ['crop', 'grid', 'tag'], flags: [] };

/** `ID:N` (leaf N of item ID) or an image file. */
const resolveImage = async (target, ctx) => {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    return { file: target, label: path.basename(target).replace(/\.[^.]+$/, '') };
  }
  const m = /^([A-Za-z0-9][A-Za-z0-9._-]*):(\d+)$/.exec(target);
  if (!m) throw new UsageError(`${target} is not an image file or ID:LEAF (an item's identifier, a colon and a leaf number)`);
  const count = leafCountOf(m[1], ctx);
  if (count !== null && Number(m[2]) >= count) throw new Error(pastTheEnd(m[1], Number(m[2]), count));
  const got = await netOf(ctx).fetchImage(leafUrl(m[1], Number(m[2])));
  return { file: got.file, label: `${m[1]}-n${m[2]}`, unknownCount: count === null ? m[1] : null };
};

const grid = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, GRID_SPEC, 'grid');
  const [target] = need(positional, 1, 'grid IMAGE|ID:LEAF [--crop X0,Y0,X1,Y1] [--grid STEP] [--tag T]');
  const tag = tagOf(opts);
  let crop;
  if (opts.crop) {
    crop = numbers(opts.crop, 4, '--crop');
    if (!(crop[2] > crop[0] && crop[3] > crop[1])) throw new UsageError('--crop X0,Y0,X1,Y1 needs X1 > X0 and Y1 > Y0');
  }
  const step = opts.grid === undefined ? undefined : Number(opts.grid);
  if (step !== undefined && !(step >= 0)) throw new UsageError('--grid must be a number of pixels (0 for none)');
  const { file, label, unknownCount: unknownIn } = await resolveImage(target, ctx);
  const bytes = fs.readFileSync(file);
  if (!sniffImage(bytes)) throw new Error(`${file} is not an image`);
  const { png, summary } = await renderView(bytes, { crop, grid: step });
  const [x0, y0, x1, y1] = summary.crop;
  const parts = [label];
  if (crop) parts.push(`${Math.round(x0)}_${Math.round(y0)}_${Math.round(x1)}_${Math.round(y1)}`);
  if (step !== undefined) parts.push(`g${step}`);
  const out = path.join(viewsDir(ctx, tag), `${parts.join('-')}.png`);
  await writeFileAtomic(out, png);
  ctx.out(out);
  ctx.out(summary.line);
  if (unknownIn) ctx.out(unknownCount(unknownIn));
  return 0;
};

// ---- screen ------------------------------------------------------------------

const SCREEN_SPEC = { values: ['samples', 'leaves'], flags: [] };

const SCREEN_WARNING = 'WARNING: the label count may help find books that print room sizes in type. It must never be used to drop a page that qualifies '
  + '(integrity rule 6): pages the app reads badly are the point.';

/** `n` leaves spread through a book of `count` leaves, away from the covers and the back matter. */
const sampleLeaves = (count, samples) => {
  const out = [];
  for (let i = 0; i < samples; i += 1) {
    const f = samples === 1 ? 0.45 : 0.12 + (i * 0.66) / (samples - 1);
    const n = Math.max(1, Math.min(Math.max(1, count - 3), Math.max(3, Math.round(count * f))));
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

const parseLeafList = (text) => {
  const leaves = String(text).split(',').map((s) => s.trim().replace(/^n/i, '')).filter(Boolean).map(checkLeaf);
  if (!leaves.length) throw new UsageError('--leaves needs leaf numbers, like 12,40,n77');
  return leaves;
};

const screen = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, SCREEN_SPEC, 'screen');
  const [id] = need(positional, 1, 'screen ID [--samples 5] [--leaves n1,n2,...]');
  checkItemId(id);
  const net = netOf(ctx);
  let leaves;
  let count = null;
  if (opts.leaves) leaves = parseLeafList(opts.leaves);
  else {
    ({ info: { leaves: count } } = await itemInfo(id, ctx));
    if (!count) throw new Error(`${id} states no leaf count, so it cannot be sampled: name the pages with --leaves`);
    leaves = sampleLeaves(count, intOpt(opts, 'samples', 5, { min: 1, max: 20 }));
  }
  // Sampled leaves are inside the book by construction; named ones may not be.
  const end = count ?? leafCountOf(id, ctx);
  ctx.out(SCREEN_WARNING);
  // The scan is the app's own, and it is CPU-heavy: one at a time, here and in
  // any other process, since a scan that loses a CPU race drops labels
  // silently. Loaded only now: importing it pulls in the whole pipeline.
  const { scanImage, terminateOcrWorker } = await import('./realDraft.mjs');
  const { decodeImage } = await import('./benchUtils.mjs');
  const counts = [];
  try {
    for (const n of leaves) {
      if (end !== null && n >= end) {
        ctx.out(`n${n}: past the end of ${id} (${end} leaves): skipped, nothing was fetched`);
        continue;
      }
      let got;
      try {
        got = await net.fetchImage(leafUrl(id, n));
      } catch (error) {
        ctx.out(`n${n}: could not fetch (${error.message})`);
        continue;
      }
      const release = await acquireLock(path.join(net.dir, '.scan.lock'), {
        clock: clockOf(ctx), staleMs: 30 * 60 * 1000, pollMs: 1000,
      });
      try {
        const started = Date.now();
        const image = await decodeImage(fs.readFileSync(got.file), got.mime);
        const scan = await scanImage(image);
        counts.push(scan.dimensions.length);
        ctx.out(`n${n}: ${scan.dimensions.length} labels${scan.truncated ? ` (${scan.truncated} regions cut off: the scan lost time; run it again when the machine is quiet)` : ''}, ${Date.now() - started} ms`);
      } finally {
        release();
      }
    }
  } finally {
    await terminateOcrWorker();
  }
  if (counts.length) {
    const total = counts.reduce((a, b) => a + b, 0);
    ctx.out(`${id}${count ? ` [${count} leaves]` : ''}: ${counts.length} pages scanned, labels read per page ${counts.join(' ')} (mean ${(total / counts.length).toFixed(1)}); ${counts.filter((c) => c >= 3).length} of ${counts.length} pages read 3 or more`);
  }
  ctx.out(SCREEN_WARNING);
  return 0;
};

// ---- cdx ---------------------------------------------------------------------

const CDX_SPEC = {
  values: ['from', 'to', 'mime', 'status', 'collapse', 'limit', 'match', 'min-length', 'pattern', 'scan'], flags: ['refresh'],
};

const cdx = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, CDX_SPEC, 'cdx');
  const [prefix] = need(positional, 1, 'cdx URL_PREFIX [--from 2020] [--to 2022] [--mime image/] [--status 200] [--collapse urlkey] [--limit N] [--match prefix|exact|domain] [--min-length BYTES] [--pattern REGEX]');
  const limit = intOpt(opts, 'limit', 20, { min: 1, max: 10000 });
  const minLength = intOpt(opts, 'min-length', 0, { min: 0 });
  let pattern;
  if (opts.pattern) {
    try {
      pattern = new RegExp(opts.pattern);
    } catch (error) {
      throw new UsageError(`--pattern is not a regular expression: ${error.message}`);
    }
  }
  // The index cuts at `limit` before a length filter can see the rows, so a
  // length filter reads more of the index than it keeps.
  const scanLimit = minLength ? intOpt(opts, 'scan', Math.min(10000, Math.max(limit * 10, 200)), { min: limit, max: 10000 }) : limit;
  const from = opts.from ?? '2020';
  const to = opts.to ?? '2022';
  const url = cdxUrl({
    prefix, from, to, mime: opts.mime, status: opts.status, collapse: opts.collapse, limit: scanLimit, match: opts.match, pattern: opts.pattern,
  });
  const { json, cached } = await netOf(ctx).fetchJson(url, { emptyOk: true, refresh: Boolean(opts.refresh) });
  const rows = parseCdx(json);
  const kept = filterCdx(rows, {
    minLength, pattern, from, to,
  }).slice(0, limit);
  ctx.out(`${rows.length} rows read, ${kept.length} kept (${from} to ${to}${minLength ? `, at least ${size(minLength)} bytes` : ''}${pattern ? `, URL matching ${pattern}` : ''})${cached ? ' (from the cache; --refresh asks again)' : ''}`);
  for (const r of kept) ctx.out(formatCdxRow(r));
  if (rows.length >= scanLimit && kept.length < limit) ctx.out(`the index may hold more: this read its first ${scanLimit} rows (--scan N reads more, --limit N keeps more)`);
  if (kept.length) ctx.out('the second line of each row is the URL that returns the capture\'s original bytes: record it as the plan\'s source');
  return 0;
};

// ---- fetch -------------------------------------------------------------------

const FETCH_SPEC = { values: ['name'], flags: [] };

const fetchCommand = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, FETCH_SPEC, 'fetch');
  const [url] = need(positional, 1, 'fetch URL [--name N]');
  if (opts.name !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(opts.name)) throw new UsageError(`--name "${opts.name}" must be letters, digits, . _ - only`);
  const net = netOf(ctx);
  const got = await net.fetchImage(url);
  const [w, h] = await pixelSize(got.file);
  let named = null;
  if (opts.name) {
    named = path.join(net.dir, 'named', `${opts.name}${path.extname(got.file)}`);
    const bytes = fs.readFileSync(got.file);
    if (fs.existsSync(named)) {
      if (!fs.readFileSync(named).equals(bytes)) throw new Error(`${named} already holds a different image: pick another --name`);
    } else await writeFileAtomic(named, bytes);
  }
  ctx.out(got.file);
  if (named) ctx.out(named);
  ctx.out(`${got.mime}  ${w}x${h} px  ${size(got.size)} bytes  ${got.cached ? 'from the cache' : 'downloaded'}`);
  ctx.out(`source URL: ${got.url}`);
  return 0;
};

// ---- log and report ----------------------------------------------------------

const LOG_SPECS = {
  plan: {
    values: ['name', 'book', 'publisher', 'era', 'year', 'decade', 'leaf', 'url', 'crop', 'size', 'line', 'tag', 'unit', 'site'], flags: ['replace', 'no-verify'],
  },
  reject: { values: ['book', 'leaf', 'url', 'reason', 'tag'], flags: [] },
  book: { values: ['book', 'id', 'publisher', 'year', 'leaves', 'note'], flags: [] },
};

const logCommand = async (argv, ctx) => {
  const [kind, ...rest] = argv;
  if (!LOG_SPECS[kind]) throw new UsageError('usage: log plan|reject|book [options] (--help lists them)');
  const { opts } = parseArgs(rest, LOG_SPECS[kind], `log ${kind}`);
  const { event, warnings, files } = await logEvent(kind, opts, {
    dir: ctx.dir,
    clock: clockOf(ctx),
    replace: Boolean(opts.replace),
    verify: !opts['no-verify'],
    cachedLeaves: (id) => cachedLeafCount(id, (url) => netOf(ctx).peekText(url)),
  });
  const what = kind === 'plan' ? event.name : (kind === 'reject' ? `${event.book} ${event.leaf !== null ? `leaf ${event.leaf}` : event.url} (${event.reason})` : event.book);
  ctx.out(`logged ${kind} ${what}`);
  for (const w of warnings) ctx.out(`WARNING: ${w}`);
  ctx.out(files.jsonl);
  ctx.out(files.md);
  return 0;
};

const report = async (argv, ctx) => {
  parseArgs(argv, { values: [], flags: [] }, 'report');
  const { events, files } = await regenerate({ dir: ctx.dir, clock: clockOf(ctx) });
  for (const line of summaryLines(events)) ctx.out(line);
  ctx.out(files.md);
  return 0;
};

export const COMMANDS = {
  search, meta, leaf, contact, grid, screen, cdx, fetch: fetchCommand, log: logCommand, report,
};
