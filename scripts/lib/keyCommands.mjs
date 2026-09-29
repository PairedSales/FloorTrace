// The commands of scripts/realKeyTool.mjs, as functions of a context
// `{dir, root, out}` (the set folder, the checkout, a line printer), so the
// tests run each one against a scratch folder. The CLI in realKeyTool.mjs only
// parses arguments and prints errors; the manual is its header.
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { applyPlan, keyOf } from './realKeys.mjs';
import {
  checkName, decodeBytes, imageOfPlan, imageOfTarget, labelOfTarget, packetDir, planFile, planImageBytes,
  readJson, wipDir, wipFile, writeFileRetry, writeJson,
} from './keyFiles.mjs';
import { compareKeys } from './keyCompare.mjs';
import { checkKey } from './keyCheck.mjs';
import { buildPacket, labelsOf } from './keyPacket.mjs';
import { probeAcross, probeLine, probeLines } from './keyProbe.mjs';
import { snapOutlines } from './keySnap.mjs';
import { outlinesOfJson, resolveRefs, validateSpec } from './keySpec.mjs';
import { ringProblem, bboxOf } from './keyGeometry.mjs';
import { TYPE_COLORS, TYPE_LABELS, renderView } from './keyView.mjs';

// ---- arguments ---------------------------------------------------------------

// A command line the tool cannot read at all (exit status 2), as opposed to
// one that is well formed and fails (exit status 1).
export class UsageError extends Error {}

/**
 * `argv` split by a command's `{values, repeat, flags}`: positional arguments,
 * and `opts` (a value option once, a repeat option as an array, a flag as
 * true). An option the command does not have is an error, never a plan name.
 */
