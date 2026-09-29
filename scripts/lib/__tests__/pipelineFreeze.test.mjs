// `freeze` and `backup` (scripts/lib/pipelineRelease.mjs, pipelineBackup.mjs):
// the batch that writes keys into plans applies only what the key tool would
// apply, refuses a stale approval by name, exports the keys file afterwards, and
// backs the set folder up when asked; the backup is verified and never
// overwrites.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { review, snap } from '../keyCommands.mjs';
import { compareAll, finalizeAgreed } from '../pipelineCommands.mjs';
import { backup, freeze } from '../pipelineRelease.mjs';
import { backupSet, defaultBackupName } from '../pipelineBackup.mjs';
import { UsageError } from '../pipelineSelect.mjs';
import { keyOf } from '../realKeys.mjs';
import { makeSet, newPlan, specOf } from './pipelineHarness.mjs';

let set;
beforeEach(() => {
  set = makeSet();
});
afterEach(() => set.cleanup());

const rowOf = (out, name) => out.split('\n').find((l) => l.startsWith(name));
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

// A plan taken to the point of review: two annotators agree, the final key is A's.
const finalized = async (name) => {
  set.addPlan(name, newPlan(name));
  await set.run(snap, name, '--role', 'a', '--spec', set.writeSpec(`${name}.a.json`, specOf('a-1')));
  await set.run(snap, name, '--role', 'b', '--spec', set.writeSpec(`${name}.b.json`, specOf('b-1', 2)));
  await set.run(compareAll, '--names', name);
  await set.run(finalizeAgreed, '--names', name);
};
const approve = (name, agent = 'rev-1') => set.run(review, name, '--approve', '--agent', agent);

