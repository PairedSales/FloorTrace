<!--
Maintainers: this file loads into every session, so keep it short (under ~150 lines).
Subsystem invariants go in .claude/rules/<area>.md (they load when matching files are
opened); a repeatable procedure goes in .claude/skills/; the long "why" belongs in the
header comment of the file it explains. HTML comments like this one are stripped
before the file reaches Claude.
-->

# FloorTrace

A single-page React 19 + Vite app for real-estate appraisers. The user uploads a floorplan sketch; the app reads its dimension labels (OCR), sets the scale from them, traces the exterior walls (classical computer vision) and reports gross living area (GLA). Everything runs in the browser — no server, no data collection. Every push to `master` deploys to GitHub Pages at `pairedsales.github.io/FloorTrace`.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server; the app is under the base path, `http://localhost:5173/FloorTrace/` |
| `npm run build`, `npm run preview` | Production build, and serve it |
| `npm run check:bundle` | After a build: the entry may preload only the `interop` and `react` chunks |
| `npm run lint` | ESLint |
| `npm test` / `npx vitest run <file>` | Vitest, all suites / one file |
| `npm run bench:detection` | Boundary and room accuracy on `fixtures/` (CI gate) |
| `npm run bench:scale` | Project-scale selection on `fixtures/` (CI gate) |
| `npm run bench:ocr` | OCR accuracy and timing (Node, Tesseract only) |
| `npm run bench:cubicasa` | The accuracy scoreboard: tracer and scale on CubiCasa5K (local only; see `datasets/README.md`) |
| `npm run bench:real` | The same scoreboard on real US plans saved as `.floorplan` files: 75 plan-book pages whose keys Claude drew and no person has checked, so a regression guard for tracer changes, not a target (local only; `--only`, `--jobs`, `--draw`, `--compare`; see `datasets/README.md`) |
| `node scripts/realKeyTool.mjs`, `realSource.mjs`, `realDrafts.mjs` | Draw, check and score answer keys; find and draft plans from archive.org (local only; `datasets/README.md`) |
| `npm run probe:exterior [draw]` | Synthetic exterior-tracer scenarios with exact truth |
| `npm run probe:memory` | What the detection memo retains per image |
| `npm run icons`, `npm run tutorial` | Regenerate committed outputs in `public/` |

## Workflow

- **Fresh worktrees have no `node_modules`.** Run `npm ci` first, and again after merging `master`. Until you do, Node and Vite resolve the main checkout's packages, which may be stale. The symptoms are easy to misread: test suites that fail to load (compare the test-file count) and Vite 403s on the `@fontsource` fonts.
- **Before pushing, run what CI runs** (`.github/workflows/deploy.yml`): lint → test → `bench:detection` → `bench:scale` → build → `check:bundle`. `bench:scale` is the one that gets forgotten.
- **Detection, OCR and scale changes need benchmark runs before and after**, compared in full. The protocol is in `.claude/rules/detection.md` and `.claude/rules/ocr.md`.
- **`master` only takes pull requests.** A repository ruleset requires the `build` check (the branch-protection API answers 404, which does not mean unprotected). Push the branch, `gh pr create`, and merge with **`gh pr merge <N> --merge`** — merge commits, never squash or rebase; that was decided explicitly. While checks are still running, add `--auto` so GitHub merges when `build` passes (auto-merge is enabled on the repo). Don't merge into a local `master`. When `master` moves, merge `origin/master` into the branch and push; `gh run rerun` re-tests the old SHAs.
- **There is no browser end-to-end harness.** Say in the PR what you checked by hand. To launch and drive the app in the Browser pane, use the `run-floortrace` skill: the pane runs with `document.hidden` set, so rAF, `ResizeObserver`, media-query events and CSS transitions stall, and layout readings there can be wrong.

## Architecture

- `src/App.jsx` — orchestrator: wires the store to the shells and owns cross-cutting workflow (mode transitions, calibration, notifications). Reusable interaction logic lives in `src/hooks/`.
- `src/store/` — one Zustand store for the plan's working state (`appStore.js`) plus `workspaceStore.js` for workspace-wide UI state and preferences; undo (`undoManager.js`), outlines (`traceManager.js`), open plans (`documentManager.js`) and ownership of async results (`documentRequests.js`).
- `src/components/` — two shells over one workflow: desktop (`AppHeader` with its `PlanTabs`, `ResultsPanel`, the `ActionBar` status line, `ViewControls`) and `mobile/`; the shared `Menu`, `Dialog` and `PanelSection`; the lazily loaded Konva canvas in `canvas/`.
- `src/utils/detection/` — wall and boundary detection. Pure-JS cores run in `src/workers/detectionWorker.js` and, unchanged, in the Node benchmarks.
- `src/utils/dimensions/` — dimension OCR (Tesseract, optional PaddleOCR), fronted by `DimensionsOCR.js` and the lazy `ocrLazy.js`.
- `src/utils/exhibit/` — the exhibit PNG, the primary export. `.floorplan` (`projectSerializer.js`) is the editable project file.
- `scripts/` — benchmarks, probes and generators. `fixtures/` — sample plans with `.truth.json` sidecars.