export const parseArgs = (argv, { values = [], repeat = [], flags = [] }, command = 'command') => {
  const opts = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2);
    const inline = eq > 0 ? arg.slice(eq + 1) : undefined;
    if (flags.includes(name)) {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`);
      opts[name] = true;
    } else if (values.includes(name) || repeat.includes(name)) {
      let value = inline;
      if (value === undefined) {
        i += 1;
        value = argv[i];
        if (value === undefined || value.startsWith('--')) throw new UsageError(`--${name} needs a value`);
      }
      if (repeat.includes(name)) (opts[name] ??= []).push(value);
      else opts[name] = value;
    } else {
      const known = [...values, ...repeat, ...flags].map((n) => `--${n}`).join(' ');
      throw new UsageError(`unknown option --${name} (${command} takes: ${known || 'no options'})`);
    }
  }
  return { positional, opts };
};

const numbers = (text, count, what) => {
  const parts = String(text).split(',').map((s) => Number(s.trim()));
  if (parts.length !== count || parts.some((n) => !Number.isFinite(n))) {
    throw new Error(`${what} must be ${count} comma-separated numbers (got "${text}")`);
  }
  return parts;
};
const boxOf = (text, what = '--crop') => {
  const box = numbers(text, 4, what);
  if (!(box[2] > box[0] && box[3] > box[1])) throw new Error(`${what} X0,Y0,X1,Y1 needs X1 > X0 and Y1 > Y0`);
  return box;
};
const need = (positional, count, usage) => {
  if (positional.length < count) throw new UsageError(`usage: ${usage}`);
  return positional;
};
const tagOf = (opts) => {
  const tag = opts.tag ?? 'default';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(tag)) throw new Error(`--tag "${tag}" must be letters, digits, . _ - only`);
  return tag;
};

const round1 = (x) => Math.round(x * 10) / 10;
const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');
const exists = (file) => fs.existsSync(file);
const viewsDir = (ctx, tag) => path.join(ctx.root, 'datasets', 'zz-scratch', 'views', tag);

// The plan's state; the one place a command that may look at the app's work
// (`--keys`, `--trace`, check's labels and scale, sheet, apply) reads it.
const readPlan = (name, ctx) => {
  const file = planFile(name, ctx.dir);
  if (!exists(file)) throw new Error(`no plan named ${name} in ${ctx.dir}`);
  const project = readJson(file);
  if (!project?.floors?.[0]?.state) throw new Error(`${file} holds no plan`);
  return project;
};

// ---- view ----------------------------------------------------------------------

const POLY_STYLES = [
  { color: '#d000d0', dash: [], word: 'solid magenta' },
  { color: '#0070ff', dash: [10, 6], word: 'dashed blue' },
  { color: '#ff8c00', dash: [2, 5], word: 'dotted orange' },
  { color: '#000000', dash: [14, 4, 3, 4], word: 'dash-dot black' },
];

export const VIEW_SPEC = {
  values: ['crop', 'grid', 'tag'], repeat: ['poly'], flags: ['keys', 'trace', 'labels', 'bare', 'no-verts'],
};

export const view = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, VIEW_SPEC, 'view');
  const [target] = need(positional, 1, 'view IMAGE|NAME [--crop X0,Y0,X1,Y1] [--grid STEP] [--poly FILE]... [--tag T] [--labels] [--keys] [--trace]');
  const tag = tagOf(opts);
  const isFile = exists(target) && fs.statSync(target).isFile();
  if (isFile && (opts.keys || opts.trace)) throw new Error('--keys and --trace need a plan NAME, not an image file');
  const { bytes, mime } = await imageOfTarget(target, ctx.dir);
  const layers = [];
  const hashInput = [];
  // The scan's labels, for a plan, or beside a packet's image.
  if (opts.labels) {
    let list;
    const beside = path.join(path.dirname(path.resolve(target)), 'labels.json');
    if (isFile && exists(beside)) list = readJson(beside).labels ?? [];
    else if (isFile) throw new Error('--labels on an image file needs a labels.json beside it (a blind packet)');
    else list = labelsOf(readPlan(checkName(target), ctx).floors[0].state);
    layers.push({
      label: 'scan labels (id)',
      color: '#008a8a',
      width: 1.5,
      boxes: list.map((l) => ({ box: [l.bbox.x, l.bbox.y, l.bbox.x + l.bbox.width, l.bbox.y + l.bbox.height], text: l.id })),
    });
    hashInput.push('labels');
  }
  if (opts.keys) {
    const project = readPlan(checkName(target), ctx);
    const key = keyOf(project.floors[0].state);
    if (!key) process.stderr.write(`note: ${target} holds no key yet (its outlines are the app's own trace)\n`);
    else {
      layers.push({
        label: 'stored key, by type', byType: true, width: 2, vertexNumbers: true, outlines: key.map((o) => ({ type: o.type, v: o.points })),
      });
      hashInput.push(JSON.stringify(key));
    }
  }
  if (opts.trace) {
    const project = readPlan(checkName(target), ctx);
    const rings = await draftRings(project, await decodeBytes(bytes, mime));
    layers.push({
      label: "app's draft trace", color: '#e00000', width: 2, dash: [9, 6], outlines: rings.map((v) => ({ type: 'gla', v })),
    });
    hashInput.push('trace');
  }
  (opts.poly ?? []).forEach((file, i) => {
    const text = fs.readFileSync(file, 'utf8');
    let json;
    try {
      json = JSON.parse(text);
    } catch (error) {
      throw new Error(`${file} is not valid JSON: ${error.message}`);
    }
    const style = POLY_STYLES[i % POLY_STYLES.length];
    layers.push({
      label: `${path.basename(file)} (${style.word})`,
      color: style.color,
      dash: style.dash,
      width: 2,
      vertexNumbers: !opts['no-verts'],
      outlines: outlinesOfJson(json, file),
    });
    hashInput.push(text);
  });
  const crop = opts.crop ? boxOf(opts.crop) : undefined;
  const grid = opts.grid === undefined ? undefined : Number(opts.grid);
  if (grid !== undefined && !(grid >= 0)) throw new Error('--grid must be a number of pixels (0 for none)');
  const { png, summary } = await renderView(bytes, { crop, grid, layers });
  const [x0, y0, x1, y1] = summary.crop;
  const parts = [labelOfTarget(target)];
  if (crop) parts.push(`${Math.round(x0)}_${Math.round(y0)}_${Math.round(x1)}_${Math.round(y1)}`);
  if (opts.grid !== undefined) parts.push(`g${grid}`);
  if (hashInput.length) parts.push(sha256(hashInput.join('\n')).slice(0, 8));
  const out = path.join(viewsDir(ctx, tag), `${parts.join('-')}.png`);
  await writeFileRetry(out, png);
  ctx.out(out);
  ctx.out(summary.line);
  return 0;
};

// The app's own trace, run again as `bench:real` runs it (the plan's labels as
// evidence). Loaded only for `--trace`: the tracer is heavy, and a blind role's
// command must never need it.
const draftRings = async (project, image) => {
  const { traceFloorplanBoundaryCore } = await import('../../src/utils/detection/pipeline.js');
  const { boundaryConstraints, nonGlaExcludeRegions } = await import('../../src/utils/traceInputs.js');
  const state = project.floors[0].state;
  const result = traceFloorplanBoundaryCore(image, {
    excludeRegions: nonGlaExcludeRegions(state),
    constraints: boundaryConstraints(state),
  });
  const floors = result?.floors?.length
    ? result.floors.filter((f) => f.outer).map((f) => f.outer.polygon)
    : (result?.outer ? [result.outer.polygon] : []);
  return floors.map((ring) => ring.map((p) => [p.x, p.y]));
};

// ---- blind ---------------------------------------------------------------------

