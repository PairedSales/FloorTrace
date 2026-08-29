// Dump every intermediate stage of the exterior trace for one fixture as PNG
// data URIs plus geometry, for docs/tracing-tutorial.html. The tutorial's
// figures are real pipeline output, so a pipeline change that would make the
// page lie shows up as a diff here instead.
//
//   node scripts/tutorialStages.mjs fixtures/ExampleFloorplan8.png out.json
import fs from 'fs';
import { PNG } from 'pngjs';
import {
  binarizeToWorkingScale, openRect, closeRect, bboxAreaOf, labelComponents,
} from '../src/utils/detection/raster.js';
import { analyzeFloorplan } from '../src/utils/detection/analyze.js';
import { partitionWallNetworks, traceBoundary } from '../src/utils/detection/boundary.js';
import {
  measureFootprint, footprintEntry, bridgeRunsGuarded, generateCandidates,
} from '../src/utils/detection/candidates.js';
import { scoreCandidate } from '../src/utils/detection/scoring.js';
import { extractWallSegments, createEvidence, contourSupport } from '../src/utils/detection/wallEvidence.js';
import {
  simplifyRing, fitRing, polygonArea, polygonSignedArea,
} from '../src/utils/detection/polygon.js';
import { traceFramedBoundary, framedComponentMask } from '../src/utils/detection/labelFrame.js';
import { loadPng } from './lib/benchUtils.mjs';

const file = process.argv[2] ?? 'fixtures/ExampleFloorplan8.png';
const outPath = process.argv[3] ?? 'tutorial-stages.json';
const imageData = loadPng(file);

// ---------- encoders ----------
const b64 = (buf) => `data:image/png;base64,${buf.toString('base64')}`;

// A binary mask as black-on-transparent, so the page can tint it with one
// source-in composite instead of shipping a coloured copy per layer.
const maskPng = (mask, w, h) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0, j = 0; i < w * h; i += 1, j += 4) {
    png.data[j] = 0; png.data[j + 1] = 0; png.data[j + 2] = 0;
    png.data[j + 3] = mask[i] ? 255 : 0;
  }
  return b64(PNG.sync.write(png));
};

const grayPng = (gray, w, h) => {
  const png = new PNG({ width: w, height: h });
  for (let i = 0, j = 0; i < w * h; i += 1, j += 4) {
    const v = gray[i];
    png.data[j] = v; png.data[j + 1] = v; png.data[j + 2] = v; png.data[j + 3] = 255;
  }
  return b64(PNG.sync.write(png));
};

const andNot = (a, b) => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] && !b[i] ? 1 : 0;
  return out;
};
const and = (a, b) => {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i += 1) out[i] = a[i] && b[i] ? 1 : 0;
  return out;
};
const count = (m) => { let n = 0; for (let i = 0; i < m.length; i += 1) if (m[i]) n += 1; return n; };

// ---------- stage 1: grayscale + Otsu ----------
const ow = imageData.width;
const oh = imageData.height;
const hist = new Uint32Array(256);
{
  for (let i = 0, j = 0; j < ow * oh; i += 4, j += 1) {
    const v = (imageData.data[i] * 77 + imageData.data[i + 1] * 150 + imageData.data[i + 2] * 29) >> 8;
    hist[v] += 1;
  }
}
// Between-class variance at every threshold, so the page can draw the curve
// Otsu maximises rather than assert that it did.
const betweenVar = new Float64Array(256);
{
  let total = 0; let sumAll = 0;
  for (let t = 0; t < 256; t += 1) { total += hist[t]; sumAll += t * hist[t]; }
  let sumBg = 0; let wBg = 0;
  for (let t = 0; t < 256; t += 1) {
    wBg += hist[t];
    sumBg += t * hist[t];
    const wFg = total - wBg;
    if (wBg === 0 || wFg === 0) { betweenVar[t] = 0; continue; }
    const mBg = sumBg / wBg;
    const mFg = (sumAll - sumBg) / wFg;
    betweenVar[t] = (wBg / total) * (wFg / total) * (mBg - mFg) * (mBg - mFg);
  }
}
const scaled = binarizeToWorkingScale(imageData, 1400);
const { width, height } = scaled;

// ---------- stage 2: analysis ----------
const analysis = analyzeFloorplan(imageData, { maxDimension: 1400 });
const { ink, gray, cleaned, wallMask, boundaryMask, thickMask, wallThickness, band } = analysis;

