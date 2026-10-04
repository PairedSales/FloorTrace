/**
 * What the page's own thread is doing while a plan loads — measured in the
 * browser, where the Node harnesses cannot see.
 *
 * The benchmarks time the pipelines; none of them can say whether the page
 * could repaint or take a click while one ran. This does: it drops a plan on
 * the running app, samples the page thread for the length of the run, and
 * reports each stretch it was busy with what it was mostly busy doing.
 *
 * Use it from the dev server (the Browser pane's `javascript_tool`, or the
 * console):
 *
 *   const probe = await import('/FloorTrace/scripts/pageProbe.js');
 *   const run = await probe.dropAndProfile(await probe.fixture('ExampleFloorplan.png'), 'plan.png');
 *   probe.freezes(run);      // [{ at, ms, what, leaf }]
 *   probe.hotspots(run);     // { busyMs, self: [...], inclusive: [...] }
 *
 * `photo(...)` and `pdf(...)` make the two inputs the fixtures do not cover: a
 * 12 MP phone photo and a one-page Letter PDF.
 *
 * The sampler is the JS Self-Profiling API, which a document may only use when
 * it is served with `Document-Policy: js-profiling` — `vite.config.js` sends it
 * from the dev and preview servers for this. For a production build with
 * readable names: `npx vite build --minify false`, `npx vite preview`, and
 * copy this file and `fixtures/` into `dist/` first.
 */

// The Browser pane's document is hidden: rAF never fires, so Konva never
// draws and its cost would be missing from every run. Frames are run from a
// message rather than a timer, because a hidden page's timers are throttled —
// a frame that arrives a second late reads as a slow draw.
if (document.hidden) {
  const frames = new MessageChannel();
  let queue = [];
  frames.port1.onmessage = () => {
    const run = queue;
    queue = [];
    for (const cb of run) cb(performance.now());
  };
  window.requestAnimationFrame = (cb) => {
    queue.push(cb);
    if (queue.length === 1) frames.port2.postMessage(0);
    return 0;
  };
  window.dispatchEvent(new Event('resize'));
}

const logs = [];
const debug = console.debug;
console.debug = (...args) => {
  logs.push([performance.now(),
    args.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')]);
  debug.apply(console, args);
};

/** A fixture as it is on disk. */
export const fixture = async (name) => (await fetch(`/FloorTrace/fixtures/${name}`)).blob();

/**
 * A fixture redrawn at another size. `noise` makes it compress the way a
 * photograph does, which is what decides how large its PNG re-encode is.
 */
export const photo = async (name, width = 4032, height = 3024, { type = 'image/jpeg', noise = 10 } = {}) => {
  const bitmap = await createImageBitmap(await fixture(name));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  const scale = Math.min(width / bitmap.width, height / bitmap.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, bitmap.width * scale, bitmap.height * scale);
  if (noise) {
    const imageData = ctx.getImageData(0, 0, width, height);
    const d = imageData.data;
    let seed = 12345;
    for (let i = 0; i < d.length; i += 4) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = ((seed >>> 24) % (2 * noise + 1)) - noise - 18;
      d[i] = Math.max(0, Math.min(255, d[i] + n));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n - 6));
    }
    ctx.putImageData(imageData, 0, 0);
  }
  return canvas.convertToBlob({ type, quality: 0.9 });
};

