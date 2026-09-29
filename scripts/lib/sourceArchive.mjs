// What the sourcing tool asks archive.org and the Wayback Machine, and how it
// reads the answers (scripts/realSource.mjs). Pure: URLs are built and answers
// parsed here, and the network is elsewhere (sourceNet.mjs), so the tests hand
// in canned answers.
//
// Three archive.org facts this rests on, each seen on a real item:
//  - a page image is https://archive.org/download/ID/page/n<leaf> (a .jpg
//    suffix answers with the same bytes) and is the full-resolution scan;
//  - a borrow-only item has `access-restricted-item: "true"` in its metadata,
//    is in the `inlibrary` collection, and answers a page with 403 text/html;
//  - some items have no `imagecount` in their metadata; their `_scandata.xml`
//    names the leaf count instead.

export const ITEM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const checkItemId = (id) => {
  if (!ITEM_ID.test(String(id ?? ''))) throw new Error(`"${id ?? ''}" is not an archive.org identifier (letters, digits, . _ - only)`);
  return String(id);
};

// A leaf number: `49`, or `n49` as the page URLs and contact sheets write it.
export const checkLeaf = (n) => {
  const text = String(n ?? '').trim().replace(/^n(?=\d)/i, '');
  if (!/^\d{1,6}$/.test(text)) throw new Error(`leaf "${n ?? ''}" must be a whole number, 0 or more`);
  return Number(text);
};

const list = (value) => (Array.isArray(value) ? value : (value === undefined || value === null ? [] : [value]));
const text = (value) => list(value).map(String).join('; ');
const intOrNull = (value) => {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) ? n : null;
};
const yearOf = (...values) => {
  for (const v of values) {
    const m = /(\d{4})/.exec(String(v ?? ''));
    if (m) return Number(m[1]);
  }
  return null;
};

// ---- search ----------------------------------------------------------------

/** `1920-1959` or `1955` as `[from, to]`. */
export const parseYearRange = (value) => {
  const m = /^(\d{4})(?:\s*-\s*(\d{4}))?$/.exec(String(value).trim());
  if (!m) throw new Error(`--year "${value}" must be a year or FROM-TO years, like 1920-1959`);
  const from = Number(m[1]);
  const to = Number(m[2] ?? m[1]);
  if (to < from) throw new Error(`--year ${value}: the range runs backwards`);
  return [from, to];
};

const SEARCH_FIELDS = ['identifier', 'title', 'year', 'creator', 'imagecount', 'downloads', 'mediatype', 'access-restricted-item'];

/**
 * What is asked for a query. Plain words (`house plans`) must all be in the
 * title or the subject: sent as typed, archive.org matches any word anywhere
 * and the first hits are government memos that mention a house. Anything with
 * Lucene syntax (a quote, a field:, a parenthesis, AND/OR/NOT) is sent as
 * typed, and so is anything under `raw`.
 */
