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
  UsageError, apply, blind, check, compare, labels, parseArgs, probe, review, sheet, snap, view,
} from '../keyCommands.mjs';
import { keyOf } from '../realKeys.mjs';

const W = 460;
const H = 300;
const image = () => {
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
  return PNG.sync.write(p);
};
const TRACE_MARK = 777.7777;
const project = () => ({
  fileType: 'floortrace',
  version: 1,
  metadata: { projectId: 'real-demo', projectName: 'demo', createdAt: 'then', updatedAt: 'then' },
  images: { 'img-1': `data:image/png;base64,${image().toString('base64')}` },
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
  ctx = { dir: root, root, out: (l) => lines.push(l) };
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('arguments', () => {
  it('refuses an option a command does not have, and a value that is missing', () => {
    expect(() => parseArgs(['x', '--bare2'], { flags: ['bare'] }, 'view')).toThrow(UsageError);
    expect(() => parseArgs(['x', '--bare2'], { flags: ['bare'] }, 'view')).toThrow(/unknown option --bare2 \(view takes: --bare\)/);
    expect(() => parseArgs(['--crop'], { values: ['crop'] }, 'view')).toThrow(/--crop needs a value/);
    expect(() => parseArgs(['--crop', '--grid'], { values: ['crop', 'grid'] }, 'view')).toThrow(/--crop needs a value/);
    expect(() => parseArgs(['--dry=1'], { flags: ['dry'] }, 'snap')).toThrow(/takes no value/);
  });

  it('reads values, repeated values, flags and --name=value', () => {
    const { positional, opts } = parseArgs(['n', '--poly', 'a', '--poly=b', '--keys', '--grid', '20'], { values: ['grid'], repeat: ['poly'], flags: ['keys'] }, 'view');
    expect(positional).toEqual(['n']);
    expect(opts).toEqual({ poly: ['a', 'b'], keys: true, grid: '20' });
  });

  it('turns a command with no plan into a usage error', async () => {
    await expect(blind([], ctx)).rejects.toThrow(UsageError);
    await expect(snap(['demo', '--spec', 'x'], ctx)).rejects.toThrow(/needs --role/);
  });
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

  it('lists the labels for an agent that cannot open the set', async () => {
    await run(blind, 'demo');
    const { out } = await run(labels, 'demo');
    expect(out).toMatch(/d0 +room +180,140,40,20 +"20' x 14'" +20 x 14 ft/);
    expect(out).toMatch(/e0 +nonGla +330,140,40,20 +"GARAGE"/);
    const { out: json } = await run(labels, 'demo', '--json');
    expect(JSON.parse(json).labels).toHaveLength(2);
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

  it('snaps from the packet\'s image when there is one', async () => {
    await run(blind, 'demo');
    const { out } = await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    expect(out).toMatch(/from .*packets/);
  });

  it('accepts --dry and does the same', async () => {
    const file = writeSpec('a.json', specOf('a-demo'));
    const before = sha(plan());
    const { code } = await run(snap, 'demo', '--role', 'a', '--spec', file, '--dry');
    expect(code).toBe(0);
    expect(sha(plan())).toBe(before);
  });

  it('lists the flagged edges in the snapped file and on the screen', async () => {
    const spec = specOf('a-demo');
    // A top edge drawn 12 px off the wall: it moves far.
    spec.outlines[0].v[0][1] = 68;
    spec.outlines[0].v[1][1] = 68;
    const { out } = await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', spec));
    expect(out).toMatch(/edge 0: \+?-?\d+\.\d px {3}<-- far/);
    const snapped = readJson(wip('.a.snapped.json'));
    expect(snapped.flagged.some((f) => f.outline === 0 && f.edge === 0 && f.flags.includes('far'))).toBe(true);
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

  it('says nothing of a replacement when there was nothing to replace, and guards a spec that had no author too', async () => {
    const bare = specOf('x');
    delete bare.author;
    const first = await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b1.json', bare));
    expect(first.out).not.toMatch(/replaced/);
    // Two specs with no name: nothing says they are one agent's.
    await expect(run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b2.json', bare))).rejects.toThrow(/already holds a spec by no named author, and this spec's author is not set/);
    const forced = await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b3.json', bare), '--replace');
    expect(forced.out).toMatch(/note: replaced the earlier demo\.b\.json \(author not set\)/);
    // A spec file that will not parse is nobody's: it is replaced, and said so.
    fs.writeFileSync(wip('.b.json'), '{ not json');
    const broken = await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b4.json', specOf('b-demo')));
    expect(broken.out).toMatch(/note: replaced the earlier demo\.b\.json \(it could not be read\)/);
  });

  it('leaves the final key to whoever adjudicates it: no author guard on the role', async () => {
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('f1.json', specOf('adj-1')));
    await run(snap, 'demo', '--role', 'final', '--spec', writeSpec('f2.json', specOf('adj-2')));
    expect(readJson(wip('.final.json')).author).toBe('adj-2');
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

  it('refuses a malformed spec with the place and the reason, and writes nothing', async () => {
    const spec = specOf('a-demo');
    spec.outlines[1].in = [9];
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('bad.json', spec))).rejects.toThrow(/outlines\[1\]\.in: edge 9 is out of range/);
    expect(fs.existsSync(wip('.a.json'))).toBe(false);
    expect(fs.existsSync(wip('.a.snapped.json'))).toBe(false);
  });

  it('refuses a rough outline that crosses itself', async () => {
    const spec = { outlines: [{ type: 'gla', v: [[100, 80], [300, 220], [300, 80], [100, 220]] }] };
    await expect(run(snap, 'demo', '--role', 'a', '--spec', writeSpec('bow.json', spec))).rejects.toThrow(/outline 0 \(gla\) as drawn: edge 0 crosses edge 2/);
  });

  it('says so when the spec, the role or the plan is wrong', async () => {
    await expect(run(snap, 'demo', '--role', 'c', '--spec', writeSpec('a.json', specOf('a')))).rejects.toThrow(/--role must be one of a, b, final/);
    await expect(run(snap, 'demo', '--role', 'a', '--spec', path.join(scratch, 'nope.json'))).rejects.toThrow(/cannot read the spec/);
    fs.writeFileSync(path.join(scratch, 'junk.json'), '{oops');
    await expect(run(snap, 'demo', '--role', 'a', '--spec', path.join(scratch, 'junk.json'))).rejects.toThrow(/not valid JSON/);
    await expect(run(snap, 'nosuch', '--role', 'a', '--spec', writeSpec('a.json', specOf('a')))).rejects.toThrow(/no plan named nosuch/);
    await expect(run(snap, '../demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a')))).rejects.toThrow(/not a plan name/);
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

  it('disagrees when one drawer fixed an edge where they drew it, and says where', async () => {
    await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    const off = specOf('b-demo');
    off.outlines[0].v = [[97, 77], [303, 77], [303, 223], [90, 223]];
    off.outlines[0].fix = [3, 0, 2];
    off.outlines[0].v[0] = [90, 70];
    await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b.json', off));
    const { out } = await run(compare, 'demo');
    expect(out).toMatch(/DISAGREE \(\d\)/);
    expect(out).toMatch(/disagreement regions/);
    expect(out).toMatch(/1\. bbox/);
  });

  it('compares two files, and draws the regions to a views folder by tag', async () => {
    await both(0);
    const a = wip('.a.snapped.json');
    const b = wip('.b.snapped.json');
    const { code, out } = await run(compare, a, b, '--draw', 'cmp.png', '--tag', 'adj1', '--image', 'demo');
    expect(code).toBe(0);
    const png = path.join(root, 'datasets', 'zz-scratch', 'views', 'adj1', 'cmp.png');
    expect(fs.existsSync(png)).toBe(true);
    expect(out).toContain(png);
    await expect(run(compare, a, b, '--draw', 'cmp.png')).rejects.toThrow(/needs --image/);
    const { out: json } = await run(compare, a, b, '--json');
    expect(JSON.parse(json).agree).toBe(true);
  });

  it('draws for a plan by name, and says what is missing', async () => {
    await both(0);
    await run(compare, 'demo', '--draw', 'named.png', '--tag', 'adj2');
    expect(fs.existsSync(path.join(root, 'datasets', 'zz-scratch', 'views', 'adj2', 'named.png'))).toBe(true);
    await expect(run(compare, 'other')).rejects.toThrow(/does not exist/);
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

  it('fails, with a non-zero exit, on a key whose label lies in the wrong outline', async () => {
    const spec = specOf('adj');
    // The garage label sits at (350, 150): make the "garage" the house's type.
    spec.outlines[1].type = 'gla';
    await finalKey(spec);
    const { code, out } = await run(check, 'demo');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL +labels +e0/);
    expect(out).toMatch(/CHECK FAIL \(1\)$/);
  });

  it('fails a hand-broken snapped file, and reads a stated area from the spec', async () => {
    await finalKey(specOf('adj', 0, { stated: [{ sqft: 400, of: 'first floor' }] }));
    let { code, out } = await run(check, 'demo');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL +stated/);
    await finalKey(specOf('adj', 0, { stated: [{ sqft: 400, of: 'first floor', explained: 'the page counts the garage' }] }));
    ({ code, out } = await run(check, 'demo'));
    expect(code).toBe(0);
    expect(out).toMatch(/WARN +stated/);
    const snapped = readJson(wip('.final.snapped.json'));
    snapped.outlines[0].v = [[100, 80], [300, 220], [300, 80], [100, 220]];
    fs.writeFileSync(wip('.final.snapped.json'), JSON.stringify(snapped));
    ({ code, out } = await run(check, 'demo'));
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL +closed .*edge 0 crosses edge 2/);
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

  it('says to snap first when there is no key to check', async () => {
    await expect(run(check, 'demo')).rejects.toThrow(/run snap --role final first/);
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

  it('keeps the kinds the annotators saw: a later change to labelKind does not move a frozen key', async () => {
    await run(blind, 'demo');
    await finalKey();
    // As if labelKind read "20' x 14'" (the living room's size) as a garage now.
    const file = path.join(root, 'keys-wip', 'packets', 'demo', 'labels.json');
    const packet = readJson(file);
    packet.labels.find((l) => l.id === 'd0').kind = 'nonGla';
    fs.writeFileSync(file, JSON.stringify(packet));
    const { code, out } = await run(check, 'demo');
    expect(code).toBe(1);
    expect(out).toMatch(/FAIL +labels +d0: .* lies in gla, expected garage\/porch\/unfinished/);
    expect(out).toMatch(/WARN +labels +packet: .*d0 is nonGla .* in the packet, room .* in the scan now/);
  });

  it('refuses a packet whose labels are not a labels list', async () => {
    await run(blind, 'demo');
    await finalKey();
    fs.writeFileSync(path.join(root, 'keys-wip', 'packets', 'demo', 'labels.json'), JSON.stringify({ labels: [{ id: 'd0' }] }));
    await expect(run(check, 'demo')).rejects.toThrow(/is not a labels list.*run blind demo again/);
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

  it('refuses a rejection with no reason, an empty agent, both flags, and no key', async () => {
    await expect(run(review, 'demo', '--reject', '--agent', 'r')).rejects.toThrow(/needs --reason/);
    await expect(run(review, 'demo', '--reject', '--agent', 'r', '--reason', '  ')).rejects.toThrow(/needs --reason/);
    await expect(run(review, 'demo', '--approve', '--reject', '--agent', 'r')).rejects.toThrow(/exactly one of/);
    await expect(run(review, 'demo', '--agent', 'r')).rejects.toThrow(/exactly one of/);
    await expect(run(review, 'demo', '--approve')).rejects.toThrow(/needs --agent/);
    await expect(run(review, 'demo', '--approve', '--agent', 'r')).rejects.toThrow(/nothing to review/);
    await finalKey();
    await expect(run(review, 'demo', '--reject', '--agent', 'r', '--reason', 'x', '--region', '1,2,3')).rejects.toThrow(/--region must be 4 comma-separated numbers/);
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

  it('does not take an older review, recorded without the spec hash, as approval of the notes', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    const rec = readJson(wip('.review-1.json'));
    delete rec.specSha256;
    fs.writeFileSync(wip('.review-1.json'), JSON.stringify(rec));
    await expect(run(apply, 'demo')).rejects.toThrow(/review-1 holds no hash of the final spec.*needs a fresh review/);
    expect(readJson(plan()).answerKey).toBeUndefined();
  });

  it('gives two reviewers who run at once two review files, and neither replaces the other', async () => {
    await finalKey();
    const each = (agent, ...more) => {
      const out = [];
      return review(['demo', '--agent', agent, ...more], { ...ctx, out: (l) => out.push(l) }).then(() => out);
    };
    await Promise.all([
      each('rev-1', '--approve'),
      each('rev-2', '--reject', '--reason', 'the porch is missing'),
      each('rev-3', '--approve', '--note', 'third'),
    ]);
    const files = fs.readdirSync(path.join(root, 'keys-wip')).filter((f) => /^demo\.review-\d+\.json$/.test(f)).sort();
    expect(files).toEqual(['demo.review-1.json', 'demo.review-2.json', 'demo.review-3.json']);
    const agents = files.map((f) => readJson(path.join(root, 'keys-wip', f)));
    expect(agents.map((r) => r.n)).toEqual([1, 2, 3]);
    expect(new Set(agents.map((r) => r.agent))).toEqual(new Set(['rev-1', 'rev-2', 'rev-3']));
  });

  it('will not review a key whose spec is missing, since apply records its notes', async () => {
    await finalKey();
    fs.rmSync(wip('.final.json'));
    await expect(run(review, 'demo', '--approve', '--agent', 'rev-1')).rejects.toThrow(/nothing to review: demo\.final\.json \(the notes, waivers and stated figures\) does not exist/);
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

  it('never replaces a checked key unless a dispute is named, and then records it', async () => {
    await finalKey();
    writeRecord({ adjudicator: 'adj-demo' });
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await run(apply, 'demo');
    expect(readJson(plan()).answerKey.by).toBe('annotators: a-demo, b-demo; adjudicator: adj-demo');
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    await expect(run(apply, 'demo')).rejects.toThrow(/is frozen: a change comes only through a dispute/);
    const { out } = await run(apply, 'demo', '--dispute', 'D-7');
    expect(out).toContain('dispute D-7');
    expect(readJson(plan()).answerKey.disputeId).toBe('D-7');
  });

  it('applies the same key again under a new record without complaint', async () => {
    await finalKey();
    writeRecord();
    await run(review, 'demo', '--approve', '--agent', 'rev-1');
    await run(apply, 'demo');
    const first = readJson(plan()).answerKey;
    await run(review, 'demo', '--approve', '--agent', 'rev-2');
    const { out } = await run(apply, 'demo', '--dispute', 'D-8');
    expect(out).toMatch(/key unchanged/);
    const second = readJson(plan()).answerKey;
    expect(second.disputeId).toBe('D-8');
    expect(second.checked.at).not.toBe(first.checked.at);
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

  it('draws a plan by name bare by default: no key and no trace', async () => {
    const bare = await run(view, 'demo', '--tag', 'x');
    const again = await run(view, 'demo', '--tag', 'x');
    expect(bare.out).toBe(again.out);
    expect(path.basename(bare.out.split('\n')[0])).toBe('demo.png');
  });

  it('accepts --bare, which a plan drawn by name already is, and refuses it with --keys or --trace', async () => {
    const plain = await run(view, 'demo', '--tag', 'x');
    const bare = await run(view, 'demo', '--bare', '--tag', 'x');
    expect(bare.out).toBe(plain.out);
    await expect(run(view, 'demo', '--bare', '--keys')).rejects.toThrow(/--bare draws no key and no trace/);
    await expect(run(view, 'demo', '--bare', '--trace')).rejects.toThrow(/--bare draws no key and no trace/);
  });

  it('says so when the crop misses the page or grazes it, and notes a crop cut back to the page', async () => {
    await expect(run(view, 'demo', '--crop', '1000,1000,1200,1200')).rejects.toThrow(/the crop 1000,1000→1200,1200 shows none of the 460 x 300 px image/);
    await expect(run(view, 'demo', '--crop', '459.5,10,600,80')).rejects.toThrow(/shows only 0\.5 x 70 px of the 460 x 300 px image/);
    await expect(run(view, 'demo', '--crop', '-50,-50,-10,-10')).rejects.toThrow(/shows none/);
    const { out } = await run(view, 'demo', '--crop', '400,200,600,400', '--tag', 'clip');
    expect(out).toMatch(/crop 400,200→460,300/);
  });

  it('refuses --keys and --trace on an image file, and an option it does not have', async () => {
    await run(blind, 'demo');
    const packetImage = path.join(root, 'keys-wip', 'packets', 'demo', 'image.png');
    await expect(run(view, packetImage, '--keys')).rejects.toThrow(/need a plan NAME/);
    await expect(run(view, packetImage, '--trace')).rejects.toThrow(/need a plan NAME/);
    await expect(run(view, 'demo', '--bogus')).rejects.toThrow(/unknown option --bogus/);
    await expect(run(view, 'demo', '--crop', '5,5,1,1')).rejects.toThrow(/X1 > X0/);
    await expect(run(view, 'demo', '--tag', '../x')).rejects.toThrow(/--tag/);
  });

  it('draws the polygons of several files, each in its own style, with a name per view', async () => {
    await run(snap, 'demo', '--role', 'a', '--spec', writeSpec('a.json', specOf('a-demo')));
    await run(snap, 'demo', '--role', 'b', '--spec', writeSpec('b.json', specOf('b-demo')));
    const one = await run(view, 'demo', '--poly', wip('.a.snapped.json'), '--tag', 'p');
    const two = await run(view, 'demo', '--poly', wip('.a.snapped.json'), '--poly', wip('.b.snapped.json'), '--tag', 'p');
    expect(one.out.split('\n')[0]).not.toBe(two.out.split('\n')[0]);
    // A rough spec with refs draws too.
    await run(view, 'demo', '--poly', path.join(scratch, 'a.json'), '--tag', 'p');
  });

  it('draws the scan\'s labels on a plan or beside a packet, and refuses them on a bare image', async () => {
    await run(blind, 'demo');
    const packetImage = path.join(root, 'keys-wip', 'packets', 'demo', 'image.png');
    await run(view, 'demo', '--labels', '--tag', 'l');
    await run(view, packetImage, '--labels', '--tag', 'l');
    fs.writeFileSync(path.join(scratch, 'page.png'), image());
    await expect(run(view, path.join(scratch, 'page.png'), '--labels')).rejects.toThrow(/needs a labels\.json beside it/);
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

  it('makes review sheets that show the stored key and its record', async () => {
    const out = path.join(scratch, 'sheet.png');
    const { out: written } = await run(sheet, 'demo', '--out', out);
    expect(written).toBe(out);
    expect(fs.statSync(out).size).toBeGreaterThan(1000);
    await expect(run(sheet, '--out', out)).rejects.toThrow(UsageError);
  });
});
