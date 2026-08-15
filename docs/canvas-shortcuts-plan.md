# Canvas keyboard shortcuts — implementation plan

> **Status: planned.** Nothing below has been implemented.

Size: S–M. Touches three files that already own keyboard state, plus one new shared
guard module. Independent of `docs/undo-redo-buttons-plan.md`.

## What already exists

Three separate window `keydown` listeners are live today, and the new bindings straddle
them. Knowing which is which is most of the design:

| Listener | Scope | Owns |
|---|---|---|
| [`useKeyboardShortcuts.js`](../src/hooks/useKeyboardShortcuts.js) | App-level, always mounted | `Ctrl+V/O/S/Z/Y`, `[`/`]`, `O`, `L`, `R`/`Shift+R` |
| [`useToolRouter.js:664`](../src/components/canvas/hooks/useToolRouter.js) | Canvas-level, mounted only with the lazy `CanvasStage` | `Esc`, `Enter`, `Delete`/`Backspace` |
| [`HelpModal.jsx:37`](../src/components/HelpModal.jsx) | Only while the modal is open | `Escape` |

**`Esc` already cancels every active tool.** [`useToolRouter.js:688`](../src/components/canvas/hooks/useToolRouter.js)
handles draw mode (with a deliberate two-stage cancel: first press drops the stroke in
progress, second leaves the mode), eraser, crop, line, area, angle, and vertex
placement. This item does not reimplement that — it fills the two gaps listed in §2.

## Decisions taken

- **Digits `1`–`7` select tools; `Alt`+digit switches perimeter trace.** (See §4 for the
  Firefox conflict and the mitigation.)
- **`Delete` gets real click-to-select vertex state**, matching how measurement lines and
  custom shapes already work.
- **`Space` to pan is dropped** — not implemented, not planned.
- **Bindings are added in place**, in whichever hook owns the state they touch, with only
  the duplicated guard extracted. A full keymap-module refactor was considered and
  rejected as disproportionate to two S-sized items.

---

## 1. Shared guard module (do this first)

`src/utils/keyboardGuard.js`:

```js
export const isTypingInField = (target) => ...      // INPUT / TEXTAREA / isContentEditable
export const shortcutsBlocked = (target) =>
  isTypingInField(target) || useAppStore.getState().showHelpModal;
```

The typing check currently exists twice, copy-pasted at
[`useKeyboardShortcuts.js:34`](../src/hooks/useKeyboardShortcuts.js) and
[`useToolRouter.js:666`](../src/components/canvas/hooks/useToolRouter.js). Both call
sites adopt the shared one.

The modal half is a **real bug fix, not scaffolding**: `HelpModal` registers its own
window `Escape` listener, so with the modal open *and* a tool active, one `Esc` press
currently closes the modal **and** cancels the tool. `shortcutsBlocked` makes the modal
swallow the key, which is what the user means.

The typing guard is load-bearing for the new digit bindings specifically: the perimeter
rename field at [`LeftPanel.jsx:323`](../src/components/LeftPanel.jsx) is a text input,
and typing `1st Floor` into it must not switch traces seven times.

## 2. `Esc` — fill two gaps

No rewrite. Add to the existing branch in `useToolRouter`:

- clear `manualEntryMode` (currently `Esc` leaves the user stuck in overlay-placement
  mode with only the toast to tell them)
- clear `selectedVertexIndex` once §3 introduces it

## 3. `Delete` on a selected vertex

The largest sub-task, because **no selected-vertex state exists anywhere**.
`draggingVertex` is transient drag-only state in
[`usePerimeterEditor.js:19`](../src/components/canvas/hooks/usePerimeterEditor.js);
vertex deletion today is right-click only, via
`PerimeterLayer` → [`CanvasStage.jsx:374`](../src/components/CanvasStage.jsx) →
[`App.jsx:818`](../src/App.jsx).