export const blind = async (argv, ctx) => {
  const { positional } = parseArgs(argv, {}, 'blind');
  const [name] = need(positional, 1, 'blind NAME');
  checkName(name);
  const project = readPlan(name, ctx);
  const packet = await buildPacket(project, name);
  const dir = packetDir(name, ctx.dir);
  // A packet is rebuilt whole: a stale image of another type would be a second
  // "the image" for a tool that takes the first it finds.
  if (exists(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (/^image\.[a-z0-9]+$/i.test(f) && f !== `image.${packet.image.ext}`) fs.rmSync(path.join(dir, f), { force: true });
    }
  }
  const imageFile = path.join(dir, `image.${packet.image.ext}`);
  await writeFileRetry(imageFile, packet.image.bytes);
  await writeJson(path.join(dir, 'labels.json'), packet.labels);
  await writeJson(path.join(dir, 'meta.json'), packet.meta);
  const kinds = { room: 0, nonGla: 0, level: 0 };
  for (const l of packet.labels.labels) kinds[l.kind] += 1;
  ctx.out(imageFile);
  ctx.out(path.join(dir, 'labels.json'));
  ctx.out(path.join(dir, 'meta.json'));
  ctx.out(`packet for ${name}: image ${packet.meta.width}x${packet.meta.height}, ${packet.labels.labels.length} labels (${kinds.room} room, ${kinds.nonGla} nonGla, ${kinds.level} level)`);
  return 0;
};

// ---- labels ----------------------------------------------------------------------

export const labels = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { flags: ['json'] }, 'labels');
  const [name] = need(positional, 1, 'labels NAME [--json]');
  checkName(name);
  const file = path.join(packetDir(name, ctx.dir), 'labels.json');
  const list = exists(file) ? readJson(file).labels : labelsOf(readPlan(name, ctx).floors[0].state);
  if (opts.json) {
    ctx.out(JSON.stringify({ labels: list }, null, 1));
    return 0;
  }
  ctx.out(`${list.length} labels the scan read on ${name} (bbox x,y,w,h in image px):`);
  for (const l of list) {
    const size = l.widthFt != null ? `  ${l.widthFt} x ${l.heightFt} ft` : '';
    const under = l.nameLabel ? `  (under ${l.nameLabel})` : '';
    ctx.out(`  ${l.id.padEnd(4)} ${l.kind.padEnd(6)} ${[l.bbox.x, l.bbox.y, l.bbox.width, l.bbox.height].join(',').padEnd(20)} "${l.text}"${size}${under}`);
  }
  return 0;
};

// ---- probe -----------------------------------------------------------------------

export const probe = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['from', 'to', 'step', 'across', 'half'] }, 'probe');
  const [target] = need(positional, 1, 'probe IMAGE --from X,Y --to X,Y [--step 0.5]   |   probe IMAGE --across X,Y,ANGLE_DEG --half 12');
  const step = opts.step === undefined ? 0.5 : Number(opts.step);
  if (!(step > 0)) throw new Error('--step must be a positive number of pixels');
  const { image } = await imageOfTarget(target, ctx.dir);
  let result;
  if (opts.across) {
    if (opts.from || opts.to) throw new Error('give --from and --to, or --across, not both');
    const [x, y, angle] = numbers(opts.across, 3, '--across');
    const half = opts.half === undefined ? 12 : Number(opts.half);
    if (!(half > 0)) throw new Error('--half must be a positive number of pixels');
    ctx.out(`across ${x},${y} at ${angle} degrees (0 = along +x, 90 = down the page), ${half} px each way; distances are from the centre`);
    result = probeAcross(image, [x, y], angle, half, { step });
  } else {
    if (!opts.from || !opts.to) throw new UsageError('usage: probe IMAGE --from X,Y --to X,Y [--step 0.5]   |   probe IMAGE --across X,Y,ANGLE_DEG --half 12');
    const from = numbers(opts.from, 2, '--from');
    const to = numbers(opts.to, 2, '--to');
    ctx.out(`from ${from.join(',')} to ${to.join(',')}; distances are along the segment from --from`);
    result = probeLine(image, from, to, { step });
  }
  for (const line of probeLines(result)) ctx.out(line);
  return 0;
};

// ---- snap ------------------------------------------------------------------------

const ROLES = ['a', 'b', 'final'];
const roleOf = (opts) => {
  const role = opts.role ?? 'final';
  if (!ROLES.includes(role)) throw new Error(`--role must be one of ${ROLES.join(', ')} (got "${role}")`);
  return role;
};

