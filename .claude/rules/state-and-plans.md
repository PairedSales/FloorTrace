---
paths:
  - "src/store/**"
  - "src/hooks/**"
  - "src/App.jsx"
  - "src/utils/draftStorage.js"
  - "src/utils/workspaceDrafts.js"
  - "src/utils/fileHandles.js"
  - "src/utils/projectSerializer.js"
  - "src/utils/hash.js"
  - "src/utils/areaCalculator.js"
  - "src/utils/unitConverter.js"
---

# Store, plans and hooks

## One store, projections derived from one declaration

- `WORKING_STATE_DEFAULTS` (`store/appStore.js`) declares working state once. `SNAPSHOT_FIELDS` (undo), `AUTOSAVE_FIELDS` (drafts in IndexedDB, localStorage fallback) and `PERSISTENT_FLOOR_FIELDS` (the `.floorplan` projection) derive from it. Never hand-list a projection: that is how `exteriorLabels` came to be autosaved but not exported.
- Call `undoManager.save()` yourself before an undoable mutation; nothing does it for you.
- `undoManager` interns image data URLs by `internKey`, never `hashDataUrl` — a collision would restore the wrong drawing. `setHistoryState` copies and caps what it is given. `parkHistory`/`adoptHistory` hand the stacks over on a plan switch; `cancelLastSave` deliberately does not survive one.
- `selectActivePerimeterOverlay` and `selectActiveAreaByType` are one-slot module memos for the live store (follow that manual pattern for new derived state; no reselect). The memo is required — the result is an object, so without it every subscriber re-renders on every `set()`. Anything handed a state instead of subscribing (the exhibit, `usePlanAreaIndex`) uses `computeAreaByType`, or alternating callers get each other's numbers.
- Every printed area breakdown goes through `displayedBreakdownTotal` (`areaCalculator.js`), which sums the rounded rows, so a total never disagrees with the rows above it.
- `rooms[]` holds only rooms the detector confirmed (a scan adds `decision.contributors`, the rooms that agree). They are evidence for the trace and what the scale's room is compared with — never what the scale is made from. The room the scale *does* come from is `roomOverlay`. Perimeter traces carry `holes`, `quality` and `wallFaces` — per trace, because `tracedBoundaries` describes only the last detection run.
- Units: `appStore.unit` is what the live plan displays (per plan; it rides in files, parks and undo). `workspaceStore.unitPreference` is the standing answer, enforced in one place, `useUnitPreference`. Don't add unit checks to individual arrival paths.

## Plans and parking

- A **plan** (`newDocumentId()`) is one image and everything measured from it; an **outline** (`newTraceId()`) is a polygon within it. Never call the plan level "floor".
- One plan lives on the store root; the rest are parked as inert records in `documentManager.js`'s module `Map` — never in the store, where a component could subscribe to a plan it isn't showing. Open-plan cap: `MAX_OPEN_DOCUMENTS` = 6, the user's number.
- `PARK_FIELDS` ≠ `AUTOSAVE_FIELDS`: parking adds `isDirty`, `drawModeActive` and `traceInteractionMode`, which are live facts within a session and meaningless in a draft.
- `adoptParkedState` ≠ `loadProject`: adopting restores, so it neither spreads defaults nor runs `normalizeTraces` (a migration for data off disk that would rebuild every trace and break memo identity).
- `<Canvas key={activeDocumentId}>` is what discards in-progress gesture state (a mid-drag crop, a half-dragged vertex) on a switch. The key is on `<Canvas>` only.

## Async work is owned, not inferred

- `documentRequests.js`: `beginWork` → `deliver` returns `'applied'` (live plan), `'routed'` (parked — held and replayed on adopt), `'stale'` (image replaced) or `'dropped'` (plan gone). Don't infer ownership from `image !== startImage`: two plans opened from one file share a data URL.
- Calibration must never replay late (area goes as scale squared), so it asks `ownerVerdict(token)` and flags the plan `needsRescale` instead; the tab shows it and `summariseIssues` counts it.
- A switch writes the incoming plan's state onto the root and *then* its `activeDocumentId`. Anything that reads the root to attribute a figure to a plan must skip while `_swappingDocument` is set (as `useAutosave` and `usePlanAreaIndex` do) and key any memo on `activeDocumentId` (as `selectWorkspaceArea` does); otherwise one plan's area is filed under the other.
- A plan contributes to the property total only with a scale: without one its area is the 1 px = 1 ft fallback. `usePlanAreaIndex` records `null` for it and `computeWorkspaceArea` leaves the live one out.

## Three invariants, each broken once

- **A plan's file handle dies with the plan.** Call `forgetFileHandle` (`utils/fileHandles.js`, a leaf so close paths needn't import the lazily loaded serializer) in `closePlan`, in `App.jsx`'s last-plan close (`restart()` keeps the id) and in `makeRoomForIncoming`. Otherwise the next property's first Ctrl+S writes into the previous property's file.
- **Cancel the pending autosave write before removing a plan's records** (`cancelPendingWrite`); the debounced write reads state when it fires.
- **Rewrite the workspace index whenever the set of plans changes**, deferred to a microtask — `closeDocument` trims `documentOrder` before adopting a successor.

## Hooks

- Workspace-level, never inside a keyed subtree: `useAutosave`, `useEnhancedOcr`, `useOcrWarmup`, `useTheme`, `useKeyboardShortcuts`, `useIsMobile`, `usePlanAreaIndex`, `useUnitPreference`, `usePlanManager` (it performs the switch).
- The only per-plan hook state is `useAutoScale`'s `lastRunByDocRef`, keyed by plan id.
- New cross-cutting behaviour goes in a hook, not in `App.jsx`.

## Hook tests (`src/hooks/__tests__/`)

- happy-dom per file (`// @vitest-environment happy-dom`); `harness.js` builds the store (`oneDocument`, `addParkedDocument`, `addUnhydratedDocument`).
- Mock only the outward edge — `workspaceDrafts`, `draftStorage`, `notify`, plus whatever leaves the process for that hook — and run the real hook against the real store.
- Worth writing when the logic lives inside an effect; that is where every multi-plan data-integrity defect has been. Confirm a new test fails against the unfixed code before trusting it.
- `App.jsx` orchestration is untested (rendering it pulls in konva, workers and OCR), including the last-plan close path.