const specks = andNot(ink, cleaned);
const curves = andNot(cleaned, wallMask);                    // door arcs, short/curved strokes
const rescued = and(andNot(boundaryMask, wallMask), ink);    // line-like residual ink
const glazing = andNot(andNot(boundaryMask, wallMask), ink); // screened bands (not ink at all)

// Stroke-thickness histogram, replicating estimateStrokeThickness so the page
// can show the vote that produced `wallThickness`.
const thicknessHist = (() => {
  const maxRun = Math.max(8, Math.round(Math.max(width, height) * 0.03));
  const h = new Float64Array(maxRun + 1);
  const scan = (start, step, n) => {
    let runStart = -1;
    for (let i = 0; i <= n; i += 1) {
      const on = i < n && wallMask[start + i * step];
      if (on && runStart < 0) runStart = i;
      if (!on && runStart >= 0) {
        const len = i - runStart;
        if (len <= maxRun) h[len] += len;
        runStart = -1;
      }
    }
  };
  for (let y = 0; y < height; y += 1) scan(y * width, 1, width);
  for (let x = 0; x < width; x += 1) scan(x, width, height);
  return Array.from(h);
})();

// ---------- stage 3: wall networks ----------
const nets = partitionWallNetworks(boundaryMask, width, height, wallThickness, 7);
const net = nets[0];

// ---------- stage 4: the closing ladder, every rung ----------
const compW = net.bbox.maxX - net.bbox.minX + 1;
const compH = net.bbox.maxY - net.bbox.minY + 1;
const longest = Math.max(width, height);
const maxGap = Math.max(24, wallThickness * 12, Math.round(Math.max(compW, compH) * 0.3));
const minFlank = Math.max(8, wallThickness * 2);
const probeDepth = Math.max(16, Math.round(Math.min(compW, compH) * 0.12));
const maxRadius = Math.max(32, Math.round(longest * 0.045));
const radii = [];
for (let r = 2; r < maxRadius; r = Math.round(r * 1.45) + 1) radii.push(r);
if (radii[radii.length - 1] !== maxRadius) radii.push(maxRadius);

const thickRadius = Math.max(1, Math.round(wallThickness * 0.3));
const structuralMask = openRect(net.mask, width, height, thickRadius);
const weldedAll = bridgeRunsGuarded(net.mask, width, height, maxGap, minFlank, probeDepth);
const weldedStructural = bridgeRunsGuarded(structuralMask, width, height, maxGap, minFlank, probeDepth);

const wallBboxArea = bboxAreaOf(net.bbox);
const sealMetrics = (area, bboxArea) => {
  const cover = Math.min(1, bboxArea / Math.max(1, wallBboxArea));
  const solidity = area / Math.max(1, bboxArea);
  const c01 = (v) => Math.max(0, Math.min(1, v));
  return {
    cover, solidity,
    seal: Math.sqrt(c01((cover - 0.4) / 0.35) * c01((solidity - 0.25) / 0.3)),
  };
};

const ladder = (name, mask) => {
  const rungs = [];
  for (const r of radii) {
    const fp = measureFootprint(mask, width, height, r);
    if (!fp) continue;
    const largest = fp.largest;
    const parts = fp.components.filter((c) => c.size >= 0.02 * largest.size);
    const enclosed = parts.reduce((s, c) => s + c.size, 0);
    const compMask = framedComponentMask(fp.labels, fp.frame, largest.id, largest.bbox, width, height);
    const closed = closeRect(mask, width, height, r);
    rungs.push({
      radius: r,
      area: largest.size,
      enclosed,
      parts: parts.length,
      ...sealMetrics(largest.size, bboxAreaOf(largest.bbox)),
      bbox: largest.bbox,
      footprint: maskPng(compMask, width, height),
      closedInk: maskPng(closed, width, height),
    });
  }
  // completeness relative to the ladder's reference enclosure
  let end = rungs.length;
  for (let i = 1; i < end; i += 1) {
    if (rungs[i].parts < rungs[i - 1].parts && rungs[i].enclosed > 1.03 * rungs[i - 1].enclosed) { end = i; break; }
  }
  while (end > 1 && rungs[end - 1].enclosed > 1.03 * rungs[end - 2].enclosed) end -= 1;
  let ref = 0;
  for (let i = 0; i < end; i += 1) ref = Math.max(ref, rungs[i].enclosed);
  if (!ref) ref = rungs.reduce((m, r) => Math.max(m, r.enclosed), 1);
  for (const rung of rungs) rung.completeness = Math.min(1, rung.enclosed / ref);
  return { name, referenceEnclosure: ref, rungs };
};

