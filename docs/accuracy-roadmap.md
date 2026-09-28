# Accuracy: the scoreboard and the road to it

The goal is an outline that is right, or one or two easy fixes from right, on
90% of the plans the app sees. This file says how that is measured, where the
tracer stands, what stands in the way, and keeps a log of every change that
moved the numbers. `npm run bench:cubicasa` prints the scoreboard at the top of
every run; `npm run bench:real` prints it for real listing plans.

## The scoreboard

Measured on the listing-like plans of CubiCasa5K — the `colorful` and
`high_quality` categories, single homes on a clean sheet, the closest thing in
the dataset to a listing plan. The architectural sheets (three quarters of the
dataset, with neighbouring flats and dimension strings on the page) are
reported beside them, not mixed in.

| Number | Target | Test split, `e8379f6` |
|---|---|---|
| **Near-perfect** | ≥ 90% | 85.3% |
| **Perfect** | ≥ 75% | 54.3% |
| **Wrong but shown as good** | ≤ 2% | 8.6% |

- **Perfect**: the traced outline overlaps the true living area by at least
  97%. On the plans that reach it, the area is within 2% nine times in ten.
- **Near-perfect**: perfect, or perfect once at most two mistakes are fixed,
  each no bigger than a fifth of the home — a balcony left in, a closet left
  out. A bigger mistake is a redraw, not a fix.
- **Wrong but shown as good**: a wrong outline the app would show green
  (confidence ≥ 75%). The dangerous case: nothing tells the user to check it.

Near-perfect is the goal; perfect is the stricter number, and the one to push
once the goal is in reach; the third is the one that must not grow while the
other two do. Each run also shows the three numbers for two slices: sheets with
**several floors**, and plans that **label a non-GLA space**.

The answer key is CubiCasa's annotation turned into what a US appraiser counts
(`datasets/README.md`): outdoor spaces the annotators typed as rooms and
outbuildings are non-GLA, rooms they never typed are not scored, and plans
whose answer key cannot be trusted are skipped with a reason. It is versioned;
the numbers above are under version 2. Tightening it lowered the scoreboard by
about a point — the old key forgave some mistakes and charged some correct
traces, and neither belongs in the score.

## Running it

The corpus is downloaded once per machine (`datasets/README.md`).

- `npm run bench:cubicasa -- --watch NAME` — the plans that show one failure,
  listed in `scripts/lib/cubicasaReview.json`: seconds, for the first try.
- `npm run bench:cubicasa -- --split dev` — 400 plans of train, weighted toward
  the listing-like ones, about two minutes. The loop for a change in progress.
- `--split train` (4,200 plans) and `--split val` to confirm a change;
  `--split test` only at milestones, so its numbers stay honest.
- `--compare <run>` puts a change against a saved run, plan by plan, scoreboard
  first; `--draw-changed` draws every plan whose verdict moved.
- `npm run bench:real` — the scoreboard on real listing plans saved as
  corrected `.floorplan` files in `datasets/real/`.

A detection change reports the scoreboard before and after in its PR and adds
a row to the log below. Saved runs to compare against are named for the commit
they measured: `master-<sha>-<split>`.

## Where the errors are

Measured on train at `15a0d86` under the first answer key, 971 listing-like
plans, before the glazing fix:

- **Non-GLA space the plan names stays in the outline.** 29.5% of the balconies,
  terraces, porches and garages a plan labels were counted as living area, on a
  third of the plans. Three mechanisms: the space sits behind a wall of glazing
  and merges with the room it opens off (58–87% of cases; fixed since); its
  tinted fill reads as solid wall, so there is no space to carve (9–22%); its
  label falls in a pocket too small to be the space (3–20%).
- **The wrong plans (16.5%)** are mostly one big mistake: a whole floor or wing
  missed (46 plans), a large non-GLA space kept (35), or a large area that is not
  a room taken in — a page border, a courtyard between wings, part of the yard
  (35). The rest have several smaller mistakes (44).
- **The near-perfect ones** mostly need a non-GLA space removed: 256 of the 405
  that are not already perfect.
- **Confidence** does not yet separate right from wrong: 10.4% of plans were
  wrong and shown as good.