const readSpec = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    throw new Error(`cannot read the spec ${file}: ${error.code ?? error.message}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
  return { spec: validateSpec(json), text };
};

export const snap = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['role', 'spec'], flags: ['dry'] }, 'snap');
  const [name] = need(positional, 1, 'snap NAME --role a|b|final --spec FILE [--dry]');
  checkName(name);
  if (!opts.role) throw new Error('snap needs --role a|b|final');
  const role = roleOf(opts);
  if (!opts.spec) throw new Error('snap needs --spec FILE (a spec you wrote in your scratch folder)');
  const { spec, text } = readSpec(opts.spec);
  const rough = resolveRefs(spec.outlines);
  rough.forEach((o, k) => {
    const problem = ringProblem(o.v);
    if (problem) throw new Error(`outline ${k} (${o.type}) as drawn: ${problem.text}; fix the vertex order before snapping`);
  });
  const { image, from } = await imageOfPlan(name, ctx.dir);
  const snapped = snapOutlines(image, spec.outlines);
  const flagged = [];
  ctx.out(`snap ${name} role ${role}: image ${image.width}x${image.height} (from ${from})`);
  snapped.forEach((o, k) => {
    ctx.out(`outline ${k} (${o.type}${spec.outlines[k].name ? ` "${spec.outlines[k].name}"` : ''}):`);
    for (const e of o.edges) {
      const note = e.fixed ? 'fixed' : e.flags.includes('no-band') ? 'no band found' : `${e.moved >= 0 ? '+' : ''}${e.moved.toFixed(1)} px`;
      const why = {
        'no-band': 'no wall band within reach: fix the edge, or redraw nearer the wall',
        'reaches-end': 'the band runs to the end of the search: look at this edge at full zoom',
        far: 'moved far: check it is the wall you meant',
        'ink-beyond': `another band ${e.beyond?.toFixed(1)} px beyond the face used (hatched or double-line wall? a dimension line?): look at this edge at full zoom`,
      };
      if (e.flags.length) flagged.push({ outline: k, edge: e.edge, flags: e.flags, moved: round1(e.moved) });
      ctx.out(`  edge ${e.edge}: ${note}${e.flags.length ? `   <-- ${e.flags.join(', ')}: ${why[e.flags[0]]}` : ''}`);
    }
    for (const w of o.warnings) ctx.out(`  warning: ${w}`);
    ctx.out(`  vertices: ${o.v.map((p) => `[${round1(p[0])},${round1(p[1])}]`).join(' ')}`);
  });
  const outlines = snapped.map((o) => ({ type: o.type, v: o.v.map((p) => [round1(p[0]), round1(p[1])]) }));
  const snappedFile = wipFile(name, `.${role}.snapped.json`, ctx.dir);
  const specFile = wipFile(name, `.${role}.json`, ctx.dir);
  await writeFileRetry(specFile, text);
  await writeJson(snappedFile, {
    name,
    role,
    author: spec.author ?? null,
    image: { width: image.width, height: image.height },
    outlines,
    flagged,
    warnings: snapped.flatMap((o, k) => o.warnings.map((w) => `outline ${k}: ${w}`)),
  });
  ctx.out(`${flagged.length} flagged edge(s); snapped outlines -> ${snappedFile}`);
  ctx.out(`spec kept -> ${specFile}`);
  return 0;
};

// ---- compare ---------------------------------------------------------------------

const pct = (x) => `${(x * 100).toFixed(2)}%`;
const typeList = (counts) => Object.entries(counts).map(([t, n]) => (n > 1 ? `${t} x${n}` : t)).join(', ') || 'none';

export const compareLines = (result, labelA, labelB) => {
  const lines = [];
  lines.push(`outline types: ${labelA} [${typeList(result.counts.a)}]  ${labelB} [${typeList(result.counts.b)}]`);
  const iou = [];
  for (const cls of ['building', 'nonGla', 'unfinished']) if (result.iou[cls]) iou.push(`${cls} ${pct(result.iou[cls].iou)}`);
  const byType = Object.entries(result.iou.byType).map(([t, v]) => `${t} ${pct(v.iou)}`).join(', ');
  lines.push(`IoU: ${iou.join(', ')}   (per type: ${byType})`);
  const b = result.boundary;
  lines.push(`boundary distance: largest ${b.max.toFixed(2)} px, 95th percentile ${b.p95.toFixed(2)} px   (${labelA} to ${labelB}: largest ${b.aToB.max.toFixed(2)}, p95 ${b.aToB.p95.toFixed(2)}; ${labelB} to ${labelA}: largest ${b.bToA.max.toFixed(2)}, p95 ${b.bToA.p95.toFixed(2)})`);
  for (const c of result.criteria) lines.push(`  ${c.ok ? 'ok  ' : 'FAIL'} (${c.id}) ${c.text}`);
  if (result.regions.length) {
    lines.push('disagreement regions (crop here, worst first):');
    for (const r of result.regions) {
      const [x0, y0, x1, y1] = r.bbox.map(round1);
      lines.push(r.missing
        ? `  ${r.id}. bbox ${x0},${y0},${x1},${y1}  only key ${r.missing} has a ${r.class} outline here`
        : `  ${r.id}. bbox ${x0},${y0},${x1},${y1}  largest ${r.maxDistance.toFixed(2)} px at ${round1(r.at[0])},${round1(r.at[1])} on ${r.side === 'A' ? labelA : labelB}'s ${r.class} boundary  (${r.points} points)`);
    }
  }
  lines.push(result.agree ? 'AGREE' : `DISAGREE (${result.failed.length})`);
  return lines;
};

