// The manifest the real benchmark reads (lib/manifest.mjs): its hash, its
// validation, the fingerprint of a key. Synthetic files in a temp folder, so it
// runs without the set.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  keyCheck, keySha256, loadManifest, manifestHash, parseManifest, readManifest,
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
});

describe('a malformed manifest', () => {
  it('refuses a split or an era it does not know, naming the plan', () => {
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: entry('train', 'vintage') })), 'm')).toThrow(/p1: split "train"/);
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: entry('dev', '1950s') })), 'm')).toThrow(/p1: era "1950s"/);
    expect(() => parseManifest(JSON.stringify(manifestOf({ p1: { era: 'vintage' } })), 'm')).toThrow(/p1: split undefined/);
  });
});

describe('the key fingerprint', () => {
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
