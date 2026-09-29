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
- Space the sheet itself labels as future, expansion or unfinished (an
  "expansion attic" drawn with a suggested layout) is Unfinished, not GLA: the
  drawing says the space is not finished, whatever layout it suggests.
- A chimney or fireplace mass that protrudes beyond the wall face is an
  Unfinished outline of its own, and the GLA edge stays on the wall face across
  it. A hearth inside the room is GLA. (Two independent annotators split on
  whether to outline a 12 sq ft chimney at all, so `compare` does not let one that
  small decide agreement: below.)
- A bay or bow that encloses floor area at floor level is inside the GLA
  outline. A glazed unit drawn proud of the wall with no wall band under it (a
  window box, a greenhouse window) is not.
- Unfinished space shares boundaries with its neighbours and does not overlap
  scored outlines: it stops where the GLA, Garage or Porch outline starts
  (`["ref", k, i]` vertices make the boundary exactly shared).

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

### Sourcing plans (`realSource`)

```
node scripts/realSource.mjs COMMAND ...       # --help prints the manual
```

Finds the pages a set grows from, on archive.org only: house-plan books (vintage
plans) and Wayback Machine captures of house-plan and builder sites (2020 to
2022). A sourcer looks through a book with `meta`, `contact` and `grid`, drafts
each plan with `realDrafts.mjs` from the page's URL, and records it with `log`.
Every command that writes a file prints its absolute path.

| Command | What it does |
|---|---|
| `search QUERY [--rows N] [--year FROM-TO] [--page N] [--sort "downloads desc"] [--raw]` | archive.org advanced search over texts. Plain words must all be in the title or subject (`house plans` is searched as `title:(house AND plans) OR subject:(house AND plans)`: typed as is, archive.org matches any word anywhere and the first hits are memos that mention a house). Lucene syntax (a quote, `field:`, parentheses, `AND`/`OR`/`NOT`) and `--raw` are sent as typed. Prints the query sent, then identifier, year, leaf count (blank where the search lacks it; `meta` counts), title, creator, and `[borrow-only]`. A query archive.org cannot parse (`title:(`) is answered with HTTP 200 and `{"error": ...}`: the command fails with that message and caches nothing, so it is never read as "no results". |
| `meta ID` | Title, year, publisher, **leaf count**, collections, and whether **anyone can view the pages**: the `access-restricted-item` flag, the lending collections, and a test of one page image about 40% into the book (it says which leaf, the URL and what came back, and keeps the page). Prints the page URL pattern `https://archive.org/download/ID/page/n<leaf>`. **Exits 1 if the pages are not viewable**, with the reasons; a borrow-only item answers a page with 403. |
| `leaf ID N [--ext jpg]` | Downloads leaf N (or takes it from the cache): prints its path, its pixel size (a full-resolution page is about 4,000 by 6,000) and the source URL to record. Leaves are numbered from 0. **A leaf past the end of a book is not an error to archive.org**: it answers `page/n<k>` for any k with HTTP 200 and the last page's image. So when the book's leaf count is in the cache (`meta ID` puts it there), `leaf`, `contact`, `grid ID:LEAF` and `screen --leaves` refuse or skip a leaf at or past it and fetch and cache nothing (`contact` skips those leaves with a `WARNING` and draws the rest); with no cached count they say so in a note, and `meta ID` fixes that. |
| `contact ID FROM TO [--step S] [--cols C] [--rows R] [--tag T]` | A **contact sheet** PNG of leaves FROM to TO (every S-th), each shrunk to a cell and labelled with its leaf number: 12 to a sheet by default (4 across, 3 down, about 1,600 px each way), more sheets when more leaves are asked for, at most 96 leaves a call. It is how a plan page is found fast. A leaf that cannot be fetched is marked in its cell. Uses the cache, so a second call costs no requests. |
| `grid IMAGE\|ID:LEAF [--crop X0,Y0,X1,Y1] [--grid STEP] [--tag T]` | The key tool's `view` (grid labelled in the page's own pixels on all four edges), for choosing a crop from a page or a cached leaf (`ID:LEAF` fetches the leaf if it is not cached). Read crop coordinates from views of 300 to 500 px with a grid of 10 to 25 px, never from a whole page. Prints the PNG's path, then `crop x0,y0→x1,y1  scale N px/px  grid S`. |
| `screen ID [--samples 5] [--leaves n1,n2,...]` | Runs the app's own scan (`scanImage` of `realDraft.mjs`, the Tesseract path) on pages spread through the book, and prints the labels read per page and per book. |
| `cdx URL_PREFIX [--from 2020] [--to 2022] [--mime image/] [--status 200] [--collapse urlkey] [--limit N] [--match prefix\|exact\|domain] [--min-length BYTES] [--pattern REGEX]` | Wayback CDX search. Prints each capture's timestamp, mime type, length and original URL, and under it the **original-bytes URL** `https://web.archive.org/web/<timestamp>id_/<original>`, which is what a modern plan records as its source. Defaults are the project's: captures of 2020 to 2022, status 200, images. `--collapse urlkey` keeps one capture per URL. `--pattern` is a regular expression on the original URL, host included. `--min-length` drops small rows (thumbnails); the index cuts at `--limit` before that filter, so the command reads 10 times the limit (`--scan N` changes it) and keeps what passes. |
| `fetch URL [--name N]` | Downloads any archive.org URL (an `id_` capture URL, a page URL) into the cache; prints its path, mime type and pixel size. A response that is not an image (a login page, an error page, JSON) is refused and nothing is cached. `--name` also keeps a copy as `named/N.<ext>` (never over a different image). |
| `log plan\|reject\|book ...` | Appends an event to the sourcing log (below). |
| `report` | Rewrites `sources.md` from the log and prints the counts per book or site and per era, and every cap broken: a book, name stem or `--unit` over 12 plans (with the spellings it was typed as), a site over 60. |

