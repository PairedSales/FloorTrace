# datasets/

Large external floor-plan datasets live here. Everything in this folder except
this README is git-ignored, so each machine downloads its own copy.

## CubiCasa5K

5,000 floor plans with SVG ground truth (walls, rooms, doors, windows).

- Source: https://zenodo.org/records/2613548 (`cubicasa5k.zip`, 5.5 GB)
- Paper/code: https://github.com/CubiCasa/CubiCasa5k
- Extract so the plans sit at `datasets/cubicasa5k/cubicasa5k/<category>/<id>/`
  (`F1_original.png`, `F1_scaled.png`, `model.svg`).

`datasets/cubicasa5k_coco/` holds COCO-format annotation JSONs for the same plans.
