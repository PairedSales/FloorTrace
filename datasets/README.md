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

### Splits, the manifest and the run files

The set is split into `dev`, which engineers tune against, and `test`, which
nobody tunes against. Whole books, publishers and builders go to one split, so
`test` measures drawing styles the tracer was never tuned on. The split, each
plan's era and a fingerprint of its key are recorded in the manifest, and every
scoreboard number names the manifest it was measured under.

**The manifest** is `orchestration/manifest.json` in the set folder, so
`datasets/real/orchestration/manifest.json` (a run's `--dir` moves it with the
folder). Version 1:

```json
{
  "version": 1, "seed": 20260928, "createdAt": "2026-…",
  "plans": {
    "aladdin62-n15": {
      "book": "aladdin62", "publisher": "Aladdin", "era": "vintage", "decade": 1960,
      "split": "dev",
      "source": {"url": "…", "crop": [0, 0, 1200, 900], "size": [1200, 900]},
      "keySha256": "<64 hex digits>",
      "annotation": {"annotators": ["A", "B"], "agreement": {}, "adjudicated": false,
                     "verifiedBy": "blind double annotation",
                     "checked": {"by": "AI review", "at": "…", "via": "final review"}}
    }
  }
}
```

`bench:real` reads four fields and leaves the rest to whoever writes the
manifest: `split` (`dev` or `test`) and `era` (`vintage` or `2020-2022`), both
required, since a mistyped one would drop a plan from every run without a word;
`keySha256`, the SHA-256 of `JSON.stringify(key)` where `key` is what
`keyOf(state)` returns (`scripts/lib/realKeys.mjs`), and `book`. A file that is
not JSON, or of another version, is refused with the reason. The **manifest
hash** is the SHA-256 of the file's bytes: any edit, of a field the benchmark
reads or not, is a new manifest. `orchestration/watch.json` holds the watch
lists, `{"lists": {"<mechanism>": ["plan", …]}}`. The code is
`scripts/lib/manifest.mjs`.

`keySha256` guards the key and only the key: a plan whose outlines were edited
after the manifest froze them is not scored. It does not cover the plan's image,
its scanned labels or its scale, so a plan rescanned or recalibrated after the
freeze moves its score without tripping the check. A plan with no `keySha256` is
not checked at all, and the run says how many (`key check: 3 of 75 manifest
plans carry no keySha256, so their keys are not checked`).

**The test-split rule.** Nobody tunes against `test`. Only the orchestrator runs
it, at milestones, and reads aggregates only. `--split test`, `--split all` and
naming a test plan with `--only` refuse to run (exit 2) unless the environment
variable `FLOORTRACE_TEST_SPLIT_OK=1` is set, which is the orchestrator's alone.
A run that includes test plans prints no line about any one of them, draws no
overlay for it, and keeps its per-plan results out of the main run file (below);
an engineer who needs a test number asks for the aggregate.

#### `bench:real` options

```
npm run bench:real -- [--split dev|test|all] [--only NAME,NAME…] [--watch LIST]
                      [--jobs N] [--out NAME] [--compare NAME] [--draw]
                      [--dir PATH] [--manifest PATH] [--fixtures]
```

- `--split`: which plans, read from the manifest. The default is `dev` when a
  manifest exists and `all` when there is none (every plan in the folder, as
  before; a split cannot be named without a manifest). `all` with a manifest is
  dev and test. A plan in the folder but not in the manifest is never scored:
  it is listed as "not in the manifest". A plan the manifest lists and the folder
  lacks is an ERROR row. `--split dev` does not open a test plan's file.
- `--only A,B`: exactly these plans, by name (repeat the option or use commas).
  Without `--split` a plan is taken from whichever split it lies in; with one,
  it must lie in that split. A name the manifest does not know, or the folder
  does not hold, is an error.
- `--watch LIST`: the plans of a list in `watch.json`, within the chosen split.
  An unknown list, or a plan in it nobody has, is an error. With `--only`,
  both must hold.
- `--jobs N` (default 1): plans are shared out over N worker processes (the
  same script started with `--worker`). The results, their order and the run
  file are those of a serial run, apart from `ms`: `node scripts/realRunDiff.mjs A B`
  compares two run files that way. Timings taken with N > 1 ran under parallel
  load and the output says so. A worker that dies is reported as an ERROR row
  for the plan it was on and replaced; the run goes on. `--draw` works.
  `realRunDiff.mjs` exits 2, not 0, when either file holds no results: two
  empty or wrong files are not "identical".
- `--manifest PATH`: another manifest, with `watch.json` beside it (for tests
  and scratch sets). It must exist: a manifest that was named and is not there
  is an error (exit 2), never a run without one, which would have no split and
  no test-split gate. `--dir` moves the folder, and with it the default
  manifest. A `--dir` with no `orchestration/manifest.json` beside it runs every
  plan in it, as before, with one exception: if the set's own manifest
  (`datasets/real/orchestration/manifest.json`) calls any of its plans `test`,
  the run is refused (exit 2, saying how many, not which) until `--manifest`
  names the set's manifest, so a copy of the set without its manifest is no way
  around the split.
- `--compare NAME`: the verdict moves against an earlier run, refused (exit 2,
  before the run, with no override) when that run was measured under another
  manifest hash. A run made before manifests, or with none, has hash `null`,
  and two of those compare. When both runs held test plans, the test split's
  aggregate delta is printed, and nothing per plan.
- An unknown option is an error. Exit codes: 0; 1 when any plan ended as an
  ERROR row (a crashed worker, a key changed since the manifest, a plan missing
  from the folder); 2 for a request refused.

A plan in the manifest whose key no longer hashes to its `keySha256` is not
scored: `ERROR key changed since the manifest (was ab12cd34, is ef56ab78)`, or
`is none` when the plan holds only the app's own trace again. A key is changed
only by a dispute (`orchestration/disputes.md`), which writes a new manifest.

#### The output and the run file

Every run begins with the line that names it: `bench:real  commit 9d212fb+dirty
split dev  manifest 3fa9c1d2e4b7  plans 250  jobs 8` (`+dirty` when the working
tree differs from the commit; the manifest hash is 12 of its 64 digits). After
the overall scoreboard come the mean error by cause (non-GLA space kept, other
space taken in, living space left out), the median and 90th-percentile trace
time (`app` and `bare`), then, when there is a manifest, a scoreboard for each
era (`vintage`, `2020-2022`, the latter shown as "0 plans" while it is empty)
and, when the run holds both splits, one for each split. Test-split
scoreboards are aggregates.

`datasets/real_runs/<out>.json` holds `meta`, `results` and, when test plans ran,
`testAggregate`. `meta` is `{date, dir, commit, dirty, split, only, watch,
manifestHash, jobs, timing}` with the full manifest hash and `timing` =
`{app: {median, p90}, bare: {median, p90}, plans, jobs, parallel}` in ms. In the
main file `only` lists the open plans that `--only` named, plus an `onlyTest`
count when it also named test plans (`watch` is a list's name, which names no
plan); `<out>.test.json` keeps the whole `only`.
`results` holds every non-test plan (scored, skipped, or ERROR). `testAggregate`
holds the test plans' scoreboard counts and shares, mean error by cause, timings,
error and skip counts, and the same for each era: no plan name. The per-plan test
results go to `<out>.test.json` (`{meta, results}`), written only when test
plans ran and never read by `--compare`. A `<out>.test.json` left by an earlier
run of the same name is not removed, so name the milestone runs. `--draw`
overlays go in `real_runs/<out>/`, none for a test plan.

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
