// What the sourcing tool asks archive.org and how it reads the answers
// (scripts/lib/sourceArchive.mjs), against answers shaped like the real ones.
import { describe, expect, it } from 'vitest';
import {
  cdxUrl, checkItemId, checkLeaf, countScandataLeaves, expandQuery, filterCdx, formatCdxRow, formatSearchRow, judgeViewable, leafUrl, metadataUrl, parseCdx,
  parseMetadata, parseSearch, parseWaybackUrl, parseYearRange, searchUrl, testLeafOf, waybackUrl,
} from '../sourceArchive.mjs';

describe('search', () => {
  it('asks plain words for the title or subject, all of them', () => {
    expect(expandQuery('house plans')).toBe('title:(house AND plans) OR subject:(house AND plans)');
    expect(expandQuery('  bungalows ')).toBe('title:(bungalows) OR subject:(bungalows)');
    expect(expandQuery("builder's plan-book")).toBe("title:(builder's AND plan-book) OR subject:(builder's AND plan-book)");
  });

  it('sends Lucene syntax, and anything under --raw, as typed', () => {
    expect(expandQuery('"house plans"')).toBe('"house plans"');
    expect(expandQuery('title:bungalow AND date:[1920 TO 1939]')).toBe('title:bungalow AND date:[1920 TO 1939]');
    expect(expandQuery('house AND plans')).toBe('house AND plans');
    expect(expandQuery('house plans', { raw: true })).toBe('house plans');
    expect(() => expandQuery('   ')).toThrow(/needs a query/);
  });

  it('builds the URL: texts only, the fields, the rows, the years', () => {
    const url = new URL(searchUrl('small homes', { rows: 5, years: [1920, 1959], page: 2, sort: 'downloads desc' }));
    expect(url.origin + url.pathname).toBe('https://archive.org/advancedsearch.php');
    expect(url.searchParams.get('q')).toBe('(title:(small AND homes) OR subject:(small AND homes)) AND mediatype:texts AND year:[1920 TO 1959]');
    expect(url.searchParams.getAll('fl[]')).toEqual(['identifier', 'title', 'year', 'creator', 'imagecount', 'downloads', 'mediatype', 'access-restricted-item']);
    expect(url.searchParams.get('rows')).toBe('5');
    expect(url.searchParams.get('page')).toBe('2');
    expect(url.searchParams.get('sort[]')).toBe('downloads desc');
    expect(url.searchParams.get('output')).toBe('json');
  });

  it('clamps the rows and refuses a sort it cannot read', () => {
    expect(new URL(searchUrl('x', { rows: 5000 })).searchParams.get('rows')).toBe('100');
    expect(new URL(searchUrl('x', { rows: 0 })).searchParams.get('rows')).toBe('1');
    expect(() => searchUrl('x', { sort: 'downloads; drop' })).toThrow(/--sort/);
  });

  it('reads a year or a range of years', () => {
    expect(parseYearRange('1955')).toEqual([1955, 1955]);
    expect(parseYearRange('1920-1959')).toEqual([1920, 1959]);
    expect(() => parseYearRange('1959-1920')).toThrow(/backwards/);
    expect(() => parseYearRange('the 1950s')).toThrow(/--year/);
  });

  it('reads the rows, whatever shape the fields come in', () => {
    const { found, rows } = parseSearch({
      response: {
        numFound: 1390,
        docs: [
          {
            identifier: 'a1', title: 'Home plans', year: 1928, creator: ['A. Builder', 'B. Drafter'], imagecount: '54', downloads: 12,
          },
          {
            identifier: 'b2', title: ['Small homes'], creator: 'Sears', 'access-restricted-item': 'true',
          },
        ],
      },
    });
    expect(found).toBe(1390);
    expect(rows[0]).toMatchObject({ identifier: 'a1', year: 1928, creator: 'A. Builder; B. Drafter', imagecount: 54, restricted: false });
    expect(rows[1]).toMatchObject({ identifier: 'b2', title: 'Small homes', year: null, imagecount: null, restricted: true });
    expect(formatSearchRow(rows[0])).toBe('a1  1928   54 leaves  Home plans  / A. Builder; B. Drafter');
    expect(formatSearchRow(rows[1])).toContain('[borrow-only]');
    expect(formatSearchRow(rows[1])).toContain('  ? leaves');
    expect(parseSearch({})).toEqual({ found: 0, rows: [] });
  });
});

