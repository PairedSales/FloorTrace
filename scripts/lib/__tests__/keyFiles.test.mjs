// Where the key tool reads and writes (scripts/lib/keyFiles.mjs): a write into
// the set survives Google Drive holding a file and never leaves a half-written
// plan, a plan name cannot point out of the set, and the image a key is drawn
// on is the blind packet's when there is one.
import { execFile } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkName, flattenAlpha, imageOfPlan, imageOfTarget, labelOfTarget, mimeOfFile, packetDir, planImageBytes, readPacketLabels, realDir, writeFileAtomic,
  writeNumbered,
} from '../keyFiles.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'keyfiles-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.FLOORTRACE_REAL_DIR;
});

const png = (w, h, fill = 255) => {
  const p = new PNG({ width: w, height: h });
  p.data.fill(fill);
  return PNG.sync.write(p);
};
const plan = (bytes) => ({
  images: { 'img-1': `data:image/png;base64,${bytes.toString('base64')}` },
  floors: [{ state: { imageRef: 'img-1' } }],
});

describe('writeFileAtomic', () => {
  const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });

  it('writes a file, making its folder, and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'a', 'b', 'x.json');
    await writeFileAtomic(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['x.json']);
  });

  it('replaces a file whole', async () => {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, 'old');
    await writeFileAtomic(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  it('retries EBUSY on the write and on the rename, then succeeds', async () => {
    let writes = 0;
    let renames = 0;
    const fsImpl = {
      ...fs,
      writeFileSync: (f, d) => {
        writes += 1;
        if (writes <= 2) throw busy();
        return fs.writeFileSync(f, d);
      },
      renameSync: (a, b) => {
        renames += 1;
        if (renames <= 1) throw Object.assign(new Error('perm'), { code: 'EPERM' });
        return fs.renameSync(a, b);
      },
    };
    const file = path.join(dir, 'x.json');
    await writeFileAtomic(file, 'ok', { fsImpl, delayMs: 1 });
    expect(fs.readFileSync(file, 'utf8')).toBe('ok');
    expect(writes).toBe(3);
    expect(renames).toBe(2);
  });

  it('gives up after its retries with the original file whole and no temporary file', async () => {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, 'precious');
    const fsImpl = { ...fs, renameSync: () => { throw busy(); } };
    await expect(writeFileAtomic(file, 'new', { fsImpl, retries: 2, delayMs: 1 })).rejects.toThrow('busy');
    expect(fs.readFileSync(file, 'utf8')).toBe('precious');
    expect(fs.readdirSync(dir)).toEqual(['x.json']);
  });

  it('does not retry an error that is not Drive holding a file', async () => {
    let writes = 0;
    const fsImpl = { ...fs, writeFileSync: () => { writes += 1; throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); } };
    await expect(writeFileAtomic(path.join(dir, 'x'), 'a', { fsImpl, delayMs: 1 })).rejects.toThrow('no space');
    expect(writes).toBe(1);
  });
});

describe('names and folders', () => {
  it('accepts a plan name and refuses anything that could leave the set', () => {
    expect(checkName('colonial63-n16')).toBe('colonial63-n16');
    expect(checkName('aladdin62-n9a')).toBe('aladdin62-n9a');
    for (const bad of ['', '../x', 'a/b', 'a\\b', '.hidden', 'x y', undefined]) expect(() => checkName(bad), String(bad)).toThrow(/not a plan name/);
  });

  it('points the tool at another folder of plans when FLOORTRACE_REAL_DIR is set', () => {
    process.env.FLOORTRACE_REAL_DIR = dir;
    expect(realDir()).toBe(path.resolve(dir));
    delete process.env.FLOORTRACE_REAL_DIR;
    expect(realDir()).toMatch(/real$/);
    expect(realDir()).not.toBe(path.resolve(dir));
  });
});

