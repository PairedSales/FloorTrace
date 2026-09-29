// The commands of scripts/realSource.mjs (scripts/lib/sourceCommands.mjs), each
// run against a scratch checkout and set folder and a fake network: what they
// print, where they write, what they refuse. The one thing they do not run is
// `screen`'s scan (that is the app's own OCR, tested with the app); its
// sampling is tested here.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  COMMANDS, UsageError, drawContactSheets, leafRange, parseArgs, parseLeafList, sampleLeaves, SCREEN_WARNING,
} from '../sourceCommands.mjs';
import { HttpError } from '../sourceNet.mjs';
import { readLog, sourcesFiles } from '../sourceLog.mjs';
import { fakeClock } from './fakeNet.mjs';

let root;
let dir;
let cache;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcecmd-'));
  dir = path.join(root, 'set');
  cache = path.join(root, 'cache');
  fs.mkdirSync(dir);
  fs.mkdirSync(cache);
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

// A page of a given size: white, with a dark box in it, as a PNG file.
const page = (name, w = 600, h = 800, fill = [255, 255, 255]) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i += 1) {
    png.data[i * 4] = fill[0];
    png.data[i * 4 + 1] = fill[1];
    png.data[i * 4 + 2] = fill[2];
    png.data[i * 4 + 3] = 255;
  }
  const file = path.join(cache, name);
  fs.writeFileSync(file, PNG.sync.write(png));
  return file;
};
const readPng = (file) => PNG.sync.read(fs.readFileSync(file));
const pixel = (png, x, y) => Array.from(png.data.subarray((y * png.width + x) * 4, (y * png.width + x) * 4 + 3));

// A network that answers from tables and remembers what was asked.
const fakeNet = ({ images = {}, json = () => null, text = () => '' } = {}) => {
  const calls = [];
  return {
    dir: cache,
    calls,
    fetchImage: async (url) => {
      calls.push(['image', url]);
      const found = images[url];
      if (found instanceof Error) throw found;
      if (!found) throw new HttpError(404, url);
      return { file: found, mime: 'image/png', size: fs.statSync(found).size, cached: false, url };
    },
    fetchJson: async (url, options) => {
      calls.push(['json', url, options]);
      const value = json(url);
      if (value instanceof Error) throw value;
      return { json: value, cached: false };
    },
    fetchText: async (url) => {
      calls.push(['text', url]);
      return { text: text(url), cached: false };
    },
  };
};

const run = async (command, argv, net, extra = {}) => {
  const out = [];
  const err = [];
  const ctx = {
    dir, root, env: {}, out: (l) => out.push(l), err: (l) => err.push(l), net, clock: fakeClock(), ...extra,
  };
  let status;
  try {
    status = await COMMANDS[command](argv, ctx);
  } catch (error) {
    return { error, out, err, ctx };
  }
  return { status, out, err, text: out.join('\n'), ctx };
};

describe('arguments', () => {
  const spec = { values: ['rows', 'year'], flags: ['refresh'] };

  it('splits positional arguments, values and flags', () => {
    expect(parseArgs(['house plans', '--rows', '5', '--refresh', '--year=1920-1959'], spec)).toEqual({
      positional: ['house plans'], opts: { rows: '5', refresh: true, year: '1920-1959' },
    });
    expect(parseArgs(['--rows', '-3'], spec).opts.rows).toBe('-3');
  });

  it('refuses an option the command does not have, a missing value, and a value for a flag', () => {
    expect(() => parseArgs(['--rowz', '5'], spec, 'search')).toThrow(UsageError);
    expect(() => parseArgs(['--rowz', '5'], spec, 'search')).toThrow(/unknown option --rowz \(search takes: --rows --year --refresh\)/);
    expect(() => parseArgs(['--rows'], spec)).toThrow(/--rows needs a value/);
    expect(() => parseArgs(['--rows', '--refresh'], spec)).toThrow(/--rows needs a value/);
    expect(() => parseArgs(['--refresh=yes'], spec)).toThrow(/takes no value/);
  });
});

