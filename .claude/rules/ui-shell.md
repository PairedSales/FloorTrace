---
paths:
  - "src/components/**"
  - "src/index.css"
  - "tailwind.config.js"
  - "src/hooks/useViewport.js"
  - "src/hooks/useKeyboardShortcuts.js"
  - "src/hooks/useMenu.js"
  - "src/hooks/usePlanIssues.js"
  - "src/hooks/useCornerPlacement.js"
  - "src/utils/planStage.js"
  - "src/utils/notify.js"
  - "src/utils/progressSteps.js"
  - "src/utils/traceIssues.js"
---

# UI shell (`src/components/`)

Most components open with a header comment explaining their layout decisions; read it before changing the component.

## Who it is for

- Appraisers and agents, often 50+, rarely technical. Optimise for readability and plain words over density and showing the machinery. Say what a thing is for in the user's terms ("the scale came from 3 rooms"), never in the pipeline's ("px/ft", "wall match", "OCR", "void", "hypothesis").
- The screen reads as three things: **the answer** (results panel, left), **the plan** (right), and **what you can do to it** (action bar, above the plan). At rest a finished plan shows about twenty controls. Before adding one, ask whether it is needed before the user asks for it; if not, it belongs behind a menu or inside a folded section.
- One name per thing, in both shells: *Save image* (never "export"), *outline*, *scale*, *plan*, *room sizes* (never "dimensions"), *results panel*. `HelpModal.jsx` quotes control names, and its test ties them to `toolCatalog.js`.

## The design system (`index.css`)

- Type: 14 px for anything read, 13 px for the line under it, 12 px only for chips and key caps. Numbers are the text face with `tabular-nums`; the code face is for `<kbd>` only.
- Classes: `.btn` + `-primary` / `-secondary` / `-quiet` / `-danger`, sizes `-sm` / `-lg`; `.icon-btn`; `.link-btn`; `.field-input`; `.seg` / `.seg-option` (pressed state from `aria-pressed`); `.chip` + `-ok` / `-warn` / `-crit` / `-quiet`; `.note` + `-warn`; `.label-sm`; `.menu-trigger`. Use them rather than spelling out a control's classes.
- Components, where a pattern owns behaviour as well as a look: `Menu.jsx` (every dropdown), `Dialog.jsx` (every dialog), `PanelSection.jsx` (every fold of the panel).
- **One filled button on screen at a time**, and never a disabled one. In the panel it is Save image, as soon as there is an area; in a state that needs something from the user it is the one way to supply it.

## Two shells, one workflow

- `useIsMobile()` (`max-width: 819.98px`) picks the chrome; `useIsTouch()` (`pointer: coarse`) picks target sizes. They are separate on purpose (a touchscreen laptop keeps the desktop layout with 44 px targets). The product is a desktop app; the mobile shell is kept working but not developed.
- `App.jsx` owns every workflow decision and builds `<Canvas>` once for whichever shell renders. Don't fork behaviour into `components/mobile/`: the mobile measurement sheet renders the same `ResultsPanel` (`mobile`, restyled by the `.touch-dense` scope in `index.css`), and the tool sheet reads the same `TOOL_GROUPS` (`toolCatalog.js`). Panel props a shell does not pass are optional; a section without a handler omits the action.
- Anything the panel tells the user must be on the page, not only in a `title` — a tooltip does not exist on a phone.

## Desktop layout

