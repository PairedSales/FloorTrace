---
name: run-floortrace
description: Launch FloorTrace's dev server and drive the app in the Browser pane — load a plan, let OCR and tracing run, click Konva canvas shapes, read live state — including the workarounds for the pane's hidden-document quirks (stalled rAF, ResizeObserver, media queries and CSS transitions). Use when asked to run, preview, screenshot or verify a change in the running app.
---

# Run and drive FloorTrace

## Launch

1. A fresh worktree has no `node_modules`: run `npm ci` if it is missing, or the dev server resolves the main checkout's packages.
2. `preview_start` with `name: "floortrace-dev"` (`.claude/launch.json`). `autoPort` picks a free port and Vite honours `PORT`. The app is under the base path: `http://localhost:<port>/FloorTrace/`.
3. Make sure the server is serving this checkout — another session's server can hold the port. Fetch a file you changed (`fetch('/FloorTrace/src/<path>').then(r => r.text())`) and look for your edit.

## Load a plan

- Simplest: click **Try the sample plan** on the start screen (`public/example-plan.png`, the same image as `fixtures/ExampleFloorplan.png`: two outlines, a garage left out, about 1,900 ft²).
- Any fixture: Vite serves `fixtures/` at `/FloorTrace/fixtures/<name>.png`. Fetch it, wrap it in a `File` inside a `DataTransfer`, and dispatch `new DragEvent('drop', { dataTransfer, bubbles: true })` on `#app-container` — that element owns `onDrop`; dispatching on `#root` does nothing.
- A drop onto an open plan opens a second plan beside it (six at most), and a reload restores every plan that was open. To start clean, clear `localStorage`, delete the IndexedDB database `floortrace-db` (drafts; `keyval-store` is Tesseract's cache and is worth keeping) and reload. Close other tabs on the same origin first, or `deleteDatabase` blocks and autosave never initialises.
- A new port is a new origin, with empty storage and a cold Tesseract cache.

## Read state

- Prefer the React tree. `await import('/FloorTrace/src/store/appStore.js')` can hand back a second module instance with empty state; before trusting it, compare a value the UI also receives (e.g. `getState().image` against the app's `hasImage` prop). To read props, start from a DOM node, take `el[Object.keys(el).find(k => k.startsWith('__reactFiber'))]`, follow `.return` to the component, and read `memoizedProps`. Never `JSON.stringify` a fiber or hook chain; they are circular.
- After editing a module, re-import it with `?v=<random>` or the dev cache serves the old copy.
- Web workers don't hot-reload: after editing `src/utils/detection/`, reload the page or the worker keeps running the old code.
- `javascript_tool` calls cap at 30 s. Poll OCR and tracing progress in short calls instead of awaiting a whole scan.
- `src/utils/perfMarks.js` records DEV-only `ft:*` performance marks for the drop-to-area path.

## The pane runs hidden

The Browser pane doesn't composite, so `document.hidden` is true. What that breaks, and the workaround:

- **`requestAnimationFrame` never fires**, so Konva never paints its hit canvas and node-level handlers (OCR pills, vertex handles, room corners) miss every event. Before interacting: `window.requestAnimationFrame = (cb) => setTimeout(() => cb(performance.now()), 0)`, then `window.dispatchEvent(new Event('resize'))`.
- **`ResizeObserver` never delivers**, so the stage sticks at its 800×600 default. A window `resize` event drives `useCameraController`'s `measure()` instead.
- **Media-query change events don't fire**: after `resize_window`, `useIsMobile`/`useIsTouch` stay stale until `App` re-renders. Nudge a store field `App` subscribes to, e.g. `setShowSideLengths`.
- **Width 0 means the mobile shell.** Check `innerWidth` before planning desktop-layout checks; `resize_window` does not always fix it. If it stays 0, verify structure with a happy-dom component test instead.
- **CSS transitions freeze at their start value**, so `getComputedStyle` reports pre-change colours and opacity. Finish them first: `document.querySelectorAll('*').forEach((e) => e.getAnimations().forEach((a) => a.finish()))`.
- `IntersectionObserver` never fires and timers are throttled (the bar's status line and a notice outlive their duration). Screenshots can fail while the pane is collapsed or OCR is busy; prefer `read_page`, `find` and `javascript_tool`.

## Driving the desktop shell

- Menus: the triggers are `#menu-main` (the header's Menu), `#menu-bar-measure` and `#menu-bar-image` (the toolbar above the plan), and `#menu-panel-outline` ("Change the outline", inside the panel's open outline step; it opens `position: fixed` beside the panel). `#menu-bar-outline` exists only while the results panel is put away. `.click()` one, then click the `[role="menuitem"]` whose text you want. A row that cannot be used is `aria-disabled`, not `disabled`.
- The results panel is the area (`#panel-area`) and, inside `#panel-steps`, four steps: `#panel-sizes` (does not fold; its button is "Read again"), `#panel-scale`, `#panel-outline` and `#panel-work` (`#panel-area-step` until there is a measured area). Only `#panel-work` folds: it opens from its `button[aria-expanded]` ("Show the sum"), and folded, the sum is not in the DOM. The scale and outline steps are always open; the outline step's one `button[aria-expanded]` is its menu trigger. Each step's title is its `[data-step-title]`. While a plan is first being measured `#panel-steps` is a list of `li[data-state]` instead.
- The green scale-room box is on the plan whenever the results panel is showing its steps (or there is no scale). It is not drawn while the panel is put away or a plan is first being measured, so open the panel before looking for it on the stage.
- A tool that was running when a plan was last saved to its draft is still running after a reload, and the toolbar's menus (`#menu-bar-measure`, `#menu-bar-image`) are not in the DOM while one runs. Press the bar's Done or Cancel first.
- The theme is light unless `localStorage['floortrace:theme']` is `'dark'` (Settings ▸ Night mode). To look at the other one without the Settings dialog, set `document.documentElement.dataset.theme` to `'dark'` or `'light'`.
- A screenshot of a 1440-wide viewport comes back at about 800 px. To read a region at full size, scale the shell from the corner you want: `Object.assign(document.getElementById('app-container').style, { transformOrigin: '0% 0%', transform: 'scale(1.8)' })` — and set `transform` back to `''` afterwards.

## Canvas interaction

- Konva shapes are not DOM. Find the stage from `document.querySelector('.konvajs-content').parentElement` by walking its React fiber's hooks for a value with `.find`, `.batchDraw` and `.content`.
- Click a shape: `stage.find('Circle')` (one per detected dimension, at the label centre), then `node.fire('click', { evt: new MouseEvent('click') }, true)`.
- Drags (brush, eraser, crop): dispatch `MouseEvent`s on `stage.content` — not `stage.container()`, and not `PointerEvent`s. Map image pixels to client coordinates with `stage.children[0].getAbsoluteTransform().point(p)` plus `stage.container().getBoundingClientRect()`.
- Touch paths: dispatch `TouchEvent`s built from `Touch` objects on `.konvajs-content canvas`. Always include at least one `changedTouches` entry; Konva throws on an empty `touchend`.

## Checking styles

A Tailwind class that compiled to no rule looks exactly like one with the wrong value. Search the stylesheets rather than the element: `[...document.styleSheets].flatMap((s) => { try { return [...s.cssRules].map((r) => r.cssText) } catch { return [] } })`.

## Before/after comparisons

- Set the change aside as one coherent unit (a temporary WIP commit, or a tagged stash applied by SHA — never bare `git stash`), clear storage, reload, rerun, then restore. Never revert half of an import/export pair: the module fails to load and React reports it as a hook-order crash.
- "Rendered more hooks" or a hook-order error right after editing a hook is Fast Refresh patching a mounted component. Confirm on a fresh tab before debugging it.

## Reporting

For purely visual chrome changes, verify what a program can check (DOM geometry, computed styles, ARIA wiring, state-driven re-renders) and say what you could not see. Put what you verified by hand in the PR description — there is no end-to-end harness.
