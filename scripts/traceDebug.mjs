// Inspect the candidate search for one image: networks, candidates, scores,
// what was picked and why, plus the non-GLA arbitration outcome.
import fs from 'fs';
import { PNG } from 'pngjs';
import { analyzeFloorplan } from '../src/utils/detection/analyze.js';
import { traceBoundary, partitionWallNetworks } from '../src/utils/detection/boundary.js';
import { polygonArea } from '../src/utils/detection/polygon.js';

const file = process.argv[2];
const truthPath = file.replace(/\.png$/i, '.truth.json');
const truth = fs.existsSync(truthPath) ? JSON.parse(fs.readFileSync(truthPath, 'utf8')) : null;
const png = PNG.sync.read(fs.readFileSync(file));
const imageData = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };

const analysis = analyzeFloorplan(imageData, { maxDimension: 1400 });
console.log(`working ${analysis.width}x${analysis.height} scale=${analysis.scaleX.toFixed(3)} wallThickness=${analysis.wallThickness}`);

const nets = partitionWallNetworks(
  analysis.boundaryMask, analysis.width, analysis.height, analysis.wallThickness, 7,
);
console.log(`networks: ${nets.length}`);
for (const net of nets) {
  console.log(`  bbox=[${net.bbox.minX},${net.bbox.minY},${net.bbox.maxX},${net.bbox.maxY}] ink=${net.wallSize}`);
}

const excludeRegions = (truth?.boundary?.excludeRegions ?? []).map(([x, y, w, h]) => ({
  x: x * analysis.scaleX,
  y: y * analysis.scaleY,
  width: w * analysis.scaleX,
  height: h * analysis.scaleY,
}));

const result = traceBoundary(analysis, { excludeRegions });
if (!result) {
  console.log('no boundary');
  process.exit(0);
}
console.log(`\nfloors=${result.floors.length} confidence=${result.confidence.toFixed(2)} usedFallback=${result.usedFallback}`);
console.log(`warnings: ${result.warnings.map((w) => `${w.code}${w.detail ? `(${JSON.stringify(w.detail)})` : ''}`).join(', ') || 'none'}`);
result.floors.forEach((f, i) => {
  const bb = f.footprintBbox;
  const orig = (v, s) => Math.round(v / s);
  console.log(
    `  floor ${i}: bboxWork=[${bb.minX},${bb.minY},${bb.maxX},${bb.maxY}] `
    + `orig=[${orig(bb.minX, analysis.scaleX)},${orig(bb.minY, analysis.scaleY)},${orig(bb.maxX, analysis.scaleX)},${orig(bb.maxY, analysis.scaleY)}] `
    + `areaPx=${Math.round(polygonArea(f.outerPolygon))} verts=${f.outerPolygon.length} `
    + `conf=${f.confidence.toFixed(2)} cand=${JSON.stringify(f.candidate)} `
    + `excluded=${f.excluded}(${f.excludedRegions.map((r) => `${r.sources.join('+')}${r.keyword ? `:${r.keyword}` : ''}`).join(',')}) `
    + `rejected=${f.rejectedRegions.length} holes=${f.holes.length} shave=${f.filamentShaved} `
    + `ext=${f.exteriorThickness} plaus=${JSON.stringify(f.plausibility)}`,
  );
});
console.log('\nalternatives per network:');
result.debug.alternatives.forEach((alts, i) => {
  console.log(`  net ${i}: ${alts.map((a) => `${a.variant}/${a.policy}@r${a.radius} score=${a.score} seal=${a.seal} sup=${a.support} cov=${a.coverage} area=${a.areaPx}`).join(' | ') || '(none)'}`);
});
console.log('\nseal searches:');
result.debug.sealSearches.forEach((s, i) => {
  console.log(`  net ${i}:`);
  for (const entry of s) {
    console.log(`    ${entry.variant}/${entry.policy}: ${entry.tried.map((t) => `r${t.radius}=${t.area}`).join(' ')}`);
  }
});