describe('freeze', () => {
  it('writes the key and its record into the plan, exports the keys file, and points at the manifest', async () => {
    await finalized('alpha60-n1');
    await approve('alpha60-n1');
    const r = await set.run(freeze, '--all');
    expect(r.code).toBe(0);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/alpha60-n1 +frozen +key applied; record by annotators: a-1, b-1; adjudicator: none; blind double annotation; checked /);
    expect(r.out).toMatch(/1 frozen, 0 refused/);
    const plan = set.readPlan('alpha60-n1');
    // The key in the plan is the final snapped key, outline for outline.
    const snapped = set.readJson(set.wip('alpha60-n1', '.final.snapped.json'));
    expect(keyOf(plan.floors[0].state)).toEqual(snapped.outlines.map((o) => ({ type: o.type, points: o.v })));
    expect(plan.answerKey).toMatchObject({
      by: 'annotators: a-1, b-1; adjudicator: none', verifiedBy: 'blind double annotation', checked: { by: 'AI review', via: 'final review' },
    });
    // `realKeys export` ran: the keys file holds the key, with its record.
    const keys = set.readJson(path.join(set.dir, 'answer-keys.json'));
    expect(Object.keys(keys.plans)).toEqual(['alpha60-n1']);
    expect(keys.about['alpha60-n1'].checked.by).toBe('AI review');
    expect(r.out).toMatch(/1 answer keys -> .*answer-keys\.json/);
    expect(r.out).toMatch(/not backed up: run `node scripts\/realPipeline\.mjs backup`/);
    expect(r.out).toMatch(/next: node scripts\/realManifest\.mjs build/);
  });

  it('a dry run says what it would freeze and writes nothing: no plan, no keys file, no backup', async () => {
    await finalized('alpha60-n1');
    await approve('alpha60-n1');
    const before = sha(set.planFile('alpha60-n1'));
    const r = await set.run(freeze, '--all', '--dry');
    expect(r.code).toBe(0);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/would freeze +check PASS/);
    expect(r.out).toMatch(/1 would be frozen \(dry run: nothing written\)/);
    expect(sha(set.planFile('alpha60-n1'))).toBe(before);
    expect(fs.existsSync(path.join(set.dir, 'answer-keys.json'))).toBe(false);
    await expect(set.run(freeze, '--all', '--dry', '--backup')).rejects.toThrow(UsageError);
  });

  it('refuses, by name, a plan whose key or notes changed after the approval', async () => {
    await finalized('alpha60-n1');
    await finalized('alpha60-n2');
    await approve('alpha60-n1');
    await approve('alpha60-n2');
    // n1's notes change after review-1 approved them: the snapped key is byte for byte the same.
    await set.run(snap, 'alpha60-n1', '--role', 'final', '--spec', set.writeSpec('n.json', specOf('a-1', 0, { notes: 'Changed after the approval.' })));
    const r = await set.run(freeze, '--all');
    expect(r.code).toBe(1);
    expect(rowOf(r.out, 'alpha60-n1')).toMatch(/alpha60-n1 +REFUSED +STALE approval: the final key or its notes changed after review-1 approved them/);
    expect(rowOf(r.out, 'alpha60-n2')).toMatch(/frozen/);
    expect(r.out).toMatch(/1 frozen, 1 refused/);
    expect(set.readPlan('alpha60-n1').answerKey).toBeUndefined();
    // Reviewed again as it stands, it goes through.
    await approve('alpha60-n1', 'rev-2');
    const again = await set.run(freeze, '--all');
    expect(again.code).toBe(0);
    expect(rowOf(again.out, 'alpha60-n1')).toMatch(/frozen/);
    expect(set.readPlan('alpha60-n1').answerKey.notes).toBe('Changed after the approval.');
  });

  it('says why the rest are not ready, and is not an error for them', async () => {
    await finalized('alpha60-n1');
    await finalized('alpha60-n2');
    await finalized('alpha60-n3');
    set.addPlan('alpha60-n4', newPlan('alpha60-n4'));
    await set.run(review, 'alpha60-n1', '--reject', '--agent', 'rev-1', '--reason', 'the porch is missing');
    await set.run(review, 'alpha60-n2', '--reject', '--agent', 'rev-1', '--reason', 'a corner is off');
    await set.run(snap, 'alpha60-n2', '--role', 'final', '--spec', set.writeSpec('n2.json', specOf('a-1', 0, { notes: 'Corner fixed.' })));
    const r = await set.run(freeze, '--all');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 frozen, 0 refused; not ready: 1 latest review \(n\) rejected it; 1 no final key yet; 1 no review yet; 1 the key was revised after a rejection and needs a fresh review/);
    expect(r.out).not.toMatch(/answer keys ->/);
    expect(fs.existsSync(path.join(set.dir, 'answer-keys.json'))).toBe(false);
  });

  it('will not freeze a key that fails its check, or one with no record', async () => {
    await finalized('alpha60-n1');
    await finalized('alpha60-n2');
    await approve('alpha60-n1');
    await approve('alpha60-n2');
    // The scan now reads the garage label as a room: n1's label is in the wrong outline.
    const project = set.readPlan('alpha60-n1');
    project.floors[0].state.exteriorLabels[0].bbox = { x: 150, y: 140, width: 40, height: 20 };
    set.writePlan('alpha60-n1', project);
    fs.rmSync(set.wip('alpha60-n2', '.record.json'));
    for (const argv of [['--all'], ['--all', '--dry']]) {
      const r = await set.run(freeze, ...argv);
      expect(r.code).toBe(1);
      expect(rowOf(r.out, 'alpha60-n1')).toMatch(/REFUSED .*(check FAIL|fails check)/);
      expect(rowOf(r.out, 'alpha60-n2')).toMatch(/REFUSED +alpha60-n2\.record\.json does not exist/);
    }
    expect(set.readPlan('alpha60-n1').answerKey?.checked).toBeUndefined();
  });

  it('skips a plan already frozen and does not touch it again', async () => {
    await finalized('alpha60-n1');
    await approve('alpha60-n1');
    await set.run(freeze, '--all');
    const stamp = fs.statSync(set.planFile('alpha60-n1')).mtimeMs;
    const keys = sha(path.join(set.dir, 'answer-keys.json'));
    const r = await set.run(freeze, '--all');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/0 frozen, 0 refused; not ready: 1 already frozen/);
    expect(fs.statSync(set.planFile('alpha60-n1')).mtimeMs).toBe(stamp);
    expect(sha(path.join(set.dir, 'answer-keys.json'))).toBe(keys);
  });

  it('backs the set folder up after the batch when asked, and not when nothing was frozen', async () => {
    await finalized('alpha60-n1');
    await approve('alpha60-n1');
    const idle = await set.run(freeze, '--names', 'alpha60-n1', '--dry');
    expect(idle.out).not.toMatch(/backup/);
    const r = await set.run(freeze, '--all', '--backup-name', 'real-backup-test');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/backup -> .*real-backup-test/);
    expect(r.out).toMatch(/verified: file count matches, answer-keys\.json SHA-256 [0-9a-f]{12}/);
    expect(fs.existsSync(path.join(set.root, 'real-backup-test', 'alpha60-n1.floorplan'))).toBe(true);
    expect(r.out).not.toMatch(/not backed up/);
    const nothing = await set.run(freeze, '--all', '--backup');
    expect(nothing.out).toMatch(/nothing was frozen, so no backup was made/);
  });

  it('needs a selector, like every batch', async () => {
    await expect(set.run(freeze)).rejects.toThrow(UsageError);
  });
});

