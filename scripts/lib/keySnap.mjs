// The snapping rule behind scripts/realKeyTool.mjs, pure so it is tested on a
// synthetic wall band without the set.
//
// A key is drawn by eye, a few pixels off the wall. `snapOutline` moves each
// edge to where the ink says the wall's outer face is: it samples luminance
// along the edge's outward normal, takes the fraction of samples that are dark
// at each offset, and reads the wall band off that profile. The face is the
// band's outer end, which is what an appraiser measures to, never its centre.
// An edge listed in `in` takes the inner end instead: a garage or porch edge
// along the house wall, so the two outlines meet at the house's exterior face.

const EPS = 1e-9;

// The page's ink threshold: Otsu's split of a 256-bin luma histogram, taken as
// the midpoint of the two classes' means. Otsu's own index is the last bin of
// the dark class, which for a page of two tones is that tone, so nothing would
// count as darker than it.
export const otsuOfImage = (image) => {
  const hist = new Float64Array(256);
  const { data, width, height } = image;
  for (let i = 0; i < width * height; i += 1) {
    hist[(data[i * 4] * 77 + data[i * 4 + 1] * 150 + data[i * 4 + 2] * 29) >> 8] += 1;
  }
  const total = width * height;
  let sumAll = 0;
  for (let t = 0; t < 256; t += 1) sumAll += t * hist[t];
  let sumBg = 0;
  let weightBg = 0;
  let best = 127;
  let bestVar = -1;
  for (let t = 0; t < 256; t += 1) {
    weightBg += hist[t];
    if (weightBg === 0) continue;
    const weightFg = total - weightBg;
    if (weightFg === 0) break;
    sumBg += t * hist[t];
    const between = weightBg * weightFg * ((sumBg / weightBg) - ((sumAll - sumBg) / weightFg)) ** 2;
    if (between > bestVar) {
      bestVar = between;
      best = t;
    }
  }
  let darkSum = 0;
  let darkN = 0;
  for (let t = 0; t <= best; t += 1) {
    darkSum += t * hist[t];
    darkN += hist[t];
  }
  const lightN = total - darkN;
  if (darkN === 0 || lightN === 0) return best;
  return (darkSum / darkN + (sumAll - darkSum) / lightN) / 2;
};

