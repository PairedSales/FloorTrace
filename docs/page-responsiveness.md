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

### After the plan is open

Measured in a second pass, on the 12 MP plan, once the first changes were live.

| Action | page frozen | What it is |
|---|---|---|
| Open Save image | ~1.0 s | 533 ms `img.src = dataUrl`, 265–297 ms the decode on first draw, ~180 ms encoding the page for the share sheet |
| Change an option in that dialog | ~0.18 s | the share-sheet encode again, on every render |
| One eraser stroke | 0.58–0.62 s | `canvas.toDataURL` of the whole plan, per stroke (a crop is the same call) |
| Grab a corner for the first time | ~0.7 s | the snapper's own `<img>` from the data URL, and its decode |
| Undo | 46 ms | nothing: the bitmap is still in the cache |

**The first visit over the network is not part of the problem here.** On the live site, on this
connection, the engines a first scan needs — Tesseract's core (1.45 MB), its language data
(2.87 MB) and OpenCV (3.90 MB) — came down in 0.13–0.22 s each. That is 8.2 MB, so about seven
seconds on a 10 Mbit line; the scan waits at most 1.5 s for OpenCV and then reads without it.

### The usual workflow: a pasted snip, and four plans at once

The owner's inputs are snips pasted with Ctrl+V and images dropped on the page — fixture-sized
plans, about 1000–1500 px. PDFs and photographs are secondary. These were measured after the
changes in §2, so they are the state of things now, not a before.

| What | time | page thread |
|---|---|---|
| A snip pasted (987×956) | 2.6 s to its area | 0.36 s busy, longest stall 62 ms |
| A snip pasted (1440×1080) | 1.8 s | 0.16 s busy, longest stall 72 ms |
| Four plans dropped together | 19.3 s for all four: 3.2, 2.4, 6.2, 6.5 s | 1.5 s busy over the 19, longest stall 188 ms |
| The site closed and reopened, four plans saved | workspace back at 0.45 s, stage up at 0.8 s | 0.47 s busy, longest stall 140 ms |
| Switching to a plan for the first time after reopening | panel at ~35 ms, drawn at ~0.2 s | 30–360 ms busy |
| Switching back to one already open | drawn at ~0.13 s | under 0.13 s busy |

(Dev build for the first three, so React's share is several times what ships; production for
the rest.) Plans are read one after another when several arrive together, by design: the scan's
budget is wall clock, and two at once would each read fewer sizes.

Nothing is read or traced again on reopening: the four areas came back as saved (1,899, 1,313,
2,199 and 1,991 ft²). Four plans are 2.8 MB on disk, 1.0 MB of it the second copy of each image
in its undo history (§3.6).

**Where the time goes now is the outline, on some plans.** Of those four, "Finding the outside
walls" took 0.46 and 0.56 s on two and 2.8 and 2.9 s on the other two — nearly half their
total. §3.3 has why.

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

**What still needs an `<img>` loads it from the image's bytes** (`loadImageElement` in
`imageCache.js`). The decode worker hands back the bytes it fetched along with the bitmap; the
saved image and the corner snapper load their `<img>` from a `blob:` URL of them instead of from
the data URL, which the page then never parses again. Same `<img>`, same pixels — checked at four
scales on three images, on both kinds of canvas — so nothing either of them produces changes.
The dialog also asks whether there is a share sheet before encoding the page for it.

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

| After the plan is open (12 MP) | page frozen, before → after |
|---|---|
| Open Save image | ~1.0 s → **0.27 s** (the decode on first draw is what is left) |
| Change an option in that dialog | ~0.18 s → 0 where there is no share sheet; unchanged where there is |
| Grab a corner for the first time | ~0.7 s → ~0.23 s (not driven; from the same two costs) |

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

**On the live site**, after the deploy: the sample plan reads the same (9 room sizes, 1,899 ft²)
in 2.8 s, the scan and the decode run in their workers, the on-page fallback is never fetched,
and the page's longest stall across the whole run was 57 ms.

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