- **Scale**: with every label read perfectly, 54.5% of these plans get a scale
  within 2%. CubiCasa's feet-inches are converted from metric sizes, which the
  scale selection reads as metric labels, so part of this is the dataset.

After the glazing fix, 24 of the 130 listing-like train plans still wrong were
looked at one by one: 19 were the tracer's mistake, 2 were the answer key's (a
terrace and a lawn typed as rooms, since fixed by rule), and 3 were ambiguous (a
sheet of several units; untyped rooms, since unscored). Of the tracer's 19:

- **8 have walls drawn in a light tone** — grey, green, tan, blue. The tracer
  follows the fixtures and line work and misses rooms, or the whole plan. The
  largest single class.
- 3 left a labelled balcony, porch or terrace in (partly carved, a tiled
  terrace floor, a label written by hand).
- 2 traced a page border; 2 closed two drawings side by side into one; 2 took
  text or a door swing into the outline (one of them also light-walled); 3
  traced an exterior wall drawn as two lines along the inner one.

Sheets with several floors do worst of any slice: 38% perfect on dev, against
58% overall (13% against 54% before the drawings were cut apart).

## The road

In order of how much each is worth. Each is its own PR: tried on its watch
list, measured on dev, then train and val.

1. **Labelled non-GLA space behind glazing.** Carve it from behind the window
   wall, and say so whenever a labelled space cannot be separated. *Done.*
2. **Light-toned walls** (watch list `light-walls`). A third of the wrong plans
   in the review; four of the eight are missed whole. *Done for walls the
   binarizer's fill-aware split set aside as tinted fill* — six of the eight.
   The other two lose a room behind a run of windows drawn in thin, light
   lines that nothing closes. In `13695` the windows sit in a diagonal wall.
   In `9417` a 330 px window is drawn as three light strips, and the glazing
   rescue reads only one solid band. Its wall-thickness estimate also misses
   the 26 px grey walls: runs longer than 3% of the page are not counted.
   `colorful/1680` went from perfect to wrong through its windows too, by
   another route. The windows split the house into two wings with the living
   room between them. Now that each wing's grey walls enclose it, the `join`
   pass of remediation refuses to rejoin them, as it refuses two separate
   drawings.
3. **Sheets with several floors**: floors missed, or closed together into one
   outline (`drawings-merged`). *Done where open page separates the drawings.*
   One wall network held both, and the weld closed the gap along their aligned
   walls; now the network is cut along a clear band between them. On train, 117
   of the 190 sheets trace as many outlines as they draw, up from 29, and 37%
   are perfect, up from 17%. Still merged: a gap with an entrance or a stair
   drawn in it, drawings that overlap along both axes, and one that closes a
   room only with a weld across the gap. A garage drawn apart from the house
   now traces as a floor of its own, which the carve cannot take whole (item 4).
4. **Labelled non-GLA space still kept**: a tinted fill that reads as solid
   wall, a tiled floor, a partial carve (`non-gla-kept`). *Done for decks
   drawn in boards* (`boarded-decks`), the largest group: on train, 70 listing
   plans had a labelled space inside the outline that no route of the carve
   answered, and on about half the label sat on boards or tiles the carve's
   barrier read as wall. The boards carve takes those whose boards chain
   cleanly: on train it leaves fewer labelled spaces inside the outline on 12
   listing plans and 160 architectural sheets, and more on none. Still kept:
   a balcony whose door onto the room sits
   at a corner (the barrier closes a door only between collinear wall), a
   balcony and room one cavity even with window lines as wall, hatching dense
   enough to fuse solid, paving spaced wider than a board, a label in
   handwriting, and a garage drawn apart from the house, which now traces as
   a floor of its own that the carve cannot take whole.
5. **Things stuck to the outline**: door swings outside the exterior wall, entry
   steps, watermark text against a wall (`stuck-to-outline`), and page borders
   (`page-border`).
6. **Exterior walls drawn as two lines**, traced along the inner one
   (`double-line-walls`).
7. **Unlabelled balconies and decks**: find them from the drawing, or at least
   flag them.
8. **Confidence that predicts the verdict**, so a wrong outline is not shown
   green.
