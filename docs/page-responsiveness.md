# FloorTrace — what the page is doing while a plan loads

> **A dated record** (October 2026). The question was "it seems to hang when a sketch is loaded",
> for a new sketch and for saved work reopened later in a new tab. This is what was measured, what
> was changed, and what was found and left. `docs/load-to-area-performance.md` (August 2026) is the
> companion: it is about how *long* a load takes. This one is about whether the page can repaint
> and take a click while it does — which that document could not see, because everything in it
> was measured in Node.

**Metric:** time the page's own thread is busy, and the longest single stretch of it. A busy
stretch is a freeze: the progress line does not repaint, Stop cannot be pressed, a tab cannot be
switched.

**How it was measured:** `scripts/pageProbe.js`, which drops a plan on the running app and samples
the page thread with the JS Self-Profiling API; for a reload, the same sampler started from the
first line of `index.html`. A production build (`vite build --minify false`, for readable names)
on a 16-core Windows desktop, in Chromium. Two things about that browser pane shape the numbers:
its document is hidden, so frames were run from messages to keep Konva drawing, and `longtask`
entries are not delivered, which is why the probe samples instead. Busy time and freezes are solid.
Times to "drawn" are good to about 0.1 s and include a lazy chunk the pane fetches later than a
visible tab would.

---

## 1. What was found

### Opening a sketch

**The load was not slow so much as deaf.** Tesseract has always read in workers, but everything
around it ran on the page: the decode and its full-size `getImageData`, grayscale, the resample to
OCR size, CLAHE, the unsharp mask, the glyph analysis, every ROI's variants and their PNG
encodes. That is 1.3–1.8 s of page-thread work per plan, in stretches of up to 0.8 s.

| Input | drop → area | page busy | freezes of 60 ms or more |
|---|---|---|---|
| `ExampleFloorplan.png` 987×956, cold | 3.8 s | ≥1.3 s | twelve, longest 278 ms |
| The same plan as a 12 MP phone photo (4032×3024 JPEG) | 5.4 s | 3.0 s | 729, 806, 387, 536, 216 ms |
| `ExampleFloorplan7` as a one-page Letter PDF | 8.4 s | 2.3 s | 217, 713, 157, 391, 218, 162 ms |

On the photo the first three run nearly end to end: the page is unresponsive from 0.1 s to 2.4 s
after the drop. Where it went, on that run:

| Page-thread cost | ms | What it is |
|---|---|---|
| `canvas.toDataURL('image/png')` | 615 | `prepareDataUrl` re-encoding an image over 4000 px |
| `detectDimensionsCore` | 1333 | the scan's image work (`dashLineMask` 284, `scaleGray` 254, `sweep` 214, `unsharp` 108, `histOf` 108) |
| `getImageData` | 247 | the scan's own full-size readback |
| first draw of the plan | 232 | the decode, done on first paint |
| React | ~200 | the render when the area lands |

Fixture-sized plans (about 1000 px) never froze for more than ~0.3 s on this machine. **The size of
the input is what turns jank into a hang**, and two ordinary inputs are always large: a phone
photo, and any PDF page — `pdfLoader` renders every page with a 4000 px long edge.

### Coming back to saved work in a new tab

A new tab is a new session: it finds no workspace of its own, asks every open tab whether the one
on disk is theirs (a fixed 250 ms), adopts it, reads the active plan back and draws it. The reads
are quick — a 29.7 MB image comes out of IndexedDB in 45 ms without blocking. **What froze the page
was turning that string back into pixels**, three times over:

| Page-thread cost, 12 MP plan | ms | What it is |
|---|---|---|
| `img.src = dataUrl` | 475 | the URL is parsed and un-base64'd in place, before `onload` |
| `inkMapFor` | ~220 | the first `drawImage` of that `<img>`: the decode itself |
| Konva's first draw | ~230 | the same decode again, for a canvas of another size |

`img.decode()` does not help: it resolved in 228 ms and the first canvas draw after it still took
237. An `ImageBitmap` made from the bytes draws in 1–4 ms at any size, however long it is held.

| Saved workspace, reopened in a new session | plan drawn | page busy | longest freezes |
|---|---|---|---|
| One plan, 987×956 | 0.85 s | 0.29 s | 82 ms |
| One plan, 12 MP (29.7 MB image) | 1.5–1.7 s | 0.86 s | 491, 223, 246 ms |
| Four plans, the open one 12 MP | ~1.4 s | 0.84 s | 384, 569 ms |
| …then switching to a plan not read back yet (a PDF page) | 0.41 s | 0.51 s | 129, 229, 165 ms |

A small saved plan was never the problem. A large one froze the page for about a second of its
first second and a half, and again on each switch to a plan the cache had let go.

---

## 2. What changed