// A key file's outlines. `compare` needs polygons and refuses anything else;
// `check` reads whatever is there, so it can say what is wrong with it.
const readOutlines = (file, { strict = true } = {}) => {
  const outlines = outlinesOfJson(readJson(file), file);
  if (strict) {
    outlines.forEach((o, k) => {
      const problem = ringProblem(o.v);
      if (problem) throw new Error(`${file}: outline ${k} (${o.type}) is not a polygon: ${problem.text}; run check on it`);
    });
  }
  return outlines;
};

export const compare = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['draw', 'tag', 'image', 'crop'], flags: ['json'] }, 'compare');
  need(positional, 1, 'compare NAME | A_SNAPPED B_SNAPPED [--json] [--draw OUT.png --tag T]');
  if (positional.length > 2) throw new Error('compare takes NAME, or two snapped files');
  let fileA;
  let fileB;
  let name = null;
  if (positional.length === 2) [fileA, fileB] = positional;
  else {
    name = checkName(positional[0]);
    fileA = wipFile(name, '.a.snapped.json', ctx.dir);
    fileB = wipFile(name, '.b.snapped.json', ctx.dir);
  }
  const a = readOutlines(fileA);
  const b = readOutlines(fileB);
  const result = compareKeys(a, b);
  const labelA = 'A';
  const labelB = 'B';
  let drawn = null;
  if (opts.draw) {
    const target = opts.image ?? name;
    if (!target) throw new Error('--draw with two files needs --image IMAGE (a packet image or a plan NAME)');
    const { bytes } = await imageOfTarget(target, ctx.dir);
    const pad = 50;
    const [bx0, by0, bx1, by1] = bboxOf([...a, ...b].map((o) => o.v));
    const crop = opts.crop ? boxOf(opts.crop) : [bx0 - pad, by0 - pad, bx1 + pad, by1 + pad];
    const { png, summary } = await renderView(bytes, {
      crop,
      layers: [
        { label: 'A (solid)', outlines: a, color: '#d000d0', width: 2.5 },
        { label: 'B (dashed)', outlines: b, color: '#0070ff', width: 2.5, dash: [10, 6] },
        {
          label: 'disagreement region (number: largest distance)',
          color: '#e00000',
          boxes: result.regions.map((r) => ({
            box: [r.bbox[0] - 6, r.bbox[1] - 6, r.bbox[2] + 6, r.bbox[3] + 6],
            text: r.missing ? `${r.id}: only ${r.missing}` : `${r.id}: ${r.maxDistance.toFixed(1)}px`,
          })),
        },
      ],
    });
    // A bare file name lands in this agent's views folder; a path is used as given.
    const file = /[\\/]/.test(opts.draw)
      ? path.resolve(opts.draw)
      : path.join(viewsDir(ctx, tagOf(opts)), opts.draw);
    await writeFileRetry(file, png);
    drawn = { file, line: summary.line };
  }
  const record = {
    a: fileA, b: fileB, at: new Date().toISOString(), ...result,
  };
  if (name) await writeJson(wipFile(name, '.compare.json', ctx.dir), record);
  if (opts.json) ctx.out(JSON.stringify(record, null, 1));
  else {
    ctx.out(`compare ${name ?? `${path.basename(fileA)} ${path.basename(fileB)}`}`);
    for (const line of compareLines(result, labelA, labelB)) ctx.out(line);
    if (drawn) {
      ctx.out(drawn.file);
      ctx.out(drawn.line);
    }
    if (name) ctx.out(`written -> ${wipFile(name, '.compare.json', ctx.dir)}`);
  }
  return 0;
};

// ---- check -----------------------------------------------------------------------

const finite = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
export const scaleOf = (state) => {
  const cal = state?.calibration;
  const f = cal?.feetPerPixel;
  if (!cal?.calibrated) return null;
  if (finite(f)) return { x: f, y: f };
  if (finite(f?.x) && finite(f?.y)) return { x: f.x, y: f.y };
  return null;
};

// One run of the checks on a plan's `role` key, shared by `check` and `apply`.
export const runCheck = async (name, role, ctx, { feetPerPixel = null } = {}) => {
  const snappedFile = wipFile(name, `.${role}.snapped.json`, ctx.dir);
  if (!exists(snappedFile)) throw new Error(`no ${path.basename(snappedFile)} in ${wipDir(ctx.dir)}: run snap --role ${role} first`);
  const outlines = readOutlines(snappedFile, { strict: false });
  const specFile = wipFile(name, `.${role}.json`, ctx.dir);
  const spec = exists(specFile) ? validateSpec(readJson(specFile)) : null;
  const project = readPlan(name, ctx);
  const state = project.floors[0].state;
  const { image } = await imageOfPlan(name, ctx.dir);
  const scale = feetPerPixel ? { x: feetPerPixel, y: feetPerPixel } : scaleOf(state);
  const result = checkKey({
    outlines, spec, labels: labelsOf(state), image, scale,
  });
  return {
    ...result, spec, outlines, snappedFile, scale,
  };
};