**`screen` is for finding, never for dropping.** The label count may help find
books that print their room sizes in type. It must never be used to drop a page
that qualifies: pages the app reads badly are the point (integrity rule 6: the
dataset is chosen blind to the tracer). The command prints this warning before
and after its result. It runs one scan at a time on the machine (a lock in the
cache folder), because a scan that loses a CPU race drops labels silently: never
run it beside a benchmark or a draft. Tesseract's own messages appear between
its lines.

**The rules of the road** are enforced by the code, not requested.

- *Only archive.org.* Every fetch, and every redirect it follows, must be to
  `archive.org` or a subdomain of it (`web.archive.org`, `ia801505.us.archive.org`).
  Any other host, a URL with credentials or a port, or a redirect off the list is
  refused with a message, and no request is made.
- *One request at a time, machine-wide.* A lock file in the cache folder is held
  for each request, so two agents running the tool at once cannot fire two
  requests together. It waits 1,000 ms after the last request to
  `web.archive.org` and 300 ms after one elsewhere. A 429, a 5xx, a timeout or a
  body cut short backs off (`Retry-After` honoured, otherwise 2 s and doubling to
  a minute); the wait is recorded beside the lock, so every process keeps it. After
  four tries, or when the server asks for more than two minutes, the command fails
  with a message. A lock whose process has died, or that is over five minutes old,
  is taken over; a normal exit or a signal releases it. A process waiting for the
  lock sleeps between looks (it never spins), and fails with a message after about
  six minutes, or after 30 seconds of being unable to create the lock file or move
  a stale one aside (Google Drive or an antivirus holding it: the cache folder is
  on Drive). A trailing dot on the host (`web.archive.org.`) is the same host, with
  the same gap and the same cache entry. `realDrafts.mjs` (and
  `realKeys.mjs apply`) fetch an archive.org URL through the same client, so a
  draft neither fires beside another request nor downloads a page `leaf` already
  holds; a URL on any other host is fetched as it always was.
- *Nothing is fetched twice.* Pages are cached under `datasets/archive-cache/`
  of the main checkout, whatever worktree runs the tool (git ignores it):
  `items/<id>/n<leaf>.jpg` for a page (`page/n12` and `page/n12.jpg` are one
  entry), `urls/<hash>.<ext>` for any other URL, `named/`, and `api/` for search,
  metadata and CDX answers, kept a day (`--refresh` asks again). An entry counts
  only if its file is non-empty and starts with an image's magic bytes, so an HTML
  error page is never cached as an image, and one found there is fetched again.
  A process that waited for the lock looks in the cache again before it asks, so
  two agents wanting one page at once download it once.
- *What it writes.* The cache, `datasets/zz-scratch/views/<TAG>/` of the checkout
  (`contact` and `grid`; use your own tag), and the set folder's `orchestration/`
  (`log`, `report`). Writes retry while Google Drive holds a file. It never
  deletes anything.

`FLOORTRACE_ARCHIVE_CACHE` and `FLOORTRACE_REAL_DIR` point the cache and the set
folder somewhere else (a scratch run of `log`). `FLOORTRACE_SOURCE_GAP_WAYBACK_MS`
and `FLOORTRACE_SOURCE_GAP_MS` set the gaps; `FLOORTRACE_SOURCE_TRIES`,
`_TIMEOUT_MS`, `_BACKOFF_MS`, `_BACKOFF_MAX_MS` and `_MAX_WAIT_MS` the retries;
`FLOORTRACE_SOURCE_LOCK_WAIT_MS` and `_LOCK_FAULT_MS` how long a process waits for the lock;
`FLOORTRACE_SOURCE_TRACE=1` prints when each request began and ended, to see that
two processes never overlap.

**The log.** `log` appends one JSON object per line to
`datasets/real/orchestration/sources.jsonl` under a lock (sourcers log at once)
and regenerates `sources.md` beside it: plans by book or site with their leaf or
URL, crop, size, labels and builder line, then the rejected pages and their
reasons, then totals. The three events:

```
node scripts/realSource.mjs log plan --name NAME --book BOOK --era vintage|2020-2022 --year YYYY --url URL \
  --crop X,Y,W,H --line "<the builder line realDrafts printed>" [--publisher P] [--leaf L] [--size W,H] [--decade D] [--tag T] \
  [--unit CODE] [--site NAME] [--replace] [--no-verify]
node scripts/realSource.mjs log reject --book BOOK (--leaf L | --url URL) --reason REASON [--tag T]
node scripts/realSource.mjs log book --book BOOK [--id ID] [--publisher P] [--year Y] [--leaves N] [--note "..."]
```

- A `plan` line is `{event, at, name, book, publisher, era, year, decade, leaf,
  url, crop: [x,y,w,h], size: [w,h], unit, site, labels, scale, cutOff, line, tag}`; labels,
  cut-off regions and scale are read from the builder line. It is refused
  unless: the name is `<book><yy>-n<leaf>[a|b]` (vintage) or `<site><yy>-<plan id>`
  (modern), with `yy` the year's and the leaf the `--leaf`; era and year agree
  (a modern year is 2020 to 2022, and `--url` is the capture's
  `https://web.archive.org/web/<timestamp>id_/...` in that year); `--crop` is four
  whole numbers; `--url` is on archive.org; and the name is new. `--replace` logs
  a plan again and marks the old line `superseded` (it stays in the file). When
  the plan is in the set folder, its recorded source (URL, crop, size) must match
  the log (`--no-verify` skips that); `--size` defaults to what the plan records.
  A plan under about 1,000 px across, cut-off regions, no labels or no scale
  print a `WARNING` and are still logged.
- **One book, one spelling.** The 12-plan cap is only as good as the count, and
  many sourcers log at once. So `--book` must look like the name's stem
  (`pacific25` for "Pacific 1925": it holds the stem's letters, or they are its
  initials) or name a `log book` entry (log the book first when the stem is an
  abbreviation, `hpn21` for "houseplans.net"); and a stem already logged under one
  spelling is refused under another. A vintage `--leaf` at or past the book's leaf
  count (the cached metadata, else the latest `log book --leaves` for that item or
  book) is refused: archive.org answers such a leaf with the last page, so the entry
  would name a page that is not there.
- **The caps.** At most 12 plans from one *unit* and no site above 60. The unit is
  the book (the exact `--book` text), the name's stem, or `--unit`: the designer
  code of a plan on an aggregator site such as houseplans.net (its designers draw
  in different styles), scoped to its site, so 12 plans from designer 940 and 12
  from designer 110 of one site are fine. A plan with a `--unit` does not count
  toward its `--book`'s 12. `--site` (default: the book) groups a site's plans for
  the cap of 60. `log plan` prints a `WARNING` when a plan takes its book, unit or
  site over a cap (the lock makes the count exact, whoever else is logging), and
  `report` prints every violation.
- A `reject` needs one reason from a closed list: `3d`, `elevation`, `site-plan`,
  `too-small`, `hand-lettered`, `not-us-home`, `duplicate-house`, `not-a-plan`, or
  `other:<text>`. **How well the app traces a page is not on the list**, and an
  `other:` text about the tracer, the scan or the labels is refused: a page
  qualifies before it is drafted, never by how the app handles it (integrity rule
  6). A `book` line names a book or site looked at, for the report's headings.
- `report` lists every cap broken: a book, a name stem or a `--unit` over 12
  plans (with the spellings it was typed as when there are several), a site over
  60.

**Exit status.** 0 on success; 1 for a well formed request that fails (the network,
a refused URL, a book whose pages are not viewable, a log entry the validators
refuse), with one line saying why; 2 for a command line that cannot be read: an
unknown command or option, a missing argument, or a value of the wrong form
(`cdx --from soon`, `--match banana`, `grid --crop 1,2,3`, a bad `--tag`).

### Drawing and checking keys (`realKeyTool`)

```
node scripts/realKeyTool.mjs COMMAND ...      # --help prints the manual
```

An answer key is drawn from crops of the plan at full zoom, written down
roughly, and snapped to the outer face of the wall band the ink shows. The
picture tool that shows an agent an image shrinks a whole page and loses the
wall faces, so coordinates are read only from `view` crops of 300 to 500 px with
a grid of 10 to 25 px, and whole-page views are for seeing what the plan
contains. The tool's header comment is its manual and is kept accurate; this is
the map of it.

**An annotator's round.** `blind NAME` writes the packet (below). `view` the
packet's image in crops, corner by corner; `probe` the ink where a doubt about
which line is the wall face remains; write a spec (below) in a scratch folder;
`snap NAME --role a --spec FILE`; open every flagged edge at full zoom with the
snapped outline drawn (`view IMAGE --crop … --poly <snapped file>`); `check
NAME --role a`. Finish with the whole plan and its key, for the types and for
anything missing: a second level, a wing, a detached garage. A second annotator
does the same with `--role b`; `compare NAME` says whether the two agree; the
adjudicator writes `--role final` from the disagreement regions; `check` runs on
the final key; a reviewer who drew none of it records `review`; `apply` freezes it.