**The scan runs in a worker** (`src/workers/ocrWorker.js`; `dimensions/ocrHost.js` is the page's
half). It decodes the image, starts the Tesseract pool as its own workers, loads OpenCV and runs
`detectDimensionsCore` unchanged. The page keeps the scan queue and its memo, the asset URLs, and
PaddleOCR — which needs WebGL and an `<img>`, and is reached by message. A worker that cannot
start (no nested workers, no `OffscreenCanvas`) or that dies hands the scan back, and it runs on
the page as before (`dimensions/scanOnPage.js`, fetched only then).

**The plan's image is decoded in a worker and drawn from a bitmap** (`src/workers/decodeWorker.js`,
`canvas/imageCache.js`). The page's cost is the `postMessage`, 7 ms for the 30 MB string. The
decode starts when the plan is known rather than when the stage mounts (`Canvas.jsx`), so it
overlaps the konva chunk's arrival. An image only an `<img>` can read (an SVG), or a browser
without the worker, is decoded on the page as before.

**The loader reads an image's size from its bytes** (`imageLoader.js`, `createImageBitmap(file)`)
instead of handing the data URL to an `<img>` to read two numbers.

| Opening a sketch | page busy, before → after | freezes after |
|---|---|---|
| `ExampleFloorplan.png`, cold | ≥1.3 s → **39 ms** | none |
| 12 MP phone photo | 3.0 s → **0.8 s** | one, 476–684 ms (the PNG re-encode, §3.1) |
| Letter PDF page | 2.3 s → **0.28 s** | one, 214–226 ms (the PNG encode, §3.2) |

| Reopening saved work in a new session | plan drawn | page busy | longest freeze |
|---|---|---|---|
| One plan, 987×956 | 0.85 → 0.72 s | 0.29 → 0.17 s | 82 ms, as before |
| One plan, 12 MP | 1.5–1.7 → **0.92 s** | 0.86 → **0.23 s** | 491 → 137 ms |
| Four plans, the open one 12 MP | ~1.4 → **0.90 s** | 0.84 → **0.25 s** | 569 → 209 ms |
| …switching to a plan not read back yet | 0.41 → 0.29 s | 0.51 → 0.22 s | 229 → 122 ms |

Drop-to-area is unchanged within run-to-run noise (3.8 → 3.5 s, 5.4 → 5.0 s, 8.4 → 8.9 s): the
same work is done, by the same number of threads. What changed is that none of it holds the page.
One side effect is in the scan's favour — its budget is wall clock, and renders on the page thread
no longer come out of it.

**That the answer did not move** was checked in the browser, where the Node benchmarks cannot:

- The two decodes give the same bytes. An `<img>` drawn to a canvas and `createImageBitmap` drawn
  to an `OffscreenCanvas` were hashed over every pixel for two PNG fixtures, two JPEGs (one
  4032×3024) and a WebP: identical in all five.
- The two paths give the same reading. All ten fixtures were scanned through the worker and
  through `scanOnPage` in one page: the same sizes at the same positions, the same garage and
  level labels, the same `truncated`, on every one.
- The fallback runs. With the worker's constructor made to throw, the scan ran on the page and
  read `ExampleFloorplan5` the same (13 sizes), and the worker was not tried again.

**A bitmap is not a drop-in for an `<img>` when it is drawn smaller.** At full size the two draw
the same pixels; from about half size down they are resampled differently (on line art at
0.375×, 1% of pixels differ by more than 16 levels). So the bitmap is used only where pixels
are looked at, not measured: the stage, the label-placement ink map, and the crop and eraser
tools, which draw at full size. The over-4000 px downscale, the corner snapper and the saved image
still draw from an `<img>`, and their output is unchanged.

`bench:detection` (91/91), `bench:scale` (27/27) and the suite pass; the pipelines' code was not
touched.

---

## 3. Found and left

In order of what each would buy. None is fixed here.

### 3.1 An image over 4000 px is re-encoded as PNG, and a photo's PNG is enormous

`prepareDataUrl` scales anything over `MAX_IMAGE_DIMENSION` (4000) down and re-encodes it as PNG —
deliberately, so a JPEG is not compressed twice. The standard 12 MP phone frame is **4032**×3024:
0.8% over. So a 3.1 MB photo becomes a 22–30 MB data URL, and that string is what the app then
holds, posts to three workers, decodes in each and writes to IndexedDB.

Measured: 410–615 ms of frozen page for the encode — the one freeze left on this path — and ~0.8 s
per decode against ~0.1 s for the JPEG. The same plan at 4000×3000, which is not re-encoded,
loads with **230 ms** of page-thread work and no freeze at all.

Raising the cap to 4096 would let that frame through untouched. It is not done here because the
constant is shared: `scripts/lib/realDraft.mjs` and `sourceLog.mjs` scale the plan-book pages by
it, and their answer keys are in the scaled image's pixels. Give the PDF render its own constant
at the same time, or every PDF page changes size too.

