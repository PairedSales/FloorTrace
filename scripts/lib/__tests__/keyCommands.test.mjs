// The key tool's commands (scripts/lib/keyCommands.mjs) end to end on a scratch
// set folder holding one synthetic plan: the blind packet, snap, compare,
// check, review and apply, and the promises the protocol rests on. `snap`
// never reads or writes the plan's trace or key; `apply` is the only writer
// into a plan, and only for a key that passed check and was approved as it
// stands.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  UsageError, apply, blind, check, compare, probe, review, score, snap, view,
} from '../keyCommands.mjs';
import { keySha256 } from '../manifest.mjs';
import { applyKey, keyOf } from '../realKeys.mjs';

const W = 460;
const H = 300;
const image = (extra = () => {}) => {
  const p = new PNG({ width: W, height: H });
  p.data.fill(255);
  const fill = (x0, y0, x1, y1) => {
    for (let y = y0; y < y1; y += 1) {
      for (let x = x0; x < x1; x += 1) {
        const i = (y * W + x) * 4;
        p.data[i] = 0;
        p.data[i + 1] = 0;
        p.data[i + 2] = 0;
      }
    }
  };
  fill(100, 80, 400, 88);
  fill(100, 212, 400, 220);
  fill(100, 80, 108, 220);
  fill(292, 80, 300, 220);
  fill(392, 80, 400, 220);
  extra(fill);
  return PNG.sync.write(p);
};
const TRACE_MARK = 777.7777;
const project = (extra) => ({
  fileType: 'floortrace',
  version: 1,
  metadata: { projectId: 'real-demo', projectName: 'demo', createdAt: 'then', updatedAt: 'then' },
  images: { 'img-1': `data:image/png;base64,${image(extra).toString('base64')}` },
  floors: [{
    id: 'f1',
    name: 'Floor 1',
    state: {
      imageRef: 'img-1',
      imageMimeType: 'image/png',
      projectName: 'demo',
      perimeterTraces: [{
        id: 'trace-1', type: 'gla', closed: true, typeSource: 'auto', nameSource: 'auto',
        vertices: [{ x: TRACE_MARK, y: 1 }, { x: 2, y: TRACE_MARK }, { x: 3, y: 4 }],
        quality: { source: 'auto', confidence: 0.9, warnings: [] },
      }],
      activeTraceId: 'trace-1',
      detectedDimensions: [{ width: 20, height: 14, text: "20' x 14'", bbox: { x: 180, y: 140, width: 40, height: 20 }, confidence: 90, format: 'inches' }],
      exteriorLabels: [{ keyword: 'garage', text: 'GARAGE', bbox: { x: 330, y: 140, width: 40, height: 20 } }],
      areaLabels: [],
      rooms: [{ id: 'r1', name: 'room' }],
      calibration: { calibrated: true, feetPerPixel: { x: 0.1, y: 0.1 }, source: 'room-calibration' },
      lastTraceOutcome: { at: 1, level: 'good', reason: null, floors: 1, source: 'auto' },
    },
  }],
  activeFloorId: 'f1',
});
// The rough drawing, every vertex `shift` px off the same way, so each edge
// stays parallel to its wall (a snap moves an edge along its normal and keeps
// its slope).
const specOf = (author, shift = 0, extra = {}) => ({
  author,
  notes: 'House with attached garage; the garage shares the house\'s right wall (kept by the house).',
  outlines: [
    {
      type: 'gla',
      v: [[97 + shift, 77 + shift], [303 + shift, 77 + shift], [303 + shift, 223 + shift], [97 + shift, 223 + shift]],
      name: 'first floor',
    },
    { type: 'garage', v: [['ref', 0, 1], [403 + shift, 77 + shift], [403 + shift, 223 + shift], ['ref', 0, 2]], in: [3] },
  ],
  ...extra,
});
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