const STATUS_TAG = {
  pass: 'PASS  ', warn: 'WARN  ', fail: 'FAIL  ', waived: 'WAIVED',
};

export const checkLines = (name, role, result) => {
  const lines = [`CHECK ${name} (${role}): ${result.outlines.length} outline(s), scale ${result.scale ? `${result.scale.x.toPrecision(5)} x ${result.scale.y.toPrecision(5)} ft/px` : 'none (no calibration; use --feet-per-pixel)'}`];
  for (const a of result.areas.perOutline) {
    lines.push(`  outline ${a.outline} ${a.type}${a.name ? ` "${a.name}"` : ''}: ${Math.round(a.px2).toLocaleString('en-US')} px2${a.sqft != null ? `, ${Math.round(a.sqft).toLocaleString('en-US')} sq ft` : ''}`);
  }
  const t = result.areas.totals;
  if (result.scale) {
    lines.push(`  total GLA ${Math.round(t.gla?.sqft ?? 0).toLocaleString('en-US')} sq ft${t['below-grade'] ? `, below grade ${Math.round(t['below-grade'].sqft).toLocaleString('en-US')}` : ''}${t.garage ? `, garage ${Math.round(t.garage.sqft).toLocaleString('en-US')}` : ''}${t.porch ? `, porch/patio ${Math.round(t.porch.sqft).toLocaleString('en-US')}` : ''}${t.unfinished ? `, unfinished ${Math.round(t.unfinished.sqft).toLocaleString('en-US')}` : ''}`);
  }
  for (const item of result.items) lines.push(`${STATUS_TAG[item.status]} ${item.check.padEnd(8)} ${item.subject}: ${item.detail}`);
  lines.push(`${result.warnings} warning(s), ${result.waived} waived`);
  lines.push(result.failures ? `CHECK FAIL (${result.failures})` : 'CHECK PASS');
  return lines;
};

export const check = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['role', 'feet-per-pixel'], flags: ['json'] }, 'check');
  const [name] = need(positional, 1, 'check NAME [--role a|b|final] [--feet-per-pixel X] [--json]');
  checkName(name);
  const role = roleOf(opts);
  let feetPerPixel = null;
  if (opts['feet-per-pixel'] !== undefined) {
    feetPerPixel = Number(opts['feet-per-pixel']);
    if (!(feetPerPixel > 0)) throw new Error('--feet-per-pixel must be a positive number');
  }
  const result = await runCheck(name, role, ctx, { feetPerPixel });
  if (opts.json) {
    const { spec: _spec, outlines: _outlines, ...rest } = result;
    ctx.out(JSON.stringify({ name, role, ...rest, pass: result.failures === 0 }, null, 1));
  } else for (const line of checkLines(name, role, result)) ctx.out(line);
  return result.failures ? 1 : 0;
};

// ---- review ----------------------------------------------------------------------

const readRecord = (name, ctx) => {
  const file = wipFile(name, '.record.json', ctx.dir);
  if (!exists(file)) return null;
  return readJson(file);
};