// Luma at a point of the image's own coordinates, where pixel i spans
// [i, i + 1) as in the canvas and in every key: its centre is i + 0.5.
const lumaAt = (image, x, y) => {
  const { data, width, height } = image;
  const fx = Math.min(Math.max(x - 0.5, 0), width - 1);
  const fy = Math.min(Math.max(y - 0.5, 0), height - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const ax = fx - x0;
  const ay = fy - y0;
  const px = (xx, yy) => {
    const i = (yy * width + xx) * 4;
    return (data[i] * 77 + data[i + 1] * 150 + data[i + 2] * 29) / 256;
  };
  return (px(x0, y0) * (1 - ax) + px(x1, y0) * ax) * (1 - ay) + (px(x0, y1) * (1 - ax) + px(x1, y1) * ax) * ay;
};

// The ring's winding in image (y down) coordinates: +1 for a positive shoelace
// sum, which makes (dy, -dx) of an edge point away from the inside.
const windingOf = (v) => {
  let a = 0;
  for (let i = 0; i < v.length; i += 1) {
    const [x0, y0] = v[i];
    const [x1, y1] = v[(i + 1) % v.length];
    a += x0 * y1 - x1 * y0;
  }
  return a >= 0 ? 1 : -1;
};

// The band along one stretch of an edge: offsets (along the outward normal)
// from -R to +R every 0.25 px, the fraction of samples darker than `dark` at
// each, and the run of offsets at least max(0.15, 0.45 x peak) nearest the
// drawn line. `t0`..`t1` bound the stretch along the edge.
const profileOf = (image, dark, a, dir, normal, t0, t1, R) => {
  const steps = Math.round((2 * R) / 0.25);
  const frac = new Float64Array(steps + 1);
  let count = 0;
  for (let t = t0; t <= t1 + EPS; t += 1) {
    count += 1;
    const bx = a[0] + dir[0] * t;
    const by = a[1] + dir[1] * t;
    for (let k = 0; k <= steps; k += 1) {
      const d = -R + k * 0.25;
      if (lumaAt(image, bx + normal[0] * d, by + normal[1] * d) < dark) frac[k] += 1;
    }
  }
  if (count === 0) return null;
  let peak = 0;
  for (let k = 0; k <= steps; k += 1) {
    frac[k] /= count;
    if (frac[k] > peak) peak = frac[k];
  }
  const threshold = Math.max(0.15, 0.45 * peak);
  if (peak < 0.15) return { found: false, peak };
  const runs = [];
  let k = 0;
  while (k <= steps) {
    if (frac[k] < threshold) {
      k += 1;
      continue;
    }
    let e = k;
    while (e + 1 <= steps && frac[e + 1] >= threshold) e += 1;
    runs.push([k, e]);
    k = e + 1;
  }
  const offsetOf = (idx) => -R + idx * 0.25;
  // The crossing between the last offset inside the run and the first outside.
  const crossing = (inside, outside) => {
    if (outside < 0 || outside > steps) return offsetOf(inside);
    const fi = frac[inside];
    const fo = frac[outside];
    const u = fi === fo ? 0 : (fi - threshold) / (fi - fo);
    return offsetOf(inside) + (offsetOf(outside) - offsetOf(inside)) * u;
  };
  const gap = ([s, e]) => (s <= R * 4 && e >= R * 4 ? 0 : Math.min(Math.abs(offsetOf(s)), Math.abs(offsetOf(e))));
  const [s, e] = runs.reduce((best, run) => (gap(run) < gap(best) ? run : best));
  return {
    found: true,
    peak,
    outer: crossing(e, e + 1),
    inner: crossing(s, s - 1),
    reachesEnd: s === 0 || e === steps,
  };
};

const lineThrough = (p, dir) => ({ p, dir });

const intersect = (l1, l2) => {
  const cross = l1.dir[0] * l2.dir[1] - l1.dir[1] * l2.dir[0];
  if (Math.abs(cross) < 1e-6) return null;
  const dx = l2.p[0] - l1.p[0];
  const dy = l2.p[1] - l1.p[1];
  const t = (dx * l2.dir[1] - dy * l2.dir[0]) / cross;
  return [l1.p[0] + l1.dir[0] * t, l1.p[1] + l1.dir[1] * t];
};

const closestOn = (line, pt) => {
  const t = (pt[0] - line.p[0]) * line.dir[0] + (pt[1] - line.p[1]) * line.dir[1];
  return [line.p[0] + line.dir[0] * t, line.p[1] + line.dir[1] * t];
};

/**
 * One outline's edges moved to the outer face of the wall bands.
 *
 * `outline`: `{v: [[x, y], …], fix?: [edge…], in?: [edge…], R?: 14, tilt?: bool}`.
 * Edge i runs from v[i] to v[i+1]. Returns `{v, edges}` where `edges[i]` is
 * `{edge, moved, flag}`: `flag` is null, 'no-band', 'far' (moved more than
 * 4 px) or 'reaches-end' (the band runs to the end of the search).
 */
export const snapOutline = (image, outline, { dark = otsuOfImage(image), fixedVertices = [] } = {}) => {
  const { v, R = 14, tilt = false } = outline;
  const fix = new Set(outline.fix ?? []);
  const inside = new Set(outline.in ?? []);
  const n = v.length;
  const sign = windingOf(v);
  const lines = [];
  const edges = [];
  for (let i = 0; i < n; i += 1) {
    const a = v[i];
    const b = v[(i + 1) % n];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
    // Outward: away from the inside, whichever way the ring is wound.
    const normal = [dir[1] * sign, -dir[0] * sign];
    // An edge between two shared vertices is the shared boundary itself.
    const shared = fixedVertices[i] && fixedVertices[(i + 1) % n];
    if (fix.has(i) || shared) {
      lines.push(lineThrough(a, dir));
      edges.push({ edge: i, moved: 0, flag: null, fixed: true });
      continue;
    }
    const skip = Math.min(12, 0.2 * len);
    const useInner = inside.has(i);
    const pick = (p) => (useInner ? p.inner : p.outer);
    const whole = profileOf(image, dark, a, dir, normal, skip, len - skip, R);
    if (!whole?.found) {
      lines.push(lineThrough(a, dir));
      edges.push({ edge: i, moved: 0, flag: 'no-band' });
      continue;
    }
    let line;
    let moved = pick(whole);
    const flagged = whole.reachesEnd;
    if (tilt && len >= 180) {
      const first = profileOf(image, dark, a, dir, normal, skip, len / 3, R);
      const last = profileOf(image, dark, a, dir, normal, (2 * len) / 3, len - skip, R);
      if (first?.found && last?.found) {
        const t1 = (skip + len / 3) / 2;
        const t2 = ((2 * len) / 3 + len - skip) / 2;
        const p1 = [a[0] + dir[0] * t1 + normal[0] * pick(first), a[1] + dir[1] * t1 + normal[1] * pick(first)];
        const p2 = [a[0] + dir[0] * t2 + normal[0] * pick(last), a[1] + dir[1] * t2 + normal[1] * pick(last)];
        const tl = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
        line = lineThrough(p1, [(p2[0] - p1[0]) / tl, (p2[1] - p1[1]) / tl]);
        moved = (pick(first) + pick(last)) / 2;
      }
    }
    line ??= lineThrough([a[0] + normal[0] * moved, a[1] + normal[1] * moved], dir);
    lines.push(line);
    edges.push({ edge: i, moved, flag: flagged ? 'reaches-end' : Math.abs(moved) > 4 ? 'far' : null });
  }
  // Each vertex is where its two edges meet; two edges on one line meet
  // nowhere, so the vertex slides to the edge instead.
  const out = v.map((pt, i) => {
    if (fixedVertices[i]) return fixedVertices[i];
    const prev = lines[(i + n - 1) % n];
    const next = lines[i];
    return intersect(prev, next) ?? closestOn(next, pt);
  });
  return { v: out, edges };
};

// The keys-wip file's outlines snapped together: `['ref', k, i]` is vertex i of
// outline k after it has snapped, so two outlines share a boundary exactly.
// Outlines snap in an order that puts each one after those it refers to.
export const snapOutlines = (image, outlines, options = {}) => {
  const dark = options.dark ?? otsuOfImage(image);
  const isRef = (p) => Array.isArray(p) && p[0] === 'ref';
  const done = new Array(outlines.length).fill(null);
  const deps = outlines.map((o) => [...new Set(o.v.filter(isRef).map((p) => p[1]))]);
  let remaining = outlines.length;
  while (remaining > 0) {
    let progressed = false;
    for (let k = 0; k < outlines.length; k += 1) {
      if (done[k] || !deps[k].every((d) => done[d])) continue;
      const fixedVertices = outlines[k].v.map((p) => (isRef(p) ? done[p[1]].v[p[2]] : null));
      const rough = outlines[k].v.map((p, i) => fixedVertices[i] ?? p);
      const snapped = snapOutline(image, { ...outlines[k], v: rough }, { dark, fixedVertices });
      done[k] = { type: outlines[k].type ?? 'gla', v: snapped.v, edges: snapped.edges };
      remaining -= 1;
      progressed = true;
    }
    if (!progressed) throw new Error('outlines refer to each other in a loop');
  }
  return done;
};