let root;
let scratch;
let lines;
let ctx;
const run = async (command, ...argv) => {
  lines.length = 0;
  const code = await command(argv, ctx);
  return { code, out: lines.join('\n') };
};
const plan = () => path.join(root, 'demo.floorplan');
const wip = (suffix) => path.join(root, 'keys-wip', `demo${suffix}`);
const writeSpec = (name, spec) => {
  const file = path.join(scratch, name);
  fs.writeFileSync(file, JSON.stringify(spec));
  return file;
};
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'keycmd-'));
  scratch = path.join(root, 'scratch');
  fs.mkdirSync(scratch);
  fs.writeFileSync(plan(), JSON.stringify(project()));
  lines = [];
  // `setManifestFile`: where `score` looks for the set's own manifest when the folder has none.
  ctx = {
    dir: root, root, out: (l) => lines.push(l), setManifestFile: path.join(root, 'no-set-manifest.json'), env: {},
  };
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('blind', () => {
  it('writes the packet: the image bytes, the labels and the size, and nothing of the trace', async () => {
    const { code, out } = await run(blind, 'demo');
    expect(code).toBe(0);
    const dir = path.join(root, 'keys-wip', 'packets', 'demo');
    expect(fs.readdirSync(dir).sort()).toEqual(['image.png', 'labels.json', 'meta.json']);
    expect(readJson(path.join(dir, 'meta.json'))).toEqual({ name: 'demo', width: W, height: H });
    const bytes = Buffer.from(project().images['img-1'].split(',')[1], 'base64');
    expect(fs.readFileSync(path.join(dir, 'image.png')).equals(bytes)).toBe(true);
    const text = fs.readFileSync(path.join(dir, 'labels.json'), 'utf8');
    expect(text).not.toMatch(/perimeterTraces|calibration|feetPerPixel|confidence|quality|777/);
    expect(readJson(path.join(dir, 'labels.json')).labels.map((l) => `${l.id}:${l.kind}`)).toEqual(['d0:room', 'e0:nonGla']);
    expect(out).toContain('2 labels (1 room, 1 nonGla, 0 level)');
  });

  it('is idempotent, and leaves the plan alone', async () => {
    const before = sha(plan());
    await run(blind, 'demo');
    const first = fs.readFileSync(path.join(root, 'keys-wip', 'packets', 'demo', 'labels.json'), 'utf8');
    await run(blind, 'demo');
    expect(fs.readFileSync(path.join(root, 'keys-wip', 'packets', 'demo', 'labels.json'), 'utf8')).toBe(first);
    expect(sha(plan())).toBe(before);
  });
});