### 3.3 The second-chance trace costs 1.2–2.1 s, on four fixtures in ten

This is the largest wait left in the usual workflow, and it is worker time: the page stays live.

The first search is cheap, because the prewarm has already climbed its ladder: 0.2–0.33 s. When
a label the scan located falls outside the outline it finds, remediation runs an `escalate` pass
— the ladder to twice the radius, with every rescue forced — and that pass is a cold search of
about 45 rungs. Reproduced in Node on the app's own path (the scan's labels, the rooms measured
from them, then the trace, with the browser's `cacheKey` and prewarm):

| Fixture | first search | with the second pass | second pass | its result |
|---|---|---|---|---|
| `ExampleFloorplan3` | 324 ms | 2424 ms | 2.1 s | kept |
| `ExampleFloorplan4` | 242 ms | 1400 ms | 1.2 s | thrown away |
| `ExampleFloorplan5` | 198 ms | 2121 ms | 1.9 s | thrown away |
| `ExampleFloorplan7` | 330 ms | 2339 ms | 2.0 s | kept |

The other six trace in 33–456 ms and never run it.

Three things about it:

- **`bench:detection` cannot see it.** Its constrained pass prints "no retry needed" on every
  fixture: the truth file's rooms never leave a label outside. The scan's labels do, on four of
  the ten. So the gate that guards the tracer's time has never timed this pass, and the 60 s
  ceiling the detection suites are held under says nothing about it either.
- **It re-measures what the first search measured.** The pass regenerates every candidate from
  nothing. Its welded ladder's first eight or nine rungs, and the structural ladder's, are the
  same masks at the same radii the first search closed, flooded and labelled moments before —
  17–19 of its ~45 rungs. `measureFootprint` is a pure function of the mask and the radius, so
  handing the first search's rungs to the pass is exact, and worth an estimated 0.5–0.8 s.
- **The memo cannot hold it.** `ExampleFloorplan3`, `4` and `5` all trip the 32 MB search budget
  (34–36 MB charged); holding everything `ExampleFloorplan5` computes would take 101 MB. Each
  kept rung is charged for a page-sized `Int32` label array where one bit per pixel would say
  the same thing. Until that is smaller, neither a bigger budget nor running the pass ahead of
  time during the scan is affordable — a budget of 128 MB was tried and changed nothing, because
  the pass is not what the memo was holding.

Any change here is a detection change: output-identical or not at all, and the proof has to come
from a harness that runs the app's path, since the benchmark does not reach this code.

### 3.4 Every eraser stroke and every crop re-encodes the whole plan on the page

`handleEraserMouseUp` and the crop commit end in `canvas.toDataURL(imageMimeType)`: the full image,
synchronously, once per stroke. 0.58–0.62 s for a 12 MP PNG; a clean PDF page is nearer 0.2 s.
Whiting out a legend in five strokes is three seconds of frozen page.

The encode cannot simply be moved: the data URL *is* the image the store holds, the eraser's next
stroke compares against it (`work.out`), and undo snapshots it. Doing it off the page means the
image the app holds is briefly not the one on screen, and every one of those has to be taught
that. It is the strongest case for the last item on this list.

**It is also lossy on a JPEG plan.** `imageMimeType` is the file's, so a JPEG is re-encoded as a
JPEG. Measured on a 1600×1200 JPEG after one stroke in the far corner: the stored image was a
JPEG again, and in an 800×600 region nowhere near the stroke a third of the pixels had changed
(mean 0.38 levels, max 8). Small — but it is the second generation of ringing that
`imageLoader.js` goes out of its way to avoid for an oversized image, and here it is applied to
the whole plan on every edit session. Encoding edits as PNG ends it, at the price of the size and
the time in §3.1.

### 3.5 The decode on first draw is still on the page for the saved image and the snapper

