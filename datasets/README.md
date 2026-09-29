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
drawn proud of a long wall can do it too: look, and move on). `unstable`:
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
`reaches-end`, `ink-beyond` or `unstable`, until the edge is drawn on the face or
listed in `fix`.

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
