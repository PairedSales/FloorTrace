# Accuracy: the scoreboard and the road to it

The goal is an outline that is right, or one or two easy fixes from right, on
90% of the plans the app sees. This file says how that is measured, where the
tracer stands, what stands in the way, and keeps a log of every change that
moved the numbers. `npm run bench:cubicasa` prints the scoreboard at the top of
every run.

## The scoreboard

Measured on the listing-like plans of CubiCasa5K — the `colorful` and
`high_quality` categories, single homes on a clean sheet, the closest thing in
the dataset to a listing plan. The architectural sheets (three quarters of the
dataset, with neighbouring flats and dimension strings on the page) are
reported beside them, not mixed in.

| Number | Target | Test split at `15a0d86` | Test split now |
|---|---|---|---|
| **Near-perfect** | ≥ 90% | 80.8% | 86.2% |
| **Perfect** | ≥ 75% | 45.4% | 55.4% |
| **Wrong but shown as good** | ≤ 2% | 12.3% | 7.7% |

- **Perfect**: the traced outline overlaps the true living area by at least
  97%. On the plans that reach it, the area is within 2% nine times in ten.
- **Near-perfect**: perfect, or perfect once at most two mistakes are fixed,
  each no bigger than a fifth of the home — a balcony left in, a closet left
  out. A bigger mistake is a redraw, not a fix.
- **Wrong but shown as good**: a wrong outline the app would show green
  (confidence ≥ 75%). The dangerous case: nothing tells the user to check it.

Near-perfect is the goal; perfect is the stricter number, and the one to push
once the goal is in reach; the third is the one that must not grow while the
other two do.

## Running it

The corpus is downloaded once per machine (`datasets/README.md`).

- `npm run bench:cubicasa -- --split dev` — 400 plans of train, weighted toward
  the listing-like ones, about two minutes. The loop for a change in progress.
- `--split train` (4,200 plans) and `--split val` to confirm a change;
  `--split test` only at milestones, so its numbers stay honest.
- `--compare <run>` puts a change against a saved run, plan by plan, scoreboard
  first; `--draw-changed` draws every plan whose verdict moved.

A detection change reports the scoreboard before and after in its PR and adds
a row to the log below.

## Where the errors are

Train split at `15a0d86`, listing-like plans (971):

- **Non-GLA space the plan names stays in the outline.** 29.5% of the balconies,
  terraces, porches and garages a plan labels were counted as living area, on a
  third of the plans. Three mechanisms: the space sits behind a wall of glazing
  and merges with the room it opens off (58–87% of cases); its tinted fill reads
  as solid wall, so there is no space to carve (9–22%); its label falls in a
  pocket too small to be the space (3–20%).
- **The wrong plans (16.5%)** are mostly one big mistake: a whole floor or wing
  missed (46 plans), a large non-GLA space kept (35), or a large area that is not
  a room taken in — a page border, a courtyard between wings, part of the yard
  (35). The rest have several smaller mistakes (44).
- **The near-perfect ones** mostly need a non-GLA space removed: 256 of the 405
  that are not already perfect.
- **Confidence** does not yet separate right from wrong: 10.4% of plans are wrong
  and shown as good.
- **Scale**: with every label read perfectly, 54.5% of these plans get a scale
  within 2%. CubiCasa's feet-inches are converted from metric sizes, which the
  scale selection reads as metric labels, so part of this is the dataset.

## The road

In order of how much each is worth. Each is its own PR, measured on dev, then
train and val.

1. **Labelled non-GLA space behind glazing.** Carve it from behind the window
   wall, and say so whenever a labelled space cannot be separated. *Done.*
2. **Labelled non-GLA space with a tinted fill**, which reads as solid wall.
3. **Things stuck to the outline**: door swings outside the exterior wall, entry
   steps, watermark text against a wall, page borders.
4. **Missing floors and wings** on sheets with several plans.
5. **Courtyards and gaps between wings** closed over.
6. **Unlabelled balconies and decks**: find them from the drawing, or at least
   flag them.
7. **Confidence that predicts the verdict**, so a wrong outline is not shown
   green.
8. **One-click fixes in the app**: click a space to take it out of the outline,
   or put it back. This is what makes a near-perfect outline quick to finish.
9. **Scale**: separate what CubiCasa's converted labels cause from real errors.

## Beyond CubiCasa

- CubiCasa5K is Finnish plans; the app sees US listing plans. The last word on
  the scoreboard should come from 50–100 real listing plans, scored the same
  way, with the truth drawn by correcting the app's own outline.
- The dataset is CC BY-NC-SA 4.0: measure with it, ship nothing derived from
  it. A model trained on it would carry the non-commercial terms into the app.

## Log

Listing-like plans. Train is 971 plans, test 130.

| Date | Change | Split | Near-perfect | Perfect | Wrong, shown good |
|---|---|---|---|---|---|
| 2026-09-26 | Baseline, `15a0d86` | train | 83.5% | 41.8% | 10.4% |
| 2026-09-26 | Baseline, `15a0d86` | val | 79.4% | 42.6% | 12.3% |
| 2026-09-26 | Baseline, `15a0d86` | test | 80.8% | 45.4% | 12.3% |
| 2026-09-26 | Carve labelled balconies behind glazing; refuse a carve that cuts off a wing | train | 86.6% | 52.7% | 7.9% |
| 2026-09-26 | (same) | val | 83.9% | 50.3% | 9.0% |
| 2026-09-26 | (same) | test | 86.2% | 55.4% | 7.7% |