What is left of two rows above: ~0.27 s when Save image opens on a 12 MP plan, ~0.23 s on the
first corner grabbed. Both draw the plan well under full size from an `<img>`, and an `<img>`
decodes on first draw. A bitmap would not — but it is resampled differently at that size (§2), so
the saved image's line work and the snapper's corners would change. Someone has to choose that
on purpose.

### 3.6 A plan's undo history stores a second copy of its image

`hist:v1:<doc>` holds the undo stack's image pool, and for a plan whose image was never edited
that pool is one entry: the image, again. Measured on disk: `doc-2::image` 21.73 MB and
`hist:v1:doc-2` 21.73 MB. It doubles what a plan costs against the storage quota, it is read and
deserialised a second time when the plan is opened, and the two copies are separate strings in
memory. A pool entry equal to the plan's own image could be stored as a reference to it.

### 3.7 The start screen shows for a third of a second before saved work replaces it

In a new session the start screen is up at ~0.1 s and the restored plan takes its place at ~0.4 s.
250 ms of the gap is the roll call (`CLAIM_WAIT_MS`), which cannot be shortened: it is how long a
live tab is given to say the workspace is its own. The screen could wait for the restore to settle
instead — a first visit has no workspace to ask about and would not be delayed — but it must not
wait on storage that never answers (§3.9).

The roll call has a second edge. A tab whose page is frozen for longer than 250 ms cannot answer
it, and a new tab opened in that moment adopts its workspace. Before this change a tab reading a
large plan was frozen for longer than that several times a load; now only the PNG re-encode
(§3.1) is.

And one thing that is by design but reads as a hang: with the old tab still open, a new tab
starts empty. The saved work belongs to the tab that is showing it.

### 3.8 The search memo trips on ordinary plans, not only large ones

`searchMemo` reported `overBudget` at 34.98 MB against the 32 MB budget on the PDF page (working
raster 1082×1400) — and at 34–36 MB on `ExampleFloorplan3`, `4` and `5` at their own size, none
of them over 1.2 megapixels on a side that matters. §4.2 of `load-to-area-performance.md` stopped
a trip from clearing the memo, which is why the first search is still warm on those plans. Its
change (3), a smaller label array, is the same thing §3.3 ends on.

### 3.9 A database that will not open costs ten seconds per call, not once

`getDB` (`draftStorage.js`) bounds a hung `indexedDB.open` at 10 s and, rightly, does not memoise
the failure. But a *hung* open is not retried into health: every `getDraft` and `setDraft` starts
its own, and waits its own 10 s. Reproduced here by leaving a `deleteDatabase` pending: the start
screen showed for over 30 s, the restored workspace then arrived over it, and every autosave
after that waited 10 s and fell back to `localStorage` — a synchronous `JSON.stringify` of the
whole plan, 29.7 MB for the phone photo.

Nothing in the app deletes the database, so a user needs a browser fault to get here. Worth
closing all the same: remember that an open is still pending and fail fast until it settles.

### 3.10 Underneath, and not measured

- **The data URL is the image's identity and its transport**, and most of what is left on this
  list is that one fact: every worker request posts the whole string, each of three workers
  un-base64s it for itself, an edit has to produce a new one synchronously (§3.4), and a draft
  stores it twice (§3.6). Holding the image as its bytes — a `Blob`, with the data URL made only
  for a `.floorplan` file — would take all of those away at once. It is a change to what `image`
  is throughout the store, undo, drafts and the workers, not a patch.
- Not measured: memory with several large plans open (a 12 MP plan is 48 MB decoded, held once on
  the page and once in each worker that has it), a multi-page PDF from start to finish, a slower
  machine than this one, Safari and Firefox, and a visible tab.
- The render when the area lands is 80–230 ms (`fixedTrouble` in `labelLayout.js`, text
  measurement). The one stretch over 60 ms left on a fixture-sized plan.
