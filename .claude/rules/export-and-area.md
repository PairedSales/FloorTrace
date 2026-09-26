---
paths:
  - "src/utils/exhibit/**"
  - "src/utils/areaDecomposition.js"
  - "src/utils/areaDerivation.js"
  - "src/utils/derivationText.js"
  - "src/utils/scaleProvenance.js"
  - "src/components/WorkCard.jsx"
  - "src/components/ExportDialog.jsx"
  - "src/hooks/useExhibitExport.js"
  - "src/hooks/useProjectIO.js"
  - "src/utils/projectSerializer.js"
---

# Exhibit export and the area working

## Exhibit (`src/utils/exhibit/`)

- The exhibit PNG — the plan with its outlines burned in plus a summary block — is the primary output; users trace once for one appraisal workfile. The `.floorplan` file is secondary ("Save editable project").
- `model.js` decides what the page says → `compose.js` turns it into a display list of `{op}` records → `index.js` paints it and delivers the file. Test layout by asserting on `layout.ops`, not pixels.
- The exhibit describes the state it is handed: it uses `computeAreaByType(state)`, never the live-store memo.
- It must look like the screen the user approved: wall-length labels sit inside the polygon exactly as `PerimeterLayer` draws them, and overlays are placed into page space through `project()` rather than a rotated canvas context, so labels stay upright under `canvasRotation`.
- `scaleProvenance.js` is the single source for where the scale came from (it reads `calibration.quality.roomCount`); the dock, the exhibit and the working card all state it. It is a leaf module so the dock doesn't pull the exhibit graph into the entry chunk.
- The save picker opens before encoding: encoding a large page spends the click's user activation.
- Shortcuts: `Ctrl+E` opens the export dialog, `Ctrl+Alt+C` copies the exhibit, `Ctrl+S` saves the project. Never `Ctrl+Shift+C`.

## Area working (`WorkCard.jsx`, `areaDerivation.js`, `areaDecomposition.js`)

- Total GLA only, laid out like an appraisal workfile's calculation page: one line per rectangle or right triangle (`13.7 × 11.8 = 161.7`), summed per level. Off by default (`workspaceStore.showWork`).
- `areaDecomposition.js` documents its algorithm in its header. The decisions not to undo: peel by the largest `min(width, height)` then by area (two comparisons, never a packed numeric key); rotate onto the outline's dominant direction only when enough of the perimeter agrees; snap only float noise (`SNAP_REL`), since a physical tolerance chains across staircases; emit a trapezoid's two wedges separately; compute products from unrounded lengths and apportion rounding by largest remainder so the column adds up exactly.
- When no cut reproduces the shoelace area the result is `exact: false` and the card states the area without a breakdown. Refuse rather than mislead.
- Areas are square feet internally. Convert factors for display units; never relabel them.