9. **One-click fixes in the app**: click a space to take it out of the outline,
   or put it back. This is what makes a near-perfect outline quick to finish.
10. **Scale**: separate what CubiCasa's converted labels cause from real errors.

## Beyond CubiCasa

- CubiCasa5K is Finnish plans; the app sees US listing plans. The last word on
  the scoreboard should come from 50–100 real listing plans, scored the same
  way by `npm run bench:real`, with the truth drawn by correcting the app's own
  outline. The nine fixtures score perfect there, but they are the plans the
  tracer was developed on; only fresh plans are a fair test.
- The dataset is CC BY-NC-SA 4.0: measure with it, ship nothing derived from
  it. A model trained on it would carry the non-commercial terms into the app.

### Real plans

75 pages of US house-plan books, 1914 to 1963 (`datasets/README.md`). Claude
drew every answer key and no person has checked one yet, so these numbers are
provisional: a key corrected later moves them.

| Date | Tracer | Plans | Near-perfect | Perfect | Wrong, shown good |
|---|---|---|---|---|---|
| 2026-09-28 | `61e28d8` | 75 | 44.0% | 12.0% | 49.3% |

The same tracer scores 85.5%, 55.2% and 11.0% on CubiCasa's listing-like val
plans. Here it fails one way: it takes in too much. Living space left out
averages 0.5% of the home; non-GLA space kept averages 18.3%, anything else
taken in 13.6%.

- **A porch, terrace or garage kept** (road item 4) is the largest mistake on
  30 of the 42 wrong plans and 16 of the 24 near-perfect ones. The scan read a
  non-GLA label on 20 of those 30, and the app said it could not remove one
  (`non-gla-not-removed`) on 9.
- **Something else taken in** is the largest mistake on the other 12 wrong
  plans: drive courts, planting and terraces drawn around the house, dimension
  lines, an unexcavated basement, two drawings joined (items 3 and 5).
- **Confidence does not warn**: 37 of the 42 wrong plans would show green.
- Traced bare, without the scan's rooms, 33.3% are near-perfect.

## Log

Listing-like plans. Numbers under different answer keys are not comparable.

| Date | Change | Key | Split | Plans | Near-perfect | Perfect | Wrong, shown good |
|---|---|---|---|---|---|---|---|
| 2026-09-26 | Baseline, `15a0d86` | 1 | train | 971 | 83.5% | 41.8% | 10.4% |
| 2026-09-26 | Baseline, `15a0d86` | 1 | val | 155 | 79.4% | 42.6% | 12.3% |
| 2026-09-26 | Baseline, `15a0d86` | 1 | test | 130 | 80.8% | 45.4% | 12.3% |
| 2026-09-26 | Carve labelled balconies behind glazing (#262) | 1 | train | 971 | 86.6% | 52.7% | 7.9% |
| 2026-09-26 | (same) | 1 | val | 155 | 83.9% | 50.3% | 9.0% |
| 2026-09-26 | (same) | 1 | test | 130 | 86.2% | 55.4% | 7.7% |
| 2026-09-26 | Answer key 2 (the tracer unchanged), `e8379f6` | 2 | train | 870 | 86.4% | 53.3% | 7.8% |
| 2026-09-26 | (same) | 2 | val | 145 | 80.7% | 46.9% | 11.7% |
| 2026-09-26 | (same) | 2 | test | 116 | 85.3% | 54.3% | 8.6% |
| 2026-09-27 | Give back walls the fill-aware split set aside (#265) | 2 | train | 870 | 88.4% | 54.8% | 7.7% |
| 2026-09-27 | (same) | 2 | val | 145 | 84.8% | 50.3% | 11.7% |
| 2026-09-27 | Cut apart drawings one wall network holds together (#267) | 2 | train | 870 | 89.1% | 59.2% | 7.4% |
| 2026-09-27 | (same) | 2 | val | 145 | 84.8% | 54.5% | 11.7% |
| 2026-09-27 | Carve labelled decks drawn in boards (#268) | 2 | train | 870 | 89.1% | 59.4% | 7.4% |
| 2026-09-27 | (same) | 2 | val | 145 | 85.5% | 55.2% | 11.0% |
