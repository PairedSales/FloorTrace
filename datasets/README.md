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
| `snap NAME --role a\|b\|final --spec FILE [--replace]` | Validates the spec, keeps it as `keys-wip/NAME.<role>.json`, snaps it, prints each edge's move and flag, writes `NAME.<role>.snapped.json`. Never writes into the plan and never reads its trace or key. A vertex more than 2 px outside the image is an error. Role `a` or `b` already written by another `author` (or by a spec with none) is not replaced unless you add `--replace`; snapping your own spec again is the normal loop; a replaced spec is always said so. |
| `compare NAME` or `compare A B [--draw OUT.png --tag T --image IMAGE]` | Per-type IoU, the largest and 95th-percentile boundary distance, the protocol's verdict and the disagreement regions. |
| `check NAME [--role R] [--feet-per-pixel X]` | The automatic checks; `CHECK PASS` or `CHECK FAIL (n)`, non-zero exit on a fail. It prints the plan's scale (the app's own vote) and each outline's sq ft to whoever runs it, blind roles included: accepted, since the stated-area check needs it. |
| `review NAME --approve\|--reject --agent ID [--region … --reason …]` | The final reviewer's decision, `keys-wip/NAME.review-<n>.json`. |
| `apply NAME [--dispute ID]` | The freeze for one plan; the only command that writes into a plan. |
| `sheet NAME... --out FILE [--per N]` | Review sheets: each plan whole with its stored key, its record and its notes. |

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
the page prints. Everything is validated with the place and the reason.

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
other key's boundary of the same class. IoU is exact: the area two keys' outlines
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
  with total GLA, and the line says so.

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
`apply` leaves the plan otherwise as it was (image, labels, calibration); run `node scripts/realKeys.mjs export` afterwards. A `score`
command, which would judge outlines against a key by the verdict code `bench:real`
uses (`scripts/lib/realScore.mjs`), is not part of this tool yet: a follow-up adds it.

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

### Running the key pipeline (`realPipeline`, `realManifest`)

```
node scripts/realPipeline.mjs COMMAND [selector] [options]     # --help prints the manual
node scripts/realManifest.mjs COMMAND [options]                # --help prints the manual
```

The key protocol has agents' steps (drawing, adjudicating, reviewing) and
mechanical steps between them. The mechanical steps are these two scripts, for the
orchestrator to run over hundreds of plans at a time. They read the plans, so
**roles that draw or check a key blind never use them** (`realKeyTool` is theirs),
and engineers have no use for them. Every command is safe to run again (it does
what is still to do), prints one line per plan and a summary, exits 1 when a plan
ended in an error, a refusal or a failed check (2 for a command line it cannot
read), never deletes, and writes into the set folder only through the key tool's
retrying, atomic writer (Google Drive holds files it syncs). Both point at
another folder with `FLOORTRACE_REAL_DIR`, so a command can be tried on a scratch
copy. The tools' headers are their manuals; this is the map.

**One batch, in order.**

1. `packets` gives each annotator its blind packet; annotators A and B draw with
   `realKeyTool` (for the first 75 plans `import-existing` makes A of the stored
   draft key, and only B is drawn).
2. `compare-all`, then `finalize-agreed` for what agrees (A becomes the final key
   and the record is written), `finalize-single` for the dev plans that get no B.
3. The adjudicator settles each DISAGREE with `realKeyTool snap --role final`,
   then `adjudicated NAME --adjudicator TAG`.
4. A fresh reviewer records `realKeyTool review`; `status` says which reviews are
   approved, rejected or stale.
5. `freeze` writes the approved keys into their plans, runs `realKeys export` and
   backs the set folder up; `realManifest build` writes the manifest; `verify`
   checks it; `stats` gives the milestone report its four numbers.

**Selectors** (every `realPipeline` command but `adjudicated`, `backup` and `stats`
needs one; `stats` takes one to narrow): `--names A,B` (repeatable; bare names
work too), `--book X` (a book or site unit, as the manifest's `book`; the book as
logged, or the site, also match), `--split dev|test` (from the manifest, else
`splits.json`), `--all`. They combine as filters: `--names` picks exactly those
plans, else every plan, and `--book` and `--split` then keep what is in that book
and that split. With none of them the command refuses and lists them.

