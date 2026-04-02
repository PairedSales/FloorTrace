import { it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { detectRoomFromClickCore, traceFloorplanBoundaryCore } from '../pipeline.js';

const ROOT = path.resolve(import.meta.dirname, '..', '..', '..', '..');
const data = fs.readFileSync(path.join(ROOT, 'ExampleFloorplan.png'));
const png = PNG.sync.read(data);
const imageData = { width: png.width, height: png.height, data: new Uint8ClampedArray(png.data) };

const polygonArea = (polygon) => {
  let sum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], n = polygon[(i+1)%polygon.length];
    sum += c.x * n.y - n.x * c.y;
  }
  return Math.abs(sum)/2;
};

it('diagnose pipeline output', () => {
  console.log('=== Exterior wall tracing ===');
  const traced = traceFloorplanBoundaryCore(imageData);
  console.log('Has outer:', !!traced?.outer);
  console.log('Has inner:', !!traced?.inner);
  console.log('Debug:', JSON.stringify(traced?.debug));
  if (traced?.outer) {
    const p = traced.outer.polygon;
    console.log('Outer vertices:', p.length);
    console.log('Outer overlay:', JSON.stringify(traced.outer.overlay));
    console.log('Outer area:', polygonArea(p));
    console.log('First 6 vertices:', JSON.stringify(p.slice(0,6)));
  }
  if (traced?.inner) {
    const ip = traced.inner.polygon;
    console.log('Inner vertices:', ip.length);
    console.log('Inner overlay:', JSON.stringify(traced.inner.overlay));
    console.log('Inner area:', polygonArea(ip));
  }

  console.log('\n=== Room (342,440) ===');
  const room1 = detectRoomFromClickCore(imageData, { x: 342, y: 440 });
  if (room1) {
    console.log('Overlay:', JSON.stringify(room1.overlay));
    console.log('Vertices:', room1.polygon.length, 'Area:', polygonArea(room1.polygon));
    console.log('Confidence:', room1.confidence);
    console.log('Debug:', JSON.stringify(room1.debug));
  } else console.log('null');

  console.log('\n=== Room (861,373) ===');
  const room2 = detectRoomFromClickCore(imageData, { x: 861, y: 373 });
  if (room2) {
    console.log('Overlay:', JSON.stringify(room2.overlay));
    console.log('Area:', polygonArea(room2.polygon));
  } else console.log('null');

  console.log('\n=== Room (1268,627) ===');
  const room3 = detectRoomFromClickCore(imageData, { x: 1268, y: 627 });
  if (room3) {
    console.log('Overlay:', JSON.stringify(room3.overlay));
    console.log('Area:', polygonArea(room3.polygon));
    console.log('Component size:', room3.debug?.componentSize);
  } else console.log('null');

  expect(true).toBe(true);
}, 30000);
