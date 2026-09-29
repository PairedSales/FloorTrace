# datasets/

Large external floor-plan datasets live here. Everything in this folder except
this README is git-ignored, so each machine downloads its own copy.

## CubiCasa5K

5,000 Finnish floor plans with SVG ground truth: interior and exterior walls,
doors, windows, and every room typed (bedroom, bath, garage, balcony…).

- Source: https://zenodo.org/records/2613548 (`cubicasa5k.zip`, 5.5 GB), or the
  Kaggle mirror, which is where the COCO files below come from.
- Paper/code: https://github.com/CubiCasa/CubiCasa5k
- License: CC BY-NC-SA 4.0 (non-commercial, share-alike). Fine for measuring the
  tracer; ship nothing derived from it.
- Extract so the plans sit at `datasets/cubicasa5k/cubicasa5k/<category>/<id>/`
  (`F1_original.png`, `F1_scaled.png`, `model.svg`), beside `train.txt`,
  `val.txt` and `test.txt` (4,200 / 400 / 400).

Two measured facts make it a benchmark rather than a pile of pictures:

- **It is to scale.** An SVG unit is one centimetre: every room's own printed
  size (`model.svg` carries it in metres and in feet-inches) divides out to
  100 units/m on 4,968 of the 5,000 plans.
- **SVG coordinates are `F1_scaled.png` pixels.** Walls land on ink 94% of the
  time mapped directly, 61% stretched to the SVG canvas. So `F1_scaled.png` is
  drawn at 30.48 px/ft and every plan has a known area.

`datasets/cubicasa5k_coco/` holds bounding boxes only (walls and rooms as
rectangles, no outlines). Nothing here uses it.

### `npm run bench:cubicasa`

The tracer and the scale selection over these plans, scored against the SVG
truth. The header of `scripts/cubicasaBenchmark.mjs` says what is measured and
how. Every trace gets a verdict — **perfect** (IoU ≥ 97%), **near-perfect**
(perfect once at most two error regions of ≤ 20% of the area are fixed) or
**wrong** — and the error is split into regions by cause: non-GLA space kept,
anything else taken in, living space left out. Each run opens with the
scoreboard from `docs/accuracy-roadmap.md`: those numbers on the listing-like
plans, against their targets.

The corpus is found in this checkout's `datasets/`, else in the main
checkout's (through git's common directory), so worktrees need no copy;
`FLOORTRACE_DATASETS` overrides both. Runs are saved beside the corpus in
`cubicasa5k_runs/`, so a baseline outlives the worktree that measured it.

```
npm run bench:cubicasa -- --watch light-walls              # one failure's examples, in seconds
npm run bench:cubicasa -- --split dev                      # 400 of train, listing-style weighted: the edit loop, ~2 min
npm run bench:cubicasa -- --out mine --compare baseline    # per-plan deltas and verdict moves against a saved run
npm run bench:cubicasa -- --compare baseline --draw-changed # overlays of every plan whose verdict moved
npm run bench:cubicasa -- --draw 20                        # overlays of the 20 worst plans
npm run bench:cubicasa -- --boundary '{"autoGarage":false}' # try an option before coding it
```

Overlays tint the app trace's error by cause: blue non-GLA kept, red anything
else taken in, yellow living space left out, grey space the answer key does
not decide; truth green, app red, bare orange.

Iterate on a watch list and `dev`, confirm on `train` and `val`, and run
`test` only at milestones, so the test numbers stay an honest measure. Read
results by category: most plans (`high_quality_architectural`) are
architectural sheets with neighbouring flats on the page and wet rooms drawn
as tile grids, while `colorful` and `high_quality` are the closest thing here
to a listing floor plan.

#### The answer key

`buildTruth` in `scripts/lib/cubicasa.mjs` turns each `model.svg` into the
living area a US appraiser would count. Its rules are versioned
(`TRUTH_VERSION`, recorded in every run); `--compare` refuses a baseline scored
under another version.

- Living area is every room plus the walls within reach of one, to their outer
  face.
- Non-GLA: outdoor space, garages and carports, and anything the annotators
  typed as a room but named as outdoor space (PARVEKE, TERASSI, KUISTI, PIHA,
  PATIO, LASITETTU…); sheds and woodstores; and a storage room, sauna or
  boiler room with no other room within a wall's reach, which is an
  outbuilding.