describe('an item', () => {
  const open = {
    metadata: {
      identifier: 'PacificBook', title: "Pacific's book of homes, vol. 25", date: '1925', year: '1925', creator: 'Pacific Ready-Cut Homes, Inc.',
      publisher: 'Pacific Ready-Cut Homes, Inc.', collection: ['buildingtechnologyheritagelibrary', 'catalogs'], imagecount: '164', mediatype: 'texts',
    },
    files: [{ name: 'PacificBook.pdf' }],
  };
  const borrowOnly = {
    metadata: {
      identifier: 'wlmartin', title: 'W.L. Martin home designs', date: '2000', 'access-restricted-item': 'true',
      collection: ['internetarchivebooks', 'inlibrary', 'printdisabled'], imagecount: '126',
    },
  };
  const noCount = {
    metadata: { identifier: 'HomesOfToday1932', title: 'Homes of today : 1932.', date: '1932', collection: ['catalogs'] },
    files: [{ name: 'HomesOfToday1932_meta.xml' }, { name: 'HomesofToday-19320001_scandata.xml' }],
  };

  it('reads what a sourcer needs', () => {
    expect(parseMetadata(open, 'PacificBook')).toMatchObject({
      id: 'PacificBook', year: 1925, leaves: 164, restricted: false, lending: [], publisher: 'Pacific Ready-Cut Homes, Inc.', scandata: null,
    });
    expect(parseMetadata(borrowOnly, 'wlmartin')).toMatchObject({ restricted: true, lending: ['inlibrary'], year: 2000 });
    expect(parseMetadata(noCount, 'HomesOfToday1932')).toMatchObject({ leaves: null, scandata: 'HomesofToday-19320001_scandata.xml' });
  });

  it('says so when there is no such item', () => {
    expect(() => parseMetadata({}, 'nothere')).toThrow(/no item named nothere/);
    expect(() => parseMetadata(null, 'nothere')).toThrow(/no item named nothere/);
  });

  it('counts leaves from a scandata file', () => {
    expect(countScandataLeaves('<book><bookData><leafCount>92</leafCount></bookData><pageData><page leafNum="0"/><page leafNum="1"/></pageData></book>')).toBe(92);
    expect(countScandataLeaves('<book><pageData><page leafNum="0"><pageNumData/></page><page leafNum="1"></page><page>\n</page></pageData></book>')).toBe(3);
    expect(countScandataLeaves('<book/>')).toBeNull();
  });

  it('tests a page about 40% in, away from the covers', () => {
    expect(testLeafOf(164)).toBe(66);
    expect(testLeafOf(2)).toBe(1);
    expect(testLeafOf(null)).toBe(5);
  });

  it('calls pages viewable only when nothing says otherwise', () => {
    const good = { leaf: 66, ok: true, what: 'image/jpeg 4359x6100' };
    expect(judgeViewable({ restricted: false, lending: [], test: good })).toEqual({ viewable: true, reasons: [] });
    const lent = judgeViewable({ restricted: true, lending: ['inlibrary'], test: { leaf: 50, ok: false, what: 'HTTP 403' } });
    expect(lent.viewable).toBe(false);
    expect(lent.reasons).toHaveLength(3);
    expect(judgeViewable({ restricted: false, lending: [], test: { leaf: 5, ok: false, what: 'HTTP 403' } }).reasons[0]).toMatch(/page n5 did not answer as a public image: HTTP 403/);
    // The flag alone is enough, even when a page happened to answer.
    expect(judgeViewable({ restricted: true, lending: [], test: good }).viewable).toBe(false);
    expect(judgeViewable({ restricted: false, lending: ['lendinglibrary'], test: good }).viewable).toBe(false);
  });

  it('builds page and metadata URLs, and refuses names that would point elsewhere', () => {
    expect(leafUrl('PacificBook', 49)).toBe('https://archive.org/download/PacificBook/page/n49');
    expect(leafUrl('PacificBook', '49', 'jpg')).toBe('https://archive.org/download/PacificBook/page/n49.jpg');
    expect(metadataUrl('a.b-c_d')).toBe('https://archive.org/metadata/a.b-c_d');
    for (const bad of ['', 'a/b', '../x', 'a b', '-lead', 'x?y=1']) expect(() => checkItemId(bad), bad).toThrow(/identifier/);
    for (const bad of ['-1', '1.5', 'nn4', '', ' ', 'abc', '1e3', undefined]) expect(() => checkLeaf(bad), String(bad)).toThrow(/leaf/);
    expect(checkLeaf('0')).toBe(0);
    expect(checkLeaf('n49')).toBe(49);
    expect(checkLeaf(12)).toBe(12);
  });
});

