---
paths:
  - "src/components/**"
  - "src/index.css"
  - "tailwind.config.js"
  - "src/hooks/useViewport.js"
  - "src/hooks/useKeyboardShortcuts.js"
  - "src/utils/planStage.js"
  - "src/utils/traceIssues.js"
---

# UI shell (`src/components/`)

Most components open with a header comment explaining their layout decisions; read it before changing the component.

## Who it is for

- Appraisers and agents, often 50+, rarely technical. Optimise for readability and plain words over density and showing the machinery. Say what a thing is for in the user's terms ("the scale came from 3 rooms"), never in the pipeline's ("px/ft", "wall match", "OCR", "void", "hypothesis").
- Type floor: 13 px for anything a user must read, 12 px only for labels under icons and chips, sentence-case headings (`.card-heading`, 14 px). Numbers are the text face with `tabular-nums`; the code face is for `<kbd>` only.
- Shared button classes live in `index.css` (`.btn` + `-primary` / `-secondary` / `-quiet`); use them rather than spelling out a button's classes.

## Two shells, one workflow

- `useIsMobile()` (`max-width: 819.98px`) picks the chrome; `useIsTouch()` (`pointer: coarse`) picks target sizes. They are separate on purpose (a touchscreen laptop keeps the desktop layout with 44 px targets). The product is a desktop app; the mobile shell is kept working but not developed.
- `App.jsx` owns every workflow decision and builds `<Canvas>` once for whichever shell renders. Don't fork behaviour into `components/mobile/`: the mobile measurement sheet renders the same `MeasurementDock` (restyled by the `.touch-dense` scope in `index.css`), and the tool sheet reads the same `TOOL_GROUPS` (`toolCatalog.js`). Dock props the phone shell does not pass (the outline and scale fixes) are optional; a card without a handler omits the action.
- Anything the dock tells the user must be on the page, not only in a `title` — a tooltip does not exist on a phone.

## Desktop layout

- Top band `TopBar.jsx` (48 px): `[mark FloorTrace · File · View · Help] | [Open · Undo · Redo] ⋯ [Panel] | [Export]`. With no plan open it is the name, the menus and Open only. Below it, the plan column: `StatusBar` (36 px, only with a plan or while one loads) → `DocumentTabs` → canvas, inset between the measurement dock (left, 340 px, only with a plan) and the tool rail (right, 76 px).
- The band names no pipeline stage. Opening a plan reads its dimensions, sets the scale and traces the outline by itself; the corrections live on the dock card for the result they correct (Outline, Scale), and the modal tools on the rail. The mark is not a button — closing lives in File.
- No control in the band is filled. Export is outlined `-ready` once there is an area, never filled; the dock's Export button fills only when nothing is left to check. A disabled control is never the primary anywhere.
- Menus: File (open, paste, export, copy, save, new plan tab, close, Settings…), View (fit, zoom, rotate, panel, wall lengths, snap), Help (guide, shortcuts, the tracer walkthrough). Workspace preferences — units, theme, autosave, the enhanced reader — are in `SettingsDialog.jsx`, each with a sentence; per-plan switches (wall lengths, snap) stay in View. Several-plan commands are listed only when there are several plans.
- The band fits at the 820 px desktop minimum with nothing to spare. Anything new with a label goes in a menu.
- Dropdowns share `menuSurface.jsx`. `workspaceStore.menuOpen` holds the open menu's id (`top:file`, `tools-more`, …), so opening one closes any other across components; it also blocks shortcuts. Swallow `mousedown` on triggers and panels, never on a wrapper.
- `StatusBar` is also the instruction bar for a running tool. At rest: a tip (only when there is an outline), zoom with Fit, and the save state ("Saved"). While a tool runs the band tints accent and shows the tool's name, instruction, brush, Cancel and Done. In a narrow band (container query, < 640 px) a running tool's name and instruction take their own rows and the brush label and key hints drop, so Done is never pushed off the end. Hint priority: `isProcessing` > `statusFlash` > hovered tool > the mode's instruction. Hover text and the corner count render outside the `role="status"` live region. `TOOL_MODES` (`toolModes.js`) is the only copy source for modes. The scale is never shown in pixels.
- Tool rail: labelled buttons (icon over a one-word `short`), a tooltip, and the `hint` written into `workspaceStore.toolHint` on hover. Tools in the `overflow` group (angle, remove corners, rotate) sit behind a More button, which wears a running overflow tool's icon and name. Disabled tools are `aria-disabled`, not `disabled` — a disabled button gets no hover events in Chrome.
- Tool digits run 1–9 straight down `TOOL_GROUPS` (the overflow group is last, so its digit is 9). `useKeyboardShortcuts`, `keyboardGuard` and Help read them from there. `Alt`/`Shift+1–7` switch outlines, `Ctrl+Alt+1–6` switch plans, `Ctrl+Alt+N` opens a new plan.
- Tab strip (`DocumentTabs.jsx`): only with two or more plans; tabs are as wide as their names (110–220 px) and the strip ends at the last tab; it never scrolls — overflow goes into the chevron menu. Its width is re-measured by the window `resize` listener, a `ResizeObserver` and the `dockOpen`/has-image effect deps; keep all three.
- The toast's `desktopChromePx` counts the top band, the status band when it shows, the tab strip when it exists, and 10 px. The browser tab title is always the static `FloorTrace`.
- Confirmations (`ConfirmDialog`) focus Cancel: every one of them discards work.