Follow the pattern `selectedCustomShapeIndex` already sets
([`CanvasStage.jsx:245`](../src/components/CanvasStage.jsx)) exactly:

1. `selectedVertexIndex` + setter added to `usePerimeterEditor`'s return
   ([line 148](../src/components/canvas/hooks/usePerimeterEditor.js))
2. Threaded from `CanvasStage` into `useToolRouter` (for `Delete` and `Esc`) and into
   `PerimeterLayer` (for click-to-select and the highlight)
3. `PerimeterLayer` renders the selected vertex `Circle` with a larger radius and accent
   stroke, and sets selection on click
4. `Delete` routes to the existing `onDeletePerimeterVertex` chain
5. Selection clears on: `Esc`, trace switch, vertex-array identity change, and a
   successful delete

**Ordering inside the existing `Delete` branch** ([`useToolRouter.js:674`](../src/components/canvas/hooks/useToolRouter.js))
must be measurement line → custom shape → vertex, so a live line/shape selection is not
shadowed by a stale vertex selection.

**The `<= 3` guard needs a voice.** [`App.jsx:820`](../src/App.jsx) already refuses to
drop a perimeter below three vertices — correct, but silent. With a visible selection and
a `Delete` key, a silent no-op reads as a broken keybinding. Add a toast explaining that
a perimeter needs at least three points.

Right-click delete stays as-is.

## 4. `1`–`7` tools, `Alt`+`1`–`7` traces

`R` already rotates, and rotation is an action rather than a mode, so it stays off the
digit row. That leaves exactly seven modes for seven digits:

| 1 | 2 | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|---|
| Line | Area | Angle | Outline | Crop | Eraser | Draw Exterior |

**The mapping is fixed regardless of what the ToolsPanel is currently showing.**
Line/Area/Angle are hidden until `hasArea` is true
([`ToolsPanel.jsx:48`](../src/components/ToolsPanel.jsx)); a mapping that renumbers itself
as app state changes is worse than one that occasionally no-ops. Pressing a digit for an
unavailable tool shows a brief toast saying why.

Both bindings live in `useKeyboardShortcuts` (App-level), where every toggle handler from
`useToolManager` is already in scope and `perimeterTraces` is already subscribed.
`Alt`+digit calls `switchPerimeterTrace(perimeterTraces[n-1].id)`, no-op past the end.
The trace cap is 7 (`TRACE_COLORS.length`, enforced at
[`Toolbar.jsx:108`](../src/components/Toolbar.jsx)), so the digit row covers it exactly.

### Firefox conflict

Firefox on Windows and Linux uses `Alt`+`1`–`8` for tab switching, so those presses may
never reach the page there. `Alt`+digit is implemented as specified, and `Shift`+digit is
additionally bound as an alias for trace switching — same behaviour, no browser conflict,
no extra cost.

## 5. `F` to fit

App-level, in `useKeyboardShortcuts` next to the existing `O`/`L`/`R` block. New
`onFitToWindow` prop wired to `App.jsx`'s `handleFitToWindow`, which already calls the
imperative handle exposed by [`Canvas.jsx:22`](../src/components/Canvas.jsx). ~6 lines.

## 6. Update `HelpModal`

Add `F`, `1`–`7`, `Alt`/`Shift`+`1`–`7`, and `Delete` to the `shortcuts` array at
[`HelpModal.jsx:7`](../src/components/HelpModal.jsx). The modal is the only
discoverability surface in the app; a binding that is not listed there effectively does
not exist.

## 7. Verification

There is no browser/e2e harness, so this is `npm run lint` plus manual verification with
`npm run dev`. Walk each binding, and specifically check:

- typing into the perimeter rename field does not fire digit bindings
- `Esc` with the help modal open closes only the modal, leaving an active tool alone
- `Delete` with a measurement line selected still deletes the line, not a vertex
- deleting down to three vertices toasts instead of silently doing nothing

No detection code is touched, so `npm run bench:detection` is not required.