describe('the Wayback CDX', () => {
  const parts = (url) => {
    const u = new URL(url);
    return { base: u.origin + u.pathname, get: (k) => u.searchParams.get(k), all: (k) => u.searchParams.getAll(k) };
  };

  it('defaults to this project\'s captures: 2020 to 2022, status 200, images', () => {
    const q = parts(cdxUrl({ prefix: 'houseplans.com' }));
    expect(q.base).toBe('https://web.archive.org/cdx/search/cdx');
    expect(q.get('url')).toBe('houseplans.com');
    expect(q.get('matchType')).toBe('prefix');
    expect(q.get('from')).toBe('2020');
    expect(q.get('to')).toBe('2022');
    expect(q.get('output')).toBe('json');
    expect(q.get('fl')).toBe('timestamp,original,mimetype,statuscode,digest,length');
    expect(q.all('filter')).toEqual(['mimetype:image/.*', 'statuscode:200']);
    expect(q.get('limit')).toBe('20');
    expect(q.get('collapse')).toBeNull();
  });

  it('takes the other options', () => {
    const q = parts(cdxUrl({
      prefix: 'https://www.dongardner.com/plan/', from: '2021', to: '20211231', mime: 'image/(png|jpeg)', status: 'any', collapse: 'urlkey', limit: 5, match: 'domain', pattern: 'floor.?plan',
    }));
    expect(q.get('matchType')).toBe('domain');
    expect(q.get('from')).toBe('2021');
    expect(q.get('to')).toBe('20211231');
    expect(q.all('filter')).toEqual(['mimetype:image/(png|jpeg)', 'original:.*(floor.?plan).*']);
    expect(q.get('collapse')).toBe('urlkey');
    expect(q.get('limit')).toBe('5');
    expect(parts(cdxUrl({ prefix: 'x.com', mime: 'all' })).all('filter')).toEqual(['statuscode:200']);
  });

  it('refuses options it cannot use', () => {
    expect(() => cdxUrl({})).toThrow(/URL prefix/);
    expect(() => cdxUrl({ prefix: 'x.com', match: 'fuzzy' })).toThrow(/--match/);
    expect(() => cdxUrl({ prefix: 'x.com', from: 'last year' })).toThrow(/--from/);
    expect(parts(cdxUrl({ prefix: 'x.com', limit: 999999 })).get('limit')).toBe('10000');
  });

  it('reads the rows, the header row, and an empty answer', () => {
    const rows = parseCdx([
      ['timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
      ['20210114233544', 'https://www.houseplans.com/plan/a.png', 'image/png', '200', 'GEO7', '48213'],
      ['20220301000000', 'https://www.houseplans.com/plan/b.jpg', 'image/jpeg', '200', 'ABC', '9120'],
    ]);
    expect(rows).toEqual([
      { timestamp: '20210114233544', original: 'https://www.houseplans.com/plan/a.png', mimetype: 'image/png', statuscode: '200', digest: 'GEO7', length: 48213 },
      { timestamp: '20220301000000', original: 'https://www.houseplans.com/plan/b.jpg', mimetype: 'image/jpeg', statuscode: '200', digest: 'ABC', length: 9120 },
    ]);
    expect(parseCdx(null)).toEqual([]);
    expect(parseCdx([])).toEqual([]);
    expect(parseCdx([['timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length']])).toEqual([]);
    expect(parseCdx([['20210101000000', 'https://x.com/a.png', 'image/png', '200', 'D', '5']])[0].length).toBe(5);
  });

  it('builds the original-bytes URL, and takes one apart', () => {
    const url = waybackUrl('20210114233544', 'https://www.houseplans.com/plan/a.png');
    expect(url).toBe('https://web.archive.org/web/20210114233544id_/https://www.houseplans.com/plan/a.png');
    expect(parseWaybackUrl(url)).toEqual({ timestamp: '20210114233544', original: 'https://www.houseplans.com/plan/a.png', year: 2021 });
    expect(parseWaybackUrl('https://web.archive.org/web/20210114233544/https://www.houseplans.com/plan/a.png')).toBeNull();
    expect(parseWaybackUrl('https://archive.org/download/x/page/n1')).toBeNull();
    expect(() => waybackUrl('2021', 'https://x.com/a.png')).toThrow(/14 digits/);
  });

  it('keeps the rows in the years, of the size and shape asked', () => {
    const rows = [
      { timestamp: '20191231235959', original: 'https://x.com/plan/old.png', length: 90000 },
      { timestamp: '20200101000000', original: 'https://x.com/plan/thumb.png', length: 900 },
      { timestamp: '20210601000000', original: 'https://x.com/plan/floor-plan.png', length: 60000 },
      { timestamp: '20221231235959', original: 'https://x.com/logo.png', length: 60000 },
      { timestamp: '20230101000000', original: 'https://x.com/plan/new.png', length: 90000 },
    ];
    expect(filterCdx(rows, { from: '2020', to: '2022' }).map((r) => r.original)).toEqual([
      'https://x.com/plan/thumb.png', 'https://x.com/plan/floor-plan.png', 'https://x.com/logo.png',
    ]);
    expect(filterCdx(rows, { from: '2020', to: '2022', minLength: 5000 }).map((r) => r.original)).toEqual([
      'https://x.com/plan/floor-plan.png', 'https://x.com/logo.png',
    ]);
    expect(filterCdx(rows, { from: 2020, to: 2022, minLength: 5000, pattern: /\/plan\// }).map((r) => r.original)).toEqual(['https://x.com/plan/floor-plan.png']);
  });

  it('prints a row with the URL to record under it', () => {
    const text = formatCdxRow({ timestamp: '20210114233544', mimetype: 'image/png', length: 48213, original: 'https://www.houseplans.com/plan/a.png' });
    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('20210114233544  image/png');
    expect(text.split('\n')[1].trim()).toBe('https://web.archive.org/web/20210114233544id_/https://www.houseplans.com/plan/a.png');
  });
});