## Measurement dock

- Order: Area → (the calculation, when opened) → Things to check (`ChecksCard.jsx`, `#dock-checks`) → Outline (`#dock-outline`) → Scale (`#dock-scale`). The same component on mobile, so the same order.
- The Area headline prints a number only when there is a scale and an outline. With no scale the store falls back to 1 px = 1 ft; that pixel count is never shown as square feet — the card says what is missing instead, as the exhibit prints "—".
- Every verdict lives on Things to check. Its rows are `summariseIssues(...).issues` (`utils/traceIssues.js`) and its chip counts the same list, so the two cannot disagree; the Area card's "N things to check" link reads the same summary. `info` warnings and accepted ones are not counted and sit under Details with the statistics. No confidence or "wall match" percentage is shown anywhere — it reads as accuracy, which it is not. The card hides until there is an outline or an issue.
- Outline card: the list (rename, hide, delete, "Counts as"), add another, and "Outline not right?" fixes (next-best outline, paint, corners, find again) — open by themselves when there is something to check. With no outline it offers the ways to make one, led by the brush after a failed trace, and while a hand-drawn outline is in progress it says how to finish instead.
- Scale card: where the scale came from (`scaleProvenance`), the size of the room in the green box (editable), and the ways to change it (another room, a length you know, back to the automatic scale, read again).

## Canvas and touch

- Nothing the eager shell imports may pull konva into the entry's static graph: `DocumentTabs` imports no canvas component, and `canvas/imageCache.js` and `canvas/wallSnapEngineCache.js` must stay import-free. `npm run build && npm run check:bundle` catches a regression.
- Touch: `useToolRouter` routes one-finger touches into the same `dispatchPointerDown` as the mouse; two fingers drive the camera (`usePinchZoom`). Test buttons with `button != null && button !== 0` (a `TouchEvent` has no `button`). A gesture that grows a second finger commits rather than cancels. Handles keep their drawn size and get a `hitFunc` sized in `/scale` (~44 screen px). Deleting a vertex on touch is a 500 ms press-and-hold.

## Styling

- Colours are `rgb(var(--token) / <alpha-value>)`. An opacity modifier on `current` (`border-current/40`) or one outside the configured opacity scale compiles to no CSS at all, and the element silently falls back to a theme-blind default. Name the token (`border-warn/40`).
- The chrome tokens in `index.css` and the canvas/exhibit colours (exact Dracula values, persisted in `.floorplan` files) are two deliberate palettes. Don't unify them.
- Check contrast of a self-tint (`bg-accent/12` with `text-accent`) composited over its real parent; a token-pair check misses the loss.
- Never bind `Ctrl+Shift+C` — it is the browser's element inspector.