describe('search', () => {
  const answer = {
    response: {
      numFound: 1251,
      docs: [
        { identifier: 'PopularHomes1963', title: 'Popular homes', year: 1963, imagecount: '90', creator: 'Popular Homes Inc' },
        { identifier: 'wlmartin', title: 'W.L. Martin home designs', year: 2000, imagecount: '126', 'access-restricted-item': 'true' },
      ],
    },
  };

  it('prints the query sent, the count and a row per text', async () => {
    const net = fakeNet({ json: () => answer });
    const r = await run('search', ['house plans', '--rows', '2', '--year', '1915-1965'], net);
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe('query: title:(house AND plans) OR subject:(house AND plans)  (years 1915-1965)');
    expect(r.out[1]).toBe('1251 texts match; showing 2');
    expect(r.out[2]).toContain('PopularHomes1963  1963   90 leaves  Popular homes  / Popular Homes Inc');
    expect(r.out[3]).toContain('[borrow-only]');
    const url = new URL(net.calls[0][1]);
    expect(url.searchParams.get('q')).toBe('(title:(house AND plans) OR subject:(house AND plans)) AND mediatype:texts AND year:[1915 TO 1965]');
    expect(url.searchParams.get('rows')).toBe('2');
  });

  it('sends --raw as typed and needs a query', async () => {
    const net = fakeNet({ json: () => answer });
    await run('search', ['house plans', '--raw'], net);
    expect(new URL(net.calls[0][1]).searchParams.get('q')).toBe('(house plans) AND mediatype:texts');
    expect((await run('search', [], net)).error).toBeInstanceOf(UsageError);
    expect((await run('search', ['x', '--rows', '500'], net)).error).toBeInstanceOf(UsageError);
  });
});

