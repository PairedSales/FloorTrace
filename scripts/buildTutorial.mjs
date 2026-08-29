// Inline a stage dump into docs/tracing-tutorial.src.html and emit the page.
//
// The output lands in public/ because the app links to it — View > "How the
// outline is traced" opens `${BASE_URL}tracing-tutorial.html`, so Vite has to
// copy it into dist/. Like the icons, it is build output rather than a source
// file: edit the template, run `npm run tutorial`, never the .html.
//
// A second, body-only form is written when a path is given for it, for hosts
// that supply their own <head>/<body> skeleton.
//
//   npm run tutorial
import fs from 'fs';

const dataPath = process.argv[2] ?? 'tutorial-stages.json';
const artifactOut = process.argv[3] ?? null;

const tplPath = new URL('../docs/tracing-tutorial.src.html', import.meta.url);
const outPath = new URL('../public/tracing-tutorial.html', import.meta.url);

const tpl = fs.readFileSync(tplPath, 'utf8');
// The payload sits in a <script type="application/json">, so the one sequence
// that could end it early has to be escaped. There is none today; a future
// dump carrying a warning message with markup in it would have one.
const json = fs.readFileSync(dataPath, 'utf8').replace(/<\/script/gi, '<\\/script');
const bodyOnly = tpl.replace('__STAGES__', () => json);

const HEAD_OPEN = '\n<div class="shell">';
const split = bodyOnly.indexOf(HEAD_OPEN);
if (split < 0) throw new Error('template no longer starts its body with <div class="shell">');

const standalone = [
  '<!doctype html>',
  '<html lang="en">',
  '<head>',
  '<meta charset="utf-8">',
  '<meta name="viewport" content="width=device-width, initial-scale=1">',
  bodyOnly.slice(0, split),
  '</head>',
  '<body>',
  bodyOnly.slice(split + 1),
  '</body>',
  '</html>',
  '',
].join('\n');

fs.writeFileSync(outPath, standalone);
if (artifactOut) fs.writeFileSync(artifactOut, bodyOnly);

const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
console.log(`public/tracing-tutorial.html  ${kb(Buffer.byteLength(standalone))}`);
if (artifactOut) console.log(`${artifactOut}  ${kb(Buffer.byteLength(bodyOnly))}`);