describe('the image a key is drawn on', () => {
  it('is the plan\'s image bytes, decoded to pixels', async () => {
    const bytes = png(12, 9);
    fs.writeFileSync(path.join(dir, 'p.floorplan'), JSON.stringify(plan(bytes)));
    expect(planImageBytes(plan(bytes)).bytes.equals(bytes)).toBe(true);
    const got = await imageOfPlan('p', dir);
    expect(got.image.width).toBe(12);
    expect(got.image.height).toBe(9);
    expect(got.from).toMatch(/p\.floorplan$/);
  });

  it('is the blind packet\'s when there is one', async () => {
    const bytes = png(12, 9);
    fs.writeFileSync(path.join(dir, 'p.floorplan'), JSON.stringify(plan(bytes)));
    fs.mkdirSync(packetDir('p', dir), { recursive: true });
    fs.writeFileSync(path.join(packetDir('p', dir), 'image.png'), bytes);
    const got = await imageOfPlan('p', dir);
    expect(got.image.width).toBe(12);
    expect(got.from).toMatch(/packets/);
  });

  it('refuses a packet whose image is not the plan\'s, as a plan drafted again leaves it', async () => {
    fs.writeFileSync(path.join(dir, 'p.floorplan'), JSON.stringify(plan(png(12, 9))));
    fs.mkdirSync(packetDir('p', dir), { recursive: true });
    fs.writeFileSync(path.join(packetDir('p', dir), 'image.png'), png(20, 10));
    await expect(imageOfPlan('p', dir)).rejects.toThrow(/holds a different image from the plan's.*run blind p again/);
  });

  it('takes a packet with no plan beside it as it is', async () => {
    fs.mkdirSync(packetDir('solo', dir), { recursive: true });
    fs.writeFileSync(path.join(packetDir('solo', dir), 'image.png'), png(7, 5));
    expect((await imageOfPlan('solo', dir)).image.width).toBe(7);
  });

  it('says so when there is no such plan, and refuses a plan with no image', async () => {
    await expect(imageOfPlan('missing', dir)).rejects.toThrow(/no plan named missing/);
    fs.writeFileSync(path.join(dir, 'q.floorplan'), JSON.stringify({ images: {}, floors: [{ state: { imageRef: 'x' } }] }));
    await expect(imageOfPlan('q', dir)).rejects.toThrow(/holds no image/);
  });

  it('takes an image file, or a plan name, and says which it could not find', async () => {
    const file = path.join(dir, 'page.png');
    fs.writeFileSync(file, png(8, 8));
    expect((await imageOfTarget(file, dir)).image.width).toBe(8);
    fs.writeFileSync(path.join(dir, 'p.floorplan'), JSON.stringify(plan(png(6, 6))));
    expect((await imageOfTarget('p', dir)).image.width).toBe(6);
    await expect(imageOfTarget(path.join(dir, 'gone.png'), dir)).rejects.toThrow(/no such image file/);
    await expect(imageOfTarget('gone.jpg', dir)).rejects.toThrow(/no such image file/);
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    await expect(imageOfTarget(path.join(dir, 'notes.txt'), dir)).rejects.toThrow(/not an image file/);
  });

  it('names a packet\'s image for its plan, so two plans\' views never collide', () => {
    const file = path.join(packetDir('colonial63-n16', dir), 'image.png');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, png(4, 4));
    expect(labelOfTarget(file)).toBe('colonial63-n16');
    expect(labelOfTarget('colonial63-n16')).toBe('colonial63-n16');
    expect(labelOfTarget('some/where/page-12.jpg')).toBe('page-12');
  });

  it('reads a transparent margin as paper, not as black ink', () => {
    const image = { width: 2, height: 1, data: new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]) };
    flattenAlpha(image);
    expect([...image.data]).toEqual([255, 255, 255, 255, 0, 0, 0, 255]);
    expect(mimeOfFile('a.JPG')).toBe('image/jpeg');
    expect(mimeOfFile('a.txt')).toBeNull();
  });
});