- **Header** `AppHeader.jsx` (52 px): `[mark FloorTrace] [plan tabs · Add plan] ⋯ [Autosaved] [Undo · Redo] | [Help] [Menu]`. It is a frame, not a menu bar: no File/View/Help, and no filled button. With no plan open it is the name, Help and Menu.
- **Menu** (the one in the header): open, paste; save image, copy image, save project file; the three per-plan switches (wall lengths, snap, results panel); Settings; close. Rows about the plan are listed only with a plan open, several-plan rows only with several plans. Workspace preferences — units, theme, autosave, the slower reader — are in `SettingsDialog.jsx`, each with a sentence.
- **Plan tabs** (`PlanTabs.jsx`) live in the header, because the panel changes with the plan as well as the canvas. Shown from the first plan (one tab is the plan's name); tabs are as wide as their names (120–230 px) and never scroll — overflow goes into a menu. The width is re-measured by the window `resize` listener, a `ResizeObserver` and the plan-count/has-image effect deps; keep all three. The last plan can be closed from its tab (it empties in place).
- **Results panel** (`ResultsPanel.jsx`, 360 px, left, only with a plan) and the **plan column**: `ActionBar` (48 px, only with a plan) over the canvas, with `ViewControls` (zoom, Fit) floating in the canvas's bottom-right corner.
- **Start screen** (`WelcomeScreen.jsx`, rendered by `Canvas`): the whole window below the header until a plan is open. A drop zone, "Choose a file…" and the sample; on a first run the demo and three steps sit beside it. It wears the theme — only a plan gets the white paper (`canvas-grid-bg`). A second plan's empty tab shows the same screen with `adding`.
- `desktopChromePx` is what a notice has to clear — the header, the action bar when there is a plan, and 10 px. The browser tab title is always the static `FloorTrace`.

## Action bar (`ActionBar.jsx`)

- At rest: three menus — **Outline**, **Measure**, **Edit plan** — whose rows come from `TOOL_GROUPS` (`toolCatalog.js`), each with a name, a sentence and its digit. The scale's corrections are not here: the scale is a number, and it is corrected in the panel's Scale section.
- A group is `tools` (modes: they have a digit, a `TOOL_MODES` entry and a tile on the phone), `commands` (things that happen once) and `menu` (the desktop order, `'-'` for a rule). A group without `menu` is not a bar menu. Rows that cannot be used stay in place, greyed, with the reason as their sentence (`aria-disabled`, never `disabled` — the row must stay reachable to say why).
- While a tool runs the menus stand down and the bar is that tool's instruction: name, hint, corner count, brush, and the way out. `TOOL_MODES` (`toolModes.js`) is the only copy source. A tool that commits something has `doneLabel` and is left with Cancel + that; a tool with nothing to commit has `leaveLabel: 'Done'` and that is its one, filled, button.
- Priority in the lead: `isProcessing` > a flash > the offer to find the outline again > the mode's instruction or the idle tip. A job starting silences the flash the last one ended on. The menus stay during processing (a wedged job must not lock out every tool); commands that start work wait for a running job, tools do not.
- The idle tip is the standing answer to "the outline is not right" — drag a corner, or redraw it from the Outline menu. It replaces saying so about each trace.
- After the plan's image is edited (marks erased, a crop) the bar at rest offers "Find the outline again" (`workspaceStore.retraceOfferFor`, per plan). An offer, never an automatic re-trace: the outline may have been adjusted by hand. Any trace clears it.
- Words give way, never controls: everything in `.action-lead` truncates, and Stop, Cancel and Done live outside it. In a narrow bar (container query, < 640 px) a running tool's instruction takes its own row and the key hints drop. A flash is shown only for what is left of its window. The corner count and the elapsed seconds render outside the `role="status"` live region. The scale is never shown in pixels.
- Tool digits run 1–9 straight down `TOOL_GROUPS`. `useKeyboardShortcuts`, `keyboardGuard` and Help read them from there; `keyboardGuard` finds the image-rewriting digits by the group id `image`. `Alt`/`Shift+1–7` switch outlines, `Ctrl+Alt+1–6` switch plans, `Ctrl+Alt+N` adds a plan.
- **Cancel means cancel.** Painting keeps the outline it will replace on the plan until the new one is drawn. Placing corners clears it, and `useCornerPlacement` puts it back if placement ends without a finished outline. An outline added (`addOutline`, the route every "Add another outline" takes) and abandoned before it is drawn is taken out of the list again — unless the user went to the brush to paint it. Either way the undo points saved along the way are dropped.

## Feedback: who says what (`utils/notify.js`)

There are no toasts. Measured before they were removed, eight of the nine sample plans raised at least one after a trace, two raised a pair within 12 ms, and on two the toast contradicted the panel — every stage of the automatic run reported on itself, each on its own channel, and each was also worked out a second time for the panel.

- **The panel** says anything about the measurement that is still true: the area or what is missing, a doubtful scale, why there is no outline. Never a passing message.
- **`flash(text, tone)`** — the action bar's lead (the phone's pill): what just happened to the plan, one line, latest wins. `'ok'` (green) when it was done, `'warn'` (amber, and on screen longer) when it was not and why. A whole automatic run ends in exactly one: `reportTrace` in `App.jsx`. A step of a run never flashes for itself; when a second thing must be said about a run (a kept hand-set scale, a room whose walls were not found) it is flashed *after* the trace, because the bar keeps only the latest.
- **`flashAt(text, anchor)`** — a refusal with a place on the plan: the words in the bar, the crossing edges lit on the canvas (`RefusalHighlightLayer`).
- **`notify(text, {type, action})`** — `Notice.jsx`, one card over the plan, for what went wrong *outside* the plan and has nowhere of its own to be said: a file that would not open, a save that failed, storage that is full, a plan that could not be restored. `'error'` or `'warning'` only — it throws on anything else, so good news and bulletins cannot creep back. One slot: a second notice replaces the first. On a plan that opens and traces normally it never renders.
- **A dialog says its own errors**, inside itself (`.note-crit` in the Save image dialog; the slower reader's status on its own switch in Settings). Nothing is raised behind a dialog's backdrop.
- **`askConfirm()`** — anything that destroys work.
- A message that only echoes what is already on screen gets no channel at all. Before adding one, find which of the above it is; if it is "still true in a minute", it is the panel's.

## Menus and dialogs

- `Menu.jsx` is every dropdown. `workspaceStore.menuOpen` holds the open menu's id (`main`, `bar:outline`, `tabs-overflow`, …), so opening one closes any other across components; it also blocks shortcuts (`keyboardGuard`). Menus sharing a `group` switch on hover once one is open. Swallow `mousedown` on triggers and panels, never on a wrapper — mouse buttons 3/4 (undo/redo) are read off the same window event.
- `Dialog.jsx` is every dialog: Escape closes it and only it (capture, stopped), Tab stays inside, focus is taken on open and returned on close, a press on the backdrop closes. `ConfirmDialog` focuses Cancel and has no close button: every one of them discards work.

## Results panel (`ResultsPanel.jsx`)

- Order: the area → Outline (`#panel-outline`) → Scale (`#panel-scale`) → How the area was calculated (`WorkSection.jsx`, `#panel-work`) → Save image, pinned to the foot. The same component on mobile, where Save sits under the figure.
- Each section is a `PanelSection`: folded, it is a title and its own conclusion ("Measured from 3 rooms on this plan"). A section opens by itself when it holds the next thing to do (outline: none drawn, or several, or one of the notes below; scale: none, a doubt about it, or the length tool / room picker is on) and otherwise stays how it was last left; a plan switch resets that. While FloorTrace is first measuring a plan the sections stand down and the panel shows the job in three steps (`progressSteps.js`), ticking only steps that produced something.
- The area prints a number only when there is a scale and an outline. With no scale the store falls back to 1 px = 1 ft; that pixel count is never shown as square feet — the panel says what is missing instead, as the exhibit prints "—".
- **The panel says nothing about how well an outline follows the walls.** There is no "Things to check" list, no detector warning, no confidence or "wall match" percentage and no "check it" anywhere: the outline is on the plan and the user looks at it. That was the owner's call (October 2026) — don't reintroduce a verdict on the outline, in any form, without being asked.
- What a picture cannot show *is* said, inside the section it is about: a doubtful scale and a held-back scale under Scale, an area counted twice and a cut-out no longer taken off under Outline. They are the `issues` of `usePlanIssues()` (the one place `summariseIssues`' arguments are gathered), each a `CheckNote`; the section opens by itself and wears a "Check" chip while it holds one. They never gate Save image, which is the filled button as soon as there is an area.
- A finding and what to do about it are separate strings (`detail` / `remedy` in `boundaryQuality.js`): the exhibit prints the finding, and must not tell its reader which button to press. A remedy is read only inside Scale, directly over the buttons it names.
- Outline section: the list (rename, hide, delete, "Counts as", and where a type FloorTrace chose was read from), add another, and inside/outside of walls. With no outline it offers the ways to make one, led by the brush after a failed trace, with the trace's reason when it gave one — the only time a detector reason is put into words. Redrawing an outline that exists is the action bar's Outline menu, not repeated here.
- Scale section: where the scale came from (`scaleProvenance`), the size of the room in the green box (editable), and the ways to change it (another room, a length you know, back to the automatic scale — offered for any scale set by hand, `isUserAsserted` — and read again). While a length is being measured it is only the lengths and the box to type into, which takes the focus.
- The green box (the room the scale came from) is drawn on the plan only while Scale is open, there is no scale, or a room is being picked (`workspaceStore.scaleRoomShown`, `App.jsx`); the phone always draws it. It is draggable, and dragging it re-sets the scale.
- "A room is being picked" is `selectPickingRoom` (`appStore.js`), and nothing else: the bar's `pick` mode, the panel opening Scale and the canvas drawing the room sizes as buttons all read it. It is false while a job runs, because the automatic run passes through the same store state. The canvas used to take it as a prop, the prop was dropped from `<Canvas>`, and the buttons silently stopped being drawn for five weeks — read it from the store.
- Units are a setting, not a control on the panel.

## Canvas and touch

- Nothing the eager shell imports may pull konva into the entry's static graph: `PlanTabs` imports no canvas component, and `canvas/imageCache.js` and `canvas/wallSnapEngineCache.js` must stay import-free. `npm run build && npm run check:bundle` catches a regression.
- Touch: `useToolRouter` routes one-finger touches into the same `dispatchPointerDown` as the mouse; two fingers drive the camera (`usePinchZoom`). Test buttons with `button != null && button !== 0` (a `TouchEvent` has no `button`). A gesture that grows a second finger commits rather than cancels. Handles keep their drawn size and get a `hitFunc` sized in `/scale` (~44 screen px). Deleting a vertex on touch is a 500 ms press-and-hold.

## Styling

- Colours are `rgb(var(--token) / <alpha-value>)`. An opacity modifier on `current` (`border-current/40`) or one outside the configured opacity scale compiles to no CSS at all, and the element silently falls back to a theme-blind default. Name the token (`border-warn/40`).
- The chrome tokens in `index.css` and the canvas/exhibit colours (exact Dracula values, persisted in `.floorplan` files) are two deliberate palettes. Don't unify them.
- `.canvas-grid-bg` is the paper: white in both themes, and it re-applies the light tokens to its subtree under the dark theme. Anything inside it (the zoom controls) wears the light palette; anything that should follow the theme (the start screen) must sit outside it.
- Check contrast of a self-tint (`bg-accent/12` with `text-accent`) composited over its real parent; a token-pair check misses the loss.
- Never bind `Ctrl+Shift+C` — it is the browser's element inspector.