There are no manual drawing or editing tools: the outline is read-only, and the one manual input is the scale (pick a different room, or *Set scale using known length*). See `.claude/rules/ui-shell.md` before adding one back.

The flow: load an image → OCR reads the labels → every labelled room is measured and the rooms vote on one project scale → the exterior is traced with those rooms and labels as constraints → area, with the detector's confidence and warnings.

Rules for each subsystem load automatically when you open its files: `.claude/rules/detection.md`, `ocr.md`, `state-and-plans.md`, `ui-shell.md`, `export-and-area.md`, `build.md`.

## Terminology

- A **plan** is one image and everything measured from it (one tab). An **outline** is one polygon within a plan. Never use "floor" for the plan level. The `.floorplan` format's `floors[]` is plan-shaped and always holds one entry — a version seam; leave it.
- **GLA** excludes non-GLA space (garage, porch, patio, balcony) and below-grade levels.

## Rules that apply everywhere

- **This codebase's characteristic failure is a wrong answer that looks right.** The cases that fit that description are the ones no picture shows — a doubtful scale, an area counted twice, a cut-out no longer subtracted, a plan with no scale — and those are always said, in the panel section they are about and on the saved image (`traceIssues.js`). The outline is the opposite case: it is drawn on the plan and the user checks it by eye, so the UI says nothing about how well it follows the walls (the owner's decision, October 2026 — a list of the detector's doubts beside the picture was redundant). Detection results still carry `confidence` and `warnings[]`; they drive remediation, the runner-up outlines and the benchmarks, and are saved with the plan. Don't strip them, and don't put them back on screen without being asked.
- **Area goes as scale squared.** The scale is the most consequential number the app produces: never apply one from evidence the user has moved on from, and never let anything quietly degrade its inputs (CPU contention during an OCR scan silently costs detections).
- **Never key identity on `hashDataUrl`.** It folds an 8 KB prefix and the length into 32 bits, and two images can collide. Use the data URL itself or `internKey` (`utils/hash.js`).
- **Derive, don't copy.** State projections derive from `WORKING_STATE_DEFAULTS`; each user-facing verdict or figure has one source (`boundaryQuality.js`, `traceIssues.js`, `scaleProvenance.js`, `displayedBreakdownTotal`). A second copy is where drift starts.
- **Settled questions stay settled without new measurements:** OpenCV stays in the OCR pipeline, and the ideas recorded as benchmarked shut in `docs/ocr-performance.md` and `docs/load-to-area-performance.md` stay shut.

## Conventions

- Comments carry a short "why"; match the density of `detection/pipeline.js` and `store/appStore.js`. Longer rationale goes in the file's header comment.
- ESLint: unused variables are errors unless they match `^[A-Z_]`; `%TypedArray%.from(x, fn)` is banned in favour of a preallocated loop (it is ~20× slower).
- Tests sit in `__tests__/` beside the code. The default environment is node — the CV suites don't need a DOM. Component and hook tests opt into happy-dom per file with a `// @vitest-environment happy-dom` docblock. Detection suites run whole fixture plans; keep each test file well under 60 s (vitest's worker RPC timeout).
- Put new cross-cutting interaction logic in a hook, not in `App.jsx`.

## Docs

- `docs/architecture.md` — pipeline overview and quality model.
- `docs/accuracy-roadmap.md` — the accuracy scoreboard and its targets, what stands in the way, and a log of every change that moved it.
- `docs/remediation-plan.md` — open findings. `docs/tools-and-options-backlog.md` — ideas not yet built, and the manual tools removed in October 2026.
- `docs/ocr-performance.md`, `docs/load-to-area-performance.md` — dated measurement records. `docs/CODE_REVIEW.md` — historical review from July 2026.
- `Reference Data for Wall Detection System/` — papers behind the detector. `datasets/README.md` — getting CubiCasa5K.
