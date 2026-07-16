# FloorTrace — Engineering Review

**Date:** 2026-07-16
**Scope:** Full repository (all `src/`, `scripts/`, configs, CI, docs). Findings verified by running the test suite (220/220 pass), ESLint (22 errors, 7 warnings at HEAD), a production build, and targeted runtime experiments (Zod v4 error API, Zustand hook-call-outside-render).

---

# Executive Summary

## Overall Assessment

FloorTrace is an unusually well-engineered hobby/product codebase in its core competency: the two computer-vision pipelines (dimension OCR in `src/utils/dimensions/`, wall/boundary detection in `src/utils/detection/`) are cleanly layered, environment-agnostic (identical code runs in the browser worker and Node benchmark harnesses), thoroughly commented at the "why" level, and backed by ground-truth benchmark fixtures and 220 passing tests. This is the hard 70% of the app and it is in very good shape.

The weaker 30% is the React shell around those pipelines. Several real, user-visible bugs live there — the crop tool crashes on commit due to a hook called inside an event handler, a failed clipboard paste destroys the current project and its undo history, and global keyboard shortcuts hijack Ctrl+V/Ctrl+Z inside text inputs. `npm run lint` is red at HEAD (22 errors — one of which is precisely the crop bug), and CI deploys to production GitHub Pages without running tests or lint, from three branches including `work`. Startup cost is dominated by a ~15.5 MB (3.9 MB gzip) OpenCV.js chunk fetched at app mount to provide only CLAHE + median blur — both of which already have pure-JS fallbacks.

None of the problems require rewrites. The highest-value work is: fix the four verified bugs (a few hours total), gate CI on lint + tests (30 minutes), and defer or drop OpenCV.js (an hour). That converts an already-strong codebase into a robust one.

## Scores

| Dimension | Score | Rationale |
|---|---|---|
| Architecture | **8 / 10** | Excellent pipeline layering, worker isolation, env-adapter pattern; dragged down by `App.jsx` prop-drilling and duplicated undo responsibilities |
| Maintainability | **7 / 10** | Superb "why" comments and docs in the pipelines; dead code, red lint, and 3 copies of the raster core detract |
| Reliability | **5 / 10** | Crop tool is broken at HEAD; data-loss path on paste; several undo-stack correctness gaps; races leave the spinner stuck |
| Performance | **6 / 10** | Runtime pixel work is exemplary (SATs, run-length morphology, interned undo images); startup ships 3.9 MB gzip of OpenCV for marginal benefit; dead 12 MB of Paddle models deployed |
| Security | **8 / 10** | Client-only, no secrets, schema-validated project import, sanitized numerics; runtime CDN dependency and repo hygiene are the only notes |
| Developer Experience | **7 / 10** | Benchmark harnesses with ground truth are outstanding; CLAUDE.md/docs are excellent; but lint is red, CI has no quality gate, and no type checking |

## Strengths

- **Environment-agnostic pipeline cores.** `detectDimensionsCore` and `traceFloorplanBoundaryCore` take plain `{width,height,data}` + an `env` adapter, so the exact production code runs under Node in `scripts/ocrBenchmark.mjs` / `scripts/detectionBenchmark.mjs` against `*.truth.json` ground truth. This is the single best engineering decision in the repo — CV regressions are measurable before merge.
- **Comment discipline.** Nearly every non-obvious threshold in `boundary.js`, `room.js`, `parse.js`, and `raster.js` carries a one-line *why* ("a greedy 'first radius that looks sealed' accepts partial footprints…"). This is rare and valuable for tuning-heavy CV code.
- **Memory-conscious undo.** `undoManager.js` interns image data URLs in a hash-keyed pool so 50 snapshots of an unchanged 2 MB image cost one copy; `SNAPSHOT_FIELDS`/`AUTOSAVE_FIELDS` derive from one `WORKING_STATE_DEFAULTS` so reset/undo/autosave can't drift.
- **Graceful degradation.** OpenCV, PaddleOCR, and IndexedDB all degrade to working fallbacks (JS CLAHE, Tesseract-only, localStorage).
- **Robust project-file handling.** Zod schema validation, version gating, NaN/Infinity sanitization, image de-duplication by hash.
- **Performance-literate hot paths.** Summed-area tables for wall-coverage queries, run-based 1D morphology instead of naive kernels, OR-pool downscaling that preserves 1-px lines, hand-rolled stored-deflate PNG encoding to dodge a ~1 s/canvas `toBlob` tax, RAF-throttled Konva drag updates that bypass React at 60 fps.

## Weaknesses

- The React shell has **verified broken features at HEAD** (crop tool) and a **data-loss path** (paste failure), both of which lint or a store-level test would have caught.
- **No CI quality gate**: deploy-to-production runs on push (including the `work` branch) with no lint or test step; `npm run lint` currently fails with 22 errors.
- **Undo correctness is diffuse**: `undoManager.save()` call sites are scattered across App, hooks, and the floor slice, producing double-saves, no-op snapshots (angle tool), and a dangling `activeTraceId` after undoing "Add Floor".
- **Startup weight**: ~3.9 MB gzip OpenCV fetched at mount for two optional filters; 12 MB of PaddleOCR models committed and deployed while the rescue pass they serve is unreachable in production.
- **Duplication**: three Otsu implementations (one explicitly "mirrors" another), two `hasSelfIntersection`-guarded vertex-add paths (one dead), dead files/props/deps.

## Top 10 Highest-Value Improvements

| # | Improvement | Severity | Effort | Finding |
|---|---|---|---|---|
| 1 | Fix crop-tool crash (`useAppStore(...)` inside event handler) | Critical | 5 min | F1 |
| 2 | Stop destroying project state before a paste/open succeeds | High | 30 min | F2 |
| 3 | Gate CI: run `lint` + `vitest` before deploy; drop `work` from deploy branches | High | 30 min | F6 |
| 4 | Scope global Ctrl+V/Z/S shortcuts away from text inputs | High | 30 min | F3 |
| 5 | Defer (or remove) the ~15.5 MB OpenCV.js download | High | 1–2 h | F5 |
| 6 | Fix Zod v4 `err.errors` → `err.issues` in import error reporting | Medium | 5 min | F4 |
| 7 | Consolidate undo-snapshot responsibility; fix double-save / dangling `activeTraceId` / angle no-op snapshots | Medium | 2–4 h | F8 |
| 8 | Terminate-and-restart the detection worker on timeout | Medium | 1 h | F10 |
| 9 | Decide the PaddleOCR pass's fate: wire up `warmupNeuralOcr()` behind a setting or delete the 12 MB of models | Medium | 1–3 h | F7 |
| 10 | Burn down the 22 ESLint errors (mostly dead code) and keep lint green | Medium | 1–2 h | F12 |

