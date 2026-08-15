# Visible undo/redo buttons — implementation plan

> **Status: planned.** Nothing below has been implemented.

Size: S. Self-contained — touches the undo manager, one new hook, and the toolbar.
Independent of `docs/canvas-shortcuts-plan.md`; the two can land in either order.

## The gap

Undo/redo already work from three input paths: `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` in
[`useKeyboardShortcuts.js:90`](../src/hooks/useKeyboardShortcuts.js), and mouse side
buttons 3/4 in the same file's `mousedown` effect. There is no on-screen affordance, so
a user who does not already know the keybindings has no way to discover that undo exists.

## The blocker

[`src/store/undoManager.js`](../src/store/undoManager.js) keeps `undoStack` and
`redoStack` as module-level arrays with no observation API. A button needs reactive
enabled/disabled state, and nothing can currently tell React when the stacks change.

## 1. Add a subscription to `undoManager`

~15 lines at the top of the module, alongside the existing stacks:

```js
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const canUndo = () => undoStack.length > 0;
export const canRedo = () => redoStack.length > 0;
```

`emit()` must fire from **all six** mutation sites, not just the obvious two:

| Site | Why it matters |
|---|---|
| `save()` | first undoable action enables the Undo button |
| `undo()` | may empty the undo stack; always fills the redo stack |
| `redo()` | mirror of the above |
| `cancelLastSave()` | pops the stack back off — the button must follow |
| `clear()` | restart / new image empties both |
| `setHistoryState()` | **the subtle one.** Loading a project restores history; without an emit here the buttons show the *previous* project's availability |

## 2. `src/hooks/useUndoHistory.js`

Two `useSyncExternalStore` calls returning booleans:

```js
const canUndo = useSyncExternalStore(undoManager.subscribe, undoManager.canUndo);
const canRedo = useSyncExternalStore(undoManager.subscribe, undoManager.canRedo);
```

Booleans are primitives, so `getSnapshot` identity is stable by construction — no
memoised snapshot object, no infinite-render hazard.

### Why not put this in the Zustand store

`canUndo`/`canRedo` are derived from the undo stack, so mirroring them into working
state risks them landing in `SNAPSHOT_FIELDS` or `AUTOSAVE_FIELDS` — a snapshot that
records its own undo depth is circular, and an autosaved one is meaningless on restore.
CLAUDE.md names field-set drift as the bug class that already produced the
`exteriorLabels` autosaved-but-not-exported failure. Keeping this state outside the
store makes the mistake impossible rather than merely avoided.

## 3. Toolbar buttons

`Undo2` / `Redo2` from `lucide-react` (already the icon library). Icon-only, in their
own group inserted between the Save block and the divider at
[`Toolbar.jsx:84`](../src/components/Toolbar.jsx).

- `disabled={!canUndo}` / `disabled={!canRedo}` — the existing `toolbar-btn` class
  already carries disabled styling, matching Open/Save/Fit.
- `title="Undo (Ctrl+Z)"` and `title="Redo (Ctrl+Shift+Z)"`. The tooltip is the point:
  it is what teaches the keybinding that already exists.
- `onClick` calls `undoManager.undo` / `undoManager.redo` directly. No App-level
  handler is needed — the hook can be consumed in `Toolbar` itself, keeping `App.jsx`
  unchanged and honouring the "App is a thin orchestrator" convention.

## 4. Test

`src/store/__tests__/undoManager.test.js` — the one genuinely unit-testable piece:

- a listener fires once from each of the six mutation sites
- `canUndo`/`canRedo` report correctly after `save` → `undo` → `redo` → `clear`
- `setHistoryState(null)` clears and emits
- `unsubscribe()` actually detaches

## 5. Verification

`npm run lint`, the new unit test, then `npm run dev` to confirm the buttons enable on
the first undoable action and grey out at the ends of the stack. No detection code is
touched, so `npm run bench:detection` is not required.

## Also update

Nothing in `HelpModal.jsx` — undo/redo are already listed there. This item only adds
the visual affordance for bindings that are already documented.