| Command | What it does |
|---|---|
| `view IMAGE\|NAME [--crop X0,Y0,X1,Y1] [--grid STEP] [--poly FILE]... [--tag T] [--labels] [--bare]` | A PNG of the page or the crop (long side ~1,400 px) with a grid labelled in image pixels on all four edges, a legend, and any outlines; prints the path and `crop x0,y0→x1,y1  scale N.NN px/px  grid S`. Each `--poly` file (a spec, a snapped file, or a bare ring) has its own line style and its vertices are numbered `outline.vertex`. A plan `NAME` is drawn bare. `--bare` is accepted because the protocol's line reads `view --bare`, and does nothing more; with `--keys` or `--trace` it is an error. A crop that misses the page, or shows under 2 px of it, is an error; one that reaches past the page is cut back to it, with a note on stderr. |
| `view NAME --keys` / `--trace` | Also the plan's stored key (by type) and the app's own trace (dashed red). For the orchestrator, the app checker and engineers, **never for a role that draws or checks a key blind.** |
| `blind NAME` | The annotator's packet, `keys-wip/packets/NAME/`: `image.<ext>` (the plan's exact bytes, so coordinates are the key's), `labels.json`, `meta.json {name, width, height}`. |
| `labels NAME` | The packet's labels as a table, for an agent that cannot open the set folder. |
| `probe IMAGE\|NAME --from X,Y --to X,Y [--step 0.5]` or `--across X,Y,ANGLE --half N` | The luminance along a segment at pixel centres, the page's ink threshold and the dark and light runs (`dark 12.0–17.5 (5.5 px)`), with where each run lies on the page. A segment that leaves the image is an error, not the border's pixels read again. |
| `snap NAME --role a\|b\|final --spec FILE [--tag T] [--replace] [--dry]` | Validates the spec, keeps it as `keys-wip/NAME.<role>.json`, snaps it, prints each edge's move and flag, writes `NAME.<role>.snapped.json`. Never writes into the plan and never reads its trace or key. A vertex more than 2 px outside the image is an error. Role `a` or `b` already written by another `author` (or by a spec with none) is not replaced unless you add `--replace`; snapping your own spec again is the normal loop; a replaced spec is always said so. `--dry` is accepted and changes nothing: it is not a preview, `snap` always writes `keys-wip/` (and never the plan), and says so. `--tag T` also writes scratch copies (below). |
| `compare NAME` or `compare A B [--draw OUT.png --tag T --image IMAGE]` | Per-type IoU, the largest and 95th-percentile boundary distance, the protocol's verdict and the disagreement regions. A small unfinished outline does not decide agreement (below). With `NAME`, `--tag T` also writes scratch copies (below). |
| `check NAME [--role R] [--feet-per-pixel X] [--tag T]` | The automatic checks; `CHECK PASS` or `CHECK FAIL (n)`, non-zero exit on a fail. It prints the plan's own calibration (the app's scale vote, which is not the trace) and each outline's sq ft to whoever runs it, blind roles included: accepted, since the stated-area check needs it. `--tag T` prints the scratch copy's path, not the set's, where `--json` names the file checked. |
| `review NAME --approve\|--reject --agent ID [--region … --reason …]` | The final reviewer's decision, `keys-wip/NAME.review-<n>.json`. |
| `apply NAME [--dispute ID]` | The freeze for one plan; the only command that writes into a plan. |
| `sheet NAME... --out FILE [--per N]` | Review sheets: each plan whole with its stored key, its record and its notes. |
| `score NAME FILE [--json]` | The verdict of the outlines in `FILE` against the plan's stored key, by `bench:real`'s own code (below). For the app checker; **never for a role that draws or checks a key blind.** |