const ladders = [
  ladder('all/weld', weldedAll),
  ladder('structural/weld', weldedStructural),
];

// ---------- stage 5: wall segments ----------
const segs = extractWallSegments(net.mask, width, height, {
  minRun: Math.max(12, Math.round(Math.max(compW, compH) * 0.03)),
  maxThickness: Math.max(8, Math.round(Math.max(4, wallThickness) * 3)),
  bridgeGap: Math.round(Math.max(compW, compH) * 0.55),
});
const segOut = (list, vertical) => list.map((s) => ({
  vertical, faceLo: s.faceLo, faceHi: s.faceHi, lo: s.lo, hi: s.hi,
  thick: s.thick, drawn: s.drawn, pieces: s.pieces ?? 1,
}));
const segments = [...segOut(segs.vertical, true), ...segOut(segs.horizontal, false)];

const round = (poly, d = 2) => poly.map((p) => [
  Math.round(p.x * 10 ** d) / 10 ** d, Math.round(p.y * 10 ** d) / 10 ** d,
]);

// ---------- stage 6: the real trace ----------
const result = traceBoundary(analysis, {});
const floor = result.floors[0];
const alternatives = result.debug.alternatives[0] ?? [];

// Every candidate the search scored, not just the three runners-up the debug
// channel keeps — the page compares the whole field, so it has to see it.
const scoredAll = (() => {
  const generated = generateCandidates(net, analysis, {});
  if (generated.rescue.hasStructural) generated.rescue.structural();
  const ev = createEvidence(analysis, net.mask, net.ribbon);
  const ctx = {
    analysis,
    evidence: ev,
    epsilon: Math.max(2, wallThickness * 0.35),
    fitOptions: { mergeTol: Math.max(2, Math.round(wallThickness * 0.5)) },
    wallBboxArea: generated.wallBboxArea,
    wallBbox: net.bbox,
    maxRadius: generated.maxRadius,
    coverage: generated.coverage,
    constraints: null,
    brush: null,
    scale: analysis.scaleX,
  };
  return generated.candidates.map((c) => {
    const s = scoreCandidate(c, ctx);
    if (!s) return null;
    const radiusCost = Math.min(1, s.radius / Math.max(2, generated.maxRadius));
    return {
      variant: s.variant,
      policy: s.policy,
      radius: s.radius,
      seal: s.seal.seal,
      cover: s.seal.cover,
      solidity: s.seal.solidity,
      support: s.support.mean,
      longestGap: s.support.longestGap,
      coverage: s.coverage,
      completeness: s.completeness,
      annex: s.annex,
      economy: 1 - Math.min(1, 0.6 * radiusCost),
      score: s.score,
      areaPx: s.areaPx,
      verts: s.shape.polygon.length,
      polygon: round(s.shape.polygon),
      footprint: maskPng(c.entry.mask, width, height),
    };
  }).filter(Boolean).sort((a, b) => b.score - a.score);
})();

// ---------- stage 7: contour -> RDP -> rectilinear fit ----------
const epsilon = Math.max(2, wallThickness * 0.35);
const winner = (() => {
  const r = floor.candidate.radius;
  const mask = floor.candidate.policy === 'raw'
    ? (floor.candidate.variant === 'structural' ? structuralMask : net.mask)
    : (floor.candidate.variant === 'structural' ? weldedStructural : weldedAll);
  const fp = measureFootprint(mask, width, height, r);
  return footprintEntry(fp, fp.largest, width, height);
})();
const rawRing = traceFramedBoundary(winner, width, height);
const simplified = simplifyRing(rawRing, epsilon);
const fitted = fitRing(simplified, { angleTolDeg: 14, mergeTol: Math.max(2, Math.round(wallThickness * 0.5)) });