## Quick Wins (<30 minutes)

- F1: one-line fix — `useAppStore.getState().imageMimeType` in `useCropTool.js:91`.
- F4: `err.errors` → `err.issues` in `projectSerializer.js:219`.
- F6 (part): add `npm run lint && npm test` steps to `.github/workflows/deploy.yml`; remove `work` from trigger branches.
- F18: `npm uninstall html-to-image`; delete `src/utils/imagePreprocessor.js` (both unused, verified by grep).
- F17: remove the redundant dynamic `import('./utils/DimensionsOCR')` in `App.jsx` (it's already statically imported; Vite warns the split is a no-op).
- F22: move `undoManager.save()` after the `traceIndex === -1` early-return in `floorManager.deletePerimeterTrace`.
- F19: add the appraisal-order PDFs pattern to `.gitignore`.

## Medium Improvements (1–4 hours)

- F2 (paste/open data loss), F3 (shortcut scoping), F5 (OpenCV deferral), F8 (undo consolidation), F9 (stuck spinner race), F10 (worker timeout restart), F11 (OCR worker re-warm), F12 (lint burn-down), F13 (shared raster core), F23 (store-level undo/restore tests).

## Large Engineering Projects

Only one is justified by evidence, and it is optional:

- **Reduce `App.jsx`/`Canvas.jsx` prop topology (F14).** Canvas receives ~45 props, most of which are values/setters from the same Zustand store that Canvas and its children already import directly. Migrating the remaining prop-drilled state into store selectors (as `LeftPanel` and `PerimeterLayer` already partly do) would remove an entire class of dead-prop bugs (three were found) and shrink `App.jsx` below ~500 lines. Do this incrementally, one subsystem at a time — not as a rewrite.

Deliberately **not** recommended: TypeScript migration of the CV pipelines (the benchmark + test harness already provides the safety types would; conversion risk outweighs benefit), replacing the manual memoized selectors with a library (current pattern is documented and works), or any rework of the detection/OCR algorithms (they are the best part of the codebase).

## Technical Debt

1. Three Otsu/grayscale implementations: `detection/raster.js` (`inkThreshold`, noted as "mirrors dimensions/raster.js inkOtsu"), `dimensions/raster.js` (`inkOtsu`), `imagePreprocessor.js` (dead). A tuning fix applied to one silently misses the other (F13).
2. Two parallel vertex-add/close-perimeter implementations: `App.jsx` (`handleAddPerimeterVertex`, `handleRemovePerimeterVertex` — dead, still passed as props) and `usePerimeterEditor` (live). The dead pair also updates `perimeterOverlay` in a way the live pair doesn't, so the two disagree about behavior (F14).
3. `undoManager.save()` is invoked from 20+ call sites across four layers with no ownership convention; `cancelLastSave()` exists to patch over speculative saves but is used in only some paths (F8).
4. The eraser's live-preview channel (`setLocalPerimeterVertices` via `perimeterRef`, `PerimeterLayer.localPerimeterVertices` prop) is plumbing with no consumer — the prop is destructured and never read (lint confirms).
5. 12 MB of PaddleOCR model weights committed and deployed for a pass that cannot activate (F7).
6. Legacy compatibility layers accumulating in `projectSerializer.js` (single-floor `floors[]` export shape, numeric `feetPerPixel` migration) — fine for now, but version 1 covers three shapes already; document them or bump the version when next touched.

## Potential Bugs

*(Detailed write-ups below; classification per item.)*

| ID | Description | Class | Severity |
|---|---|---|---|
| F1 | Crop tool throws "Invalid hook call" on mouse-up; crop never applies | **Definite bug** (verified) | Critical |
| F2 | Failed paste/open wipes image, overlays, and undo history | **Definite bug** | High |
| F3 | Ctrl+V/Z/S/O/R intercepted inside text inputs | **Definite bug** | High |
| F4 | Zod v4: invalid project file yields `TypeError: Cannot read properties of undefined (reading 'map')` instead of the validation message | **Definite bug** (verified) | Medium |
| F8a | Closing a perimeter pushes two identical undo snapshots (first Ctrl+Z is a no-op) | Likely bug | Medium |
| F8b | Undo after "Add Floor" leaves `activeTraceId` pointing at a deleted trace; perimeter becomes uneditable with no visible recovery | Likely bug | Medium |
| F8c | Angle-tool changes push undo snapshots that exclude `angleToolState`, so Ctrl+Z appears to do nothing | Likely bug | Low-Medium |
| F9 | `isProcessing` spinner stuck if the image changes mid-detection (`handleTracePerimeter`, `handleDimensionSelect` early-return without clearing it) | Likely bug | Low-Medium |
| F10 | Detection-worker timeout rejects the promise but the worker keeps computing; later requests queue behind it | Likely bug | Medium |
| F15 | `hashDataUrl` samples only the first 8 KB + length — two distinct images can alias in the undo pool / project export | Edge case | Low |
| F21 | Autosave restores mid-draw `perimeterVertices` with `traceInteractionMode: 'idle'` → permanent instruction toast, clicks ignored until Esc | Likely bug | Low |
| F22 | `deletePerimeterTrace` saves an undo point before checking the trace exists | Minor | Low |

## Performance Opportunities

- **F5 — OpenCV.js at startup.** `warmupOcrEngines()` runs at mount and triggers the 15,514 kB (3,906 kB gzip) `opencv` chunk for every visitor. It provides only `cv.CLAHE` + `cv.medianBlur`, both with existing pure-JS fallbacks, and its own 2 s init timeout means slower connections *never actually use it* — they pay the download and fall back anyway. Defer to first scan, or benchmark the JS fallback and delete the dependency.
- **F7 — dead 12 MB model payload** in `public/models/` deployed on every release.
- **F11 — OCR engine thrown away after each scan.** `App.handleManualMode`'s `finally` calls `terminateOcrWorker()`, so every scan after the first pays full Tesseract re-init inside its own time budget (the pipeline even has cold-start compensation logic to absorb this). Re-warm after terminate, or keep the worker.
- **F16 — runtime CDN fetches.** tesseract.js pulls `worker.min.js`, the core WASM, and `eng` traineddata from jsdelivr on first OCR (verified in `node_modules/tesseract.js/src/worker/browser/defaultOptions.js`). First-scan latency depends on a third party, and the app can't OCR offline — inconsistent with the self-hosted PaddleOCR models.
- Everything else measured is healthy: detection runs ~200–800 ms in a worker; Konva drags bypass React via refs+RAF; label layout is memoized with collision detection skipped during drags; text measurement is cached.

## Security Findings

No high-severity issues. The app is client-only with no credentials, no server, and no user PII by design.

- **F6 — deploy pipeline**: pushing `work` publishes to production Pages with no test/lint gate. Process risk rather than vulnerability.
- **F16 — supply chain**: runtime code (`worker.min.js`, WASM) loaded from jsdelivr at pinned versions. Acceptable, but self-hosting (as done for Paddle models) removes the vector and the availability dependency.
- **F19 — repo hygiene**: `HD_1740106857236__floor_Main.jpg` (tracked) and two untracked `cmp-vendors.classvaluation.com_Orders_*.pdf` files in the repo root look like real appraisal artifacts. If the tracked JPG is a real property's floorplan, consider whether it should be in a public repo; add an ignore pattern for the PDFs.
- Project import is well-defended: JSON parse guarded, Zod schema, version gate, `sanitizeData` scrubs NaN/Infinity before Konva sees them.
- `README.md` says "no data is collected", which is true of floorplan data, but the page does load Google Fonts and jsdelivr at runtime (standard third-party requests). Worth a footnote or self-hosting the fonts (F20).

## Architectural Observations

- The **two-pipeline + worker + env-adapter architecture is right** and should be preserved as the template for any new compute feature.
- **State ownership is split three ways** (Zustand store, App.jsx callbacks, per-hook local state + refs). The local-state-for-60fps-drag pattern is legitimate and well-executed; the App.jsx callback layer is the part that has decayed (dead handlers, double undo saves). The store is the natural owner of workflow actions like "close perimeter" — moving them there (pattern already proven by `floorManager.js`) would give each undo-able action exactly one `save()`.
- `useToolRouter` (790 lines) is the shell's complexity hotspot: it multiplexes 6 tools' mouse/keyboard handling. It works, but any new tool grows it further; a per-tool handler registry would keep additions O(1). Not urgent.
- The **snapshot/autosave field-list mechanism** (`WORKING_STATE_DEFAULTS` minus exclusion lists) is a good design, but exclusions are where bugs hide (F8b, F8c both stem from `EXCLUDED_SNAPSHOT_FIELDS`). A comment per excluded field stating *why* it's excluded would make the next exclusion decision safer.

## Future Recommendations

1. Add a minimal store/undo test suite (F23) — nearly every bug found in this review lives in the layer with zero coverage.
2. Add `npm run typecheck` via `checkJs` + JSDoc on `src/store/` and `src/hooks/` only (the pipelines already have benchmark coverage); this would have flagged F1 and the dead props.
3. Consider `vite-plugin-pwa` / service-worker caching once CDN assets are self-hosted — the app is a natural offline tool.
4. When multi-floor project files become a real need, retire the legacy single-floor export shape with a version bump rather than a fourth compatibility branch.

---

# Detailed Findings

Each finding: **Category · Severity · Confidence**, then evidence and remediation.

---

## F1 — Crop tool crashes on commit: hook called inside an event handler

**Category:** Reliability / Definite bug · **Severity:** Critical · **Confidence:** High (verified)

**Why it matters:** The crop tool cannot complete. On mouse-up the handler throws before drawing the cropped canvas, so the selection silently does nothing (the error surfaces only in the console). This is a shipped, advertised feature that is broken at HEAD.

**Evidence:** [useCropTool.js:91](../src/hooks/useCropTool.js#L91):

```js
const handleCropMouseUp = useCallback((sel) => {
  ...
  const imageMimeType = useAppStore((s) => s.imageMimeType);  // hook call inside a callback
```

- ESLint flags it: `react-hooks/rules-of-hooks — React Hook "useAppStore" cannot be called inside a callback`.
- Verified empirically: calling a Zustand v5 store hook outside render throws `Invalid hook call` / `TypeError: Cannot read properties of null (reading 'useCallback')`.
- Call path: `useToolRouter.handleStageMouseUp` → `crop.handleCropMouseUp(crop.cropSelection)` ([useToolRouter.js:342](../src/components/canvas/hooks/useToolRouter.js#L342)), so the throw happens on every crop attempt.
- `git log -S` shows the line arrived in `cd43ae0` ("Add support for JPG and all image formats without conversion") — a regression from the JPG work.

**Files affected:** `src/hooks/useCropTool.js`

**Fix:** `const imageMimeType = useAppStore.getState().imageMimeType;`

**Estimated effort:** 5 minutes. **Risks:** None. **Expected benefit:** Restores a broken feature. **Priority:** Immediate.

---

## F2 — Failed paste/open destroys the project and its undo history

**Category:** Reliability / Definite bug (data loss) · **Severity:** High · **Confidence:** High

**Why it matters:** A user with an open project who presses Ctrl+V while their clipboard holds *text* (or nothing, or an oversized image) loses the image, all overlays, and the entire undo stack — before the clipboard is even read. The confirm dialog makes it worse: the user confirms "discard changes" expecting a new image to replace the old one, then gets an error toast and an empty canvas with no recovery.

**Evidence:** [useDragAndDrop.js:12-31](../src/hooks/useDragAndDrop.js#L12):

```js
const handlePasteImage = useCallback(async () => {
  if (!(await checkUnsavedChanges())) return;
  try {
    setImage(null);          // ← destroys state
    resetOverlays();         // ← destroys state
    undoManager.clear();     // ← destroys recovery
    const { dataUrl, mimeType } = await loadImageFromClipboard();  // ← may throw
```

`loadImageFromClipboard` throws for any non-image clipboard ([imageLoader.js:95-98](../src/utils/imageLoader.js#L95)). The same clear-before-load ordering exists in `useProjectIO.handleFileUpload` (image branch, [useProjectIO.js:57-66](../src/hooks/useProjectIO.js#L57)) where `loadImageFromFile` can throw on the 20 MB size cap.

**Files affected:** `src/hooks/useDragAndDrop.js`, `src/hooks/useProjectIO.js`

**Fix:** Load and validate first, mutate second:

```js
const { dataUrl, mimeType } = await loadImageFromClipboard(); // throws → old project intact
resetOverlays();
undoManager.clear();
setImage(dataUrl);
setImageMimeType(mimeType);
```

(The `setImage(null)` "ensure state change" step is unnecessary — the new data URL is a different string, so the subscription fires regardless.)

**Estimated effort:** 30 minutes incl. manual verification. **Risks:** Minimal; verify the image-load effect still fires when replacing an image with itself. **Expected benefit:** Eliminates the only data-loss path found. **Priority:** Immediate.

---

## F3 — Global shortcuts hijack Ctrl+V / Ctrl+Z / Ctrl+S / Ctrl+O inside text inputs

**Category:** Reliability / Definite bug (UX) · **Severity:** High · **Confidence:** High

**Why it matters:** The window-level `keydown` handler `preventDefault()`s modifier shortcuts unconditionally. With focus in the room-dimension inputs or a trace-rename field:

- **Ctrl+V** cannot paste text — instead it triggers the image-paste flow, which (per F2) can destroy the project after a misleading confirm dialog.
- **Ctrl+Z** performs a global app undo instead of undoing typing.
- **Ctrl+A / arrow keys** work, but Ctrl+S/Ctrl+O also fire app actions mid-edit.

**Evidence:** [useKeyboardShortcuts.js:65-98](../src/hooks/useKeyboardShortcuts.js#L65). The unmodified-key branch (`o`, `l`, `r`) *does* check `e.target.tagName !== 'INPUT' && ... !isContentEditable` (lines 41, 49, 57), so the authors clearly intend input-field exclusion — the ctrl/meta branch just lacks the same guard. Text inputs exist in `LeftPanel` (dimension fields, trace rename) and `InchesInput`.

**Files affected:** `src/hooks/useKeyboardShortcuts.js`

**Fix:** Hoist the existing input-field check to the top of `handleKeyDown` and return early for editable targets (optionally still allowing Ctrl+S to save).

**Estimated effort:** 30 minutes. **Risks:** None meaningful. **Expected benefit:** Restores standard text-editing behavior; closes an entry point into F2. **Priority:** High.

---

## F4 — Zod v4 removed `ZodError.errors`; import validation error path throws

**Category:** Reliability / Definite bug · **Severity:** Medium · **Confidence:** High (verified)

**Why it matters:** When a `.floorplan` file fails schema validation, the user should see "Project validation failed: <field details>". Instead they get `Failed to load file: Cannot read properties of undefined (reading 'map')` — the diagnostic is destroyed exactly when it's needed.

**Evidence:** [projectSerializer.js:217-223](../src/utils/projectSerializer.js#L217) uses `err.errors.map(...)`. The project depends on `zod@4.4.3` (verified installed), and verified at runtime: Zod 4's `ZodError` has `.issues` but `.errors` is `undefined`, so the `.map` call throws a `TypeError` out of the `catch` block. The existing tests pass because they only assert `.toThrow()` — any error satisfies them.

**Files affected:** `src/utils/projectSerializer.js` (also update the test to assert on the message so this can't regress).

**Fix:** `err.issues.map(e => ...)`. Note `z.record(z.string())` single-arg (line 169) was also checked and works in Zod 4 (treated as value schema) — no change needed there.

**Estimated effort:** 5 minutes + 10 for a test. **Risks:** None. **Expected benefit:** Correct error reporting for corrupt/incompatible project files. **Priority:** High (trivial).

---

## F5 — OpenCV.js (~15.5 MB / 3.9 MB gzip) downloaded at app mount for two optional filters

**Category:** Performance · **Severity:** High · **Confidence:** High

**Why it matters:** The production build emits `opencv.*.js` at 15,514 kB (3,906 kB gzip) — 30× the size of the entire rest of the app (index 126 kB + konva 99 kB gzip). `App.jsx`'s mount effect calls `warmupOcrEngines()` → `loadOpenCv()` ([DimensionsOCR.js:46-53](../src/utils/DimensionsOCR.js#L46)), so **every visitor** downloads it whether or not they ever scan dimensions.

What it buys: `cv.CLAHE` + optional `cv.medianBlur` in `enhanceGrayWithCv` ([opencvBridge.js:45](../src/utils/dimensions/opencvBridge.js#L45)). The pipeline already has a pure-JS CLAHE (`dimensions/raster.js:38`) and uses it whenever OpenCV isn't ready — and `loadOpenCv` has a **2-second init timeout**, so on connections where the 4 MB download is actually painful, OpenCV never finishes initializing and the JS fallback runs anyway. The expensive dependency is used precisely when it's least needed.

**Evidence:** Build output (`vite build`); `openCvIfReady()` gating in [pipeline.js:350-352](../src/utils/dimensions/pipeline.js#L350); JS fallback at [raster.js:38](../src/utils/dimensions/raster.js#L38).

**Files affected:** `src/utils/dimensions/opencvBridge.js`, `src/utils/DimensionsOCR.js`, `package.json`

**Recommendation (in order of preference):**
1. Run `scripts/ocrBenchmark.mjs` (which already exercises the JS-CLAHE path, since Node never loads OpenCV) and compare detection rates against browser runs. If parity holds — and the benchmark architecture suggests the team already trusts the JS path — delete `@techstark/opencv-js` entirely.
2. If OpenCV measurably helps some scans, defer `loadOpenCv()` to the first `detectAllDimensions` call instead of app mount, and drop the warmup.

**Estimated effort:** 1–2 hours incl. benchmark comparison. **Risks:** Slight OCR-quality delta on noisy scans if removed — measurable with the existing harness before committing. **Expected benefit:** ~3.9 MB gzip less transfer per visitor; faster time-to-interactive on the deployed page. **Priority:** High.

---

## F6 — CI deploys to production with no lint/test gate, from three branches

**Category:** Developer Experience / Process · **Severity:** High · **Confidence:** High

**Why it matters:** `.github/workflows/deploy.yml` triggers on push to `master`, `main`, **and `work`**, and runs only `npm ci && npm run build` before publishing to GitHub Pages. Consequences observed at HEAD:

- The crop-tool bug (F1) is flagged by ESLint as an *error*, and `npm run lint` exits non-zero — yet nothing stops it from deploying.
- Pushing an experimental `work` branch publishes it to the production URL.

**Evidence:** [deploy.yml:3-8, 20-37](../.github/workflows/deploy.yml#L3).

**Files affected:** `.github/workflows/deploy.yml`

**Fix:** Add `run: npm run lint` and `run: npm test` steps before Build; restrict trigger to the default branch (keep `workflow_dispatch` for manual deploys). Requires F12's lint burn-down first (or start by gating on tests only, which already pass).

**Estimated effort:** 30 minutes (+ F12). **Risks:** None. **Expected benefit:** Broken builds like F1 become impossible to ship silently. **Priority:** High.

---

## F7 — PaddleOCR rescue pass is unreachable in production; 12 MB of models shipped anyway

**Category:** Dead code / Performance · **Severity:** Medium · **Confidence:** High

**Why it matters:** Pipeline phase 5 (neural rescue) only runs when the Paddle engine is warm, and warming happens exclusively via `warmupNeuralOcr()` — which **no code calls** (verified by grep; only the definition and a comment reference it). So `paddleIfReady()` is always `null`, `env.refineRois` returns `[]`, and every browser run skips the rescue pass. Meanwhile `public/models/` (12 MB) is committed to git and uploaded with every Pages deploy, and a meaningful slice of `pipeline.js` (failed-tile collection, `PADDLE_RESERVE_MS` budgeting, `ocrPaddle.js` collage packing) is maintained-but-dead in production.

The comment in [DimensionsOCR.js:40-45](../src/utils/DimensionsOCR.js#L40) explains why auto-init was rejected (~10 s main-thread WebGL shader compile) — the decision is sound; the limbo state is the problem.

**Files affected:** `src/utils/DimensionsOCR.js`, `src/utils/dimensions/ocrPaddle.js`, `public/models/`, `vite.config.js`

**Recommendation:** Pick one:
1. **Activate it**: call `warmupNeuralOcr()` from an explicit user affordance (an "Enhanced OCR" toggle in Options, or after the first scan completes while the app is idle) — the pipeline code is already budget-guarded and ready.
2. **Remove it**: delete `public/models/`, `ocrPaddle.js`, the phase-5 block, and `@paddlejs-models/ocr` — recoverable from git if wanted later.

**Estimated effort:** 1–3 hours either way. **Risks:** Option 1 risks the documented 10 s jank if triggered at a bad time — gate it behind idle time. **Expected benefit:** Either better OCR on hard labels, or −12 MB repo/deploy and less dead surface. **Priority:** Medium.

---

## F8 — Undo-stack correctness: double-saves, no-op snapshots, dangling active trace

**Category:** Reliability / Likely bugs · **Severity:** Medium · **Confidence:** Medium-High

**Why it matters:** Undo is a headline feature (mouse side buttons, Ctrl+Z, serialized into project files), and three call-site inconsistencies make it misbehave:

**(a) Closing a perimeter saves twice.** `usePerimeterEditor.handleClosePerimeterShape` calls `onSaveUndoPoint?.()` then `onClosePerimeter?.()` ([usePerimeterEditor.js:110-115](../src/components/canvas/hooks/usePerimeterEditor.js#L110)); `App.handleClosePerimeter` then calls `undoManager.save()` again ([App.jsx:616-623](../src/App.jsx#L616)). Two identical snapshots are pushed, so the user's first Ctrl+Z after closing appears to do nothing.

**(b) Undoing "Add Floor" strands the UI.** `EXCLUDED_SNAPSHOT_FIELDS` omits `activeTraceId` from snapshots ([appStore.js:77-91](../src/store/appStore.js#L77)). `addPerimeterTrace` saves, then sets `activeTraceId` to the new trace. Ctrl+Z restores the old `perimeterTraces` but `activeTraceId` still names the now-removed trace → `selectPerimeterOverlay` returns `null`, `PerimeterLayer` finds no active trace (no vertex handles), the Toolbar's "Add Floor"/"Manual Trace" buttons disable (they key off `perimeterOverlay`), and the LeftPanel trace list is hidden because only one trace exists — leaving no visible way to re-select the trace.

**(c) Angle-tool undo snapshots are no-ops.** `handleAngleToolStateChange` calls `undoManager.save()` on every committed angle edit ([App.jsx:859-862](../src/App.jsx#L859)), but `angleToolState` is in `EXCLUDED_SNAPSHOT_FIELDS` — so each edit pushes a snapshot that restores nothing, and Ctrl+Z after using the protractor eats stack entries without visible effect. (`AngleOverlay`'s own comment expects "undo/redo" to sync it back — [AngleOverlay.jsx:113](../src/components/canvas/AngleOverlay.jsx#L113).)

**Files affected:** `src/store/appStore.js`, `src/store/floorManager.js`, `src/App.jsx`, `src/components/canvas/hooks/usePerimeterEditor.js`

**Fix:**
- (a) Remove the `onSaveUndoPoint` call from `handleClosePerimeterShape` (App's handler owns the save), or vice-versa — one owner.
- (b) Include `activeTraceId` in snapshots (it's already autosaved and serialized; the exclusion looks accidental), or have `applySnapshot` reconcile a dangling `activeTraceId` to the first trace.
- (c) Either include `angleToolState` in snapshots or stop saving on angle edits.
- Longer term: adopt the convention that **store actions** (not components, not App) call `undoManager.save()` — `floorManager.js` already models this.

**Estimated effort:** 2–4 hours with tests. **Risks:** Snapshot-shape changes interact with saved project history — old histories lacking `activeTraceId` fall back to `WORKING_STATE_DEFAULTS` via the existing `snapshot[k] ?? defaults[k]` path, which is acceptable. **Expected benefit:** Undo behaves predictably across all features. **Priority:** Medium-High.

---

## F9 — Stuck processing spinner when the image changes mid-detection

**Category:** Reliability / Likely bug · **Severity:** Low-Medium · **Confidence:** High (code path), Medium (frequency)

**Why it matters:** `handleTracePerimeter` and `handleDimensionSelect` guard against stale results with `if (useAppStore.getState().image !== startImage) return;` — but those early returns skip `setIsProcessing(false)` ([App.jsx:472](../src/App.jsx#L472), [App.jsx:713](../src/App.jsx#L713)). If the image changes while detection runs (eraser commit, crop once F1 is fixed, undo of an image edit via mouse side-button — none of which are blocked by `isProcessing`), the "Working…" spinner stays up forever. `autoTraceExterior` handles the same situation correctly with a guarded `finally` ([App.jsx:679-683](../src/App.jsx#L679)) — the fix is to copy that pattern.

**Files affected:** `src/App.jsx`

**Estimated effort:** 30 minutes. **Risks:** None. **Expected benefit:** No stuck UI state. **Priority:** Medium.

---

## F10 — Detection-worker timeout abandons the computation instead of cancelling it

**Category:** Reliability · **Severity:** Medium · **Confidence:** High

**Why it matters:** `runWorkerRequest` rejects after 30 s and deletes the pending entry ([detection/index.js:26-45](../src/utils/detection/index.js#L26)), but the worker thread keeps crunching the pathological image. Because there is one worker and requests are processed sequentially, every subsequent detection queues behind the runaway job — the user sees "Detection timed out" and then *every later attempt also times out*, with no recovery short of a page reload. `terminateDetectionWorker()` exists but is only called on App unmount.

**Files affected:** `src/utils/detection/index.js`

**Fix:** On timeout, call `terminateDetectionWorker()` (rejecting any other pending requests) and let the next request lazily respawn via `ensureWorker()`. Worker startup is cheap relative to a 30 s timeout.

**Estimated effort:** ~1 hour. **Risks:** In-flight sibling requests get rejected on a timeout — acceptable; they were doomed to queue anyway. **Expected benefit:** Self-healing detection after a pathological image. **Priority:** Medium.

---

## F11 — Warm OCR engine discarded after every scan

**Category:** Performance · **Severity:** Medium · **Confidence:** High

**Why it matters:** `warmupOcrEngines()` at mount exists specifically so "the first dimension scan doesn't pay multi-second engine bootstrap" ([DimensionsOCR.js:36-39](../src/utils/DimensionsOCR.js#L36)). But `App.handleManualMode`'s `finally` block calls `terminateOcrWorker()` after **every** scan ([App.jsx:385-388](../src/App.jsx#L385)), so scan #2 onward ("Find Room Size" re-scans, loading a second image) pays the full Tesseract createWorker + CDN fetch cost inside its own time budget. The pipeline even carries cold-start compensation logic (`effectiveBudget`, [pipeline.js:644-648](../src/utils/dimensions/pipeline.js#L644)) to absorb the self-inflicted cost.

If the terminate is intentional (freeing ~100 MB of worker memory between scans is a defensible trade), re-warm asynchronously right after: `terminateOcrWorker().then(() => warmupOcrEngines())` — idle-time init instead of scan-time init.

**Files affected:** `src/App.jsx`

**Estimated effort:** 15–30 minutes. **Risks:** Slightly higher steady-state memory if kept warm. **Expected benefit:** Consistent multi-second savings on repeat scans. **Priority:** Medium.

---

## F12 — `npm run lint` fails at HEAD: 22 errors, 7 warnings

**Category:** Code quality · **Severity:** Medium · **Confidence:** High (ran it)

**Why it matters:** A red lint baseline means new errors are invisible — F1 sat in plain sight behind 21 pre-existing errors. The errors are almost all dead code, which doubles as an inventory of decayed seams:

- `App.jsx`: unused `loadImageFromFile`/`loadImageFromClipboard` imports, unused `resetOverlays`, unused `autoTraceExterior` params.
- `Canvas.jsx`: `onAddPerimeterVertex` prop accepted, never used (its App-side implementation `handleAddPerimeterVertex` is a *second, divergent* implementation of vertex adding — see F14).
- `PerimeterLayer.jsx`: `localPerimeterVertices` prop unused → the eraser live-preview plumbing is dead end-to-end.
- `useToolRouter`/`usePerimeterEditor`/`useShapeEditor`/`useMeasurementSystem`/`useCanvasPan`: unused destructured params documenting parameters that no longer do anything.
- `useCropTool.js:91`: the F1 rules-of-hooks error.
- Minor: unused catch bindings (`draftStorage.js`, `projectSerializer.js:411` — use optional catch binding).

The `react-hooks/exhaustive-deps` warnings were reviewed individually: they are mostly benign (stable Zustand setters), but each requires that mental check every time — silence them by including the stable refs, which costs nothing.

**Files affected:** 12 files (list via `npx eslint .`).

**Estimated effort:** 1–2 hours. **Risks:** Deleting "unused" props requires confirming the caller side too (they come in pairs). **Expected benefit:** Green baseline enabling the F6 CI gate; removes misleading dead seams. **Priority:** Medium-High (prerequisite for F6's lint gate).

---

## F13 — Three copies of the raster/threshold core

**Category:** Refactoring / Duplication · **Severity:** Medium · **Confidence:** High

**Why it matters:** The fill-aware Otsu logic — the most subtle thresholding code in the app — exists twice and must be kept in sync by hand: `detection/raster.js:inkThreshold` (its comment literally says "mirrors dimensions/raster.js inkOtsu") and `dimensions/raster.js:inkOtsu`. Plain Otsu exists three times (both files plus dead `imagePreprocessor.js`), as do grayscale conversion and histogram helpers. The recent colored-floorplan fixes (commit `97961c6`) had to touch this logic — any future tuning has to remember both copies or silently fork behavior between the OCR and boundary pipelines.

**Evidence:** [detection/raster.js:59-85](../src/utils/detection/raster.js#L59) vs [dimensions/raster.js:188-214](../src/utils/dimensions/raster.js#L188) — byte-for-byte identical thresholds (0.14, 0.002, 0.4, 35).

**Files affected:** `src/utils/detection/raster.js`, `src/utils/dimensions/raster.js`, new `src/utils/raster/threshold.js` (or similar)

**Fix:** Extract `otsuHist`/`histOf`/`otsu`/`inkOtsu` (and optionally grayscale) into one shared module consumed by both pipelines. The two APIs differ only in image shape (bare `Uint8Array` vs `{data,width,height}`) — normalize on the histogram level, which is shape-agnostic. Both benchmark harnesses will confirm no behavior change. Delete `imagePreprocessor.js` (F18).

**Estimated effort:** 1–2 hours. **Risks:** Low — pure functions with benchmark + 220-test coverage. **Expected benefit:** Single point of truth for the most-tuned code in the repo. **Priority:** Medium.

---

## F14 — Prop-drilling topology in App/Canvas, with divergent duplicate handlers

**Category:** Architecture / Refactoring · **Severity:** Medium · **Confidence:** High (structure), Medium (payoff)

**Why it matters:** `Canvas` accepts ~45 props ([Canvas.jsx:17-65](../src/components/Canvas.jsx#L17)), almost all sourced from the same Zustand store that `Canvas`, `PerimeterLayer`, `DimensionOverlay`, and the hooks already import directly. This split personality has produced concrete defects, not just aesthetics:

- `App.handleAddPerimeterVertex`/`handleRemovePerimeterVertex` ([App.jsx:603-634](../src/App.jsx#L603)) are passed down but never called — the live implementations are in `usePerimeterEditor`, **and they behave differently** (App's version also mirrors vertices into `perimeterOverlay` during drawing; the live one doesn't). A future reader has a 50% chance of "fixing" the dead one.
- The double undo-save in F8(a) is a direct consequence of the same action being owned in two layers.
- The dead eraser-preview plumbing (F12) threaded through three files without anyone noticing it had no consumer.

**Files affected:** `src/App.jsx`, `src/components/Canvas.jsx`, `src/components/canvas/hooks/*`

**Recommendation:** Incremental, per subsystem: (1) delete the dead App handlers and their props now (quick win, part of F12); (2) when next touching a subsystem, let its hook read state/actions from the store directly and drop the corresponding Canvas props (the pattern `usePerimeterEditor` already uses for `setPerimeterVertices` via `useAppStore.getState()`). Target: Canvas props become "callbacks App genuinely owns" (~10) rather than a store relay.

**Estimated effort:** Deletions: 30 min. Full migration: several sessions of 1–2 h each. **Risks:** Each moved prop needs manual interaction testing (no e2e harness). **Expected benefit:** Removes the dead-seam bug class; makes `App.jsx` legible. **Priority:** Medium (deletions high, migration opportunistic).

---

## F15 — `hashDataUrl` samples only the first 8 KB — image aliasing is possible

**Category:** Reliability / Edge case · **Severity:** Low · **Confidence:** Medium

**Why it matters:** The hash keys three things: the undo image pool, project-file image dedup, and autosaved history. It hashes `dataUrl.slice(0, 8192) + '|' + length` ([hash.js:9-18](../src/utils/hash.js#L9)). Two different images that share their first ~6 KB of base64 (identical header + early scanlines — plausible for two edits of the same source, e.g. eraser strokes in the *lower* half of a plan) and coincidentally equal encoded length would intern to one pool entry — undo would then silently restore the *wrong image*. Probability is low (length equality is a strong filter) but the failure is silent and confusing, and the consequence lands in the feature (undo) users trust for recovery.

**Files affected:** `src/utils/hash.js`

**Fix options:** cheapest is sampling three regions (head + middle + tail) plus length — still O(KB); or FNV over a strided sample of the whole string. Keep the function synchronous (it's called in `save()` hot path).

**Estimated effort:** 30 minutes incl. updating `hash.test.js`. **Risks:** Changing the hash orphan-keys history in *old autosaves/projects* — the resolve path already falls back to `null` image, but verify restore behavior; consider keeping old hashes valid by only adding new samples when strings exceed 8 KB. **Expected benefit:** Removes a silent-corruption edge from undo/persistence. **Priority:** Low-Medium.

---

## F16 — Tesseract worker/WASM/language data fetched from jsdelivr at runtime

**Category:** Reliability / Security (supply chain) · **Severity:** Low-Medium · **Confidence:** High (verified in dependency source)

**Why it matters:** With default `createWorker('eng', 1)` options ([ocrTesseract.js:18-26](../src/utils/dimensions/ocrTesseract.js#L18)), tesseract.js v6 loads `worker.min.js`, `tesseract-core` WASM (~3–5 MB), and the `eng` traineddata from `cdn.jsdelivr.net` (verified: `node_modules/tesseract.js/src/worker/browser/defaultOptions.js`, `worker-script/index.js:130`). Consequences: first scan latency depends on a third-party CDN; OCR fails entirely offline or if jsdelivr is blocked (some corporate networks); and executable code is pulled from a CDN at runtime (pinned by version, so risk is modest). It's also inconsistent with the deliberate choice to self-host the PaddleOCR models "no network dependency" ([ocrPaddle.js:5](../src/utils/dimensions/ocrPaddle.js#L5)).

**Files affected:** `src/utils/dimensions/ocrTesseract.js`, `public/`

**Fix:** Pass `workerPath`, `corePath`, `langPath` pointing at self-hosted copies under `public/` (same pattern as `models/`). ~5 MB added to the Pages deploy — trivial next to the existing 12 MB of Paddle models.

**Estimated effort:** 1–2 hours incl. verifying the build serves them with correct paths under `/FloorTrace/`. **Risks:** Must update the vendored files when bumping tesseract.js. **Expected benefit:** Deterministic first-scan latency, offline capability, closed supply-chain vector. **Priority:** Medium-Low.

---

## F17 — `DimensionsOCR` is both statically and dynamically imported

**Category:** Performance (minor) / Code quality · **Severity:** Low · **Confidence:** High

**Evidence:** `App.jsx` statically imports `terminateOcrWorker, warmupOcrEngines` from `./utils/DimensionsOCR` (line 17) and then dynamically imports the same module inside `handleManualMode` (line 307). Vite warns during build: *"dynamic import will not move module into another chunk"*. The `await import(...)` is pure ceremony — the module is already in the main bundle.

**Fix:** Use the static import in `handleManualMode` (or, if the intent was to keep the OCR pipeline out of the main chunk, invert it: make *all* references dynamic — but the heavy parts (tesseract.js, opencv) are already split/dynamic, so the simple fix is right).

**Effort:** 10 minutes. **Priority:** Low (bundle-hygiene quick win).

---

## F18 — Dead file and dead dependency

**Category:** Dead code · **Severity:** Low · **Confidence:** High (verified by grep)

- `src/utils/imagePreprocessor.js` (161 lines: grayscale/Otsu/stretch/sharpen/canvas helpers) has **zero importers**. It's a third copy of raster logic (see F13).
- `html-to-image@1.11.13` in `dependencies` has **zero imports** anywhere in the repo.

**Fix:** Delete the file; `npm uninstall html-to-image`. **Effort:** 10 minutes. **Priority:** Low (quick win).

---

## F19 — Real-world appraisal artifacts in the repo root

**Category:** Security / Repo hygiene · **Severity:** Low-Medium · **Confidence:** Medium (that they're sensitive), High (that they're present)

**Evidence:** `HD_1740106857236__floor_Main.jpg` is **tracked** in git; two `cmp-vendors.classvaluation.com_Orders_<id>_Items_..._Documents_....pdf` files and `ExampleFloorplan5.jpg` sit untracked in the root (per `git status`). The naming pattern (vendor order/document IDs) suggests real appraisal-order documents rather than synthetic fixtures. If this repo is public (it deploys to public GitHub Pages from this account), a real property's floorplan may be published in history.

**Fix:** Confirm provenance. If real: remove the tracked JPG (history rewrite only if actually sensitive), and add `cmp-vendors.*` / order-PDF patterns to `.gitignore` so they can't be committed accidentally. If synthetic: rename to the `ExampleFloorplanN` convention so the question doesn't recur.

**Effort:** 15 minutes (plus optional history rewrite). **Priority:** Medium if real data, else Low.

---

## F20 — External Google Fonts + font-family mismatch

**Category:** Performance / Quality · **Severity:** Low · **Confidence:** High

**Evidence:** `index.html` loads Fira Sans/Fira Code from Google Fonts (render-blocking `<link>`, third-party request — a footnote against the "no data is collected" positioning). Meanwhile the Konva text code hardcodes `'Inter, system-ui, sans-serif'` ([canvasUtils.js:2-5](../src/components/canvas/canvasUtils.js#L2), `PerimeterLayer.jsx:8`) — a font the app never loads. Measurement and rendering use the same string so pills stay correctly sized, but canvas labels render in the system fallback rather than matching the app's Fira theme.

**Fix:** Self-host the two Fira families (`@fontsource/fira-sans`, `@fontsource/fira-code`) and change the Konva constants to Fira Sans.

**Effort:** ~1 hour. **Priority:** Low.

---

## F21 — Autosave can restore a half-drawn perimeter into a stuck state

**Category:** Reliability / Edge case · **Severity:** Low · **Confidence:** Medium

**Evidence:** `AUTOSAVE_FIELDS` includes `perimeterVertices` but excludes `traceInteractionMode` ([appStore.js:107-115](../src/store/appStore.js#L107)). If the tab closes mid-drawing, restore brings back `perimeterVertices: [...]` with `traceInteractionMode: 'idle'`. The App toast effect ([App.jsx:163-169](../src/App.jsx#L163)) then shows the infinite "Click to add perimeter vertices" toast, but `useToolRouter` requires `traceInteractionMode === 'drawing'` for clicks to add vertices — so clicks do nothing until the user discovers Esc.

**Fix:** In `restoreFromSaved`, either null out `perimeterVertices` or set `traceInteractionMode: 'drawing'` when they're non-null (matching `setPerimeterVertices`'s own coupling logic at [appStore.js:253-261](../src/store/appStore.js#L253)).

**Effort:** 20 minutes. **Priority:** Low.

---

## F22 — `deletePerimeterTrace` pushes an undo point before validating the trace exists

**Category:** Code quality / Minor bug · **Severity:** Low · **Confidence:** High

**Evidence:** [floorManager.js:88-95](../src/store/floorManager.js#L88): `undoManager.save()` runs first; if `traceIndex === -1` the function returns having pushed a snapshot (and cleared the redo stack) for a no-op. `cancelLastSave()` exists for exactly this; or just reorder the check above the save.

**Effort:** 5 minutes. **Priority:** Low (quick win).

---

## F23 — Zero test coverage for the layer where the bugs live

**Category:** Developer Experience / Testing · **Severity:** Medium · **Confidence:** High

**Why it matters:** Test coverage is inversely correlated with where this review found defects. `src/utils/` and the detection pipeline have 220 passing tests plus two benchmark harnesses; `src/store/`, `src/hooks/`, and `src/App.jsx` have none — and F1, F2, F8(a–c), F9, F21, F22 all live there. The store and undoManager are plain JS with no DOM dependency: they are cheap to test today with the existing Vitest setup (no jsdom needed for most of it).

**Files affected:** new `src/store/__tests__/`

**Recommendation:** A focused suite (~15 tests) asserting: save→mutate→undo→redo round-trips for each undoable action; `activeTraceId` validity after undo of add/delete trace; snapshot/autosave field-list invariants (e.g. every `EXCLUDED_SNAPSHOT_FIELDS` entry exists in `WORKING_STATE_DEFAULTS`); `restoreFromSaved` of a mid-draw state; `cancelLastSave` semantics. This suite would have caught F8(a), F8(b), F21, F22 mechanically.

**Estimated effort:** 3–4 hours. **Risks:** None. **Expected benefit:** Regression net under the app's most fragile shared state. **Priority:** Medium-High.

---

## F24 — `notify()` infers toast severity from message wording

**Category:** Code quality / Opinion-adjacent improvement · **Severity:** Low · **Confidence:** High

**Evidence:** [App.jsx:116-131](../src/App.jsx#L116): when no `type` is passed, severity is guessed by substring ("error", "fail", "detected", "loaded"…). The code comment already acknowledges the right pattern ("Prefer an explicit type"), and most call sites now pass one. The inference branch means an innocuous message containing "failed" renders as an error. Finish the migration: make `type` required (default `'default'`), delete the inference, and fix the handful of bare `notify(...)` calls (`handleRotateCanvas`, `handleUnitChange`).

**Effort:** 30 minutes. **Priority:** Low. *(Classified as improvement, not bug.)*

---

# Appendix — Verification Log

| Check | Result |
|---|---|
| `npx vitest run` | 10 files, **220/220 pass** (12.6 s) |
| `npx eslint .` | **22 errors, 7 warnings** (incl. `rules-of-hooks` at `useCropTool.js:91`) |
| `npm run build` | Succeeds; chunks: opencv **15,514 kB** (3,906 kB gz), index 399 kB (126 kB gz), konva 320 kB (99 kB gz); Vite warns about the dual static/dynamic `DimensionsOCR` import |
| Zod 4.4.3 runtime probe | `ZodError.errors === undefined` (`.issues` present); `z.record(z.string())` single-arg works |
| Zustand v5 hook outside render | Throws `Invalid hook call` (confirms F1) |
| `grep warmupNeuralOcr` | Defined, never called (confirms F7) |
| tesseract.js v6 defaults | `workerPath`/`corePath`/`langPath` default to `cdn.jsdelivr.net` (confirms F16) |
| `grep html-to-image` / `imagePreprocessor` in `src/` | No imports (confirms F18) |
| `git log -S` on `useCropTool.js:91` | Introduced in `cd43ae0` |