**The blind packet** holds the image and what the scan read, and nothing else: a
packet is built by naming the fields it takes, so nothing the tracer knows can
leak into it. `labels.json` lists each label with an id (`d<i>` a room size,
`e<i>` a garage, porch, patio… name, `a<i>` a level name; the number is its place
in the plan's own list), its box in image px, its text and `kind`: `room`,
`nonGla` (the words of garage, carport, porch, patio, deck, terrace, stoop,
breezeway, balcony, screened space…; `labelKind` in `scripts/lib/keyPacket.mjs`,
the one definition `blind` and `check` share) or `level`. A size printed directly
under an exterior name is that space's own size: it is `nonGla` too, and says
which name it is under (`nameLabel`). There is no trace, no rooms, no scale, no
quality figure in it, and no other key. `check` (and so `apply`) judges a key
against the packet's labels, the ids and kinds the annotators saw, and not against
a scan of the plan read again: a plan drafted again can read other labels under
one image, so ids would name other labels, and a change to the app's exterior
feature words would move the kinds under a key already frozen. It warns when the
plan's scan now differs from the packet (run `blind` again, then check again).
A plan with no packet is checked against its own scan, kinds by `labelKind`.

**A spec** is what an annotator writes:

```json
{"author": "a-colonial63-n16", "notes": "why each call was made, as the existing notes do",
 "outlines": [
   {"type": "gla", "name": "first floor", "v": [[546, 243], [1280, 243], [1280, 697], [546, 697]]},
   {"type": "garage", "v": [["ref", 0, 0], [111, 243], [111, 663], [546, 663]], "in": [3], "fix": [2]}],
 "waive": [{"label": "d3", "reason": "a storage room that opens into the garage, counted as garage"}],
 "stated": [{"sqft": 1250, "of": "first floor", "explained": "the page's figure leaves out the walls"}]}
```

`type` is `gla`, `below-grade`, `garage`, `porch` or `unfinished`. Edge *i* runs
from `v[i]` to `v[i+1]`. `fix` edges stay where they are drawn; `in` edges take
the band's inner face (a garage or porch edge along the house wall, so the two
outlines meet at the house's exterior face); a vertex `["ref", k, i]` is vertex
*i* of outline *k* after it has snapped, so two outlines share a boundary
exactly (an edge between two refs is the shared boundary and does not move); `R`
is the search reach in px (default 14); `tilt: true` follows a wall a scan has
tilted; `bridge` (default 2.5 px) is the gap a hatched or double-line wall may
have without ending its band. A snap moves each edge along its normal and keeps
its slope, so give the two ends of a level edge the same y. `waive` excuses a
label from the label check with a reason the reviewer reads; `stated` gives areas
the page prints, each `{"sqft", "of", "explained"}`. `of` says what the figure is
of, and matches, in this order: an outline's `name` (case does not matter; the
sq ft of every outline of that name, added), else a type (`gla`, `below-grade`,
`garage`, `porch`, `unfinished`: all the outlines of that type), else total GLA,
which is the `gla` outlines only, below-grade space not included. An `of` that
is none of them, or absent, is compared with total GLA, and the check line says
so (`"first floor" names no outline`): name your outlines to compare a level on
its own, and put a page's "total" figure under `of: "total GLA"` (or leave `of`
out). Everything is validated with the place and the reason.