// Per-edge inset, replicating footprint.js `measureEdgeInsets`: march inward
// from each edge and take the median depth of the wall band behind THAT edge.
// This is the number the interior envelope is built from, so it is measured
// the same way rather than read back off the two polygons.
const measureBandDepth = (x0, y0, dir, mask, gapTol, maxDepth) => {
  let lastWall = -1; let freeRun = 0; let sawWall = false;
  for (let step = 0; step <= maxDepth; step += 1) {
    const x = Math.round(x0 + dir[0] * step);
    const y = Math.round(y0 + dir[1] * step);
    if (x < 0 || y < 0 || x >= width || y >= height) break;
    if (mask[y * width + x]) { lastWall = step; freeRun = 0; sawWall = true; } else {
      freeRun += 1;
      if (sawWall && freeRun > gapTol) break;
      if (!sawWall && step > 3) break;
    }
  }
  return sawWall && lastWall >= 0 ? lastWall + 1 : -1;
};
const perEdgeInset = (() => {
  const outer = floor.outerPolygon;
  const sign = polygonSignedArea(outer) >= 0 ? 1 : -1;
  const gapTol = Math.max(4, wallThickness * 2);
  const maxDepth = Math.max(12, wallThickness * 6) + gapTol;
  return outer.map((a, i) => {
    const b = outer[(i + 1) % outer.length];
    const dx = b.x - a.x; const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len < 2) return { inset: floor.exteriorThickness, samples: 0, len };
    const nx = (sign * -dy) / len; const ny = (sign * dx) / len;
    const samples = [];
    const n = Math.max(3, Math.min(48, Math.round(len / 6)));
    const margin = Math.min(0.25, Math.max(2, wallThickness) / Math.max(1, len));
    for (let s = 0; s < n; s += 1) {
      const t = margin + ((s + 0.5) / n) * (1 - 2 * margin);
      const d = measureBandDepth(a.x + dx * t, a.y + dy * t, [nx, ny], wallMask, gapTol, maxDepth);
      if (d > 0) samples.push(d);
    }
    if (samples.length < 3) return { inset: floor.exteriorThickness, samples: samples.length, len };
    samples.sort((p, q) => p - q);
    return { inset: samples[(samples.length / 2) | 0], samples: samples.length, len: Math.round(len) };
  });
})();

// Ablation: trace the same plan from `wallMask` instead of `boundaryMask` —
// i.e. with the screened-glazing rescue switched off. The window bands are
// lighter than the ink threshold, so without the rescue an exterior wall has a
// hole in it the width of the window.
const ablation = (() => {
  const r = traceBoundary({ ...analysis, boundaryMask: wallMask }, { mask: wallMask });
  if (!r?.floors?.length) return { failed: true };
  const f = r.floors[0];
  return {
    confidence: r.confidence,
    warnings: r.warnings.map((w) => ({ code: w.code, severity: w.severity, message: w.message })),
    outerPolygon: f.outerPolygon.map((p) => [p.x, p.y]),
    polygonArea: polygonArea(f.outerPolygon),
    candidate: f.candidate,
    footprintMask: maskPng(f.footprintMask, width, height),
    bbox: f.footprintBbox,
  };
})();

// What the speck filter actually removed, so the page can say it rather than
// assume it: every dropped component's size and box.
const speckDetail = (() => {
  const { components } = labelComponents(ink, width, height);
  const speckMax = Math.max(14, Math.round(Math.max(width, height) * 0.03));
  const dropped = components.filter((c) => Math.max(
    c.bbox.maxX - c.bbox.minX + 1, c.bbox.maxY - c.bbox.minY + 1,
  ) < speckMax);
  return {
    speckMax,
    total: components.length,
    dropped: dropped.length,
    droppedPx: dropped.reduce((s, c) => s + c.size, 0),
    largestKept: components.filter((c) => !dropped.includes(c))
      .sort((a, b) => b.size - a.size).slice(0, 3).map((c) => c.size),
  };
})();

// ---------- evidence sampled along the winning contour ----------
const evidence = createEvidence(analysis, net.mask);
const tol = Math.max(2, Math.round(Math.max(2, wallThickness) * 0.9));
const support = contourSupport(floor.outerPolygon, evidence, tol);
const supportSamples = (() => {
  const out = [];
  const poly = floor.outerPolygon;
  for (let i = 0; i < poly.length; i += 1) {
    const a = poly[i]; const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(len / 4));
    for (let s = 0; s < n; s += 1) {
      const t = (s + 0.5) / n;
      const x = Math.round(a.x + (b.x - a.x) * t);
      const y = Math.round(a.y + (b.y - a.y) * t);
      out.push([x, y, evidence.levelAt(x, y, tol)]);
    }
  }
  return out;
})();

