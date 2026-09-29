// The manifest the real benchmark reads (lib/manifest.mjs): its hash, its
// validation, the fingerprint of a key. Synthetic files in a temp folder, so it
// runs without the set.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  hasPlan, keyCheck, keySha256, loadManifest, manifestFileFor, manifestHash, parseManifest, planEra, planSplit,
  readManifest, readWatch, watchFileFor,
} from '../manifest.mjs';

const HEX = 'a'.repeat(64);
const entry = (split, era, extra = {}) => ({
  book: 'aladdin62', split, era, keySha256: HEX, ...extra,
});
const manifestOf = (plans, extra = {}) => ({ version: 1, seed: 20260928, plans, ...extra });
const key = [{ type: 'gla', points: [[0, 0], [10, 0], [10, 10]] }];

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});
const write = (name, text) => {
  const file = path.join(dir, name);
  fs.writeFileSync(file, text);
  return file;
};

describe('the manifest file', () => {
  it('is absent when there is none, with no hash', () => {
    const file = path.join(dir, 'orchestration', 'manifest.json');
    expect(readManifest(file)).toBeNull();
    expect(manifestHash(file)).toBeNull();
    expect(loadManifest(file)).toBeNull();
  });

  it('is an error, not an absence, when the file was asked for by name', () => {
    const file = path.join(dir, 'named.json');
    expect(() => loadManifest(file, { required: true })).toThrow(/manifest .*named\.json does not exist/);
    write('named.json', JSON.stringify(manifestOf({ p1: entry('dev', 'vintage') })));
    expect(loadManifest(file, { required: true }).manifest.plans.p1.split).toBe('dev');
    // The default is the lookup that may find nothing.
    expect(loadManifest(path.join(dir, 'other.json'), { required: false })).toBeNull();
  });

  it('hashes the bytes of the file, whatever the JSON means', () => {
    const text = JSON.stringify(manifestOf({ p1: entry('dev', 'vintage') }));
    const file = write('m.json', text);
    const sha = crypto.createHash('sha256').update(Buffer.from(text)).digest('hex');
    expect(manifestHash(file)).toBe(sha);
    expect(loadManifest(file).hash).toBe(sha);
    // The same content laid out differently is another manifest.
    const spaced = write('m2.json', JSON.stringify(JSON.parse(text), null, 2));
    expect(manifestHash(spaced)).not.toBe(sha);
    // A field the reader ignores still changes the hash: the file is the identity.
    const noted = write('m3.json', JSON.stringify(manifestOf({ p1: entry('dev', 'vintage', { note: 'x' }) })));
    expect(manifestHash(noted)).not.toBe(sha);
  });

  it('reads the plans, keeping the fields it does not use', () => {
    const file = write('m.json', JSON.stringify(manifestOf({
      p1: entry('dev', 'vintage', { annotation: { annotators: ['A', 'B'] }, source: { url: 'u' } }),
      p2: entry('test', '2020-2022'),
    })));
    const manifest = readManifest(file);
    expect(planSplit(manifest, 'p1')).toBe('dev');
    expect(planEra(manifest, 'p2')).toBe('2020-2022');
    expect(planSplit(manifest, 'nope')).toBeNull();
    expect(planEra(null, 'p1')).toBeNull();
    expect(manifest.plans.p1.annotation).toEqual({ annotators: ['A', 'B'] });
  });

  it('lists a plan only by a name the file holds, never one the prototype has', () => {
    const manifest = parseManifest(JSON.stringify(manifestOf({ p1: entry('dev', 'vintage') })), 'm');
    expect(hasPlan(manifest, 'p1')).toBe(true);
    for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(hasPlan(manifest, name), name).toBe(false);
      expect(planSplit(manifest, name), name).toBeNull();
      expect(planEra(manifest, name), name).toBeNull();
    }
    expect(hasPlan(null, 'p1')).toBe(false);
    expect(hasPlan({}, 'p1')).toBe(false);
  });

  it('reads a file that begins with a byte-order mark', () => {
    const bom = String.fromCharCode(0xfeff);
    const file = write('m.json', `${bom}${JSON.stringify(manifestOf({ p1: entry('dev', 'vintage') }))}`);
    expect(planSplit(readManifest(file), 'p1')).toBe('dev');
  });

  it('finds the manifest of a set folder and the watch lists beside it', () => {
    expect(manifestFileFor(path.join('a', 'real'))).toBe(path.join('a', 'real', 'orchestration', 'manifest.json'));
    expect(watchFileFor(path.join('x', 'manifest.json'))).toBe(path.join('x', 'watch.json'));
  });
});