- Rooms the annotators never typed (`Undefined`) are scored neither way: some
  are rooms, some glazed terraces. A plan more than half untyped is skipped.
- Also skipped: plans whose walls do not land on the drawing's ink
  (misregistered), and plans listed under `exclude` in
  `scripts/lib/cubicasaReview.json`, each with the reason a person gave.

`cubicasaReview.json` also holds the **watch lists**: plans that show one
failure, found by looking at overlays, for a fix to be tried on first. Add to
both as you review; keep test plans out of them.

## Real plans: `npm run bench:real`

The same scoreboard on real listing plans, where the answer key is an outline a
person checked. To add one:

1. Open the plan in FloorTrace and let it scan and trace.
2. Correct each outline to the exterior face of the walls, and set its type:
   GLA (or Below grade) for the building, Garage or Porch/patio for non-GLA
   space. Unfinished outlines are not scored.
3. Save the project (`.floorplan`) into `datasets/real/`.

`npm run bench:real` replays the app's own trace on each saved plan, with the
labels its scan read, and judges it against your outlines (a plan still
holding the app's untouched trace has no key yet and is listed, not scored); `--draw` writes an
overlay per plan and `--compare` shows verdict moves. `--fixtures` adds the
plans in `fixtures/` that have polygon truth — but those are the plans the
tracer was developed on, so only fresh plans are a fair test. Listing plans
belong to whoever drew them: keep them in `datasets/real/`, which git ignores.

### The set so far

75 pages of 17 US house-plan books, 1914 to 1963, each named for its book, its
year and its place in the book (`aladdin62-n15`). Most are one storey; 57 have
a garage or carport, 70 a porch, patio or terrace, and 23 draw two levels side
by side. They are plan-book pages, not listing sketches, so drives, planting
and terraces are drawn around the house. Drawings in the extruded 3D style,
walls drawn as raised blocks, are left out: no listing plan is drawn that way.

The outlines follow these conventions:

- To the exterior face of the walls. A wall the house shares with its garage
  belongs to the house.
- Porches, patios, terraces, decks, stoops and breezeways are Porch/patio;
  carports and garage storage are Garage; a lower level is Below grade.
- Eave storage behind knee walls, chimney masses and space the drawing does not
  decide are Unfinished, so not scored. Steps, planters and walks are not
  outlined.

**None has been checked by a person yet.** Claude drew every key, and each file
says so in its `answerKey` record (`by: "Claude (draft for review)"`, with notes
on the judgment calls). Check a plan by opening it in FloorTrace, correcting it
and saving it: the app does not write that record, so a plan saved from the app
no longer claims to be a draft.

### Drafts from images

```
node scripts/realDrafts.mjs PLAN.jpg [--name NAME] [--crop X,Y,W,H]
```

writes the `.floorplan` the app would save after scanning the image: the labels
it reads, the rooms that set the scale, the scale, and the app's own trace,
ready for its outlines to be corrected. Each step is the app's own code; the
scan is the Tesseract path, without the browser's PaddleOCR rescue. It makes
the set's first drafts exactly as they were made. The image is held as the app
would hold it: a crop (in the page's pixels) is cut as the app's crop tool cuts
it, and a side over 4000 px is scaled to fit, as the app's loader scales it.
The draft records its `source`: the image, the crop and the size they came
out, which is the size its key will be drawn on.

### Moving keys without their plans

A plan is a megabyte of image; its key is a few hundred bytes. A session that
can only upload small files to where the set is kept hands its keys over in one
file:

```
node scripts/realKeys.mjs export   # every key and its record -> datasets/real/answer-keys.json
node scripts/realKeys.mjs apply    # that file into the plans in datasets/real/
```

`apply` gives a plan still holding the app's untouched trace its key and record.
A plan whose outlines a person corrected differently is kept and listed;
`--force` replaces it. It also repairs the first drafts, which the app refused
to open for their trace record (`lastTraceOutcome.level: null`).

The keys file also carries each plan's `source`: a URL, or a file under the
folder, with its crop and its size. `apply` makes a plan the folder does not
have yet from its source before writing its key, so the set grows by that file
rather than by its images. An image of any other size is refused, since the
key is coordinates on it.