/** A one-page Letter PDF holding a fixture — the shape an exported sketch arrives in. */
export const pdf = async (name, width = 2550, height = 3300) => {
  const jpeg = new Uint8Array(await (await photo(name, width, height, { noise: 0 })).arrayBuffer());
  const encoder = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (x) => {
    const bytes = typeof x === 'string' ? encoder.encode(x) : x;
    parts.push(bytes);
    length += bytes.length;
  };
  const object = (n, body) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
    body();
    push('\nendobj\n');
  };
  push('%PDF-1.4\n');
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'));
  object(2, () => push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'));
  object(3, () => push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] '
    + '/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>'));
  object(4, () => {
    push(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} `
      + `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
    push(jpeg);
    push('\nendstream');
  });
  const content = 'q 612 0 0 792 0 0 cm /Im0 Do Q';
  object(5, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  const xref = length;
  push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5]
    .map((n) => `${String(offsets[n]).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
};

/**
 * Drop a file on the app and sample the page thread until the area is on
 * screen (plus `settleMs`, for whatever lands just after).
 *
 * A drop onto an open plan opens another beside it and the app holds six, so
 * clear the workspace between runs.
 *
 * @returns {Promise<{trace: object, from: number, to: number, totalMs: number|null,
 *   report: string|null}>} `totalMs` is drop to area; `report` is the DEV build's
 *   own stage breakdown (`utils/perfMarks.js`), null in a production build.
 */
export const dropAndProfile = async (blob, name, { waitMs = 30000, settleMs = 2500 } = {}) => {
  logs.length = 0;
  const profiler = new window.Profiler({ sampleInterval: 4, maxBufferSize: 400000 });

  const transfer = new DataTransfer();
  transfer.items.add(new File([blob], name, { type: blob.type }));
  const from = performance.now();
  document.getElementById('app-container')
    .dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, bubbles: true }));

  let doneAt = null;
  let report = null;
  let sawMeasuring = false;
  while (performance.now() < from + waitMs) {
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    const logged = logs.find(([, text]) => text.includes('image-load-to-area'));
    if (logged) {
      [doneAt, report] = logged;
      break;
    }
    // A production build has no perf marks. The panel's measuring list
    // appearing and then going is the same event, seen from the DOM.
    const measuring = Boolean(document.querySelector('#panel-steps li[data-state]'));
    sawMeasuring = sawMeasuring || measuring;
    if (sawMeasuring && !measuring && document.querySelector('#panel-steps')) {
      doneAt = performance.now();
      break;
    }
  }
  await new Promise((resolve) => { setTimeout(resolve, settleMs); });

  return {
    trace: await profiler.stop(),
    from,
    to: (doneAt ?? from + waitMs) + settleMs,
    totalMs: doneAt === null ? null : Math.round(doneAt - from),
    report,
  };
};

// The sampler does not tick evenly — it bursts under load — so a sample is
// worth the time to the next one, not a fixed interval.
const weighted = ({ trace, from, to }) => {
  const { samples } = trace;
  const out = [];
  for (let i = 0; i < samples.length; i += 1) {
    const { timestamp, stackId } = samples[i];
    if (timestamp < from || timestamp > to) continue;
    const next = samples[i + 1]?.timestamp ?? timestamp;
    out.push({ at: timestamp - from, ms: Math.min(50, next - timestamp), stackId });
  }
  return out;
};

// Leaf first.
const stackOf = (trace, stackId) => {
  const frames = [];
  let stack = trace.stacks[stackId];
  while (stack) {
    const frame = trace.frames[stack.frameId];
    const url = frame.resourceId != null ? trace.resources[frame.resourceId] : '';
    frames.push({
      name: frame.name || '(anonymous)',
      file: url.split('?')[0].split('/').slice(-2).join('/'),
      line: frame.line,
    });
    stack = stack.parentId != null ? trace.stacks[stack.parentId] : null;
  }
  return frames;
};

const label = (frame) => `${frame.name} @${frame.file}${frame.line ? `:${frame.line}` : ''}`;

const ranked = (totals, count) => [...totals.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, count)
  .map(([name, ms]) => `${Math.round(ms)}ms ${name}`);

/** Page-thread time per function over a run: its own, and with what it called. */
export const hotspots = (run, count = 25) => {
  const self = new Map();
  const inclusive = new Map();
  let busyMs = 0;
  for (const sample of weighted(run)) {
    if (sample.stackId == null) continue;
    busyMs += sample.ms;
    const frames = stackOf(run.trace, sample.stackId).map(label);
    self.set(frames[0], (self.get(frames[0]) ?? 0) + sample.ms);
    for (const frame of new Set(frames)) inclusive.set(frame, (inclusive.get(frame) ?? 0) + sample.ms);
  }
  return { busyMs: Math.round(busyMs), self: ranked(self, count), inclusive: ranked(inclusive, count) };
};

// What a stretch was for, by the first of these found anywhere on its stack.
const CATEGORIES = [
  ['re-encoding the image', /prepareDataUrl|renderPage/],
  ['reading room sizes on the page', /detectDimensionsCore|scanOnPage/],
  ['autosave', /setDraft|writeDocDraft|saveAutosavedDraft/],
  ['drawing the plan', /drawScene|batchDraw/],
  ['react', /performWorkOnRoot|flushPassiveEffects|flushSpawnedWork/],
];

/**
 * Every stretch the page thread was continuously busy for `minMs` or more: a
 * span in which nothing could repaint and no click was answered.
 */
export const freezes = (run, minMs = 60) => {
  const stretches = [];
  let current = null;
  for (const sample of weighted(run)) {
    if (sample.stackId == null) {
      current = null;
      continue;
    }
    if (!current) {
      current = { at: Math.round(sample.at), ms: 0, what: new Map(), leaf: new Map() };
      stretches.push(current);
    }
    const frames = stackOf(run.trace, sample.stackId);
    const names = frames.map((frame) => frame.name).join(' ');
    const category = CATEGORIES.find(([, pattern]) => pattern.test(names))?.[0] ?? 'other';
    current.ms += sample.ms;
    current.what.set(category, (current.what.get(category) ?? 0) + sample.ms);
    current.leaf.set(frames[0].name, (current.leaf.get(frames[0].name) ?? 0) + sample.ms);
  }
  return stretches
    .filter((stretch) => stretch.ms >= minMs)
    .map((stretch) => ({
      at: stretch.at,
      ms: Math.round(stretch.ms),
      what: ranked(stretch.what, 3).join(', '),
      leaf: ranked(stretch.leaf, 4).join(', '),
    }));
};