describe('a malformed manifest', () => {
  it('names the file when it is not JSON', () => {
    expect(() => parseManifest('{"version": 1,', 'orchestration/manifest.json')).toThrow(/orchestration\/manifest\.json is not valid JSON/);
  });

  it('refuses a version it does not read', () => {
    expect(() => parseManifest(JSON.stringify({ version: 2, plans: {} }), 'm')).toThrow(/version 2/);
    expect(() => parseManifest(JSON.stringify({ plans: {} }), 'm')).toThrow(/version undefined/);
  });

  it('refuses a split or an era it does not know, naming the plan', () => {
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: entry('train', 'vintage') })), 'm')).toThrow(/p1: split "train"/);
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: entry('dev', '1950s') })), 'm')).toThrow(/p1: era "1950s"/);
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: { era: 'vintage' } })), 'm')).toThrow(/p1: split undefined/);
  });

  it('refuses a fingerprint that is not a SHA-256', () => {
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: entry('dev', 'vintage', { keySha256: 'abc' }) })), 'm')).toThrow(/keySha256/);
  });

  it('accepts a plan with no fingerprint yet, and says how many problems it found', () => {
    const plans = { p1: { split: 'dev', era: 'vintage' } };
    expect(parseManifest(JSON.stringify(manifestOf(plans)), 'm').plans.p1.keySha256).toBeUndefined();
    const bad = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`q${i}`, { split: 'x', era: 'vintage' }]));
    expect(() => parseManifest(JSON.stringify(manifestOf(bad)), 'm')).toThrow(/and 3 more/);
  });

  it('is an error when plans is not an object', () => {
    expect(() => parseManifest(JSON.stringify({ version: 1, plans: [] }), 'm')).toThrow(/"plans" is not an object/);
  });
});

describe('the key fingerprint', () => {
  it('is the SHA-256 of the key as JSON, and none for a plan with no key', () => {
    expect(keySha256(key)).toBe(crypto.createHash('sha256').update(JSON.stringify(key)).digest('hex'));
    expect(keySha256(key)).toBe(keySha256(JSON.parse(JSON.stringify(key))));
    expect(keySha256(null)).toBeNull();
  });

  it('changes when one coordinate does', () => {
    const moved = [{ type: 'gla', points: [[0, 0], [10, 0], [10, 10.1]] }];
    expect(keySha256(moved)).not.toBe(keySha256(key));
  });

  it('checks a key against the manifest', () => {
    const sha = keySha256(key);
    expect(keyCheck(sha, key)).toBeNull();
    expect(keyCheck(undefined, key)).toBeNull();
    expect(keyCheck(null, null)).toBeNull();
    const moved = [{ type: 'gla', points: [[0, 0], [10, 0], [10, 10.1]] }];
    expect(keyCheck(sha, moved)).toBe(`key changed since the manifest (was ${sha.slice(0, 8)}, is ${keySha256(moved).slice(0, 8)})`);
    expect(keyCheck(sha, null)).toBe(`key changed since the manifest (was ${sha.slice(0, 8)}, is none)`);
  });
});

describe('the watch lists', () => {
  it('are absent without a file, and read as lists of plans', () => {
    expect(readWatch(path.join(dir, 'watch.json'))).toBeNull();
    const file = write('watch.json', JSON.stringify({ lists: { 'open porch on posts': ['p1', 'p2'], none: [] } }));
    expect(readWatch(file).lists['open porch on posts']).toEqual(['p1', 'p2']);
  });

  it('refuse a file that is not that shape', () => {
    expect(() => readWatch(write('a.json', '[1'))).toThrow(/not valid JSON/);
    expect(() => readWatch(write('b.json', JSON.stringify({ lists: { x: 'p1' } })))).toThrow(/"lists"/);
    expect(() => readWatch(write('c.json', JSON.stringify({ x: ['p1'] })))).toThrow(/"lists"/);
    expect(() => readWatch(write('d.json', JSON.stringify({ lists: { x: [1] } })))).toThrow(/"lists"/);
  });
});