**What a snap flags.** `no-band`: no wall band within reach. `far`: the edge moved
over 4 px. `reaches-end`: the band runs to the end of the search on the side that
decides the face. `ink-beyond`: another band within 10 px past the face used that
is nearly as continuous along the edge as the face band itself, as the second
stroke of a hatched or double-line wall and a dimension line are (window boxes
drawn proud of a long wall can do it too: look, and move on), or a stroke that was
refused a join for covering too little of the edge (below). `bridged`: the face
is the end of a stroke joined across a gap (the `bridge`, default 2.5 px), and not of
the stroke nearest the line you drew: it says by how many px. `partial`: the stroke
the face is read from covers under 60% as much of the edge as the strongest stroke
on it, as a window frame does when the line was drawn on it. A gap is bridged only
between strokes that are each at least 60% as continuous along the edge as the
wall (their best dark fraction against the edge's peak): a window frame drawn proud
of the wall covers a part of the edge, and joined to the wall's line it would carry
the face out to it with nothing to show it. A frame that covers most of an edge is
indistinguishable from a wall line by ink alone: that is what `bridged` and the
probe are for, and `"bridge": 0` on the outline (or `fix` on the edge) is the
answer when the nearer stroke is the face. `unstable`:
read again from where it landed, the face moves over 1 px more, as along a run of
windows and doors where the wall is less of the edge than the strokes drawn in it.
It also warns of an edge drawn a hair off level or plumb, of a wall whose face
leans over 2 px along an edge (a scan tilted on the page: say `tilt`), and of a
vertex whose two edges are nearly parallel. Look at every flagged edge at full
zoom; probe the ink where the doubt is; `fix` an edge you have read by hand.
`check` shows these flags again: a snapped key lies on its bands, so a second snap
cannot tell the wall from a thin line beside it (a garage door) that captured the
edge, and only the first snap's flags say so. They are kept in the snapped file
(`flagged`), and `check` warns of every edge not in `fix` that was flagged `far`,
`reaches-end`, `ink-beyond`, `bridged`, `partial` or `unstable`, until the edge is
drawn on the face or listed in `fix`.

**Faces.** The face is the band's outer end, never its centre. Where a solid band
sits inside a hatched one, it is the hatched band's outer line. Window sills and
frames drawn proud of the wall are not wall. A thin line near a wall, such as a
garage door between two thick piers, can capture a snap: `fix` there.

**What `compare` calls agreement** (the protocol's step 3): the same outline
types; the building outlines (gla and below-grade) at IoU 99% or better; garage
and porch each at 97% or better; and no boundary point more than 3 px from the
other key's boundary of the same class (building, non-GLA). **Unfinished space is
not scored, so it is in neither IoU nor the boundary distance, and a small
unfinished outline does not count as an outline type:** one under 2% of its own
key's building area (the summed area of that key's gla and below-grade
outlines) is set aside. It is listed under "informational" in the output (and as
`informational` in `NAME.compare.json`: the key, the outline, its area and share,
its box, and whether the other key drew unfinished space over the same ground),
and the two keys agree without it. A larger unfinished outline that only one key
draws still fails the types, and is listed as a region to crop at (it is not a
distance failure). The pilot's two annotators split on 12-13 sq ft chimney masses
alone, which forced an adjudication of nothing that is scored. (Before this,
unfinished was a third class in the distance criterion, so a chimney that one key
lacked failed the distance too, and two keys that drew the same large unfinished
region more than 3 px apart disagreed.) IoU is exact: the area two keys' outlines
of a type share over the area of their union, worked out edge by edge with no
raster (a 0.5 px raster was off by 0.2% on a house of 600-900 px and 0.8% on one of
100-200 px, and the 99% line falls where it does). It can differ from a
`bench:real` score by the sub-pixel a truth mask rounds away. The boundary distance
is measured from each key to the other, so a spike on one key is found by the key
it is on; the 95th-percentile distance pools both directions, sampled about every
pixel.

**What `check` tests** (step 5), each `pass`, `warn`, `waived` or `fail`:

- every outline is closed (at least 3 distinct vertices) and does not cross itself;
- building and non-GLA outlines overlap no more than their shared boundary: the
  larger of 2 px times the length they share and 0.2% of the smaller outline
  (unfinished space over scored space, and two outlines of one class, only warn);
- every `room` label (its box's centre) lies inside a gla, below-grade or
  unfinished outline, and every `nonGla` label inside a garage, porch or unfinished
  one: inside the wrong kind is a fail unless the spec's `waive` names it (then it
  is `waived`, with its reason, for the reviewer), and inside none at all is a warn;
- every edge not in `fix` (and not a shared boundary) moves no more than 2 px, and
  finds a band, when snapped again; more than half an outline's edges in `fix` warns;
  an edge the first snap flagged (above) warns;
- the page the key was snapped on (the snapped file records its size) is the size
  of the plan's image: a plan drafted again is another page, and a key drawn on the
  old one is a fail;
- a stated area, from the spec's `stated` or a sq ft figure a level label carries,
  against the key's area at the plan's scale (`--feet-per-pixel` overrides it): over
  5% apart fails unless the entry says why (`explained`, then a warn). An `of` that
  names an outline (by its `name`) or a type compares that; any other is compared
  with total GLA (the `gla` outlines), and the line says so.

`check` reads the plan's own calibration, to put a key's area in sq ft, and prints
that scale and each outline's sq ft to whoever runs it, blind annotators included.
The app's scale is the tracer's vote, not its trace, and no key is judged by it,
so this is accepted; the annotator sees a number, never an outline of the app's.

**Files.** The set folder is `datasets/real/` of the main checkout;
`FLOORTRACE_REAL_DIR` points the tool at another folder of plans, so `apply` can be
tried on a scratch copy. Work files live in `keys-wip/`: `NAME.<role>.json` (the
spec) and `NAME.<role>.snapped.json` for each role `a`, `b`, `final`;
`NAME.compare.json`; `NAME.review-<n>.json`; `NAME.record.json` (the orchestrator
writes it: `{"annotators": [...], "adjudicator": null|"…", "verifiedBy": "blind
double annotation"|"single annotation"}`); and `packets/NAME/`. Every write into
the set retries while Google Drive holds a file and goes through a temporary file,
so a plan is never left half written. An agent cannot write inside the set, so
every command that writes there takes a file from the agent's own scratch folder
(`datasets/zz-scratch/<tag>/` of its checkout) and does the copying. Views go to
`datasets/zz-scratch/views/<TAG>/` of the checkout that runs the tool, so two agents
on one plan never overwrite each other.

**The record `apply` writes** into the plan's `answerKey`, in place of a draft's
`by: "Claude (draft for review)"`:

| Field | Meaning |
|---|---|
| `by` | `annotators: <ids>; adjudicator: <id or none>`, from `NAME.record.json`. |
| `verifiedBy` | `"blind double annotation"` or `"single annotation"`. |
| `checked` | `{by: "AI review", at, via: "final review"}`: the final reviewer's approval, `at` being when it was recorded. Only checked keys enter the manifest. |
| `at` | When the key was written into the plan. |
| `notes` | The final spec's notes: each judgment call and why. |
| `disputeId` | Present when the key was changed after the freeze, through a dispute (`apply NAME --dispute ID`). |

`apply` needs the final snapped key, a passing `check`, the record file, and a
latest review that approved this very key (the review stores the hash of the
snapped key and of the final spec, that is of its notes, waivers and stated figures
too, so a key or a note changed after its approval needs a fresh review). A
reviewer may not be one of the key's annotators or its adjudicator. Reviews are
created exclusively, so two reviewers who run `review` at once get two numbers and
neither replaces the other. A plan whose record already has `checked`
is frozen: `apply` refuses it unless `--dispute ID` names the dispute that
changes it, and refuses a dispute whose final key is the key the plan already holds
(a dispute id marks a change; a dispute the key survived is logged, not applied).
`apply` leaves the plan otherwise as it was (image, labels, calibration); run `node scripts/realKeys.mjs export` afterwards.

#### Scoring outlines against a key: `score`

```
node scripts/realKeyTool.mjs score NAME FILE [--json]
```

The verdict of the outlines in `FILE` against the plan's stored key, reached by the
code `bench:real` judges by: the truth masks are `answerKeyFromOutlines` and the
traced mask is `tracedMask` (through `scoreTrace`) from `scripts/lib/realScore.mjs`,
the verdict is `scoreMask` from `scripts/lib/verdict.mjs`, and nothing of them is
copied (`scripts/lib/keyScore.mjs` only reads `FILE` and words the result). The app
checker, who tries the running app on real plans, uses it to score the outlines it
reads from the app's state, and compares the verdict with `bench:real`'s for the
same plan and commit. It reads the stored key, so it is not for a role that draws or checks a
key blind. It exits 0 whatever the verdict (the verdict is the answer), and 1 on an
error.

The key is the plan's stored outlines, as `bench:real` reads them (closed outlines
of three or more points, at the precision they are stored), not `keyOf`'s copy
rounded to a tenth of a pixel: the same rings score the same. A plan with no key
yet is refused (`no answer key yet`). A test-split plan (the manifest beside the
folder, or the set's own when the folder has none) is refused too, unless
`FLOORTRACE_TEST_SPLIT_OK=1` is set, which is the orchestrator's alone: as in
`bench:real`, integrity rule 4 leaves a test plan's verdict to the orchestrator,
and the check comes before the plan is opened. When the manifest holds a
`keySha256` for the plan and the key no longer hashes to it, `score` scores anyway
and says so (`key changed since the manifest`), since `bench:real` would refuse
the plan.

`FILE` is JSON in one of two shapes, in the plan's own image pixels:

```json
{"outlines": [{"type": "gla", "vertices": [{"x": 100, "y": 80}, "..."], "holes": [], "closed": true}],
 "confidence": 0.93, "warnings": ["thin-structure-excluded"]}
```

the app's outlines (`perimeterTraces` of the app's state), each with `vertices`
(`{x, y}` or `[x, y]`) or `points` (`[[x, y], ...]`), or a bare array of such
outlines; or