const reviewFiles = (name, ctx) => {
  if (!exists(wipDir(ctx.dir))) return [];
  const re = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.review-(\\d+)\\.json$`);
  return fs.readdirSync(wipDir(ctx.dir))
    .map((f) => ({ f, n: Number(re.exec(f)?.[1]) }))
    .filter((x) => Number.isInteger(x.n))
    .sort((x, y) => x.n - y.n);
};

// Who drew or settled a plan's key: the reviewer may not be one of them.
const involved = (name, ctx) => {
  const people = new Set();
  const record = readRecord(name, ctx);
  for (const p of [...(record?.annotators ?? []), record?.adjudicator]) if (p) people.add(String(p));
  for (const role of ROLES) {
    const file = wipFile(name, `.${role}.json`, ctx.dir);
    if (!exists(file)) continue;
    try {
      const author = readJson(file).author;
      if (author) people.add(String(author));
    } catch {
      // A spec that will not parse is `snap`'s to report, not the review's.
    }
  }
  return people;
};

export const review = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['agent', 'region', 'reason', 'note'], flags: ['approve', 'reject'] }, 'review');
  const [name] = need(positional, 1, 'review NAME --approve|--reject --agent ID [--region X0,Y0,X1,Y1 --reason "..."] [--note "..."]');
  checkName(name);
  if (opts.approve === opts.reject) throw new Error('review needs exactly one of --approve or --reject');
  const agent = String(opts.agent ?? '').trim();
  if (!agent) throw new Error('review needs --agent ID (who is reviewing)');
  const reason = opts.reason === undefined ? null : String(opts.reason).trim();
  if (opts.reject && !reason) throw new Error('--reject needs --reason "...": the adjudicator works from it (and --region X0,Y0,X1,Y1 where it applies)');
  const region = opts.region ? boxOf(opts.region, '--region') : null;
  const finalFile = wipFile(name, '.final.snapped.json', ctx.dir);
  if (!exists(finalFile)) throw new Error(`nothing to review: ${path.basename(finalFile)} does not exist in ${wipDir(ctx.dir)}`);
  if (involved(name, ctx).has(agent)) throw new Error(`${agent} drew or adjudicated ${name}'s key and may not review it`);
  const done = reviewFiles(name, ctx);
  const n = (done.at(-1)?.n ?? 0) + 1;
  const record = {
    name,
    n,
    agent,
    at: new Date().toISOString(),
    decision: opts.approve ? 'approve' : 'reject',
    region,
    reason,
    note: opts.note === undefined ? null : String(opts.note),
    keySha256: sha256(fs.readFileSync(finalFile)),
  };
  const file = wipFile(name, `.review-${n}.json`, ctx.dir);
  await writeJson(file, record);
  ctx.out(file);
  ctx.out(JSON.stringify(record, null, 1));
  return 0;
};

// ---- apply -----------------------------------------------------------------------

const VERIFIED = ['blind double annotation', 'single annotation'];

export const apply = async (argv, ctx) => {
  const { positional, opts } = parseArgs(argv, { values: ['dispute'] }, 'apply');
  const [name] = need(positional, 1, 'apply NAME [--dispute ID]');
  checkName(name);
  const finalFile = wipFile(name, '.final.snapped.json', ctx.dir);
  if (!exists(finalFile)) throw new Error(`${path.basename(finalFile)} does not exist: there is no final key to apply`);
  const record = readRecord(name, ctx);
  if (!record) throw new Error(`${name}.record.json does not exist in ${wipDir(ctx.dir)}: the orchestrator writes it ({"annotators": [...], "adjudicator": null|"...", "verifiedBy": "..."})`);
  if (!Array.isArray(record.annotators) || !record.annotators.length || !record.annotators.every((x) => typeof x === 'string' && x)) {
    throw new Error(`${name}.record.json needs "annotators": a non-empty array of agent ids`);
  }
  if (record.adjudicator != null && (typeof record.adjudicator !== 'string' || !record.adjudicator)) throw new Error(`${name}.record.json: "adjudicator" is null or an agent id`);
  if (!VERIFIED.includes(record.verifiedBy)) throw new Error(`${name}.record.json: "verifiedBy" must be one of: ${VERIFIED.map((v) => `"${v}"`).join(', ')}`);
  const latest = reviewFiles(name, ctx).at(-1);
  if (!latest) throw new Error(`${name} has no review: run review --approve first`);
  const decision = readJson(wipFile(name, `.review-${latest.n}.json`, ctx.dir));
  if (decision.decision !== 'approve') throw new Error(`the latest review of ${name} (review-${latest.n}) is a rejection: ${decision.reason ?? ''}`);
  if (decision.keySha256 !== sha256(fs.readFileSync(finalFile))) {
    throw new Error(`${name}'s final key changed after review-${latest.n} approved it: it needs a fresh review`);
  }
  const result = await runCheck(name, 'final', ctx);
  if (result.failures) throw new Error(`${name} fails check (${result.failures} failure(s)): run check ${name} and fix them first`);
  const notes = String(result.spec?.notes ?? '').trim();
  if (!notes) throw new Error(`${name}.final.json has no "notes": they are the record of the key's judgment calls`);
  const project = readPlan(name, ctx);
  const existing = project.answerKey;
  if (existing?.checked && !opts.dispute) {
    throw new Error(`${name}'s key was checked (${existing.checked.by}, ${existing.checked.at}) and is frozen: a change comes only through a dispute (apply ${name} --dispute ID)`);
  }
  const at = new Date().toISOString();
  const about = {
    by: `annotators: ${record.annotators.join(', ')}; adjudicator: ${record.adjudicator ?? 'none'}`,
    verifiedBy: record.verifiedBy,
    checked: { by: 'AI review', at: decision.at, via: 'final review' },
    at,
    notes,
    ...(opts.dispute ? { disputeId: opts.dispute } : {}),
  };
  const outlines = result.outlines.map((o) => ({ type: o.type, points: o.v.map((p) => [round1(p[0]), round1(p[1])]) }));
  const applied = applyPlan(project, outlines, about, { force: true });
  // The same key with a new record (a re-review): the record still changes.
  if (applied.outcome === 'unchanged') project.answerKey = about;
  project.metadata = { ...project.metadata, updatedAt: at };
  await writeFileRetry(planFile(name, ctx.dir), JSON.stringify(project));
  ctx.out(`${name}: key ${applied.outcome}; record by ${about.by}; ${about.verifiedBy}; checked ${about.checked.at}${about.disputeId ? `; dispute ${about.disputeId}` : ''}`);
  ctx.out('Run `node scripts/realKeys.mjs export` to refresh answer-keys.json.');
  return 0;
};