describe('backup', () => {
  const seed = () => {
    for (const n of ['a60-n1', 'a60-n2']) set.addPlan(n, newPlan(n));
    set.write('answer-keys.json', '{"version":1,"plans":{}}');
    set.write('orchestration/manifest.json', '{"version":1,"plans":{}}\n');
    set.write('orchestration/briefs/x.md', 'a brief');
    set.write('keys-wip/a60-n1.a.json', '{}');
    set.write('zz-scratch/views/x.png', 'scratch');
    set.write('zz-other/y.txt', 'scratch too');
  };

  it('copies everything but the scratch folders beside the set folder, and verifies the copy', async () => {
    seed();
    const r = await set.run(backup, '--name', 'real-backup-2026-09-29');
    expect(r.code).toBe(0);
    const dest = path.join(set.root, 'real-backup-2026-09-29');
    expect(r.lines[0]).toBe(`backup -> ${dest}`);
    expect(r.lines[1]).toMatch(/^6 files, \d\.\d MB; verified: file count matches, answer-keys\.json SHA-256 [0-9a-f]{12}, manifest SHA-256 [0-9a-f]{12}$/);
    const listing = (root) => fs.readdirSync(root, { recursive: true }).filter((f) => fs.statSync(path.join(root, f)).isFile()).sort();
    expect(listing(dest)).toEqual([
      'a60-n1.floorplan', 'a60-n2.floorplan', 'answer-keys.json', path.join('keys-wip', 'a60-n1.a.json'), path.join('orchestration', 'briefs', 'x.md'), path.join('orchestration', 'manifest.json'),
    ].sort());
    expect(sha(path.join(dest, 'answer-keys.json'))).toBe(sha(path.join(set.dir, 'answer-keys.json')));
    // The set itself is as it was.
    expect(fs.existsSync(path.join(set.dir, 'zz-scratch', 'views', 'x.png'))).toBe(true);
  });

  it('never overwrites: an existing backup makes the next one NAME-2, then NAME-3', async () => {
    seed();
    const names = [];
    for (let i = 0; i < 3; i += 1) {
      const r = await set.run(backup, '--name', 'real-backup-x');
      names.push(path.basename(r.lines[0].replace('backup -> ', '')));
    }
    expect(names).toEqual(['real-backup-x', 'real-backup-x-2', 'real-backup-x-3']);
    // What was in the first backup is still there, untouched.
    set.write('answer-keys.json', '{"version":1,"plans":{"changed":[]}}');
    const first = fs.readFileSync(path.join(set.root, 'real-backup-x', 'answer-keys.json'), 'utf8');
    expect(first).toBe('{"version":1,"plans":{}}');
  });

  it('is fine on a set with no keys file or manifest yet, saying so', async () => {
    set.addPlan('a60-n1', newPlan('a60-n1'));
    const r = await set.run(backup, '--name', 'real-backup-y');
    expect(r.lines[1]).toMatch(/answer-keys\.json SHA-256 absent \(none in the set\), manifest SHA-256 absent \(none yet\)/);
  });

  it('refuses a bad name and a missing set folder', async () => {
    seed();
    await expect(backupSet(set.dir, { name: '../escape' })).rejects.toThrow(/not a backup name/);
    await expect(backupSet(path.join(set.root, 'nothing'), { name: 'real-backup-z' })).rejects.toThrow(/no set folder/);
    expect(defaultBackupName(new Date(2026, 8, 9))).toBe('real-backup-2026-09-09');
  });

  it('does not trust a copy that does not match: it says so and leaves the copy where it is', async () => {
    seed();
    const real = fs.copyFileSync;
    // A copy that damages the keys file (as a full disk or a half-synced file would).
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to) => {
      real(from, to);
      if (String(from).endsWith('answer-keys.json')) fs.writeFileSync(to, 'damaged');
    });
    try {
      await expect(backupSet(set.dir, { name: 'real-backup-bad' })).rejects.toThrow(/does not match .* in answer-keys\.json .*left as it is, not to be trusted/);
    } finally {
      spy.mockRestore();
    }
    expect(fs.existsSync(path.join(set.root, 'real-backup-bad'))).toBe(true);
    // A file count that differs is caught too (here a stray file appears in the copy as it is made).
    const stray = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to) => {
      real(from, to);
      fs.writeFileSync(path.join(path.dirname(to), 'stray.txt'), 'not from the set');
    });
    try {
      await expect(backupSet(set.dir, { name: 'real-backup-count' })).rejects.toThrow(/holds \d+ files, and .* held 6/);
    } finally {
      stray.mockRestore();
    }
  });

  it('retries a file Google Drive is holding', async () => {
    seed();
    const real = fs.copyFileSync;
    let refused = 0;
    const spy = vi.spyOn(fs, 'copyFileSync').mockImplementation((from, to) => {
      if (String(from).endsWith('a60-n1.floorplan') && refused < 2) {
        refused += 1;
        throw Object.assign(new Error('busy'), { code: 'EBUSY' });
      }
      real(from, to);
    });
    try {
      const result = await backupSet(set.dir, { name: 'real-backup-busy', retryDelayMs: 1 });
      expect(result.files).toBe(6);
      expect(refused).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});
