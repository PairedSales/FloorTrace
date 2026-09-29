// Where the key tool reads and writes (scripts/lib/keyFiles.mjs): a write into
// the set survives Google Drive holding a file and never leaves a half-written
// plan, a plan name cannot point out of the set, and the image a key is drawn
// on is the blind packet's when there is one.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkName, flattenAlpha, imageOfPlan, imageOfTarget, labelOfTarget, mimeOfFile, packetDir, planImageBytes, realDir, writeFileRetry,
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

describe('writeFileRetry', () => {
  const busy = () => Object.assign(new Error('busy'), { code: 'EBUSY' });

  it('writes a file, making its folder, and leaves no temporary file behind', async () => {
    const file = path.join(dir, 'a', 'b', 'x.json');
    await writeFileRetry(file, '{"a":1}');
    expect(fs.readFileSync(file, 'utf8')).toBe('{"a":1}');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['x.json']);
  });

  it('replaces a file whole', async () => {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, 'old');
    await writeFileRetry(file, 'new');
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
    await writeFileRetry(file, 'ok', { fsImpl, delayMs: 1 });
    expect(fs.readFileSync(file, 'utf8')).toBe('ok');
    expect(writes).toBe(3);
    expect(renames).toBe(2);
  });

  it('gives up after its retries with the original file whole and no temporary file', async () => {
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, 'precious');
    const fsImpl = { ...fs, renameSync: () => { throw busy(); } };
    await expect(writeFileRetry(file, 'new', { fsImpl, retries: 2, delayMs: 1 })).rejects.toThrow('busy');
    expect(fs.readFileSync(file, 'utf8')).toBe('precious');
    expect(fs.readdirSync(dir)).toEqual(['x.json']);
  });

  it('does not retry an error that is not Drive holding a file', async () => {
    let writes = 0;
    const fsImpl = { ...fs, writeFileSync: () => { writes += 1; throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); } };
    await expect(writeFileRetry(path.join(dir, 'x'), 'a', { fsImpl, delayMs: 1 })).rejects.toThrow('no space');
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
    fs.writeFileSync(path.join(dir, 'p.floorplan'), JSON.stringify(plan(png(12, 9))));
    fs.mkdirSync(packetDir('p', dir), { recursive: true });
    fs.writeFileSync(path.join(packetDir('p', dir), 'image.png'), png(20, 10));
    const got = await imageOfPlan('p', dir);
    expect(got.image.width).toBe(20);
    expect(got.from).toMatch(/packets/);
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