// ---- sheet -----------------------------------------------------------------------

const keysOf = (project) => (keyOf(project.floors[0].state) ?? []).map((o) => ({ type: o.type, v: o.points }));

const wrap = (g, text, width) => {
  const lines = [];
  let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (g.measureText(next).width > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

export const sheet = async (argv, ctx) => {
  const { positional: names, opts } = parseArgs(argv, { values: ['out', 'per'] }, 'sheet');
  if (!opts.out || !names.length) throw new UsageError('usage: sheet NAME... --out FILE [--per N]');
  const per = opts.per === undefined ? 4 : Number(opts.per);
  if (!(per >= 1)) throw new Error('--per must be a number of plans, 1 or more');
  const CELL_W = 960;
  const IMG_H = 760;
  const NOTES_H = 190;
  const CELL_H = IMG_H + NOTES_H;
  const LEGEND_H = 44;
  const pages = [];
  for (let i = 0; i < names.length; i += per) pages.push(names.slice(i, i + per));
  const written = [];
  for (const [p, group] of pages.entries()) {
    const cols = group.length > 1 ? 2 : 1;
    const rows = Math.ceil(group.length / cols);
    const canvas = createCanvas(cols * CELL_W, LEGEND_H + rows * CELL_H);
    const g = canvas.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, canvas.width, canvas.height);
    g.font = 'bold 20px sans-serif';
    let lx = 14;
    for (const [type, color] of Object.entries(TYPE_COLORS)) {
      g.fillStyle = color;
      g.fillRect(lx, 12, 22, 18);
      g.fillStyle = '#000';
      g.fillText(TYPE_LABELS[type], lx + 30, 28);
      lx += 30 + g.measureText(TYPE_LABELS[type]).width + 26;
    }
    for (const [k, name] of group.entries()) {
      const ox = (k % cols) * CELL_W;
      const oy = LEGEND_H + Math.floor(k / cols) * CELL_H;
      const project = readPlan(checkName(name), ctx);
      const { bytes } = planImageBytes(project);
      const img = await loadImage(bytes);
      const s = Math.min((CELL_W - 20) / img.width, (IMG_H - 50) / img.height);
      const dx = ox + (CELL_W - img.width * s) / 2;
      const dy = oy + 40;
      g.drawImage(img, dx, dy, img.width * s, img.height * s);
      for (const key of keysOf(project)) {
        const color = TYPE_COLORS[key.type] ?? '#000';
        g.beginPath();
        key.v.forEach(([x, y], i) => (i === 0 ? g.moveTo(dx + x * s, dy + y * s) : g.lineTo(dx + x * s, dy + y * s)));
        g.closePath();
        g.globalAlpha = 0.14;
        g.fillStyle = color;
        g.fill();
        g.globalAlpha = 1;
        g.strokeStyle = color;
        g.lineWidth = 3;
        g.stroke();
      }
      g.fillStyle = '#000';
      g.font = 'bold 26px sans-serif';
      g.fillText(name, ox + 12, oy + 30);
      const record = project.answerKey;
      const who = record?.by ? `${record.by}${record.verifiedBy ? `; ${record.verifiedBy}` : ''}${record.checked ? `; checked: ${record.checked.by}, ${String(record.checked.at).slice(0, 10)}` : '; not checked'}` : 'no record';
      g.font = 'bold 15px sans-serif';
      g.fillStyle = '#444';
      g.fillText(who.slice(0, 110), ox + 14, oy + IMG_H + 4);
      g.font = '17px sans-serif';
      g.fillStyle = '#222';
      wrap(g, record?.notes ? record.notes : '(no notes)', CELL_W - 28).slice(0, 7).forEach((line, i) => g.fillText(line, ox + 14, oy + IMG_H + 28 + i * 22));
      g.strokeStyle = '#999';
      g.lineWidth = 1;
      g.strokeRect(ox + 1, oy + 1, CELL_W - 2, CELL_H - 2);
    }
    const base = opts.out.replace(/\.png$/i, '');
    const file = pages.length > 1 ? `${base}-${p + 1}.png` : `${base}.png`;
    await writeFileRetry(path.resolve(file), canvas.toBuffer('image/png'));
    written.push(file);
  }
  for (const file of written) ctx.out(file);
  return 0;
};

export const COMMANDS = {
  view, blind, labels, probe, snap, compare, check, review, apply, sheet,
};