```json
{"rings": [[[100, 80], [300, 80], [300, 220], [100, 220]]], "confidence": 0.93}
```

each ring a traced floor's outer polygon, as `bench:real` records them in a run
file's `results[i].app.rings` (holes are not in them). `confidence` is a number from
0 to 1 and `warnings` are codes, or `{code, severity}` (an `info` one is not one, as
in `bench:real`); both are optional. **The traced area is the union of the `gla` and
`below-grade` outlines** (an outline with no type is `gla`) **less their holes**
(unless stale), filled as `bench:real` fills the floors of a trace, so a ring list
gives exactly the mask `bench:real` builds from the floors it traced. Garage, porch
and unfinished outlines are not the trace and are left out, and an outline with
`closed: false` or under three points is skipped: each is said in a `note:` line. It
also notes a file with no building outline (nothing was traced: wrong), one whose
points lie beyond the plan's image (coordinates on another scale than the plan's
own image score as a wrong trace), and a confidence that was not given.

It prints the verdict, the IoU, the area error (positive: the outlines cover more
than the key's building), the error by cause as a share of the key's building area
(non-GLA space kept, other space taken in, living space missed), the largest error
regions, the key's outline types and record (who drew it, whether it was checked),
and, when `confidence` is given, the confidence with the app's word for it
(`good` from 75%) and **whether the outline is wrong but shown as good**: the
verdict is `wrong` and the confidence is at least `QUALITY_GOOD`
(`src/utils/boundaryQuality.js`). `--json` prints the same as JSON
(`verdict, iou, areaErr, overNonGla, overOther, missed, regions, floors, key, counted,
left, confidence, level, warnings, wrongButShownGood, outside, notes, keyRecord,
keyChanged`).

The rings of a run file are rounded to whole pixels and have no holes, so scoring
them differs from that run's own figures by the rounding, and by the area of any
hole the trace had: on the 75 plans of `real_runs/phase0-9d212fb.json` every
verdict and every wrong-but-shown-good flag is the run's, and the IoU differs by
0.0006 at the median and 0.029 at most (a plan with holes). Fed the trace's
unrounded outlines with their holes, `score` gave `bench:real`'s per-plan result
exactly on all 75 plans (9 of them with holes): verdict, IoU, area error, the
error by cause and its regions, traced area, confidence, warnings and floors.

#### Scratch copies for blind roles: `--tag`

A blind annotator's guard forbids naming `keys-wip/`, and the orchestrator's audit
looks for it. `snap`, `compare` and `check` take `--tag T` (letters, digits, `.`, `_`,
`-`), and then copy what they write into `datasets/zz-scratch/T/` of the checkout
that runs the tool, and print those paths where they would have printed the set's:

- `snap NAME --role R --spec FILE --tag T` writes `NAME.R.snapped.json` and
  `NAME.R.json` (the spec) there, prints them as `snapped outlines -> ...` and
  `spec kept -> ...`, and a line `use this with --poly: <the snapped copy>`.
  `view IMAGE --poly <that path>` draws it as it draws the set's.
- `compare NAME --tag T` copies both keys (`NAME.a.snapped.json`,
  `NAME.b.snapped.json`), their specs and `NAME.compare.json` (whose `a` and `b`
  name the copies), prints `use this with --poly:` for each key, and a key that is
  missing is said without the set's path. With two files, `--tag` still only names
  the folder a `--draw` picture goes to.
- `check NAME --role R --tag T` names the snap copy where it prints a path (`--json`'s
  `snappedFile`, left out when there is no copy), and a key not yet snapped without
  the set's path. Its text output has never named one.

Without `--tag` nothing changes. The only line these commands print that names a
path in `keys-wip/` is `snap`'s header, when a packet exists: the packet's image is
what the key is drawn on, and is the one thing of `keys-wip/` a blind role may open.
(`snap --dry`'s note names the folder, as a fact about what `snap` writes, not as
somewhere to look.)
`view`, `labels` and `probe` print no path of the set in normal use (`view`'s is
its picture, in the checkout's scratch folder).

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

### The roles, the blind guard and the transcript audit

The agents that source, draw, check and improve on this set are defined in
`.claude/agents/`, one file per role, each with its model effort in the
frontmatter: `sourcer`, `annotator`, `adjudicator`, `reviewer` (the four
**blind** roles: they never see the app's trace, a benchmark result, or another
agent's key), `engineer`, `app-checker` and `auditor`. Each file says where
`<set folder>` is (the orchestrator's spawn message gives its absolute path;
`realKeyTool blind NAME` prints a packet's path).

**The guard.** Each blind role's frontmatter wires a `PreToolUse` hook,
`.claude/hooks/blind-guard.mjs <role>`, to `Bash|PowerShell|Monitor|Read|Grep|Glob`,
with `shell: bash` and a command that ends `|| exit 2`. It reads the tool call's
inputs and refuses (exit 2, the reason on stderr) a call that would show the
role what it may not see; it fails **closed**: an unknown role, an error in the
guard, a rules file that will not load, or a missing script is also a refusal,
where any other exit code would let the call through. The rules are data in
`.claude/hooks/blindRules.mjs`, shared with the audit below. What they refuse, by
what a call names (paths are read with quotes removed and `..` resolved):

- to every blind role: any `.floorplan`, `real_runs/`, `cubicasa5k_runs/`, a
  `datasets/real-…` backup, `answer-keys`, `perimeterTraces`, the benchmark and
  tracer commands, `realKeyTool view --keys|--trace`, the set folder as a working
  directory, a search rooted at `datasets/`, `orchestration/`, `realRunDiff`,
  `realKeys`, and the environment variables that re-point the set folder;
- the set folder is an **allow-list** per role, and every other path in it is
  refused, wildcards and the folder itself included: annotator, adjudicator and
  reviewer may open `keys-wip/packets/`; the adjudicator also `keys-wip/<plan>.{a,b,final}.*`
  and `<plan>.compare.json`; the reviewer `<plan>.final.*` and `<plan>.review-<n>.json`;
  the sourcer only `inbox/`. An annotator's own key files are allowed by the audit
  (it knows the letter) but not by the live guard, which does not: an annotator
  draws its own snapped key from the copy the key tool writes to its scratch
  folder, not from `keys-wip/`;
- the key tool's subcommands, per role: annotator `view probe snap check labels`
  (`snap` and `check` need `--role a|b`), adjudicator those and `compare` (`snap`
  needs `--role final`), reviewer `view probe check labels review` (`check` on the
  final key), sourcer `view probe`; `realDrafts` is the sourcer's alone.

It is a speed bump for an honest agent about to open the wrong file, not a
sandbox: it reads the text of a call, so a path built in a variable gets past it.

**The audit.** A workflow's subagents cannot carry the hook, so the
orchestrator runs `node scripts/auditBlind.mjs TRANSCRIPT_DIR [--json]
[--ignore-prefix a,b] [--manifest FILE]` on each workflow's transcript folder
(`journal.jsonl` and an `agent-<id>.jsonl` per agent): it reads every agent's
tool calls against its role's rules, the same table the guard uses. **The role
comes from the agent's label in the journal, `<prefix>:<plan>`**, so a workflow
script labels its agents `a:` or `b:` (annotators; an annotator's own letter's key
files are allowed), `adj:` or `final:` (adjudicator), `rev:` (reviewer), `src:`
(sourcer), `eng:` (engineer: never the test split, never a key edit) and `app:`
(app checker: never a key edit). Any other label, or none, is **listed and makes
the exit status 1**: an audit that skips agents it does not recognise looks
clean while it has not looked. Labels that are deliberately not audited (builders,
auditors, fixers) are declared with `--ignore-prefix build,audit,fix,resume`; a
role's own prefix cannot be ignored, and the summary counts what was. `--manifest
<set folder>/orchestration/manifest.json` makes it refuse an `eng:` agent any
plan the manifest puts in the test split, by name. A missing or unparseable
transcript is a finding, and tools it does not read are listed per agent.
Exit: 0 clean, 1 a finding, 2 a folder or option it cannot use.
