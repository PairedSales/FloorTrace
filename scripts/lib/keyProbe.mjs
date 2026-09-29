// The ink along a line, for settling which stroke is the wall face
// (scripts/realKeyTool.mjs `probe`). Luminance is sampled at pixel centres
// (a pixel i spans [i, i + 1)) with the same threshold `snap` uses, and the
// dark and light runs are read off with their ends placed where the luminance
// crosses the threshold between two samples.
import { lumaAt, otsuOfImage } from './keySnap.mjs';

/**
 * Samples the segment from `from` to `to` every `step` px (the end included).
 * `origin` shifts the printed distances (an across-probe reads from -half).
 * Returns `{threshold, length, samples: [{t, x, y, luma}], runs: [{kind, from,
 * to, length}]}`, distances along the segment in px.
 */
export const probeLine = (image, from, to, { step = 0.5, origin = 0, threshold = otsuOfImage(image) } = {}) => {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (length === 0) throw new Error('the segment has zero length');
  if (!(step > 0)) throw new Error('--step must be positive');
  const dir = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  const count = Math.max(1, Math.ceil(length / step - 1e-9));
  const samples = [];
  for (let i = 0; i <= count; i += 1) {
    const t = Math.min(length, i * step);
    const x = from[0] + dir[0] * t;
    const y = from[1] + dir[1] * t;
    samples.push({ t: t + origin, x, y, luma: lumaAt(image, x, y) });
  }
  const runs = [];
  const at = (t) => [from[0] + dir[0] * (t - origin), from[1] + dir[1] * (t - origin)];
  const push = (kind, a, b) => runs.push({
    kind, from: a, to: b, length: b - a, p0: at(a), p1: at(b),
  });
  let start = samples[0].t;
  let kind = samples[0].luma < threshold ? 'dark' : 'light';
  for (let i = 1; i < samples.length; i += 1) {
    const now = samples[i].luma < threshold ? 'dark' : 'light';
    if (now === kind) continue;
    const a = samples[i - 1];
    const b = samples[i];
    const u = (threshold - a.luma) / (b.luma - a.luma);
    const cross = a.t + (b.t - a.t) * u;
    push(kind, start, cross);
    start = cross;
    kind = now;
  }
  const end = samples[samples.length - 1].t;
  push(kind, start, end);
  return { threshold, length, samples, runs };
};

/** The segment through `centre` at `angleDeg` (0 = along +x, 90 = down the page), `half` px each way. */
export const probeAcross = (image, centre, angleDeg, half, options = {}) => {
  const a = (angleDeg * Math.PI) / 180;
  const d = [Math.cos(a), Math.sin(a)];
  return probeLine(
    image,
    [centre[0] - d[0] * half, centre[1] - d[1] * half],
    [centre[0] + d[0] * half, centre[1] + d[1] * half],
    { ...options, origin: -half },
  );
};

const f1 = (x) => (Math.abs(x) < 0.05 ? 0 : x).toFixed(1);

/** The probe as lines of text: the samples, the threshold, then the runs with where each starts on the page. */
export const probeLines = (result) => {
  const lines = [];
  const { samples } = result;
  lines.push(`luminance (0 black - 255 white) at ${samples.length} points, ${f1(samples[1].t - samples[0].t)} px apart:`);
  for (let i = 0; i < samples.length; i += 12) {
    const row = samples.slice(i, i + 12);
    lines.push(`  t=${f1(row[0].t).padStart(6)}  ${row.map((s) => String(Math.round(s.luma)).padStart(3)).join(' ')}`);
  }
  lines.push(`ink threshold ${result.threshold.toFixed(1)} (the page's own: darker than this is ink)`);
  for (const run of result.runs) {
    lines.push(`${run.kind} ${f1(run.from)}–${f1(run.to)} (${f1(run.length)} px)   from x,y ${f1(run.p0[0])},${f1(run.p0[1])} to ${f1(run.p1[0])},${f1(run.p1[1])}`);
  }
  return lines;
};