describe('meta', () => {
  const open = { metadata: { identifier: 'Open', title: 'Open book', date: '1925', collection: ['catalogs'], imagecount: '100' } };
  const lent = { metadata: { identifier: 'Lent', title: 'Lent book', date: '2000', 'access-restricted-item': 'true', collection: ['inlibrary', 'printdisabled'], imagecount: '80' } };

  it('reports a book anyone can view, and exits 0', async () => {
    const file = page('n40.png', 500, 700);
    const net = fakeNet({ json: () => open, images: { 'https://archive.org/download/Open/page/n40': file } });
    const r = await run('meta', ['Open'], net);
    expect(r.status).toBe(0);
    expect(r.text).toContain('leaves: 100 (from the metadata\'s imagecount)');
    expect(r.text).toContain('borrow-only flag (access-restricted-item): no');
    expect(r.text).toContain('lending collections: none');
    expect(r.text).toContain('page test: leaf 40, https://archive.org/download/Open/page/n40 -> 200 image/png 500x700');
    expect(r.text).toContain('page images: https://archive.org/download/Open/page/n<leaf>  (the full-resolution page; leaves 0..99)');
    expect(r.text).toContain('viewable: YES (pages are public)');
    expect(r.err).toEqual([]);
  });

  it('exits 1 for a borrow-only book, saying what it saw', async () => {
    const net = fakeNet({ json: () => lent, images: { 'https://archive.org/download/Lent/page/n32': new HttpError(403, 'https://ia600104.us.archive.org/BookReader/BookReaderImages.php?id=Lent') } });
    const r = await run('meta', ['Lent'], net);
    expect(r.status).toBe(1);
    expect(r.text).toContain('borrow-only flag (access-restricted-item): YES');
    expect(r.text).toContain('lending collections: inlibrary');
    expect(r.text).toContain('-> HTTP 403 from ia600104.us.archive.org');
    expect(r.text).toMatch(/viewable: NO \(access-restricted-item is set \(borrow-only\); in a lending collection \(inlibrary\); page n32 did not answer as a public image: HTTP 403/);
    expect(r.err.join('\n')).toMatch(/meta: Lent is not viewable: /);
  });

  it('exits 1 when the flags are clear but the page is not an image', async () => {
    const net = fakeNet({ json: () => open, images: { 'https://archive.org/download/Open/page/n40': new Error('https://x answered 200 text/html but starts "<!DOCTYPE html>", not an image; nothing was cached') } });
    const r = await run('meta', ['Open'], net);
    expect(r.status).toBe(1);
    expect(r.text).toMatch(/viewable: NO \(page n40 did not answer as a public image: .*not an image/);
  });

  it('counts leaves from the scandata when the metadata gives none', async () => {
    const noCount = { metadata: { identifier: 'Nc', title: 'No count', date: '1932' }, files: [{ name: 'Nc-0001_scandata.xml' }] };
    const net = fakeNet({
      json: () => noCount,
      text: () => '<book><bookData><leafCount>92</leafCount></bookData></book>',
      images: { 'https://archive.org/download/Nc/page/n37': page('n37.png') },
    });
    const r = await run('meta', ['Nc'], net);
    expect(r.status).toBe(0);
    expect(r.text).toContain('leaves: 92 (from the item\'s _scandata.xml)');
    expect(net.calls.find((c) => c[0] === 'text')[1]).toBe('https://archive.org/download/Nc/Nc-0001_scandata.xml');
  });

  it('refuses an identifier that would point elsewhere, and an item that is not there', async () => {
    expect((await run('meta', ['a/b'], fakeNet())).error.message).toMatch(/identifier/);
    expect((await run('meta', ['Ghost'], fakeNet({ json: () => ({}) }))).error.message).toMatch(/no item named Ghost/);
  });
});

describe('leaf', () => {
  it('prints the cached path first, then its size and the URL to record', async () => {
    const file = page('n49.png', 640, 900);
    const net = fakeNet({ images: { 'https://archive.org/download/Book/page/n49': file } });
    const r = await run('leaf', ['Book', 'n49'], net);
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe(file);
    expect(r.out[1]).toMatch(/^640x900 px {2}image\/png {2}[\d,]+ bytes {2}downloaded$/);
    expect(r.out[2]).toBe('source URL to record: https://archive.org/download/Book/page/n49');
  });

  it('passes --ext on, and refuses a leaf that is not a number', async () => {
    const net = fakeNet({ images: { 'https://archive.org/download/Book/page/n49.jpg': page('a.png') } });
    expect((await run('leaf', ['Book', '49', '--ext', 'jpg'], net)).status).toBe(0);
    expect(net.calls[0][1]).toBe('https://archive.org/download/Book/page/n49.jpg');
    expect((await run('leaf', ['Book', 'forty'], net)).error.message).toMatch(/leaf "forty"/);
    expect((await run('leaf', ['Book'], net)).error).toBeInstanceOf(UsageError);
  });
});

describe('contact', () => {
  const images = (from, to, size = [500, 700]) => Object.fromEntries(
    leafRange(from, to).map((n) => [`https://archive.org/download/Book/page/n${n}`, page(`n${n}.png`, ...size, [230, 240, 250])]),
  );

  it('draws leaves into labelled cells of a sheet about 1,600 px wide', async () => {
    const net = fakeNet({ images: images(10, 14) });
    const r = await run('contact', ['Book', '10', '14', '--tag', 'me'], net);
    expect(r.status).toBe(0);
    const sheetPath = r.out[0];
    expect(sheetPath).toBe(path.join(root, 'datasets', 'zz-scratch', 'views', 'me', 'contact-Book-10-14.png'));
    expect(r.out[1]).toBe('leaves n10 n11 n12 n13 n14');
    const sheet = readPng(sheetPath);
    expect(sheet.width).toBe(1600);
    expect(sheet.height).toBe(30 + 2 * 520);
    // The first cell's corner carries the red leaf label; the page's own colour is inside the cell.
    const red = pixel(sheet, 8, 30 + 8);
    expect(red[0]).toBeGreaterThan(180);
    expect(red[1]).toBeLessThan(40);
    expect(pixel(sheet, 200, 30 + 300)).toEqual([230, 240, 250]);
    // The fifth leaf starts the second row.
    expect(pixel(sheet, 200, 30 + 520 + 300)).toEqual([230, 240, 250]);
    expect(pixel(sheet, 1000, 30 + 520 + 300)).not.toEqual([230, 240, 250]);
  });

  it('makes more sheets when the leaves do not fit, and takes every S-th', async () => {
    const net = fakeNet({ images: images(1, 30) });
    const r = await run('contact', ['Book', '1', '30', '--step', '2'], net);
    // 15 leaves at 12 a sheet.
    expect(r.out.filter((l) => l.endsWith('.png'))).toEqual([
      path.join(root, 'datasets', 'zz-scratch', 'views', 'default', 'contact-Book-1-30-s2-p1.png'),
      path.join(root, 'datasets', 'zz-scratch', 'views', 'default', 'contact-Book-1-30-s2-p2.png'),
    ]);
    expect(r.out[1]).toBe('leaves n1 n3 n5 n7 n9 n11 n13 n15 n17 n19 n21 n23');
    expect(r.out[3]).toBe('leaves n25 n27 n29');
    expect(net.calls.filter((c) => c[0] === 'image')).toHaveLength(15);
  });

  it('marks a leaf it could not get and draws the rest', async () => {
    const all = images(10, 12);
    delete all['https://archive.org/download/Book/page/n11'];
    const r = await run('contact', ['Book', '10', '12', '--cols', '3'], fakeNet({ images: all }));
    expect(r.status).toBe(0);
    expect(r.out[1]).toBe('leaves n10 n11 n12   (could not fetch: n11)');
    expect(readPng(r.out[0]).width).toBe(1599); // 3 cells of 533
  });

  it('exits 1 when nothing could be fetched, pointing at meta', async () => {
    const r = await run('contact', ['Book', '10', '12'], fakeNet());
    expect(r.status).toBe(1);
    expect(r.err.join('\n')).toMatch(/no leaf could be fetched \(is Book borrow-only\? `meta Book` tests it\)/);
  });

  it('refuses a call that would fetch a hundred pages, and a backwards range', async () => {
    const net = fakeNet();
    expect((await run('contact', ['Book', '1', '200'], net)).error.message).toMatch(/200 leaves is over 96 in one call.*--step/);
    expect((await run('contact', ['Book', '20', '10'], net)).error).toBeInstanceOf(UsageError);
    expect((await run('contact', ['Book', '1'], net)).error).toBeInstanceOf(UsageError);
    expect(net.calls).toEqual([]);
    // 200 leaves at a step of 3 is 67: allowed.
    expect((await run('contact', ['Book', '1', '200', '--step', '3'], fakeNet())).error).toBeUndefined();
  });

  it('draws sheets from files without a network', async () => {
    const files = { 1: page('a.png', 300, 300), 2: page('b.png', 800, 300) };
    const sheets = await drawContactSheets({
      leaves: [1, 2, 3], cols: 2, rows: 1, title: 'x', load: async (n) => (files[n] ? { file: files[n] } : { error: `n${n}: HTTP 404` }),
    });
    expect(sheets.map((s) => [s.leaves, s.failed])).toEqual([[[1, 2], []], [[3], [3]]]);
  });
});

describe('grid', () => {
  it('draws a gridded crop of an image file, named for the file, the crop and the step', async () => {
    const file = page('plan.png', 800, 600);
    const r = await run('grid', [file, '--crop', '100,100,300,300', '--grid', '20', '--tag', 'me'], fakeNet());
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe(path.join(root, 'datasets', 'zz-scratch', 'views', 'me', 'plan-100_100_300_300-g20.png'));
    expect(fs.existsSync(r.out[0])).toBe(true);
    expect(r.out[1]).toMatch(/^crop 100,100→300,300 {2}scale \d+\.\d\d px\/px {2}grid 20$/);
    // The key tool's picture: the margin labels the grid in the page's pixels.
    expect(readPng(r.out[0]).width).toBeGreaterThan(300);
  });

  it('takes ID:LEAF, fetching the leaf through the network layer', async () => {
    const net = fakeNet({ images: { 'https://archive.org/download/Book/page/n49': page('n49.png', 700, 900) } });
    const r = await run('grid', ['Book:49'], net);
    expect(r.out[0]).toBe(path.join(root, 'datasets', 'zz-scratch', 'views', 'default', 'Book-n49.png'));
    expect(r.out[1]).toMatch(/^crop 0,0→700,900 {2}scale/);
  });

  it('refuses what is neither an image nor a leaf, a crop it cannot read, and a file that is not an image', async () => {
    expect((await run('grid', ['nothere'], fakeNet())).error.message).toMatch(/not an image file or ID:LEAF/);
    expect((await run('grid', [page('p.png'), '--crop', '1,2,3'], fakeNet())).error.message).toMatch(/--crop must be 4 comma-separated numbers/);
    expect((await run('grid', [page('p.png'), '--crop', '10,10,5,50'], fakeNet())).error.message).toMatch(/X1 > X0/);
    const text = path.join(root, 'notes.txt');
    fs.writeFileSync(text, 'not an image at all, just words');
    expect((await run('grid', [text], fakeNet())).error.message).toMatch(/is not an image/);
  });
});

describe('screen', () => {
  it('spreads its samples through the book, away from the covers', () => {
    expect(sampleLeaves(164, 5)).toEqual([20, 47, 74, 101, 128]);
    expect(sampleLeaves(164, 1)).toEqual([74]);
    expect(sampleLeaves(164, 3)).toEqual([20, 74, 128]);
    const tiny = sampleLeaves(6, 5);
    expect(new Set(tiny).size).toBe(tiny.length);
    expect(Math.max(...tiny)).toBeLessThanOrEqual(3);
    expect(Math.min(...tiny)).toBeGreaterThanOrEqual(1);
  });

  it('reads a list of leaves', () => {
    expect(parseLeafList('12,40, n77')).toEqual([12, 40, 77]);
    expect(() => parseLeafList('')).toThrow(UsageError);
    expect(() => parseLeafList('12,abc')).toThrow(/leaf "abc"/);
  });

  it('carries the warning that a label count never drops a page', () => {
    expect(SCREEN_WARNING).toMatch(/must never be used to drop a page that qualifies \(integrity rule 6\)/);
  });

  it('cannot sample a book with no leaf count, and asks for --leaves instead', async () => {
    const r = await run('screen', ['Nc'], fakeNet({ json: () => ({ metadata: { identifier: 'Nc', title: 'No count' } }) }));
    expect(r.error.message).toMatch(/states no leaf count.*--leaves/);
  });
});

describe('cdx', () => {
  const rows = [
    ['timestamp', 'original', 'mimetype', 'statuscode', 'digest', 'length'],
    ['20210114233544', 'https://www.houseplans.com/plan/a-floor.png', 'image/png', '200', 'D1', '48213'],
    ['20210114233545', 'https://www.houseplans.com/plan/a-thumb.png', 'image/png', '200', 'D2', '1200'],
    ['20210114233546', 'https://www.houseplans.com/logo.png', 'image/png', '200', 'D3', '90000'],
    ['20210114233547', 'https://www.houseplans.com/plan/b-floor.jpg', 'image/jpeg', '200', 'D4', '61000'],
  ];

  it('prints each capture, then the URL that returns its original bytes', async () => {
    const net = fakeNet({ json: () => rows });
    const r = await run('cdx', ['houseplans.com', '--limit', '5'], net);
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe('4 rows read, 4 kept (2020 to 2022)');
    expect(r.out[1]).toContain('20210114233544  image/png');
    expect(r.out[1].split('\n')[1].trim()).toBe('https://web.archive.org/web/20210114233544id_/https://www.houseplans.com/plan/a-floor.png');
    expect(r.text).toContain('record it as the plan\'s source');
    const url = new URL(net.calls[0][1]);
    expect(url.searchParams.get('from')).toBe('2020');
    expect(url.searchParams.get('to')).toBe('2022');
    expect(url.searchParams.get('limit')).toBe('5');
    expect(net.calls[0][2].emptyOk).toBe(true);
  });

  it('drops thumbnails by --min-length and reads more of the index to keep the limit', async () => {
    const net = fakeNet({ json: () => rows });
    const r = await run('cdx', ['houseplans.com', '--limit', '2', '--min-length', '5000'], net);
    expect(r.out[0]).toBe('4 rows read, 2 kept (2020 to 2022, at least 5,000 bytes)');
    expect(r.text).not.toContain('a-thumb');
    expect(new URL(net.calls[0][1]).searchParams.get('limit')).toBe('200');
    expect((await run('cdx', ['houseplans.com', '--limit', '2', '--min-length', '5000', '--scan', '1'], net)).error).toBeInstanceOf(UsageError);
  });

  it('passes a pattern to the index and checks it again here', async () => {
    const net = fakeNet({ json: () => rows });
    const r = await run('cdx', ['houseplans.com', '--pattern', 'floor'], net);
    expect(new URL(net.calls[0][1]).searchParams.getAll('filter')).toContain('original:.*(floor).*');
    expect(r.out[0]).toBe('4 rows read, 2 kept (2020 to 2022, URL matching /floor/)');
    expect((await run('cdx', ['x.com', '--pattern', '('], net)).error.message).toMatch(/not a regular expression/);
  });

  it('says so when there are no captures, or the index may hold more', async () => {
    const none = await run('cdx', ['nothing.example'], fakeNet({ json: () => null }));
    expect(none.out).toEqual(['0 rows read, 0 kept (2020 to 2022)']);
    const full = await run('cdx', ['houseplans.com', '--limit', '4', '--min-length', '999999', '--scan', '4'], fakeNet({ json: () => rows }));
    expect(full.text).toMatch(/the index may hold more: this read its first 4 rows \(--scan N reads more/);
  });

  it('keeps to the years asked even if the index sends others', async () => {
    const other = [rows[0], ['20190101000000', 'https://x.com/plan/old.png', 'image/png', '200', 'D9', '50000'], rows[1]];
    const r = await run('cdx', ['x.com'], fakeNet({ json: () => other }));
    expect(r.out[0]).toBe('2 rows read, 1 kept (2020 to 2022)');
  });
});

describe('fetch', () => {
  const url = 'https://web.archive.org/web/20210614120000id_/https://www.dongardner.com/plan/1234.png';

  it('prints the cached path, the mime type and the pixel size', async () => {
    const file = page('plan.png', 900, 700);
    const r = await run('fetch', [url], fakeNet({ images: { [url]: file } }));
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe(file);
    expect(r.out[1]).toMatch(/^image\/png {2}900x700 px {2}[\d,]+ bytes {2}downloaded$/);
    expect(r.out[2]).toBe(`source URL: ${url}`);
  });

  it('keeps a named copy, never over a different image', async () => {
    const one = page('one.png', 900, 700);
    const two = page('two.png', 901, 700);
    const net = fakeNet({ images: { [url]: one, 'https://web.archive.org/web/20210614120000id_/https://x.com/b.png': two } });
    const r = await run('fetch', [url, '--name', 'dg1234'], net);
    expect(r.out[1]).toBe(path.join(cache, 'named', 'dg1234.png'));
    expect(fs.readFileSync(r.out[1]).equals(fs.readFileSync(one))).toBe(true);
    // The same image under the same name is fine (a second run).
    expect((await run('fetch', [url, '--name', 'dg1234'], net)).status).toBe(0);
    const clash = await run('fetch', ['https://web.archive.org/web/20210614120000id_/https://x.com/b.png', '--name', 'dg1234'], net);
    expect(clash.error.message).toMatch(/already holds a different image: pick another --name/);
    expect(fs.readFileSync(path.join(cache, 'named', 'dg1234.png')).equals(fs.readFileSync(one))).toBe(true);
    expect((await run('fetch', [url, '--name', '../up'], net)).error.message).toMatch(/--name/);
  });

  it('reports a page that is not an image as an error', async () => {
    const r = await run('fetch', [url], fakeNet({ images: { [url]: new Error('answered 200 text/html but starts "<!DOCTYPE html>", not an image; nothing was cached') } }));
    expect(r.error.message).toMatch(/not an image/);
  });
});

describe('log and report', () => {
  const planArgs = [
    'plan', '--name', 'popular63-n44a', '--book', 'Popular Homes 1963', '--publisher', 'Popular Homes Inc', '--era', 'vintage', '--year', '1963', '--leaf', '44',
    '--url', 'https://archive.org/download/PopularHomes1963/page/n44', '--crop', '120,340,1600,1300',
    '--line', 'popular63-n44a: 9 labels, 6 rooms set the scale, 10.12 px/ft (high), 1 outline(s), trace ok -> C:\\set\\popular63-n44a.floorplan',
  ];

  it('logs a plan, and prints what it wrote, with the warnings', async () => {
    const r = await run('log', planArgs, fakeNet());
    expect(r.status).toBe(0);
    expect(r.out[0]).toBe('logged plan popular63-n44a');
    expect(r.out[1]).toMatch(/^WARNING: no plan named popular63-n44a in the set folder yet/);
    expect(r.out[2]).toBe(path.join(dir, 'orchestration', 'sources.jsonl'));
    expect(r.out[3]).toBe(path.join(dir, 'orchestration', 'sources.md'));
    expect(readLog(sourcesFiles(dir).jsonl).events[0]).toMatchObject({ name: 'popular63-n44a', size: [1600, 1300], labels: 9 });
  });

  it('logs a rejection and a book, and refuses a reason about the trace', async () => {
    expect((await run('log', ['reject', '--book', 'Popular Homes 1963', '--leaf', '12', '--reason', 'site plan'], fakeNet())).out[0]).toBe('logged reject Popular Homes 1963 leaf 12 (site-plan)');
    expect((await run('log', ['book', '--book', 'Popular Homes 1963', '--id', 'PopularHomes1963', '--leaves', '90'], fakeNet())).out[0]).toBe('logged book Popular Homes 1963');
    const bad = await run('log', ['reject', '--book', 'B', '--leaf', '12', '--reason', 'other:the tracer fails on it'], fakeNet());
    expect(bad.error.message).toMatch(/integrity rule 6/);
  });

  it('refuses a duplicate unless --replace, and an unknown kind or option', async () => {
    await run('log', planArgs, fakeNet());
    expect((await run('log', planArgs, fakeNet())).error.message).toMatch(/already logged/);
    expect((await run('log', [...planArgs, '--replace'], fakeNet())).status).toBe(0);
    expect((await run('log', ['sketch'], fakeNet())).error).toBeInstanceOf(UsageError);
    expect((await run('log', [], fakeNet())).error).toBeInstanceOf(UsageError);
    expect((await run('log', [...planArgs, '--colour', 'red'], fakeNet())).error).toBeInstanceOf(UsageError);
  });

  it('reports per book and per era', async () => {
    await run('log', planArgs, fakeNet());
    await run('log', ['reject', '--book', 'Popular Homes 1963', '--leaf', '12', '--reason', '3d'], fakeNet());
    const r = await run('report', [], fakeNet());
    expect(r.status).toBe(0);
    expect(r.text).toContain('vintage  Popular Homes 1963: 1 plan, 1 rejected');
    expect(r.text).toContain('era vintage: 1 plans from 1 books/sites, 1 rejected pages');
    expect(r.text).toContain('era 2020-2022: 0 plans from 0 books/sites, 0 rejected pages');
    expect(r.text).toContain('total: 1 plans, 1 rejected pages');
    expect(r.text).toContain('no book or site over the cap of 12');
    expect(r.out.at(-1)).toBe(path.join(dir, 'orchestration', 'sources.md'));
  });
});