describe('snap', () => {
  it('snaps a rough spec to the wall faces, keeps the spec, and never touches the plan', async () => {
    await run(blind, 'demo');
    const before = sha(plan());
    const file = writeSpec('a.json', specOf('a-demo'));
    const { code, out } = await run(snap, 'demo', '--role', 'a', '--spec', file);
    expect(code).toBe(0);
    expect(sha(plan())).toBe(before);
    // The spec is kept exactly as written, and the snapped file holds the faces.
    expect(fs.readFileSync(wip('.a.json'), 'utf8')).toBe(fs.readFileSync(file, 'utf8'));
    const snapped = readJson(wip('.a.snapped.json'));
    const [house, garage] = snapped.outlines;
    expect(house.type).toBe('gla');
    expect(house.v[0][0]).toBeCloseTo(100, 0);
    expect(house.v[0][1]).toBeCloseTo(80, 0);
    expect(house.v[2][0]).toBeCloseTo(300, 0);
    expect(house.v[2][1]).toBeCloseTo(220, 0);
    // The garage shares the house's right-hand vertices exactly.
    expect(garage.v[0]).toEqual(house.v[1]);
    expect(garage.v[3]).toEqual(house.v[2]);
    expect(garage.v[1][0]).toBeCloseTo(400, 0);
    expect(snapped.image).toEqual({ width: W, height: H });
    expect(snapped.flagged).toEqual([]);
    // It says what it did, and nothing of the trace.
    expect(out).toMatch(/edge 0: [+-]\d\.\d px/);
    expect(out).toMatch(/edge 3: fixed/);
    expect(out).not.toMatch(/777|confidence|quality/);
    expect(JSON.stringify(snapped)).not.toMatch(/777|confidence|quality/);
  });

  it('will not let a second agent replace an annotator\'s key by naming the same role, unless --replace', async () => {
    await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    const before = fs.readFileSync(wip('.a.json'), 'utf8');
    const other = writeSpec('other.json', specOf('b-demo', 3));
    await expect(run(snap, 'demo', '--role', 'a', '--spec', other)).rejects.toThrow(/demo\.a\.json already holds a spec by "a-demo", and this spec's author is "b-demo".*--replace/s);
    // A spec that names no author cannot show it is the same agent.
    const bare = specOf('x');
    delete bare.author;
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('bare.json', bare))).rejects.toThrow(/author is not set/);
    expect(fs.readFileSync(wip('.a.json'), 'utf8')).toBe(before);
    // The same author refining their own spec is the normal loop, and says what it replaced.
    const again = await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a2.json', specOf('a-demo', 1)));
    expect(again.out).toMatch(/note: replaced the earlier demo\.a\.json \(author "a-demo"\)/);
    // --replace is the way to take the role over.
    const taken = await run(snap, 'demo', '--role', 'a', '--spec', other, '--replace');
    expect(taken.out).toMatch(/note: replaced the earlier demo\.a\.json \(author "a-demo"\)/);
    expect(readJson(wip('.a.json')).author).toBe('b-demo');
  });

  it('refuses a vertex far outside the image, and lets one sit on its edge', async () => {
    const spec = specOf('a-demo');
    spec.outlines[0].v[0] = [-40, 77];
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('out.json', spec))).rejects.toThrow(/outline 0 \(gla\) vertex 0 \[-40, 77\] lies outside the 460 x 300 px image/);
    spec.outlines[0].v[0] = [97, 77];
    spec.outlines[1].v[1] = [463, 77];
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('out2.json', spec))).rejects.toThrow(/vertex 1 \[463, 77\] lies outside/);
    expect(fs.existsSync(wip('.a.json'))).toBe(false);
    // On the page's edge, or a pixel past it, is a plan cut by its crop.
    const edge = { outlines: [{ type: 'gla', v: [[0, 0], [460, 0], [461, 300], [0, 300]], fix: [0, 1, 2, 3] }] };
    const { code } = await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('edge.json', edge));
    expect(code).toBe(0);
  });
});

describe('compare', () => {
  const both = async (shiftB = 0) => {
    await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b.json', specOf('b-demo', shiftB)));
  };

  it('agrees on two drawings that snap to the same faces, and writes the comparison', async () => {
    await both(2);
    const { code, out } = await run(compare, 'demo');
    expect(code).toBe(0);
    expect(out).toMatch(/^compare demo/);
    expect(out).toMatch(/IoU: building (99\.9\d|100\.00)%/);
    expect(out).toMatch(/^AGREE$/m);
    const record = readJson(wip('.compare.json'));
    expect(record.agree).toBe(true);
    expect(record.counts.a).toEqual({ gla: 1, garage: 1 });
  });
});

