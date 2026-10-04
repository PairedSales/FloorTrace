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
  COMMANDS, leafRange,
} from '../sourceCommands.mjs';
import { metadataUrl } from '../sourceArchive.mjs';
import { HttpError } from '../sourceNet.mjs';
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

// A network that answers from tables and remembers what was asked.
const fakeNet = ({
  images = {}, json = () => null, text = () => '', cached = {},
} = {}) => {
  const calls = [];
  return {
    dir: cache,
    calls,
    // What the API cache holds, by URL (`meta ID` put it there): read without a request.
    peekText: (url) => cached[url] ?? null,
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
      options?.validate?.(value); // as the real one: an answer the validator refuses is an error
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
});

describe('fetch', () => {
  const url = 'https://web.archive.org/web/20210614120000id_/https://www.dongardner.com/plan/1234.png';

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
});

// archive.org answers `page/n<k>` for any k past the last leaf with HTTP 200 and
// the last page's image, so only the book's leaf count tells a mistyped leaf.
describe('a leaf past the end of a book', () => {
  const cachedMeta = (leaves) => ({ [metadataUrl('Book')]: JSON.stringify({ metadata: { identifier: 'Book', title: 'A book', imagecount: String(leaves) } }) });
  // One small page file stands for every leaf: what is asked is which leaves are fetched.
  const leafUrls = (from, to) => {
    const one = page('leaf.png', 200, 280, [230, 240, 250]);
    return Object.fromEntries(leafRange(from, to).map((n) => [`https://archive.org/download/Book/page/n${n}`, one]));
  };

  it('leaf refuses it, naming the count, and fetches nothing', async () => {
    const net = fakeNet({ images: leafUrls(0, 200), cached: cachedMeta(164) });
    for (const n of ['164', 'n165', '9999']) {
      const r = await run('leaf', ['Book', n], net);
      expect(r.error.message, n).toMatch(new RegExp(`leaf ${n.replace('n', '')} is past the end of Book: it has 164 leaves \\(0\\.\\.163, from its cached metadata\\).*nothing was fetched or cached`));
    }
    expect(net.calls).toEqual([]);
    // The last leaf is a leaf, and there is nothing to note when the count is known.
    const last = await run('leaf', ['Book', '163'], net);
    expect(last.status).toBe(0);
    expect(last.out).toHaveLength(3);
    expect(net.calls).toHaveLength(1);
  });
});
