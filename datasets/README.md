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
| `search QUERY [--rows N] [--year FROM-TO] [--page N] [--sort "downloads desc"] [--raw]` | archive.org advanced search over texts. Plain words must all be in the title or subject (`house plans` is searched as `title:(house AND plans) OR subject:(house AND plans)`: typed as is, archive.org matches any word anywhere and the first hits are memos that mention a house). Lucene syntax (a quote, `field:`, parentheses, `AND`/`OR`/`NOT`) and `--raw` are sent as typed. Prints the query sent, then identifier, year, leaf count (blank where the search lacks it; `meta` counts), title, creator, and `[borrow-only]`. |
| `meta ID` | Title, year, publisher, **leaf count**, collections, and whether **anyone can view the pages**: the `access-restricted-item` flag, the lending collections, and a test of one page image about 40% into the book (it says which leaf, the URL and what came back, and keeps the page). Prints the page URL pattern `https://archive.org/download/ID/page/n<leaf>`. **Exits 1 if the pages are not viewable**, with the reasons; a borrow-only item answers a page with 403. |
| `leaf ID N [--ext jpg]` | Downloads leaf N (or takes it from the cache): prints its path, its pixel size (a full-resolution page is about 4,000 by 6,000) and the source URL to record. |
| `contact ID FROM TO [--step S] [--cols C] [--rows R] [--tag T]` | A **contact sheet** PNG of leaves FROM to TO (every S-th), each shrunk to a cell and labelled with its leaf number: 12 to a sheet by default (4 across, 3 down, about 1,600 px each way), more sheets when more leaves are asked for, at most 96 leaves a call. It is how a plan page is found fast. A leaf that cannot be fetched is marked in its cell. Uses the cache, so a second call costs no requests. |
| `grid IMAGE\|ID:LEAF [--crop X0,Y0,X1,Y1] [--grid STEP] [--tag T]` | The key tool's `view` (grid labelled in the page's own pixels on all four edges), for choosing a crop from a page or a cached leaf (`ID:LEAF` fetches the leaf if it is not cached). Read crop coordinates from views of 300 to 500 px with a grid of 10 to 25 px, never from a whole page. Prints the PNG's path, then `crop x0,y0→x1,y1  scale N px/px  grid S`. |
| `screen ID [--samples 5] [--leaves n1,n2,...]` | Runs the app's own scan (`scanImage` of `realDraft.mjs`, the Tesseract path) on pages spread through the book, and prints the labels read per page and per book. |
| `cdx URL_PREFIX [--from 2020] [--to 2022] [--mime image/] [--status 200] [--collapse urlkey] [--limit N] [--match prefix\|exact\|domain] [--min-length BYTES] [--pattern REGEX]` | Wayback CDX search. Prints each capture's timestamp, mime type, length and original URL, and under it the **original-bytes URL** `https://web.archive.org/web/<timestamp>id_/<original>`, which is what a modern plan records as its source. Defaults are the project's: captures of 2020 to 2022, status 200, images. `--collapse urlkey` keeps one capture per URL. `--pattern` is a regular expression on the original URL, host included. `--min-length` drops small rows (thumbnails); the index cuts at `--limit` before that filter, so the command reads 10 times the limit (`--scan N` changes it) and keeps what passes. |
| `fetch URL [--name N]` | Downloads any archive.org URL (an `id_` capture URL, a page URL) into the cache; prints its path, mime type and pixel size. A response that is not an image (a login page, an error page, JSON) is refused and nothing is cached. `--name` also keeps a copy as `named/N.<ext>` (never over a different image). |
| `log plan\|reject\|book ...` | Appends an event to the sourcing log (below). |
| `report` | Rewrites `sources.md` from the log and prints the counts per book or site and per era, and any book over the cap of 12 plans. |

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
  is taken over; a normal exit or a signal releases it. `realDrafts.mjs` (and
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
`FLOORTRACE_SOURCE_TRACE=1` prints when each request began and ended, to see that
two processes never overlap.

**The log.** `log` appends one JSON object per line to
`datasets/real/orchestration/sources.jsonl` under a lock (sourcers log at once)
and regenerates `sources.md` beside it: plans by book or site with their leaf or
URL, crop, size, labels and builder line, then the rejected pages and their
reasons, then totals. The three events:

```
node scripts/realSource.mjs log plan --name NAME --book BOOK --era vintage|2020-2022 --year YYYY --url URL \
  --crop X,Y,W,H --line "<the builder line realDrafts printed>" [--publisher P] [--leaf L] [--size W,H] [--decade D] [--tag T] [--replace] [--no-verify]
node scripts/realSource.mjs log reject --book BOOK (--leaf L | --url URL) --reason REASON [--tag T]
node scripts/realSource.mjs log book --book BOOK [--id ID] [--publisher P] [--year Y] [--leaves N] [--note "..."]
```

- A `plan` line is `{event, at, name, book, publisher, era, year, decade, leaf,
  url, crop: [x,y,w,h], size: [w,h], labels, scale, cutOff, line, tag}`; labels,
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
- A `reject` needs one reason from a closed list: `3d`, `elevation`, `site-plan`,
  `too-small`, `hand-lettered`, `not-us-home`, `duplicate-house`, `not-a-plan`, or
  `other:<text>`. **How well the app traces a page is not on the list**, and an
  `other:` text about the tracer, the scan or the labels is refused: a page
  qualifies before it is drafted, never by how the app handles it (integrity rule
  6). A `book` line names a book or site looked at, for the report's headings.
- `report` lists any book over the cap of 12 plans from one book, publisher or
  builder.

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
| `view IMAGE\|NAME [--crop X0,Y0,X1,Y1] [--grid STEP] [--poly FILE]... [--tag T] [--labels]` | A PNG of the page or the crop (long side ~1,400 px) with a grid labelled in image pixels on all four edges, a legend, and any outlines; prints the path and `crop x0,y0→x1,y1  scale N.NN px/px  grid S`. Each `--poly` file (a spec, a snapped file, or a bare ring) has its own line style and its vertices are numbered `outline.vertex`. A plan `NAME` is drawn bare. |
| `view NAME --keys` / `--trace` | Also the plan's stored key (by type) and the app's own trace (dashed red). For the orchestrator, the app checker and engineers, **never for a role that draws or checks a key blind.** |
| `blind NAME` | The annotator's packet, `keys-wip/packets/NAME/`: `image.<ext>` (the plan's exact bytes, so coordinates are the key's), `labels.json`, `meta.json {name, width, height}`. |
| `labels NAME` | The packet's labels as a table, for an agent that cannot open the set folder. |
| `probe IMAGE\|NAME --from X,Y --to X,Y [--step 0.5]` or `--across X,Y,ANGLE --half N` | The luminance along a segment at pixel centres, the page's ink threshold and the dark and light runs (`dark 12.0–17.5 (5.5 px)`), with where each run lies on the page. |
| `snap NAME --role a\|b\|final --spec FILE` | Validates the spec, keeps it as `keys-wip/NAME.<role>.json`, snaps it, prints each edge's move and flag, writes `NAME.<role>.snapped.json`. Never writes into the plan and never reads its trace or key. |
| `compare NAME` or `compare A B [--draw OUT.png --tag T --image IMAGE]` | Per-type IoU, the largest and 95th-percentile boundary distance, the protocol's verdict and the disagreement regions. |
| `check NAME [--role R] [--feet-per-pixel X]` | The automatic checks; `CHECK PASS` or `CHECK FAIL (n)`, non-zero exit on a fail. |
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
quality figure in it, and no other key.

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
drawn proud of a long wall can do it too: look, and move on). `unstable`:
read again from where it landed, the face moves over 1 px more, as along a run of
windows and doors where the wall is less of the edge than the strokes drawn in it.
It also warns of an edge drawn a hair off level or plumb, of a wall whose face
leans over 2 px along an edge (a scan tilted on the page: say `tilt`), and of a
vertex whose two edges are nearly parallel. Look at every flagged edge at full
zoom; probe the ink where the doubt is; `fix` an edge you have read by hand.

**Faces.** The face is the band's outer end, never its centre. Where a solid band
sits inside a hatched one, it is the hatched band's outer line. Window sills and
frames drawn proud of the wall are not wall. A thin line near a wall, such as a
garage door between two thick piers, can capture a snap: `fix` there.

**What `compare` calls agreement** (the protocol's step 3): the same outline
types; the building outlines (gla and below-grade) at IoU 99% or better; garage
and porch each at 97% or better; and no boundary point more than 3 px from the
other key's boundary of the same class. IoU is the union of a type's outlines on
a 0.5 px raster, filled as `bench:real` fills its truth mask. The 95th-percentile
distance pools both directions, sampled about every pixel.

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
latest review that approved this very key (the review stores the key's hash, so a
key changed after its approval needs a fresh review). A reviewer may not be one of
the key's annotators or its adjudicator. A plan whose record already has `checked`
is frozen: `apply` refuses it unless `--dispute ID` names the dispute that
changes it. `apply` leaves the plan otherwise as it was (image, labels,
calibration); run `node scripts/realKeys.mjs export` afterwards. A `score`
command, which judges outlines against a key by the verdict code `bench:real` uses,
arrives with the benchmark's shared library.

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