describe('check', () => {
  const finalKey = async (spec = specOf('adj')) => run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final.json', spec));

  it('passes a sound key and prints the areas at the plan\'s scale', async () => {
    await finalKey();
    const { code, out } = await run(check, 'demo');
    expect(out).toMatch(/CHECK PASS$/);
    expect(code).toBe(0);
    // 200 x 140 px at 0.1 ft/px is 280 sq ft; faces are read to a tenth of a pixel.
    expect(out).toMatch(/outline 0 gla "first floor": .* 2(79|80) sq ft/);
    expect(out).toMatch(/total GLA 2(79|80) sq ft, garage 14[01]/);
    expect(out).toMatch(/PASS +labels +2 of 2 labels/);
  });

  it('takes a scale from the command line when the plan has none, and says when there is none', async () => {
    const p = project();
    p.floors[0].state.calibration = { calibrated: false };
    fs.writeFileSync(plan(), JSON.stringify(p));
    await finalKey(specOf('adj', 0, { stated: [{ sqft: 280 }] }));
    let { out } = await run(check, 'demo');
    expect(out).toMatch(/scale none/);
    expect(out).toMatch(/WARN +stated .*no scale/);
    ({ out } = await run(check, 'demo', '--feet-per-pixel', '0.1'));
    expect(out).toMatch(/PASS +stated/);
    const { out: json } = await run(check, 'demo', '--feet-per-pixel', '0.1', '--json');
    expect(JSON.parse(json)).toMatchObject({ pass: true, failures: 0 });
  });

  it('warns of an edge the snap moved far onto a band, which a second snap of the snapped key cannot see', async () => {
    // The top edge drawn 12 px off its wall: the snap moves it there and flags it
    // `far`. The snapped key then re-snaps in place, so the face check passes.
    const spec = specOf('adj');
    spec.outlines[0].v[0][1] = 68;
    spec.outlines[0].v[1][1] = 68;
    await finalKey(spec);
    const { code, out } = await run(check, 'demo');
    expect(code).toBe(0);
    expect(out).toMatch(/WARN +faces +outline 0 gla edge 0: the snap flagged it far \(moved 1\d\.\d px onto the band it found, which may not be the wall/);
    expect(out).toMatch(/CHECK PASS$/);
    // Listed in "fix", the edge stays where it was drawn and there is nothing to warn of.
    spec.outlines[0].fix = [0];
    await finalKey(spec);
    const fixed = await run(check, 'demo');
    expect(fixed.out).not.toMatch(/flag far/);
  });

  it('judges labels against the blind packet, not the plan\'s scan read again', async () => {
    await run(blind, 'demo');
    await finalKey();
    let { out } = await run(check, 'demo');
    expect(out).toMatch(/labels from the blind packet/);
    expect(out).not.toMatch(/WARN +labels/);
    // The plan is drafted again with the same crop but another scan: the room
    // size reads elsewhere and a new label appears. The key was drawn against the
    // packet, and that is what it is judged by; the drift is a warning.
    const p = project();
    p.floors[0].state.detectedDimensions[0].bbox = { x: 20, y: 20, width: 40, height: 20 };
    p.floors[0].state.detectedDimensions.push({ width: 5, height: 5, text: "5' x 5'", bbox: { x: 30, y: 250, width: 40, height: 20 } });
    fs.writeFileSync(plan(), JSON.stringify(p));
    ({ out } = await run(check, 'demo'));
    expect(out).toMatch(/PASS +labels +2 of 2 labels/);
    expect(out).toMatch(/WARN +labels +packet: the plan's scan now reads 2 label\(s\) differently/);
    expect(out).toMatch(/CHECK PASS$/);
    // Without a packet the plan's scan is all there is.
    fs.rmSync(path.join(root, 'keys-wip', 'packets'), { recursive: true });
    ({ out } = await run(check, 'demo'));
    expect(out).toMatch(/labels from the plan's scan/);
    expect(out).toMatch(/WARN +labels +d0: .* lies in no outline/);
  });
});

describe('review and apply: the freeze', () => {
  const RECORD = { annotators: ['a-demo', 'b-demo'], adjudicator: null, verifiedBy: 'blind double annotation' };
  const finalKey = () => run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final.json', specOf('a-demo')));
  const writeRecord = (over = {}) => fs.writeFileSync(wip('.record.json'), JSON.stringify({ ...RECORD, ...over }));
  const original = () => project();

  it('records a review: its number, who, when, the decision and the key it saw', async () => {
    await finalKey();
    const { out } = await run(review, 'demo', '--approve', '--agent', 'rev-1', '--note', 'fine');
    const rec = readJson(wip('.review-1.json'));
    expect(rec).toMatchObject({ n: 1, agent: 'rev-1', decision: 'approve', note: 'fine', region: null, reason: null });
    expect(rec.keySha256).toBe(sha(wip('.final.snapped.json')));
    expect(rec.specSha256).toBe(sha(wip('.final.json')));
    expect(Date.parse(rec.at)).toBeGreaterThan(0);
    expect(out).toContain('review-1.json');
    await run(review, 'demo', '--reject', '--agent', 'rev-2', '--region', '90,70,120,100', '--reason', 'the corner is off');
    expect(readJson(wip('.review-2.json'))).toMatchObject({ n: 2, decision: 'reject', region: [90, 70, 120, 100], reason: 'the corner is off' });
  });

  it('refuses a reviewer who drew or adjudicated the key', async () => {
    await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    await finalKey();
    writeRecord({ adjudicator: 'adj-demo' });
    await expect(run(review, 'demo', '--approve', '--agent', 'a-demo')).rejects.toThrow(/may not review it/);
    await expect(run(review, 'demo', '--approve', '--agent', 'b-demo')).rejects.toThrow(/may not review it/);
    await expect(run(review, 'demo', '--approve', '--agent', 'adj-demo')).rejects.toThrow(/may not review it/);
    await run(review, 'demo', '--approve', '--agent', 'fresh-eyes');
  });

  it('writes the key and its record into the plan, and changes nothing else', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    const { out } = await run(apply, 'demo');
    expect(out).toMatch(/demo: key applied; record by annotators: a-demo, b-demo; adjudicator: none; blind double annotation; checked /);
    const after = readJson(plan());
    const before = original();
    // The key is the final snapped outlines, typed and in the app's own form.
    const snapped = readJson(wip('.final.snapped.json'));
    expect(keyOf(after.floors[0].state)).toEqual(snapped.outlines.map((o) => ({ type: o.type, points: o.v })));
    expect(after.answerKey).toEqual({
      by: 'annotators: a-demo, b-demo; adjudicator: none',
      verifiedBy: 'blind double annotation',
      checked: { by: 'AI review', at: readJson(wip('.review-1.json')).at, via: 'final review' },
      at: expect.any(String),
      notes: specOf('a-demo').notes,
    });
    expect(after.metadata.updatedAt).not.toBe('then');
    // Image, labels, calibration, scale and the rest are as they were.
    expect(after.images).toEqual(before.images);
    const state = after.floors[0].state;
    for (const key of ['imageRef', 'detectedDimensions', 'exteriorLabels', 'areaLabels', 'rooms', 'calibration', 'projectName']) {
      expect(state[key], key).toEqual(before.floors[0].state[key]);
    }
    expect(after.metadata).toEqual({ ...before.metadata, updatedAt: after.metadata.updatedAt });
  });

  it('refuses without a review, with a rejection, or when the key changed after the approval', async () => {
    await finalKey();
    writeRecord();
    await expect(run(apply, 'demo')).rejects.toThrow(/has no review/);
    await run(review, 'demo', '--reject', '--agent', 'rev-1', '--reason', 'the porch is missing');
    await expect(run(apply, 'demo')).rejects.toThrow(/is a rejection: the porch is missing/);
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    // A later, different final key needs its own review.
    const spec = specOf('a-demo');
    spec.outlines[0].name = 'main floor';
    await finalKey();
    fs.writeFileSync(wip('.final.snapped.json'), fs.readFileSync(wip('.final.snapped.json'), 'utf8').replace('"gla"', '"below-grade"'));
    await expect(run(apply, 'demo')).rejects.toThrow(/changed after review-2 approved it/);
    expect(JSON.parse(fs.readFileSync(plan(), 'utf8')).answerKey).toBeUndefined();
  });

  it('binds the approval to the notes, waivers and stated figures too: a changed spec needs a fresh review', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    // The same geometry with other notes and a waiver: the snapped file is byte for byte the same.
    const snappedBefore = fs.readFileSync(wip('.final.snapped.json'), 'utf8');
    const changed = specOf('a-demo', 0, { notes: 'Nothing to see here.', waive: [{ label: 'd0', reason: 'trust me' }] });
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final2.json', changed));
    expect(fs.readFileSync(wip('.final.snapped.json'), 'utf8')).toBe(snappedBefore);
    await expect(run(apply, 'demo')).rejects.toThrow(/final spec \(its notes, waivers and stated figures\) changed after review-1 approved it/);
    expect(readJson(plan()).answerKey).toBeUndefined();
    // Reviewed again as it now stands, it goes through, with the notes the reviewer saw.
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    await run(apply, 'demo');
    expect(readJson(plan()).answerKey.notes).toBe('Nothing to see here.');
  });

  it('refuses a key that fails check, a missing or malformed record, and empty notes', async () => {
    const spec = specOf('a-demo');
    spec.outlines[1].type = 'gla';
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final.json', spec));
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await expect(run(apply, 'demo')).rejects.toThrow(/fails check \(1 failure/);
    await finalKey();
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    fs.rmSync(wip('.record.json'));
    await expect(run(apply, 'demo')).rejects.toThrow(/record\.json does not exist/);
    writeRecord({ verifiedBy: 'a hunch' });
    await expect(run(apply, 'demo')).rejects.toThrow(/"verifiedBy" must be one of/);
    writeRecord({ annotators: [] });
    await expect(run(apply, 'demo')).rejects.toThrow(/"annotators": a non-empty array/);
    writeRecord();
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final.json', { ...specOf('a-demo'), notes: ' ' }));
    await run(review, 'demo', '--approve', '--agent', 'rev-3');
    await expect(run(apply, 'demo')).rejects.toThrow(/has no "notes"/);
  });

  it('will not freeze a key snapped on another page than the plan\'s image', async () => {
    await finalKey();
    const snapped = readJson(wip('.final.snapped.json'));
    snapped.image = { width: 1000, height: 400 };
    fs.writeFileSync(wip('.final.snapped.json'), JSON.stringify(snapped));
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await expect(run(apply, 'demo')).rejects.toThrow(/fails check \(1 failure/);
    expect(readJson(plan()).answerKey).toBeUndefined();
  });

  it('never replaces a checked key unless a dispute is named, and then records it', async () => {
    await finalKey();
    writeRecord({ adjudicator: 'adj-demo' });
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await run(apply, 'demo');
    expect(readJson(plan()).answerKey.by).toBe('annotators: a-demo, b-demo; adjudicator: adj-demo');
    // A dispute settles that the garage is a porch: a changed final key.
    const changed = specOf('a-demo');
    changed.outlines[1].type = 'porch';
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('final2.json', changed));
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    await expect(run(apply, 'demo')).rejects.toThrow(/is frozen: a change comes only through a dispute/);
    const { out } = await run(apply, 'demo', '--dispute', 'D-7');
    expect(out).toContain('dispute D-7');
    expect(readJson(plan()).answerKey.disputeId).toBe('D-7');
    expect(keyOf(readJson(plan()).floors[0].state).map((o) => o.type)).toEqual(['gla', 'porch']);
  });

  it('refuses a dispute that would change nothing: the plan is not marked as changed by it', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await run(apply, 'demo');
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    const before = sha(plan());
    // The frozen key survives its dispute: the final key is the key already there.
    await expect(run(apply, 'demo', '--dispute', 'D-8')).rejects.toThrow(/--dispute D-8: the final key is the key demo already holds.*log that the key stands/);
    expect(sha(plan())).toBe(before);
    expect(readJson(plan()).answerKey.disputeId).toBeUndefined();
  });

  it('applies the same key again under a new record when the plan\'s key was never checked', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await run(apply, 'demo');
    const first = readJson(plan());
    // A record from an earlier pass: written by someone, never checked.
    delete first.answerKey.checked;
    fs.writeFileSync(plan(), JSON.stringify(first));
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    const { out } = await run(apply, 'demo');
    expect(out).toMatch(/key unchanged/);
    const second = readJson(plan()).answerKey;
    expect(second.checked).toMatchObject({ by: 'AI review', via: 'final review' });
    expect(second.disputeId).toBeUndefined();
  });
});

