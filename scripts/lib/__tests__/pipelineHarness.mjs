// A scratch set folder for the pipeline and manifest tests: synthetic plans (one
// house with an attached garage drawn as black wall bands on white, so the key
// tool's snap finds real faces), each holding the app's own untouched trace, or
// a stored draft key as the first 75 plans do. Not a test file: the suites import it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PNG } from 'pngjs';
import { applyPlan } from '../realKeys.mjs';
import { ROOT } from '../keyFiles.mjs';

export const W = 460;
export const H = 300;

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
const IMAGE_URL = `data:image/png;base64,${image().toString('base64')}`;

// The snapped faces of that drawing: the house, and the garage that shares its right wall.
export const HOUSE = [[100, 80], [300, 80], [300, 220], [100, 220]];
export const GARAGE = [[300, 80], [400, 80], [400, 220], [300, 220]];
export const KEY = [{ type: 'gla', points: HOUSE, name: 'first floor' }, { type: 'garage', points: GARAGE }];

/** The plan as the app saves it after a scan: the app's own trace, a room size, a garage name, a scale. */
export const newPlan = (name, { source = null, dims = 1 } = {}) => ({
  fileType: 'floortrace',
  version: 1,
  metadata: { projectId: `real-${name}`, projectName: name, createdAt: 'then', updatedAt: 'then' },
  images: { 'img-1': IMAGE_URL },
  floors: [{
    id: 'f1',
    name: 'Floor 1',
    state: {
      imageRef: 'img-1',
      imageMimeType: 'image/png',
      projectName: name,
      perimeterTraces: [{
        id: 'trace-1',
        type: 'gla',
        closed: true,
        typeSource: 'auto',
        nameSource: 'auto',
        vertices: [{ x: 90, y: 70 }, { x: 410, y: 70 }, { x: 410, y: 230 }],
        quality: { source: 'auto', confidence: 0.9, warnings: [] },
      }],
      activeTraceId: 'trace-1',
      detectedDimensions: dims ? [{ width: 20, height: 14, text: "20' x 14'", bbox: { x: 180, y: 140, width: 40, height: 20 }, confidence: 90, format: 'inches' }] : [],
      exteriorLabels: [{ keyword: 'garage', text: 'GARAGE', bbox: { x: 330, y: 140, width: 40, height: 20 } }],
      areaLabels: [],
      rooms: [],
      calibration: { calibrated: true, feetPerPixel: { x: 0.1, y: 0.1 }, source: 'room-calibration' },
      lastTraceOutcome: { at: 1, level: 'good', reason: null, floors: 1, source: 'auto' },
    },
  }],
  activeFloorId: 'f1',
  ...(source ? { source } : {}),
});

/** A plan of the first 75's kind: the stored key is a draft nobody checked. */
export const draftPlan = (name, notes = 'House with an attached garage; the garage shares the house\'s right wall.') => {
  const project = newPlan(name);
  applyPlan(project, KEY, { by: 'Claude (draft for review)', at: 'earlier', notes }, { force: true });
  return project;
};

/** The rough drawing an annotator writes; every vertex `shift` px off the same way, so the snap finds the same faces. */
export const specOf = (author, shift = 0, extra = {}) => ({
  author,
  notes: 'House with an attached garage; the garage shares the house\'s right wall (kept by the house).',
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

/**
 * A scratch set folder holding `plans` ({name: project}). `ctx` is the context
 * the commands take; `run(command, ...argv)` calls one and collects its lines.
 * The checkout root is the real one, since `freeze` runs `scripts/realKeys.mjs`.
 */
export const makeSet = (plans = {}) => {
  // The set folder sits one level down, so a backup (its sibling) lands in the scratch root too.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pipeline-'));
  const dir = path.join(root, 'real');
  const scratch = path.join(dir, 'zz-scratch');
  fs.mkdirSync(scratch, { recursive: true });
  const lines = [];
  const ctx = { dir, root: ROOT, out: (l) => lines.push(l) };
  const set = {
    root,
    dir,
    ctx,
    lines,
    scratch,
    planFile: (name) => path.join(dir, `${name}.floorplan`),
    wip: (name, suffix) => path.join(dir, 'keys-wip', `${name}${suffix}`),
    orch: (file) => path.join(dir, 'orchestration', file),
    addPlan: (name, project) => fs.writeFileSync(set.planFile(name), JSON.stringify(project)),
    readPlan: (name) => JSON.parse(fs.readFileSync(set.planFile(name), 'utf8')),
    writePlan: (name, project) => fs.writeFileSync(set.planFile(name), JSON.stringify(project)),
    readJson: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
    writeSpec: (name, spec) => {
      const file = path.join(scratch, name);
      fs.writeFileSync(file, JSON.stringify(spec));
      return file;
    },
    write: (rel, text) => {
      const file = path.join(dir, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, text);
      return file;
    },
    run: async (command, ...argv) => {
      lines.length = 0;
      const code = await command(argv, ctx);
      return { code, out: lines.join('\n'), lines: [...lines] };
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
  for (const [name, project] of Object.entries(plans)) set.addPlan(name, project);
  return set;
};

/** One plan-source event of `sources.jsonl`, as `realSource log plan` writes it. */
export const planEvent = (name, extra = {}) => ({
  event: 'plan',
  at: '2026-09-29T00:00:00.000Z',
  name,
  book: extra.book ?? name.replace(/-.*$/, ''),
  publisher: null,
  era: 'vintage',
  year: 1960,
  decade: 1960,
  leaf: 1,
  url: `https://archive.org/download/x/page/n${name.replace(/^.*-n/, '')}`,
  crop: [0, 0, 460, 300],
  size: [460, 300],
  unit: null,
  site: null,
  labels: 5,
  scale: '10 px/ft',
  cutOff: 0,
  line: '',
  tag: null,
  ...extra,
});

export const writeLog = (set, events) => set.write('orchestration/sources.jsonl', `${events.map((e) => JSON.stringify(e)).join('\n')}\n`);
