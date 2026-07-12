// Render traced boundary polygons over the floorplan for visual inspection.
import fs from 'fs';
import { PNG } from 'pngjs';
import { traceFloorplanBoundaryCore } from '../src/utils/detection/pipeline.js';
import { polygonArea } from '../src/utils/detection/polygon.js';

const file = process.argv[2];
const out = process.argv[3];
const png = PNG.sync.read(fs.readFileSync(file));
const imageData = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };

const opts = {};
if (process.argv[4]) {
  // optional excludeRegions json: [[x,y,w,h],...]
  opts.excludeRegions = JSON.parse(fs.readFileSync(process.argv[4], 'utf8')).map(
    ([x, y, w, h]) => ({ x, y, width: w, height: h })
  );
}
const result = traceFloorplanBoundaryCore(imageData, opts);
if (!result) { console.log('FAILED: no boundary'); process.exit(1); }

console.log(`floors: ${(result.floors ?? []).length}  excluded=${result.excludedRegions} garages=${result.excludedGarages}`);
console.log(`debug: sealRadius=${result.debug?.sealRadius} wallThickness=${result.debug?.wallThickness} ext=${result.debug?.exteriorThickness}`);

const drawPoly = (poly, r, g, b) => {
  const pts = poly.map((p) => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  for (let i = 0; i < pts.length; i += 1) {
    const a = pts[i]; const bb = pts[(i + 1) % pts.length];
    const steps = Math.max(1, Math.ceil(Math.hypot(bb.x - a.x, bb.y - a.y)));
    for (let s = 0; s <= steps; s += 1) {
      const x = Math.round(a.x + ((bb.x - a.x) * s) / steps);
      const y = Math.round(a.y + ((bb.y - a.y) * s) / steps);
      for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
        const xx = x + dx; const yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= png.width || yy >= png.height) continue;
        const idx = (yy * png.width + xx) * 4;
        png.data[idx] = r; png.data[idx + 1] = g; png.data[idx + 2] = b; png.data[idx + 3] = 255;
      }
    }
  }
};

const floors = result.floors ?? [{ outer: result.outer, inner: result.inner }];
floors.forEach((f, i) => {
  if (f.outer) {
    drawPoly(f.outer.polygon, 255, 0, 0);
    const o = f.outer.overlay;
    console.log(`floor ${i} outer: bbox=[${o.x1},${o.y1},${o.x2},${o.y2}] areaPx=${polygonArea(f.outer.polygon).toFixed(0)} verts=${f.outer.polygon.length}`);
  }
  if (f.inner) drawPoly(f.inner.polygon, 0, 0, 255);
});

fs.writeFileSync(out, PNG.sync.write(png));
console.log(`wrote ${out}`);