describe('view, probe and sheet', () => {
  it('writes a view under the tag\'s own folder and prints its path and its crop', async () => {
    await run(blind, 'demo');
    const packetImage = path.join(root, 'keys-wip', 'packets', 'demo', 'image.png');
    const one = await run(view, packetImage, '--crop', '60,40,340,240', '--grid', '20', '--tag', 'ann-a');
    const two = await run(view, packetImage, '--crop', '60,40,340,240', '--grid', '20', '--tag', 'ann-b');
    const [pathA, lineA] = one.out.split('\n');
    const [pathB] = two.out.split('\n');
    expect(pathA).toBe(path.join(root, 'datasets', 'zz-scratch', 'views', 'ann-a', 'demo-60_40_340_240-g20.png'));
    expect(pathB).toBe(path.join(root, 'datasets', 'zz-scratch', 'views', 'ann-b', 'demo-60_40_340_240-g20.png'));
    expect(fs.existsSync(pathA) && fs.existsSync(pathB)).toBe(true);
    expect(lineA).toMatch(/^crop 60,40→340,240 {2}scale \d+\.\d\d px\/px {2}grid 20$/);
  });

  it('probes the ink along a segment: the runs, in pixels', async () => {
    const { out } = await run(probe, 'demo', '--from', '200,70', '--to', '200,100');
    // Light to y=80, dark 80-88, light after.
    expect(out).toMatch(/ink threshold 127\.5/);
    expect(out).toMatch(/light 0\.0–10\.0 \(10\.0 px\)/);
    expect(out).toMatch(/dark 10\.0–18\.0 \(8\.0 px\)/);
    expect(out).toMatch(/light 18\.0–30\.0 \(12\.0 px\)/);
    const across = await run(probe, 'demo', '--across', '200,84,90', '--half', '12');
    expect(across.out).toMatch(/dark -4\.0–4\.0 \(8\.0 px\)/);
    await expect(run(probe, 'demo', '--from', '1,1')).rejects.toThrow(UsageError);
  });

  it('will not read past the page: a probe that leaves the image is an error, not the border\'s pixels', async () => {
    await expect(run(probe, 'demo', '--from', '200,290', '--to', '200,310')).rejects.toThrow(/leaves the 460 x 300 px image/);
    await expect(run(probe, 'demo', '--from', '-5,10', '--to', '20,10')).rejects.toThrow(/leaves the 460 x 300 px image/);
    await expect(run(probe, 'demo', '--across', '200,4,90', '--half', '12')).rejects.toThrow(/leaves the 460 x 300 px image/);
    // Right up to the edge is on the page.
    const { code } = await run(probe, 'demo', '--from', '200,290', '--to', '200,300');
    expect(code).toBe(0);
  });
});