const out = {
  source: {
    file, width: ow, height: oh,
    image: b64(fs.readFileSync(file)),
  },
  working: { width, height, scaleX: analysis.scaleX, scaleY: analysis.scaleY },
  otsu: {
    threshold: scaled.threshold,
    histogram: Array.from(hist),
    betweenVariance: Array.from(betweenVar).map((v) => Math.round(v * 1e6) / 1e6),
    gray: grayPng(gray, width, height),
  },
  masks: {
    ink: maskPng(ink, width, height),
    cleaned: maskPng(cleaned, width, height),
    specks: maskPng(specks, width, height),
    curves: maskPng(curves, width, height),
    wall: maskPng(wallMask, width, height),
    thick: maskPng(thickMask, width, height),
    rescued: maskPng(rescued, width, height),
    glazing: maskPng(glazing, width, height),
    boundary: maskPng(boundaryMask, width, height),
    structural: maskPng(structuralMask, width, height),
    welded: maskPng(weldedAll, width, height),
    weldedAdded: maskPng(andNot(weldedAll, net.mask), width, height),
  },
  counts: {
    ink: count(ink), cleaned: count(cleaned), specks: count(specks),
    curves: count(curves), wall: count(wallMask), thick: count(thickMask),
    rescued: count(rescued), glazing: count(glazing), boundary: count(boundaryMask),
    structural: count(structuralMask), welded: count(weldedAll),
  },
  wallThickness,
  band,
  thicknessHistogram: thicknessHist,
  networks: nets.map((n) => ({ bbox: n.bbox, wallSize: n.wallSize })),
  ladderParams: { radii, maxRadius, maxGap, minFlank, probeDepth, thickRadius, epsilon },
  ladders,
  segments,
  candidates: alternatives,
  scoredAll,
  trace: {
    confidence: result.confidence,
    warnings: result.warnings,
    floors: result.floors.length,
    outerPolygon: round(floor.outerPolygon),
    innerPolygon: floor.innerPolygon ? round(floor.innerPolygon) : null,
    holes: (floor.holes ?? []).map((h) => round(h)),
    candidate: floor.candidate,
    exteriorThickness: floor.exteriorThickness,
    filamentShaved: floor.filamentShaved,
    footprintArea: floor.footprintArea,
    footprintBbox: floor.footprintBbox,
    polygonArea: polygonArea(floor.outerPolygon),
    innerArea: floor.innerPolygon ? polygonArea(floor.innerPolygon) : null,
    plausibility: floor.plausibility,
    perEdgeInset,
    support: { mean: support.mean, longestGap: support.longestGap, total: support.total },
    supportSamples,
  },
  polygonStages: {
    rawRing: rawRing.map((p) => [p.x, p.y]),
    simplified: round(simplified),
    fitted: round(fitted.polygon),
    skewDeg: fitted.skewDeg,
    deskewed: fitted.deskewed,
    winnerFootprint: maskPng(winner.mask, width, height),
    shavedFootprint: maskPng(floor.footprintMask, width, height),
    shaveRadius: Math.max(2, Math.round(floor.exteriorThickness * 0.75)),
  },
  ablation,
  speckDetail,
};

fs.writeFileSync(outPath, JSON.stringify(out));
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`wrote ${outPath} (${kb(fs.statSync(outPath).size)})`);
console.log(`working ${width}x${height} wallThickness=${wallThickness} epsilon=${epsilon.toFixed(2)}`);
console.log(`otsu=${scaled.threshold} networks=${nets.length} radii=${radii.join(',')}`);
console.log(`confidence=${result.confidence.toFixed(3)} verts=${floor.outerPolygon.length} ring=${rawRing.length} rdp=${simplified.length} fit=${fitted.polygon.length}`);
console.log(`counts: ${JSON.stringify(out.counts)}`);
console.log(`ladders: ${ladders.map((l) => `${l.name} ${l.rungs.map((r) => `r${r.radius}=${r.area}/${r.seal.toFixed(2)}`).join(' ')}`).join('\n         ')}`);
