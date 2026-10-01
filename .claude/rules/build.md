---
paths:
  - "vite.config.js"
  - "index.html"
  - "package.json"
  - "src/main.jsx"
  - "src/App.jsx"
  - "src/components/Canvas.jsx"
  - "src/components/CanvasStage.jsx"
  - "src/components/markGeometry.js"
  - "src/components/FloorTraceMark.jsx"
  - "src/utils/ocrLazy.js"
  - "src/utils/tracingTutorial.js"
  - "scripts/checkBundle.mjs"
  - "scripts/generateIcons.mjs"
  - "scripts/buildTutorial.mjs"
  - "scripts/tutorialStages.mjs"
  - "docs/tracing-tutorial.src.html"
  - "public/**"
  - ".github/workflows/**"
---

# Build, bundle and generated assets

## Code splitting

- Splitting is not lazying. `manualChunks` in `vite.config.js` only decides which file deferred code lands in; the deferral itself comes from dynamic imports: `Canvas.jsx` lazy-loads `CanvasStage.jsx` (all of konva), `ocrLazy.js` fronts the OCR graph, and `loadOpenCv` imports OpenCV.
- `dist/index.html` must modulepreload exactly `interop` and `react`. `npm run build && npm run check:bundle` enforces this, and CI runs it. When it fails, find the static import that pulled a chunk into the entry graph — don't widen the check.
- `react` and rollup's `commonjsHelpers` (`interop`) are pinned to their own chunks: left unassigned, rollup folds them into konva and the entry then imports konva statically. The tesseract rule skips `?url` ids — a URL belongs in whichever chunk asks for it.
- `base` is `/FloorTrace/` (GitHub Pages). The dev server honours `PORT`.

## Generated files: edit the source, never the output

- Icons in `public/` (favicons, `favicon.ico`, `icon.svg`, touch icons) come from `npm run icons`, which rasterises `src/components/markGeometry.js` — the same geometry `FloorTraceMark` draws. They are the mark on transparency: `icon.svg` switches colour with `prefers-color-scheme`, the rasters use one tone between the two themes' `--fg-3`. Don't move the rasters onto either theme's `--fg`; a near-white glyph disappears in a light tab bar.
- `public/tracing-tutorial.html` comes from `npm run tutorial`: a real pipeline run over `fixtures/ExampleFloorplan8.png` inlined into `docs/tracing-tutorial.src.html`. Edit the template. A detection change that makes the page's quoted numbers wrong shows up as a diff here — that is intended.
- `public/example-plan.png` (the start screen's sample plan) is byte-identical to `fixtures/ExampleFloorplan8.png`.
- Committed binaries — `public/models/`, `public/tesseract/`, the 516 kB tutorial — add a full copy to git history each time they are regenerated. Replace rather than accumulate, and don't regenerate them for unrelated changes.

## CI (`.github/workflows/deploy.yml`)

- One workflow serves as the PR check and the deploy: `npm ci` → lint → test → `bench:detection` → `bench:scale` → build → `check:bundle`, then a GitHub Pages deploy on pushes to `master` only. PR runs have per-ref concurrency with cancel-in-progress; deploys serialise on `pages`.
- CI runs Node 22. Check a new devDependency's `engines` against it — that class of failure appears only in CI (it is why component and hook tests use happy-dom, not jsdom).