`canvas.toBlob` and `OffscreenCanvas.convertToBlob` were tried as a way to encode off the page.
They produce the same bytes, still block for ~315 ms, and take 1.4 s against 0.4 s. Not a fix.

### 3.2 A PDF page is rendered at 4000 px for pipelines that work at 2600 and 1400

Every page is rendered with a 4000 px long edge (`pdfLoader.js`; a Letter page comes out
3091×4000). The scan then works at `MAX_OCR_DIM` 2600 and the tracer at 1400. Against the same
plan at its native 1017×1324: the scan took 6.0 s rather than 3.8 s (the sparse pass alone 2.7 s),
and the trace 2.4 s. The render and its PNG encode are also the one freeze left on this path.

ROI crops are taken from the full-resolution page, so the size is not free to cut: this needs
`bench:ocr` on PDF inputs, which the fixtures do not include.

### 3.3 The trace takes 2–3 s on plans where a label falls outside the outline

"Finding the outside walls" took 0.25–0.7 s on four of the plans measured and 2.3–3.1 s on three
(`ExampleFloorplan5`, `ExampleFloorplan7`, and the photo of `ExampleFloorplan3`). On the one
inspected, remediation had run an `escalate` pass and rejected it — a second, uncached search for
an answer it did not use. This is worker time, so the page stays live; it is the largest part of
the wait that is not Tesseract.

### 3.4 Two more places still turn a large plan's data URL into pixels on the page

- **The first corner dragged.** `createImageSnapAnalyzer` (`imageSnapper.js`) loads the data URL
  into its own `<img>` and draws it at 1500 px: for a 12 MP plan, ~0.7 s of frozen page the first
  time a corner is grabbed after each image change.
- **Save image.** `exhibit/index.js` has its own `loadImage`, a fresh `<img>` from the data URL,
  every time the dialog renders the plan.

Both could take the cached bitmap and cost nothing. Neither does, because both draw the plan
well under full size, where a bitmap and an `<img>` differ (§2): the snapper's corners and the
saved image's line work would change. Someone has to choose the resampling on purpose.

### 3.5 A plan's undo history stores a second copy of its image

`hist:v1:<doc>` holds the undo stack's image pool, and for a plan whose image was never edited
that pool is one entry: the image, again. Measured on disk: `doc-2::image` 21.73 MB and
`hist:v1:doc-2` 21.73 MB. It doubles what a plan costs against the storage quota, it is read and
deserialised a second time when the plan is opened, and the two copies are separate strings in
memory. A pool entry equal to the plan's own image could be stored as a reference to it.

### 3.6 The start screen shows for a third of a second before saved work replaces it

In a new session the start screen is up at ~0.1 s and the restored plan takes its place at ~0.4 s.
250 ms of the gap is the roll call (`CLAIM_WAIT_MS`), which cannot be shortened: it is how long a
live tab is given to say the workspace is its own. The screen could wait for the restore to settle
instead — a first visit has no workspace to ask about and would not be delayed — but it must not
wait on storage that never answers (§3.8).

The roll call has a second edge. A tab whose page is frozen for longer than 250 ms cannot answer
it, and a new tab opened in that moment adopts its workspace. Before this change a tab reading a
large plan was frozen for longer than that several times a load; now only the PNG re-encode
(§3.1) is.

And one thing that is by design but reads as a hang: with the old tab still open, a new tab
starts empty. The saved work belongs to the tab that is showing it.

### 3.7 The search memo trips on every 4000 px page

`searchMemo` reported `overBudget` at 34.98 MB against the 32 MB budget on the PDF page (working
raster 1082×1400, five entries held). §4.2 of `load-to-area-performance.md` stopped this from
clearing the memo, and its change (3) — a `Uint16` label array, halving the charge — is what
would keep such a page inside the budget. Still open.

### 3.8 A database that will not open costs ten seconds per call, not once

`getDB` (`draftStorage.js`) bounds a hung `indexedDB.open` at 10 s and, rightly, does not memoise
the failure. But a *hung* open is not retried into health: every `getDraft` and `setDraft` starts
its own, and waits its own 10 s. Reproduced here by leaving a `deleteDatabase` pending: the start
screen showed for over 30 s, the restored workspace then arrived over it, and every autosave
after that waited 10 s and fell back to `localStorage` — a synchronous `JSON.stringify` of the
whole plan, 29.7 MB for the phone photo.

Nothing in the app deletes the database, so a user needs a browser fault to get here. Worth
closing all the same: remember that an open is still pending and fail fast until it settles.

### 3.9 Smaller

- The data URL is the image's identity and its transport: every worker request posts the whole
  string, and each worker un-base64s it for itself. A 30 MB plan is decoded in three workers.
  Holding the file's bytes as a `Blob` beside the string would make every one of those free.
- The render when the area lands is 80–230 ms (`fixedTrouble` in `labelLayout.js`, text
  measurement). The one stretch over 60 ms left on a fixture-sized plan.