describe('writeNumbered', () => {
  it('takes the first free number from the start, and holds what was written for it', async () => {
    const fileOf = (n) => path.join(dir, `x.review-${n}.json`);
    fs.writeFileSync(fileOf(1), 'one');
    fs.writeFileSync(fileOf(2), 'two');
    const got = await writeNumbered(fileOf, 1, (n) => `number ${n}`);
    expect(got).toEqual({ n: 3, file: fileOf(3) });
    expect(fs.readFileSync(fileOf(3), 'utf8')).toBe('number 3');
    expect(fs.readFileSync(fileOf(1), 'utf8')).toBe('one');
  });

  it('never gives two writers one number: writers that all started at 1 get 1 to 8 between them', async () => {
    const fileOf = (n) => path.join(dir, 'sub', `x.review-${n}.json`);
    const got = await Promise.all(Array.from({ length: 8 }, (_, i) => writeNumbered(fileOf, 1, (n) => `writer ${i} took ${n}`)));
    expect(got.map((g) => g.n).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    got.forEach((g, i) => expect(fs.readFileSync(g.file, 'utf8')).toBe(`writer ${i} took ${g.n}`));
  });

  it('never gives two processes one number, which is what two reviewers at once are', async () => {
    // Separate processes, so the creates really do race: 4 of them take 5 numbers each.
    const child = path.join(dir, 'child.mjs');
    fs.writeFileSync(child, [
      "const { writeNumbered } = await import(process.argv[2]);",
      "const folder = process.argv[3];",
      "for (let i = 0; i < 5; i += 1) {",
      "  await writeNumbered((n) => folder + '/x.review-' + n + '.json', 1, (n) => 'pid ' + process.pid + ' took ' + n);",
      "}",
    ].join('\n'));
    const keyFiles = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'keyFiles.mjs')).href;
    const folder = path.join(dir, 'r');
    const spawn = () => new Promise((resolve, reject) => {
      execFile(process.execPath, [child, keyFiles, folder], (error, _out, err) => (error ? reject(new Error(err || error.message)) : resolve()));
    });
    await Promise.all([spawn(), spawn(), spawn(), spawn()]);
    const files = fs.readdirSync(folder).sort();
    expect(files).toEqual(Array.from({ length: 20 }, (_, i) => 'x.review-' + (i + 1) + '.json').sort());
    // Each file is whole and says the number it was made under.
    for (const f of files) expect(fs.readFileSync(path.join(folder, f), 'utf8')).toMatch(new RegExp('took ' + /x\.review-(\d+)\.json/.exec(f)[1] + '$'));
  }, 60000);

  it('retries a file Drive holds, and does not overwrite what is there when it loses a race', async () => {
    const fileOf = (n) => path.join(dir, `y.review-${n}.json`);
    let busy = 2;
    const impl = {
      ...fs,
      writeFileSync: (...args) => {
        if (busy > 0) {
          busy -= 1;
          throw Object.assign(new Error('busy'), { code: 'EBUSY' });
        }
        return fs.writeFileSync(...args);
      },
    };
    fs.writeFileSync(fileOf(1), 'taken');
    const got = await writeNumbered(fileOf, 1, () => 'mine', { delayMs: 1, fsImpl: impl });
    expect(got.n).toBe(2);
    expect(busy).toBe(0);
    expect(fs.readFileSync(fileOf(1), 'utf8')).toBe('taken');
  });

  it('does not swallow an error that is not a number taken', async () => {
    const impl = { ...fs, writeFileSync: () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
    await expect(writeNumbered((n) => path.join(dir, `z-${n}.json`), 1, () => 'x', { fsImpl: impl })).rejects.toThrow(/disk full/);
  });
});

describe('a blind packet\'s labels', () => {
  const write = (labels) => {
    const folder = packetDir('demo', dir);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(path.join(folder, 'labels.json'), JSON.stringify(labels));
  };
  const good = { id: 'd0', kind: 'room', text: 'x', bbox: { x: 1, y: 2, width: 3, height: 4 } };

  it('are read as the annotators saw them, and there are none without a packet', () => {
    expect(readPacketLabels('demo', dir)).toBeNull();
    write({ labels: [good, { ...good, id: 'a0', kind: 'level' }] });
    expect(readPacketLabels('demo', dir)).toEqual([good, { ...good, id: 'a0', kind: 'level' }]);
    write({ labels: [] });
    expect(readPacketLabels('demo', dir)).toEqual([]);
  });

  it('are refused when they are not a labels list, saying to run blind again', () => {
    for (const bad of [{ labels: [{ id: 'd0' }] }, { labels: [{ ...good, kind: 'garage' }] }, { labels: [{ ...good, bbox: { x: 1 } }] }, { labels: 'x' }, {}]) {
      write(bad);
      expect(() => readPacketLabels('demo', dir), JSON.stringify(bad)).toThrow(/is not a labels list.*run blind demo again/);
    }
  });
});