describe('--tag', () => {
  it('refuses a tag that is not a name before writing anything', async () => {
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')), '--tag', '../x')).rejects.toThrow(/--tag/);
    expect(fs.existsSync(wip('.a.json'))).toBe(false);
  });
});

describe('score', () => {
  const KEY = [
    { type: 'gla', points: [[100, 80], [300, 80], [300, 220], [100, 220]] },
    { type: 'garage', points: [[300, 80], [400, 80], [400, 220], [300, 220]] },
  ];
  const RECORD = {
    by: 'annotators: a-demo, b-demo; adjudicator: none',
    verifiedBy: 'blind double annotation',
    checked: { by: 'AI review', at: '2026-09-29T10:00:00.000Z', via: 'final review' },
    at: '2026-09-29T10:00:00.000Z',
    notes: 'a test key',
  };
  const keyed = () => {
    const p = project();
    applyKey(p.floors[0].state, KEY, { force: true });
    p.answerKey = RECORD;
    return p;
  };
  const traceFile = (name, json) => writeSpec(name, json);
  const houseOnly = { outlines: [{ type: 'gla', closed: true, vertices: [{ x: 100, y: 80 }, { x: 300, y: 80 }, { x: 300, y: 220 }, { x: 100, y: 220 }] }] };

  beforeEach(() => {
    fs.writeFileSync(plan(), JSON.stringify(keyed()));
  });

  it('refuses a plan with no key yet, and says how to call it', async () => {
    fs.writeFileSync(plan(), JSON.stringify(project()));
    await expect(run(score, 'demo', traceFile('t.json', houseOnly))).rejects.toThrow(/demo has no answer key yet/);
    await expect(run(score, 'demo')).rejects.toThrow(UsageError);
    await expect(run(score, 'demo', path.join(scratch, 'nope.json'))).rejects.toThrow(/no answer key yet|does not exist/);
    fs.writeFileSync(plan(), JSON.stringify(keyed()));
    await expect(run(score, 'demo', path.join(scratch, 'nope.json'))).rejects.toThrow(/nope\.json does not exist/);
    await expect(run(score, 'nosuch', traceFile('t.json', houseOnly))).rejects.toThrow(/no plan named nosuch/);
  });

  it('scores the key\'s own house as perfect and writes nothing', async () => {
    const before = sha(plan());
    const { code, out } = await run(score, 'demo', traceFile('t.json', { ...houseOnly, confidence: 0.93, warnings: ['thin-structure-excluded'] }));
    expect(code).toBe(0);
    expect(out.split('\n')[0]).toBe('score demo: verdict PERFECT   IoU 100.00%   area error +0.0% (the outlines cover more than the key\'s building)');
    expect(out).toContain('key: gla, garage   (annotators: a-demo, b-demo; adjudicator: none; checked 2026-09-29 (AI review))');
    expect(out).toContain('traced: 1 floor(s) from gla');
    expect(out).toContain('confidence 93.0% (good)');
    expect(out).not.toMatch(/WRONG BUT SHOWN/);
    expect(out).toContain('warnings: thin-structure-excluded');
    expect(sha(plan())).toBe(before);
  });

  describe('the test split, and the manifest', () => {
    const writeManifest = (file, split, extra = {}) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ version: 1, plans: { demo: { split, era: 'vintage', ...extra } } }));
    };

    it('leaves a test plan\'s verdict to the orchestrator: refused before the plan is opened, unless it says so', async () => {
      writeManifest(path.join(root, 'orchestration', 'manifest.json'), 'test');
      const file = traceFile('t.json', houseOnly);
      await expect(run(score, 'demo', file)).rejects.toThrow(/demo is in the test split.*FLOORTRACE_TEST_SPLIT_OK=1/);
      await expect(run(score, 'demo', file)).rejects.toThrow(UsageError);
      // Not even the plan is read: a plan that is not there is the gate's answer too.
      await expect(run(score, 'demo', path.join(scratch, 'nope.json'))).rejects.toThrow(/test split/);
      ctx.env = { FLOORTRACE_TEST_SPLIT_OK: '1' };
      const { code, out } = await run(score, 'demo', file);
      expect(code).toBe(0);
      expect(out).toMatch(/verdict PERFECT/);
    });

    it('scores a dev plan, and reads the set\'s manifest when the folder has none of its own', async () => {
      writeManifest(path.join(root, 'orchestration', 'manifest.json'), 'dev');
      expect((await run(score, 'demo', traceFile('t.json', houseOnly))).code).toBe(0);
      fs.rmSync(path.join(root, 'orchestration'), { recursive: true });
      writeManifest(ctx.setManifestFile, 'test');
      await expect(run(score, 'demo', traceFile('t.json', houseOnly))).rejects.toThrow(/test split/);
      // A plan the manifest does not list is not in test.
      fs.writeFileSync(ctx.setManifestFile, JSON.stringify({ version: 1, plans: {} }));
      expect((await run(score, 'demo', traceFile('t.json', houseOnly))).code).toBe(0);
    });

    it('says when the plan\'s key is not the one the manifest froze, as bench:real refuses it', async () => {
      const key = keyOf(readJson(plan()).floors[0].state);
      writeManifest(path.join(root, 'orchestration', 'manifest.json'), 'dev', { keySha256: keySha256(key) });
      const same = await run(score, 'demo', traceFile('t.json', houseOnly), '--json');
      expect(JSON.parse(same.out).keyChanged).toBeNull();
      writeManifest(path.join(root, 'orchestration', 'manifest.json'), 'dev', { keySha256: 'ab'.repeat(32) });
      const { out } = await run(score, 'demo', traceFile('t.json', houseOnly));
      expect(out).toMatch(/note: key changed since the manifest \(was abababab, is [0-9a-f]{8}\): bench:real would refuse to score demo against it/);
      expect(out).toMatch(/verdict PERFECT/);
    });
  });
});