| `realPipeline` command | What it does |
|---|---|
| `status [selector] [--json] [--no-check\|--recheck]` | One row per plan: `packet` (`ok`, `STALE` when the plan's image is no longer the packet's), `A` and `B` (`ok` = snapped, `existing` = the imported draft, `unsnapped`), `compare` (`agree`, `DISAGREE` with the criteria that failed, `stale`), `final`, `check` (`PASS`, `FAIL`, `?` = never run, `(old)` = of another key), `review` (`approved`, `rejected(n)`, `revised(n)` = the key changed after a rejection, `approved-STALE` = the key or its notes changed after the approval), `rnd` (review rounds) and `frozen` (`yes`, `draft` = an unchecked stored key). Then one summary line per stage. A check is about a second, so its result is cached beside the key (`keys-wip/NAME.check.json`, under a fingerprint of the final key, its spec, the plan and the packet's labels) and run only for a final key that has none for its current fingerprint; `--recheck` runs them all again, `--no-check` runs none and writes nothing. 400 plans read in seconds. |
| `packets [selector]` | `realKeyTool blind` for each plan. |
| `import-existing [selector \| --all-existing]` | For a plan whose stored key is an unchecked draft (`answerKey.by` starts with "Claude", no `checked`): writes `keys-wip/NAME.a.json` (the stored outlines as `v`, every edge in `fix`, since an earlier snap placed them; the record's notes; `"author": "existing-draft"`, `"existingDraft": true`) and `NAME.a.snapped.json`. The plan is not touched. Refuses a plan whose key is checked, one whose A another agent drew, and a key with holes. |
| `compare-all [selector] [--redo]` | `realKeyTool compare` for every plan with A and B snapped; one line per plan (verdict, smallest per-type IoU, worst boundary distance, criteria failed) and the tally: how many compared, the agreement rate, and how many failed types, building IoU, non-GLA IoU, distance. A comparison newer than both keys is kept; `--redo` recomputes. |
| `finalize-agreed [selector]` | For a plan whose fresh comparison agrees and that has no final key: `NAME.final.json` and `NAME.final.snapped.json` as copies of A's, `NAME.record.json` (below), then `check`. A final that fails is marked "needs adjudication" and kept. Refuses A and B by one author, and a spec with no author. |
| `finalize-single [selector]` | The same for a dev plan that has an A and no B, with `verifiedBy: "single annotation"`. Refuses a plan whose split is not dev (every test plan gets a B) and one whose A is the existing draft (every existing plan needs an independent B). |
| `adjudicated NAME --adjudicator TAG` | After `snap --role final`: writes `NAME.record.json` (below) with `adjudicated: true`, then `check`. Refuses an adjudicator who drew A or B. |
| `sample selector --fraction F --seed N [--exclude-existing]` | A deterministic random sample of the selected plans (sorted, then a seeded mulberry32 shuffle): the same plans and seed give the same sample. Prints the seed, the size and the names comma-separated; writes nothing. "30% of the rest of dev get a B" is `--split dev --fraction 0.3 --seed N --exclude-existing`, which leaves out the plans that predate the sourcing log. |
| `stats [selector] [--json]` | The four numbers of a milestone report: agreement (overall, by era, by book), adjudication (adjudicated of finalized), the final review's send-back rate with the rounds per plan, and the disputes tally (below). |
| `freeze selector [--dry] [--backup \| --backup-name NAME]` | The key tool's `apply` for every plan whose latest review approved this very key and spec, that passes `check` and is not frozen. Refuses, by name, a plan whose approval is stale and one with no record; says why the rest are not ready. Then `realKeys export`, and with `--backup` the backup. `--dry` writes nothing. |
| `backup [--name real-backup-YYYY-MM-DD]` | Copies the set folder to `<set folder>/../<name>/` (not the `zz-*` folders), never over an existing folder (`-2`, `-3`, …), and verifies the copy: file count, bytes, and the SHA-256 of `answer-keys.json` and of `orchestration/manifest.json`. |

**Files.** In `keys-wip/`, beside what `realKeyTool` writes (spec and snapped file
per role, `NAME.compare.json`, `NAME.review-<n>.json`, `packets/NAME/`):
`NAME.check.json` (the cached check) and `NAME.record.json`:

```json
{"annotators": ["a-colonial63-n16", "b-colonial63-n16"], "adjudicator": null,
 "verifiedBy": "blind double annotation",
 "agreement": {"agree": true, "iou": {"building": 0.9997, "nonGla": 0.9984, "byType": {"gla": 0.9997, "garage": 0.9981}},
               "boundary": {"max": 1.1, "p95": 0.41}, "types": {"gla": 1, "garage": 1}, "comparedAt": "…"},
 "adjudicated": true}
```

`annotators` are the specs' `author`s (`existing-draft` for an imported A);
`adjudicator` is `null` or the agent's id, and `adjudicated: true` and `agreement`
of a disagreeing pair are written by `adjudicated`; a single annotation has no
`agreement`. `apply` reads `annotators`, `adjudicator` and `verifiedBy`; the
agreement figures travel from here into the manifest. In `orchestration/`:
`sources.jsonl` and `sources.md` (`realSource`), `splits.json`, `manifest.json`,
`manifest-log.md`, `manifest-versions/`, `disputes.md`.

**The dispute line.** `orchestration/disputes.md` is prose for people with one
machine-readable line per dispute, and one more each time its status changes (the
latest line of an id wins):

```
DISPUTE <id> plan=NAME status=decided|open outcome=changed|kept direction=toward-tracer|away|neutral
```

`outcome` is given only when the dispute is decided; `direction` is required for a
changed key (did the change move the key toward the app's trace, away from it, or
neither) and optional for a kept one. The line may sit in a list item, a quote or
backticks. A line that starts with `DISPUTE` and is not this is reported by
`stats` with its line number and makes it exit 1, since a tally that skips what it
cannot read overstates what it can. `stats` warns when every changed key moved
toward the tracer (three or more): disputes that always go the tracer's way are a
warning sign in themselves.

| `realManifest` command | What it does |
|---|---|
| `assign-splits --seed N [--roster FILE] [--pin-dev BOOK,… \| --pin-existing] [--target-test 150] [--total 400] [--write [--replace]] [--created-at ISO]` | Assigns whole books (the sourcing log's cap units: a plan book, or a designer code on an aggregator site) to `dev` or `test` with a fixed seed, stratified by era × decade. Pinned books go to dev first and their plans count toward dev (`--pin-existing` pins every book none of whose plans is in `sources.jsonl`: the 17 that predate it). In each stratum (in a fixed order) the other books are sorted by name and shuffled by a stream seeded from the run's seed and the stratum, and a book goes to test when that brings the running count of test plans closer to the running share `--target-test/--total` of all plans so far: books are whole, so a stratum ends up to about one book off its share, the running target carries the difference to the next, and the total lands within about half a book of `--target-test`. The roster is read from the set folder (`sources.jsonl` for logged plans, else the plan's name: a book, its era, the decade most of its plans are from, its publisher, its plans) or from `--roster FILE`, `[{"book","era","decade","publisher","plans"}]`. Prints plans per era × decade and split with the deviation from the target, per split × era, and each book's split. `--write` writes `orchestration/splits.json` (below). |
| `build [--allow-partial] [--reason TEXT]` | Assembles `orchestration/manifest.json` from the plan files, `splits.json`, `sources.jsonl` and each plan's record. Only plans whose record is `checked` enter; one that is not is listed and fails the build unless `--allow-partial` leaves it out. A new manifest is archived as `manifest-versions/manifest-<first 12 digits of its hash>.json` and a row `{version, hash, date, reason, counts}` is appended to `manifest-log.md`; one that would not change the file logs nothing. Prints the SHA-256, the manifest hash every `bench:real` run names. |
| `verify [--final] [--allow-partial]` | Checks the manifest against the folder, each rule PASS, FAIL or INFO: every manifest plan has its file and its key still hashes to its `keySha256`; every plan file is in the manifest (`--allow-partial`: INFO); every record is checked, in the plan and in the manifest; each plan sits in the split `splits.json` gives its book; no book is in both splits. `--final` adds the finished set's rules: exactly 400 plans; at most 12 per book (unit) and 60 per site; at least 34 books; test and dev sizes (INFO, aimed at 150 and 250); both splits hold both eras; at least 90% of plans have a detected room size; no plan name looks like an address (three digits or more, then a street word); every new plan has a source (only the original 75 may be `embedded`); the 2020–2022 count (INFO, aimed at about 160 of the 325 new). |
| `hash` | Prints the SHA-256 of `orchestration/manifest.json`. |
| `amend PLAN --reason TEXT` | After a dispute changed a key (`realKeyTool apply PLAN --dispute ID` marks the plan's record with `disputeId`): rebuilds that plan's entry (its book, era and split and every other entry stay as they are), writes the new manifest, archives it and logs it with the dispute id. Refuses a plan whose record has no `disputeId`, or that the manifest does not hold. |

**`splits.json`:** `{"seed", "createdAt", "params": {targetTest, total, share,
pinDev, rosterSha256}, "books": {"<book>": {"split", "era", "decade", "publisher",
"plans"[, "site"][, "pinned"]}}}`, keys sorted, two-space indent. The same roster
and seed give the same file byte for byte (`createdAt` is the time it was first
written: an existing file that a re-run would not change is left as it is, and
`--created-at` fixes the time for a reproduction). A `splits.json` that holds
another assignment is not replaced without `--replace`, which keeps the old one as
`splits-superseded-<hash>.json`: books do not move between dev and test after
plans were drawn against the assignment.

**The manifest `build` writes** is version 1 of the schema in "Splits, the manifest
and the run files", with optional fields added, so `bench:real` reads it as it read
the hand-written ones. Per plan: `book` (the cap unit: the name's stem for a plan
book, the designer code (`--unit`) on an aggregator site, else the logged book),
`site` (when the log has one), `publisher`, `era`, `decade`, `year`, `split`,
`source` (`{url, crop, size}`, or `{file, …}` for a plan drafted from a file, or
`{"embedded": true}` for the plans whose image lives in the plan and has nowhere to
be fetched from), `keySha256`, and `annotation`: `{annotators, adjudicator,
adjudicated, agreement, verifiedBy, checked[, disputeId]}`, from the plan's own
`answerKey` record (the frozen truth) and the agreement figures of
`NAME.record.json`. The file is a pure function of the plans, `splits.json` and the
log: keys sorted at every depth, a fixed layout, and nothing in it that says when
it was built (the log does), so the same inputs are the same bytes and the same
hash. Its `seed` and `createdAt` are `splits.json`'s. The plans that predate the
sourcing log take their book, era and decade from their names (`aladdin62-n15`,
`dwellings14-p101`: 19yy); a plan with no digits in its name and no log line (a
`listing-NNN`) has no era until something says, and is left out of a derived
roster with a warning.