export const expandQuery = (query, { raw = false } = {}) => {
  const q = String(query ?? '').trim();
  if (!q) throw new Error('search needs a query, like "house plans"');
  const plain = /^[\p{L}\p{N}\s'-]+$/u.test(q) && !/\b(AND|OR|NOT)\b/.test(q);
  if (raw || !plain) return q;
  const words = `(${q.split(/\s+/).join(' AND ')})`;
  return `title:${words} OR subject:${words}`;
};

/**
 * The advanced-search URL for `query`, limited to texts and optionally to a
 * year range (see `expandQuery` for how the words are read).
 */
export const searchUrl = (query, {
  rows = 20, years, page = 1, sort, raw = false,
} = {}) => {
  const n = Math.max(1, Math.min(100, Math.floor(rows)));
  let q = `(${expandQuery(query, { raw })}) AND mediatype:texts`;
  if (years) q += ` AND year:[${years[0]} TO ${years[1]}]`;
  if (sort !== undefined && !/^[a-z]+( (asc|desc))?$/i.test(sort)) throw new Error(`--sort "${sort}" must be a field and optionally asc or desc, like "downloads desc"`);
  return `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}${SEARCH_FIELDS.map((f) => `&fl[]=${f}`).join('')}`
    + `&rows=${n}&page=${Math.max(1, Math.floor(page))}${sort ? `&sort[]=${encodeURIComponent(sort)}` : ''}&output=json`;
};

export const parseSearch = (json) => ({
  found: json?.response?.numFound ?? 0,
  rows: (json?.response?.docs ?? []).map((d) => ({
    identifier: d.identifier,
    title: text(d.title),
    year: d.year ?? null,
    creator: text(d.creator),
    imagecount: intOrNull(d.imagecount),
    downloads: d.downloads ?? null,
    restricted: /^(true|1|yes)$/i.test(String(d['access-restricted-item'] ?? '')),
  })),
});

export const formatSearchRow = (r) => `${r.identifier}  ${r.year ?? '----'}  ${r.imagecount === null ? '  ?' : String(r.imagecount).padStart(3)} leaves  `
  + `${r.title}${r.creator ? `  / ${r.creator}` : ''}${r.restricted ? '  [borrow-only]' : ''}`;

// ---- an item ---------------------------------------------------------------

export const metadataUrl = (id) => `https://archive.org/metadata/${checkItemId(id)}`;

/** The full-resolution page image of leaf `n` (the URL a plan records). */
export const leafUrl = (id, n, ext) => `https://archive.org/download/${checkItemId(id)}/page/n${checkLeaf(n)}${ext ? `.${String(ext).replace(/^\./, '')}` : ''}`;

// Collections that lend rather than serve: an item in one is borrow-only.
export const LENDING_COLLECTIONS = ['inlibrary', 'lendinglibrary'];

export const parseMetadata = (json, id) => {
  const m = json?.metadata;
  if (!m || (!m.identifier && !m.title)) throw new Error(`no item named ${id} (its metadata is empty)`);
  const collections = list(m.collection).map(String);
  const files = Array.isArray(json.files) ? json.files : [];
  return {
    id: m.identifier ?? id,
    title: text(m.title),
    year: yearOf(m.year, m.date),
    creator: text(m.creator),
    publisher: text(m.publisher),
    mediatype: m.mediatype ?? null,
    collections,
    restricted: /^(true|1|yes)$/i.test(String(m['access-restricted-item'] ?? '')),
    lending: collections.filter((c) => LENDING_COLLECTIONS.includes(c)),
    leaves: intOrNull(m.imagecount),
    scandata: files.find((f) => /_scandata\.xml$/i.test(f.name ?? ''))?.name ?? null,
  };
};

// The leaf count an item's `_scandata.xml` states: `<leafCount>`, else its
// `<page>` elements (`<pageData>` and `<pageNumData>` are not pages).
export const countScandataLeaves = (xml) => {
  const stated = /<leafCount>\s*(\d+)\s*<\/leafCount>/.exec(xml);
  if (stated) return Number(stated[1]);
  const pages = (xml.match(/<page[\s>]/g) ?? []).length;
  return pages || null;
};

/** The leaf to test whether pages are viewable: about 40% in, away from the covers. */
export const testLeafOf = (leaves) => (leaves ? Math.max(1, Math.min(leaves - 1, Math.round(leaves * 0.4))) : 5);

/**
 * Whether anyone can view the item's pages: the borrow-only flag is clear, it
 * is in no lending collection, and one page image answered 200 as an image
 * (`test` is `{leaf, ok, what}`). Every failure is a reason, so a sourcer can
 * see what the tool saw.
 */
export const judgeViewable = ({ restricted, lending, test }) => {
  const reasons = [];
  if (restricted) reasons.push('access-restricted-item is set (borrow-only)');
  if (lending.length) reasons.push(`in a lending collection (${lending.join(', ')})`);
  if (!test.ok) reasons.push(`page n${test.leaf} did not answer as a public image: ${test.what}`);
  return { viewable: reasons.length === 0, reasons };
};

// ---- the Wayback Machine ---------------------------------------------------

export const CDX_FIELDS = ['timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'];

const stamp = (value, what) => {
  if (!/^\d{4,14}$/.test(String(value))) throw new Error(`${what} "${value}" must be a year or a timestamp (2021, 20210315)`);
  return String(value);
};

// `image/` means every image type; `all` means no filter; anything else is
// the index's own regular expression (`image/(png|jpeg)`).
const mimeFilter = (mime) => {
  if (mime === 'all' || mime === '') return null;
  return mime.endsWith('/') ? `${mime}.*` : mime;
};

/**
 * The CDX search URL. Defaults are this project's: captures from 2020 to 2022,
 * status 200, images. `pattern` (a regular expression on the original URL) is
 * applied by the index, as `.*(pattern).*`, so `limit` counts matches.
 */
export const cdxUrl = ({
  prefix, from = '2020', to = '2022', mime = 'image/', status = '200', collapse, limit = 20, match = 'prefix', pattern,
} = {}) => {
  if (!String(prefix ?? '').trim()) throw new Error('cdx needs a URL prefix, like houseplans.com');
  if (!['prefix', 'exact', 'domain', 'host'].includes(match)) throw new Error(`--match "${match}" must be prefix, exact, domain or host`);
  const params = [
    ['url', String(prefix).trim()], ['matchType', match], ['output', 'json'],
    ['from', stamp(from, '--from')], ['to', stamp(to, '--to')], ['fl', CDX_FIELDS.join(',')],
  ];
  const mimeRe = mimeFilter(mime);
  if (mimeRe) params.push(['filter', `mimetype:${mimeRe}`]);
  if (status !== 'any') params.push(['filter', `statuscode:${status}`]);
  if (pattern) params.push(['filter', `original:.*(${pattern}).*`]);
  if (collapse) params.push(['collapse', collapse]);
  params.push(['limit', String(Math.max(1, Math.min(10000, Math.floor(limit))))]);
  return `https://web.archive.org/cdx/search/cdx?${params.map(([k, v]) => `${k}=${encodeURIComponent(v).replace(/%2C/g, ',').replace(/%2F/g, '/').replace(/%3A/g, ':')}`).join('&')}`;
};

/** The index's rows as objects (the header row, when there is one, names the fields). An empty answer is no rows. */
export const parseCdx = (json) => {
  if (!Array.isArray(json) || !json.length) return [];
  const [first, ...rest] = json;
  const named = first[0] === 'timestamp';
  const fields = named ? first : CDX_FIELDS;
  return (named ? rest : json).map((row) => {
    const o = Object.fromEntries(fields.map((f, i) => [f, row[i]]));
    o.length = intOrNull(o.length);
    return o;
  });
};

/** The URL that returns a capture's original bytes, no Wayback toolbar or rewriting. */
export const waybackUrl = (timestamp, original) => {
  if (!/^\d{14}$/.test(String(timestamp))) throw new Error(`timestamp "${timestamp}" must be 14 digits`);
  return `https://web.archive.org/web/${timestamp}id_/${original}`;
};

/** A capture URL's parts, or null when it is not an `id_` capture URL. */
export const parseWaybackUrl = (urlText) => {
  const m = /^https:\/\/web\.archive\.org\/web\/(\d{14})id_\/(https?:\/\/.+)$/.exec(urlText);
  return m ? { timestamp: m[1], original: m[2], year: Number(m[1].slice(0, 4)) } : null;
};

/** Rows within the years `[from, to]` (by timestamp), at least `minLength` bytes, whose URL matches `pattern` (a RegExp). */
export const filterCdx = (rows, { minLength = 0, pattern, from, to } = {}) => rows.filter((r) => {
  const year = Number(String(r.timestamp).slice(0, 4));
  if (from !== undefined && year < Number(String(from).slice(0, 4))) return false;
  if (to !== undefined && year > Number(String(to).slice(0, 4))) return false;
  if (minLength && !(r.length >= minLength)) return false;
  return !pattern || pattern.test(r.original);
});

export const formatCdxRow = (r) => `${r.timestamp}  ${String(r.mimetype).padEnd(10)}  ${String(r.length ?? '?').padStart(8)}  ${r.original}\n    ${waybackUrl(r.timestamp, r.original)}`;
