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

## Two shells, one workflow

- `useIsMobile()` (`max-width: 819.98px`) picks the chrome; `useIsTouch()` (`pointer: coarse`) picks target sizes. They are separate on purpose (a touchscreen laptop keeps the desktop layout with 44 px targets).
- `App.jsx` owns every workflow decision and builds `<Canvas>` once for whichever shell renders. Don't fork behaviour into `components/mobile/`: the mobile measurement sheet renders the same `MeasurementDock` (restyled by the `.touch-dense` scope in `index.css`), and the tool sheet reads the same `TOOL_GROUPS` (`toolCatalog.js`).
- Anything the dock tells the user must be on the page, not only in a `title` — a tooltip does not exist on a phone.

## Desktop layout

- Top band `TopBar.jsx`: `[mark · File · View] | [Open · Undo · Redo] | [Read dimensions ▾ · Find outline ▾ · Export] ⋯ | [Fit · Panel]`. Below it, the plan column: `StatusBar` (26 px) → `DocumentTabs` → canvas, inset between the measurement dock (left) and the tool rail (right).
- The rail owns modes; the top band owns commands; a stage's corrections hang off that stage's caret. There is no Trace menu.
- Exactly one control carries the filled accent: the stage the plan is at (`planStage` in `utils/planStage.js`, shared with the dock's `StageSpine`). A disabled control is never the primary. Export is never filled — outlined `-ready` at most, with `aria-current="step"`. The primary treatment never changes a control's width.
- The band fits at the 820 px desktop minimum with ~90 px to spare. Anything new with a label spends that slack; put it in a menu or drop a label.
- Dropdowns share `menuSurface.jsx`. One is open at a time via `workspaceStore.menuOpen`, which also blocks shortcuts. Swallow `mousedown` on triggers and panels, never on a wrapper.
- `StatusBar` is also the context bar for a running tool. One grow cell (only the hint truncates, nothing scrolls). Hint priority: `isProcessing` > `statusFlash` > hovered tool > the mode's instruction. Hover text and the vertex count render outside the `role="status"` live region. Scale/zoom/draft cells stand down while a tool runs (except a draft that is not being kept), and the band tints accent. `TOOL_MODES` (`toolModes.js`) is the only copy source for modes.
- Tool rail: every tool in `TOOL_GROUPS` needs a `hint` (hover writes it into `workspaceStore.toolHint`). Disabled tools are `aria-disabled`, not `disabled` — a disabled button gets no hover events in Chrome.
- Tool digits run 1–9 straight down `TOOL_GROUPS`, and are repeated in `useKeyboardShortcuts.js` and in the `keys` of the TopBar caret items. Renumber them together. `Alt`/`Shift+1–7` switch outlines, `Ctrl+Alt+1–6` switch plans, `Ctrl+Alt+N` opens a new plan.
- Tab strip (`DocumentTabs.jsx`): only with two or more plans; tabs are as wide as their names (96–200 px) and the strip ends at the last tab; it never scrolls — overflow goes into the chevron menu, which is reachable with five or six plans. Its width is re-measured by the window `resize` listener, a `ResizeObserver` and the `dockOpen`/has-image effect deps; keep all three.
- The toast's `desktopChromePx` counts the top band, the status band and 10 px, plus the tab strip only when it exists. The browser tab title is always the static `FloorTrace`.

## Measurement dock

- Order: Room size → Area → Outlines → Scale (small, `#dock-scale`) → Checks (`ChecksCard.jsx`, `#dock-checks`). The same component on mobile, so the same order.
- Every verdict lives on the Checks card. The issue count comes from `summariseIssues` (`utils/traceIssues.js`) and appears twice — the card's chip and the Area card's "N things to check" link — so it must never be computed a second way. `info` warnings are not counted.
- A `StageSpine` stage in `warn` jumps to `#dock-checks`; `STAGE_CARD` maps the others.

## Canvas and touch

- Nothing the eager shell imports may pull konva into the entry's static graph: `DocumentTabs` imports no canvas component, and `canvas/imageCache.js` and `canvas/wallSnapEngineCache.js` must stay import-free. `npm run build && npm run check:bundle` catches a regression.
- Touch: `useToolRouter` routes one-finger touches into the same `dispatchPointerDown` as the mouse; two fingers drive the camera (`usePinchZoom`). Test buttons with `button != null && button !== 0` (a `TouchEvent` has no `button`). A gesture that grows a second finger commits rather than cancels. Handles keep their drawn size and get a `hitFunc` sized in `/scale` (~44 screen px). Deleting a vertex on touch is a 500 ms press-and-hold.

## Styling

- Colours are `rgb(var(--token) / <alpha-value>)`. An opacity modifier on `current` (`border-current/40`) or one outside the configured opacity scale compiles to no CSS at all, and the element silently falls back to a theme-blind default. Name the token (`border-warn/40`).
- The chrome tokens in `index.css` and the canvas/exhibit colours (exact Dracula values, persisted in `.floorplan` files) are two deliberate palettes. Don't unify them.
- Check contrast of a self-tint (`bg-accent/12` with `text-accent`) composited over its real parent; a token-pair check misses the loss.
- Never bind `Ctrl+Shift+C` — it is the browser's element inspector.
