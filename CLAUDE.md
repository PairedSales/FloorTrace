# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

FloorTrace is a single-page React app that lets a user upload a floorplan sketch, auto-detects room dimension labels via OCR, traces interior/exterior wall boundaries via classical computer vision, and computes area. Everything runs client-side in the browser — no server, no data collection. Deployed to GitHub Pages at `pairedsales.github.io/FloorTrace`.

## Commands

```
npm run dev        # start Vite dev server
npm run build       # production build (vite build)
npm run preview     # preview production build
npm run lint        # eslint .
npm test            # vitest run (all tests)
npx vitest run <path/to/file.test.js>   # run a single test file
npm run bench:detection    # detection accuracy against fixtures/ (runs in CI)
npm run bench:scale        # scale selection against fixtures/ (runs in CI)
npm run bench:ocr          # OCR accuracy/timing benchmark (Node, Tesseract path only)
npm run probe:exterior     # exterior tracer on synthetic scenarios with exact truth
npm run probe:memory       # what the detection memo retains per image (needs --expose-gc)
npm run icons              # rasterise public/ icons + favicon from the app mark
```

Vitest tests live under `src/utils/**/__tests__/`, `src/store/__tests__/`,
`src/hooks/__tests__/` and `src/workers/__tests__/`. Benchmark/test fixture
floorplans (`ExampleFloorplanN.*` + `.truth.json` sidecars) live under `fixtures/`.

**There is still no browser/e2e harness**, so anything that needs a canvas, a
worker or a real layout is verified by hand with `npm run dev` — see the mobile
note further down for why the Browser pane lies about this app. What *is*
covered now is the layer between the store and the UI:

- **Hook tests run in happy-dom, per file, via a `// @vitest-environment happy-dom`
  docblock.** The default environment stays node on purpose: the detection
  suites are CPU-bound pure-JS pipelines that gain nothing from a DOM and would
  pay for one. happy-dom rather than jsdom because jsdom 30 wants Node
  ≥ 22.19 through `undici`'s `webidl.util.markAsUncloneable`, and CI ran Node 20
  when this was written — it passed locally and failed there with unhandled
  `TypeError`s while every test reported green, which is the worst shape a test
  dependency can have. #227 moved CI to Node 22 and closed that particular trap;
  happy-dom stays for the ~7 transitive packages against jsdom's ~360. **Check a
  new devDependency's `engines` against the CI runtime**, because that class of
  failure lands nowhere else.
- `src/hooks/__tests__/harness.js` holds the store setup (`oneDocument`,
  `addParkedDocument`, `addUnhydratedDocument`). Tests mock only the outward
  edge — `workspaceDrafts`, `draftStorage`, `notify`, plus whatever leaves the
  process for that hook (`exportProject`, `imageLoader`, `confirmToast`,
  `prewarmDetection`) — and run the real hook against the real store, so a
  failure means a decision was wrong rather than that a mock drifted. What is
  under test stays real: `useProjectIO.test.js` mocks `exportProject` but keeps
  `planStateForSave`, which is the function the defect was in.
- **A hook test is worth writing when the logic lives inside an effect**, which
  is where every multi-plan data-integrity defect has been: which plan a
  debounced write names, when the workspace index is rewritten, whether a file
  handle outlives its plan. `parkAdopt.test.js` and friends cannot reach any of
  it. Check a new one *fails* against the unfixed code before trusting it — the
  index-on-close test passed either way at first, because the bug it replaced
  happened to write the index two seconds later.
- **`App.jsx` orchestration is still out of reach.** Its last-plan close path
  (`restart()` keeps the plan's id, so the file handle has to be dropped there
  too) has no test, because rendering `App` means konva, workers and OCR. Moving
  that branch into `usePlanManager` beside `closePlan` would fix that; it has
  not been done.

**Always run `npm run bench:detection` before and after a detection change.** It scores polygon shape and square feet, not just bounding boxes — a tracer that returns each building's bounding rectangle passes a box check while discarding every notch and wing. `npm run probe:exterior` prints the same scenarios `exterior-failures.test.js` asserts (wide openings, U-notches, dimension strings, courtyards, legends, garage doors, nested plans, mixed wall thickness) with IoU/area/confidence, which is the fastest way to see what a change did. `npm run probe:exterior draw` does the same for draw mode, re-tracing those scenarios from a synthetic sloppy brush stroke (`strokeAround` in `synthetic.js`) — jitter and brush width should not move the numbers.

## Architecture

### Two levels: plans and outlines

A **plan** is one image and everything measured from it — its own calibration,
traces, OCR results, undo history and camera. It is what a tab addresses.
An **outline** is one polygon *within* one plan.

The terminology is load-bearing because the repo has an inverted collision:
`floorManager.js` calls an outline a "floor", while the `.floorplan` file's
`floors[]` array is plan-shaped and always holds exactly one entry. **No new
code may use "floor" for the plan level.** `newDocumentId()` (`store/ids.js`) is
the plan level; `newTraceId()` beside it is the outline level. `Alt/Shift+1–7`
switches outlines, so plan switching cannot have those keys.

**The tab strip is the top row of the plan's own column** (`DocumentTabs.jsx`,
rendered in `App.jsx` inside the row, not above it), with the `StatusBar` directly
under it and the canvas under that — so both bands are inset between the
measurement dock and the tool rail and stop where the plan stops.

**It renders only when two or more plans are open.** One tab is 30 px of chrome
answering a question nobody asked, taken off the plan for the whole of an ordinary
single-plan session; `File > New plan` (Ctrl+Alt+N) is how the second plan — and
the strip with it — arrives.

**The strip ends where the last tab does.** A tab is as wide as its own name
(`flex: 0 1 auto`, floor 96 px, ceiling 200) and the new-plan button follows it
immediately rather than sitting in the far corner. Tabs that grew to share the
width put the band's only two controls at opposite ends of an empty panel.

**The strip must
not scroll**: tabs truncate to a ~96 px floor, and whatever no longer fits moves
into a chevron menu. A strip that scrolls hides plans behind a gesture, which is
what a tab strip exists to prevent.

**The chevron is reachable, and that is new.** While the strip spanned the window,
six tabs at the 96 px floor needed 606 px against a 819.98 px minimum, so nobody
ever saw it. Inset, the strip is measured against the window less a 320 px dock and
a 48 px rail — ~452 px at the breakpoint, which fits four at the floor — so five or six open plans overflow on
a real screen. Treat that path as live.

**Its width is re-measured three ways and none is redundant:** a window `resize`,
a `ResizeObserver`, and the two pieces of state the inset is made of —
`dockOpen` and whether an image exists (the tool rail mounts with it), as
dependencies of the layout effect. The window listener was complete only while
this band spanned the window. The observer cannot carry it alone either: it never
fires while `document.hidden` is true, which is every preview pane and every
background tab — so the state deps are what make the common case deterministic and
testable, and the observer is the net for a width change nothing told the
component about. Measuring the window alone is what left tabs squeezed below their
floor with no chevron to reach the rest.

**Nothing the eager shell reaches may pull konva into the entry's static module
graph.** One such import puts a `modulepreload` for 320 kB back in
`dist/index.html`; check that file after touching the shell — the link is the
regression signal. In practice that means `DocumentTabs` imports no canvas
*component*. Two modules under `./canvas/` are deliberate exceptions and are
reached from the shell today through `documentManager`: `imageCache` and
`wallSnapEngineCache` import nothing at all, which is why they are safe and why
they must stay that way.

On mobile the switcher gets **no permanent chrome**: the thumb bar is contractually
one verb and the canvas claims every touch, so the subject line in the top bar —
which already names the plan — opens `MobilePlansSheet`, rendering the same list.

**One plan is on the store root at a time; the rest are parked.** `documentManager.js`
holds parked plans as inert records in a module `Map` — never in the store, because
putting them there would invite a component subscribing to a plan it is not showing.
A switch is *park → adopt*, and its correctness rests on three things:

- **`PARK_FIELDS` is not `AUTOSAVE_FIELDS`.** It adds `isDirty`, `drawModeActive`
  and `traceInteractionMode`. A draft is read back at startup, when those three are
  meaningless; a park is a round trip within one session, when they are live facts.
  Parking through the autosave projection silently launders away "this plan has
  unsaved work", and returns brush strokes with no brush in hand.
- **`adoptParkedState` is not `loadProject`.** `loadProject` spreads defaults first
  and force-sets four fields, which is right for *opening* a plan and wrong for
  *restoring* one. Adopt also deliberately skips `normalizeTraces` — that is a
  migration for traces coming off disk, and running it rebuilds every trace object,
  costing the reference identity the area memo compares on.
- **`<Canvas key={activeDocumentId}>`** is the whole argument for in-progress
  gestures. The canvas hooks hold state outside the store — a crop rectangle
  mid-drag, the eraser's starting vertices, a half-dragged vertex index — and none
  of it is parked, because none of it is a fact about the plan. It dies with the tree.

**Hooks are workspace-level or per-plan, and it matters where they mount.**
`App.jsx` mounts thirteen; the `key` is on `<Canvas>` only, so none of them remount
today — but before reaching for a keyed subtree, know which is which.

*Workspace-level, must never sit inside a keyed subtree:* `useAutosave`,
`useEnhancedOcr` (a ~10 s WebGL warmup), `useOcrWarmup`, `useTheme`,
`useKeyboardShortcuts`, `useIsMobile`, `usePlanAreaIndex` (it follows whichever
plan is live, and records what that plan contributes to the property), and
`usePlanManager` —
which *performs* the switch, so inside the keyed subtree it would be torn down
mid-adopt.

*Per-plan in what they act on, but only one holds state:* `useAutoScale`'s
`lastRunByDocRef` is keyed by plan id and is the only per-plan state any of them has.
`useToolManager`, `useProjectIO`, `useExhibitExport` and `useDragAndDrop` are
`useCallback` over store setters and hold nothing — so a keyed subtree would cost
them nothing, and keeping them out of one buys nothing either.

**Async results are owned, not inferred.** `documentRequests.js` hands out a token
at `beginWork` and `deliver` decides what may be written, returning one of **five**
verdicts: `'applied'` (the plan is live), `'routed'` (open but parked — the write
is held and replayed on adopt), `'stale'` (the plan exists but its image changed),
`'dropped'` (the plan is gone), or `'refused'` — a write passed `replayable: false`,
held for nobody because replaying it would be wrong. Calibration is the only caller:
area goes as scale squared, so a scale applied late from evidence the user has moved
on from is a wrong number that looks right. That plan is flagged `needsRescale`
(`documentManager.js`) and the tab draws a warning triangle instead.

The old `image !== startImage` guard answered two questions with one comparison,
and got the second wrong in the dangerous direction: two plans opened from the same file hold the same data URL, so each
passes the other's staleness test exactly.

`'routed'` is not optional politeness. Phase 2 built this layer when only one plan
could be open and left `'dropped'` covering "not the active plan"; phase 6 made a
plan open without being live and nothing went back. Switching tabs mid-trace then
discarded the trace and cleared the spinner — not a wrong answer but a missing one
that looks finished, which is harder to even report.

**Three more invariants the multi-plan work rests on**, each of which has been
broken once already:

- **A plan's file handle dies with the plan.** `utils/fileHandles.js` is a leaf
  module *specifically* so a close path can drop a handle without importing
  `projectSerializer`, which is dynamically imported to keep 78 kB off the critical
  path. Call `forgetFileHandle` wherever a plan stops being that plan — there are
  three: `closePlan`, `App.jsx`'s last-plan close (`restart()` keeps the id), and
  `makeRoomForIncoming` reusing an empty plan for a different drawing. A handle
  that outlives its plan sends the next property's first Ctrl+S into the previous
  property's file, with no picker.
- **Every path that removes a plan's records cancels the pending write first.**
  `useAutosave`'s debounced write is armed with a plan id but reads state when it
  *fires*; `cancelPendingWrite` is the one helper, and `removePlan` without it puts
  the records straight back. The last-plan close is why an id check is not enough
  — `restart()` keeps the id, so the write still looks current.
- **The workspace index is rewritten whenever the set of plans changes, deferred to
  a microtask.** `removePlan` never touches the index, and no close path wrote it;
  it used to be repaired *by accident* by the very write that had to go. Deferred
  because `closeDocument` trims `documentOrder` and *then* adopts a successor, so a
  synchronous write stamps `activeId` with the id of the plan being closed. A stale
  index is not a small thing: `restoreWorkspace` will walk `order` for a plan it can
  stand on, but anything it cannot read is dropped and counted.

### State: one Zustand store, snapshot-based undo/autosave

`src/store/appStore.js` holds nearly all app state as a flat "working state" object (image, calibration, perimeter traces, tool states, etc.), defined once in `WORKING_STATE_DEFAULTS` so undo/autosave/reset can't drift out of sync with each other.

- `SNAPSHOT_FIELDS` (working state minus transient UI/camera fields) is what `undoManager` snapshots on `undoManager.save()`. Callers call `undoManager.save()` themselves *before* mutating state for an undoable action — it is not automatic.
- `AUTOSAVE_FIELDS` is the similar-but-not-identical subset persisted on change to IndexedDB, falling back to localStorage if IndexedDB is unavailable (`draftStorage.js`).
- `PERSISTENT_FLOOR_FIELDS` (the `.floorplan` projection, re-exported by `projectSerializer.js`) is derived from the same declaration. Do not hand-maintain it: the hand-listed version is how `exteriorLabels` came to be autosaved but not exported, so reopening a project silently degraded every later trace.
- `rooms[]` accumulates the rooms the detector has *confirmed* (rect, per-side wall faces, implied px/ft). A single room click adds unconditionally; the scan path adds only `decision.contributors`, so rooms rejected as non-GLA, low-confidence or scale outliers never land there. That serves both jobs at once — a rectangle that leaked through a doorway is evidence for the wrong building, so it is no better as containment evidence than it was as a scale sample. It is the boundary stage's containment evidence and the sample set for a robust multi-room scale — a single `roomOverlay` could be neither. Perimeter traces additionally carry `holes` (enclosed voids, subtracted from area), `quality` (detection confidence + warnings) and `wallFaces` (the detector's exterior/interior pair for *that* outline). `wallFaces` is per trace rather than re-derived from `tracedBoundaries` because that field holds only the most recent detection run: the exterior/interior switch (`setWallFaceMode`) is one setting for the whole canvas, so a plan traced in several passes has outlines the last run cannot describe.
- **Every surface that prints an area breakdown goes through `displayedBreakdownTotal`**
  (`areaCalculator.js`), which sums what the *rows* print rather than rounding the raw
  total separately. Three call sites feed four printed surfaces — the exhibit, the
  dock's table, the dock's copy-to-clipboard text and the mobile thumb bar — and the
  last two sit on screen together, so a second definition shows two square footages at
  once. Rounding each row and the total independently prints 1,241 + 442 + 89 under a
  Total of 1,772; on a workfile exhibit a reviewer adds up by hand, that reads as an
  error in the measurement.
- `src/store/undoManager.js` interns image data URLs into a pool keyed by `internKey` (`utils/hash.js`) so repeated undo snapshots of an unchanged image share one copy in memory instead of deep-cloning multi-MB data URLs per step. **It must be `internKey`, never `hashDataUrl`:** the latter folds an 8 KB prefix plus the length into 32 bits, so two images can share a key — and this key is what undo resolves back into `image`, so a collision restores the wrong drawing with nothing looking wrong. `internKey` picks the bucket by hash and then string-compares the occupant.
- **The undo stacks are module state, so a plan switch hands them over explicitly.** `parkHistory`/`adoptHistory` are the `PARK_FIELDS` of the history — a plan that has never been parked adopts an empty one rather than inheriting the last plan's. `cancelLastSave` deliberately does not survive the switch (`cancelPendingSave` gives it up): the save belongs to one plan and the cancel would pop whichever is live. `setHistoryState` copies the caller's arrays and caps them, because a `.floorplan` is the one path that can arrive deeper than the app ever creates and would then pin every image it references in the pool.
- `src/store/floorManager.js` (mixed into the store via `createFloorSlice`) manages multiple named "perimeter traces" (one polygon per floor/level) against a single shared calibration — this is the model backing multi-floor support. `selectActivePerimeterOverlay` / `selectActiveAreaByType` in `appStore.js` are memoized selectors (manual reference-equality caching, not reselect) — follow that pattern if adding similar derived state rather than introducing a new library. (`selectCombinedArea` is a one-line read of `.total` off the second, not a memo of its own.)

  Both memos are **module state with one slot**, so they answer for whichever state called last — harmless with one plan, a trap with several. Anything handed a state rather than subscribing to the live store must not go through them: `computeAreaByType` is the un-memoised twin for exactly that, because the exhibit builder describes the state it was *given*, and alternating callers would thrash a shared memo into handing over the other plan's numbers. The memo on `selectActiveAreaByType` is a correctness requirement rather than an optimisation: it returns an object, so zustand's `Object.is` would otherwise re-render every consumer on every unrelated `set()`.

**The measurement dock is ordered by what a person reads, not by what the app computes.** Room size first and in 19 px type — it is a measurement of the building, checked against the plan by eye and corrected by hand — then Area, then the outlines, then **the Scale card, small**, and **Stats & warnings last**. The first two used to be one card with those weights reversed, headlining `1 ft = 91.0 px`: a derived, technical number in the position that says "read this first". Scale still has to be *available* (an unstated scale is how a plan gets measured at someone else's px/ft) and `#dock-scale` stays that card's id, because it holds the provenance and the manual override. `MeasurementDock` is the same component on mobile, so the order changes there too — that is the rule, not an oversight.

**Every verdict is on the last card; every card above it measures.** `StatsWarningsCard.jsx` (`#dock-stats`) holds the scale's agreement and its whole explanation, the double-counted-outline warning, the per-outline confidence chip and the detector's ranked reasons with their canvas anchors, plus the counts the measurement rests on. They used to be four separate marks — an `Agrees`/`Check` chip in the Scale card's header, a `⚠ Areas may be off by ~84%` line under the area, a `92%` chip in the outline row and a warning block on the total. Read one at a time none of them said how much there was to check; read together they crowded the numbers they were qualifying. Four things follow:

- **The count is derived once.** `utils/traceIssues.js` owns `summariseIssues`, and both the card's chip and the Area card's `N things to check` line are that one number — a panel that says "2 things to check" beside the area and then lists three is worse than either alone.
- **The Area card still says that there are some.** Only that, and only as a link to the reasons. An area offered clean while the detector doubts it is the failure this app is most prone to, so the count sits on the total it invalidates; what moved is the explanation, not the alarm.
- **A `StageSpine` stage in `warn` jumps to `#dock-stats`**, not to the card that would have shown a green tick. `STAGE_CARD` maps the rest, including PLAN — whose `#dock-plan` resolved to nothing, so that stage silently did nothing when clicked.
- **`info` warnings are not counted.** They describe how an outline was *reached*, not a reason to doubt what it enclosed; a clean plan that also says "only one hypothesis" has to keep reading as clean. They stay reachable behind the `· N notes` toggle.

The detail text is rendered on the page rather than in a `title`. The scale note's entire explanation used to be a tooltip, which on a phone is nowhere at all — and `MeasurementDock` is the same component on both shells, so a tooltip-only fact is a fact half the users cannot reach.

### `App.jsx` is a thin orchestrator

`src/App.jsx` wires the store to components and owns cross-cutting workflow logic (mode transitions between `normal`/`manual`, calibration math from room dimensions + overlay, toast notifications). Most reusable interaction logic is factored into `src/hooks/*` (autosave, keyboard shortcuts, tool manager, project import/export, drag-and-drop) — new cross-component behavior should generally go in a hook, not directly in `App.jsx`.

### Two shells over one workflow

`useIsMobile()` (`src/hooks/useViewport.js`, `max-width: 819.98px`) picks the chrome; `useIsTouch()` (`pointer: coarse`) picks the *targets*. They are separate queries on purpose — a touchscreen laptop wants 44 px handles and pinch-zoom while keeping the docked desktop layout, and a narrow mouse-driven window wants the opposite.

`App.jsx` still owns every workflow decision. It builds the `<Canvas>` element once (`canvasElement`) and hands it to whichever shell renders: the desktop shell — one full-width band (the menu titles and the command bar share it) over a row of dock, plan column and tool rail — or `<MobileChrome>` (`src/components/mobile/`), which is a top bar, the plan, one thumb-height bar, and four sheets (menu, tools, measurement, plans) over a shared `BottomSheet`. Do not fork behaviour across the two — the mobile measurement sheet renders the *same* `MeasurementDock` with `mobile`, re-sized from outside by the `.touch-dense` scope in `index.css`, and the tool sheet reads the same `TOOL_GROUPS` (`components/toolCatalog.js`) the desktop rail does.

The mobile bar states **one** verb, derived from the pipeline `StageSpine` already models (plan → scale → outline → report), rather than the desktop's seven at equal weight.

**`StatusBar` is a 26 px band of the plan's column**, under the tab strip and over the canvas — not a row of the top bar, which is where it lived until the shell was reordered, and not a window footer. Only the hint cell truncates and nothing scrolls: a horizontal scrollbar in a 26 px band eats the band, and inset it has *less* room than it had in the menu bar, not more. Three things about that one truncating cell:

- **There is exactly one grow cell.** A second would mean two cells truncating and neither readable.
- **Four claimants, in this order:** `isProcessing` suppresses everything else, then a `statusFlash`, then the tool the pointer is resting on, then the running mode's own instruction. A hover above a flash would swallow "Area copied" the moment the pointer crossed the rail; a hover below the instruction would never show at all, since every mode has one.
- **The hover text renders outside the `role="status"` live region.** That region is `aria-atomic`, so anything inside it re-announces mode *and* hint together — a pointer crossing twelve rail buttons would fire two dozen announcements. The rail's own `aria-describedby` says the same sentence to a screen reader, once, on focus.

**The tool rail is one width and says what its icons are through that status bar.** Hover or keyboard focus writes `{name, detail, digit}` into `workspaceStore.toolHint`; every tool in `TOOL_GROUPS` therefore needs a `hint`, and three had none while the words could be switched on beside the icon. The `showLabels` preference, its `floortrace:toolLabels` key, its resolver and the two toggles that drove it are gone. Disabled tools are **`aria-disabled`, not `disabled`**: a `disabled` button dispatches no pointer events in Chrome, so the one control whose reason a user most needs — why they cannot measure yet — would be the only one silent on hover.

The menu carries **three titles**, and **it is not a band of its own**. Settings and Help each held one short list and were folded into File, with "Shortcuts & tips" at the top of it and the two preferences at the foot; once the status bar moved down beside its plan, what was left was a wordmark and three words over ~1100 px of empty row, so `MenuBar` now renders as the left group of the command bar's 40 px band. `App.jsx` owns that band's height, surface and rule — both components render bare, and a background or border added back to either draws a seam through the middle of one row. Its swallowed `mousedown` stays scoped to the menu titles rather than the row, so the command buttons beside them keep working.

**That band is one line of buttons and it is nearly full.** The verbs need ~980 px, so at the desktop minimum they scroll (`overflow-x-auto`), and two things hold that off as long as possible: the titles sit outside the scroll region (`flex-1 min-w-0` on the command half) so a title never scrolls out of reach, and the wordmark is `hidden xl:inline` while the theme control is icon-only. Anything new with a *label* in this row costs one of those back — put it in a menu, or take a label out.

The **browser tab is always titled `FloorTrace`**, from the static `<title>` in `index.html`. There is no `useDocumentTitle` any more: naming the tab after the open plan is a real convenience with two windows open, and it was given up deliberately.

**The status bar is also the context bar.** A running tool used to get a second 36 px band under the command bar, and the two said the same thing twice in different words — "Select room / Click a dimension label to use that room" two rows above "Choosing a room / Click a dimension label to measure that room and take the scale from it". One band states the mode now, in the `TOOL_MODES` copy, and carries that mode's brush size, its corner count and its Cancel/Done. `MODE_LABEL`/`MODE_HINT` are gone with it: `TOOL_MODES` is the one copy source, plus an `IDLE` constant in `StatusBar` for the resting state, which is not a tool and is deliberately not in that table (`MobileToolContext` keys off the table being empty to render nothing).

Two rules that fall out of it, both about 452 px — the narrowest this band ever is:

- **The standing cells stand down while a tool runs.** Scale, zoom and a healthy draft are facts you read *between* actions, and they cannot share the band with an instruction, a brush slider and two buttons. A draft that is **not** being kept keeps its cell, because that one is a warning rather than a fact.
- **The band tints `accent` while a tool runs**, which is what the separate bar was really for: at a glance, the app is in a mode.

The vertex count sits outside the live region for the same reason the hover hint does — it changes on every click.

The toast's desktop offset (`desktopChromePx`) counts the 40 px top band, the 26 px status band and 10 px of air, plus the tab strip's 30 only when there is a strip — at one plan there is not. It was a hard-coded `116px` for a stack that had already changed twice, then a constant for a stack in which every band was permanent, and then the tab strip stopped being permanent.

**The tool digits run 1–9 straight down `TOOL_GROUPS`.** Both `toolCatalog.js` and `useKeyboardShortcuts.js` claimed to match and did not — the rail read 7, 4, 8, 9, 1, 3, 2, 5, 6 top to bottom, because digits were handed out in the order the tools were built and the rail was regrouped around them later. Nothing derives a digit from an index (a mapping that moves with app state is the thing being avoided), so renumbering means editing both lists together, plus the four places that print a digit: the `keys` on the two Trace menu items, the Paint-outline tooltip in `CommandBar`, the `1 – 9` row in `HelpModal`, and the badge in the corner of every rail button (which the status bar then repeats on hover, from the same field).

**Touch on the canvas is not free.** Every drag-based tool (brush, eraser, crop, void rectangle, room overlay) was wired to `mousedown`/`mousemove`, and no browser synthesises those during a touch drag — so all of them were dead on a phone. `useToolRouter` now exposes `handleStageTouch{Start,Move,End}` that route into the same `dispatchPointerDown` a mouse does; one finger is a pointer, two are the camera (`usePinchZoom`, wired in `useCameraController`). Three rules that are load-bearing:

- **`e.evt.button !== 0` rejects touch.** A `TouchEvent` has no `button`, so the strict test silently killed double-tap vertex insertion and every room-overlay drag. The guard is `button != null && button !== 0`.
- **A gesture that grows a second finger commits, it does not cancel.** The ink already painted is real work; discarding it because the user then reached to zoom costs a whole stroke.
- **Hit area and drawn size are different numbers.** Vertex handles, room corners, protractor handles and OCR pills keep their drawn radius and get a `hitFunc` sized in `/scale` so the target is a constant ~44 screen px at any zoom. Inflating what is *drawn* buries the outline the handles annotate.

Right-click has no touch equivalent, so deleting a vertex is a 500 ms press-and-hold (cancelled by movement or release) in `PerimeterLayer`, and rotate-the-other-way becomes a second button in the tool sheet.

**Verifying mobile in the Browser pane:** the pane does not composite, so `document.hidden` is true — `requestAnimationFrame`, `ResizeObserver` and `MediaQueryList` change events all stop firing. That makes the Konva stage stick at its 800×600 default, the hit graph never paint (so nothing on the canvas is tappable), and the shell never switch breakpoints. None of it is a bug. Shim `requestAnimationFrame` with `setTimeout`, dispatch a `resize` event to drive the camera's `measure()`, and nudge a store field `App` subscribes to so `useSyncExternalStore` re-reads the query.

### Two independent, worker-backed CV pipelines

Both pipelines take a raw image and run expensive per-pixel work off the main thread, with an emphasis on real inner/outer wall geometry rather than fixed-size placeholders.

**1. Wall/boundary detection** (`src/utils/detection/`) — runs in `src/workers/detectionWorker.js`, invoked via `src/utils/detection/index.js` (`detectRoomFromClick`, `traceFloorplanBoundary`). Pure-JS cores (`detectRoomFromClickCore`, `traceFloorplanBoundaryCore` in `pipeline.js`) take a plain `{width, height, data}` object and run identically in the worker and in `scripts/detectionBenchmark.mjs` (Node, pngjs; ground truth via `<image>.truth.json` sidecars).

The exterior stage is a **hypothesise-and-score search**, the same shape as room detection and OCR — not a single sealing heuristic. Stages:

  - `raster.js` — Otsu binarize + OR-pool downscale, run-based morphology, components, flood fill, SATs
  - `analyze.js` — text/speck strip, structural stroke extraction (kills door arcs/curves), wall-thickness estimate. Produces `wallMask` (strict; rooms use this), `boundaryMask` (wallMask + rescued line-like residual ink + **screened glazing**; the tracer uses this) and `thickMask` (strokes thick enough to be structural). Glazing is a window drawn as a grey band *filling* the wall rather than as two black rails: above the ink threshold it is not there at all, so the wall has a hole in it the width of the window, and on an exterior wall the flood comes in through it and takes the rooms behind it — an outline that follows real wall the whole way round, at 96% confidence, with a bedroom missing (ExampleFloorplan8). Rescued only where the band *is* the wall: screened against the page's own modal tone, no thicker than the wall, and at both ends continuing into a wall whose cross-section is the band's own. That last test is the whole selectivity — a stair tread is drawn in the same grey at the same thickness, but it runs *between* two walls, so the wall it meets crosses it instead of lining up with it. Do not expect `bridgeRunsGuarded` to cover this instead: a window ending within a wall thickness of a corner leaves a stub shorter than `minFlank`, and `minFlank` cannot be relaxed — one thickness is also what a scan line sees of a **diagonal** wall, and admitting those welds a diagonal garage solid (measured on ExampleFloorplan5)
  - `wallEvidence.js` — linework vectorised into axis-aligned **wall segments** (`faceLo`/`faceHi`/`lo`/`hi`/`thick`), plus graded per-point evidence: structural ink = 1, any wall stroke = 0.45, raw ink = 0.2, nothing = 0. `contourSupport` answers "is this outline actually drawn as wall?"
  - `candidates.js` — per wall network, footprints from two evidence variants (`all`, `structural`) × three connectivity policies (`weld` = colinear welding that refuses notch mouths, `raw`, `span` = wall lines painted across their full extent). `span` is a rescue that only runs when nothing enclosed the network. Every closing-ladder rung is a candidate, with a `completeness` measure relative to the largest enclosure the same evidence reached before it started annexing
  - `scoring.js` — scores each candidate on seal (does it close, and fill its own wall network), support (is the outline drawn as wall), coverage (does it enclose the wall that *was* drawn), economy (how much closing/bridging was invented), and any constraints the app supplies; emits a confidence and a `warnings[]` list
  - `boundary.js` — orchestrator: partition into wall networks (fragments of one outline rejoin only when their extents interleave and neither encloses itself), generate → score → pick per network, build floors, reject outlines that are not buildings, order them, and aggregate quality
  - `footprint.js` — per floor: outer contour, filament shave, non-GLA carve, enclosed voids as **holes**, and an interior envelope inset **per edge** by the wall measured behind that edge
  - `nonGla.js` — garage/porch/patio arbitration. Four detectors (OCR label votes, label floods, geometric garage evidence, shaded pockets) emit *candidate regions*; overlapping candidates merge into one region carrying both sources; one pass removes them under a cumulative bound, so the result cannot depend on detector order
  - `remediate.js` — **second-chance tracing**: when the winner is below `REMEDIATION_CONFIDENCE` (0.75) or excludes a known-inside constraint, the trace is searched again. `join` re-runs the wall networks surrounding a stranded room as one network (for the case where one drawing was partitioned into pieces — no closing radius reaches that); `escalate` forces every rescue and doubles the ladder over the same partition. Each attempt runs through `assembleFloors`, so it is scored, validated and aggregated by the same code as the first. Adjudication is on **effective** confidence — the detector's own number times `constraintFactor` — because inside the network that caused a miss the miss is invisible (`detectFloorNet` scopes constraints per network), which is why the base attempt can report 0.93 while the app shows 0.47. `escalate` is gated on the ladder ceiling having actually been reached (or nothing sealing, or a constraint being missed): the ladder is climbed from r=2 up and every rung is scored, so a winner that sealed well below the top already beat every wider rung that existed, and raising the top only appends rungs that score worse on `economy`. Ungated, that pass doubled the trace time of every merely-fair plan and was never once accepted on the fixtures. Never runs in draw mode: there the stroke is the intent
  - `validate.js` — post-hoc checks on the mapped result (self-intersection, floors overlapping, inner nesting, labelled regions outside the footprint) plus `scaleIsotropy` / `robustScale` for calibration. `exemptRegions` (OCR label bboxes, padded by their own size) and `carvedRegions` (the areas the carve actually removed, containment only) are separate on purpose — folding them together either exempted a real miss two rooms away or reported the garage the tracer had just carved as a label falling outside
  - `polygon.js` — Moore trace (Jacob's criterion) → RDP → de-skewed rectilinear fit; signed shoelace, ring-set area, point-in-polygon
  - `room.js` — rectangle growth from the label with wall-coverage stops (door gaps don't leak), thin-line candidates + label-aspect arbitration (closets/counters), open-plan virtual sides, then a final pass seating each chosen edge on its wall's **interior face** (measured in the unsmeared mask over the final span, never predicted from the smear trigger, and never on the centreline). Returns per-side wall faces (`{edge, cov, thick, kind, exterior}`) and the px/ft the room implies. **`options.foreignPoints` is every other parsed label on the page, as places this room is not**: a room is not named twice, so a rectangle holding another label's dimensions is one that bought the shape the label wants by running through a wall. It costs nothing on a room whose sides are drawn, and it is the only thing standing between a closet with bi-fold doors — no ink at all on its south side — and a rectangle three times its size (ExampleFloorplan8's LAUNDRY). All three callers supply them: the scan's batch (`detectionWorker.js`), a click on a dimension pill and a manual canvas click (`App.jsx`, from `detectedDimensions`). `growRoomRect` drops any that the rectangle growth already settled on, which is what makes the manual click — which names no label — safe
  - `brush.js` — **draw mode**: the user's rough brush strokes as a constraint. Strokes rasterise into a `corridor` (the painted band, which *replaces* `partitionWallNetworks` — one painted loop is one building) and a `ribbon` (the centreline at wall width, fed to `createEvidence` as asserted wall). The tracer then searches only ink inside the corridor, which is why draw mode beats auto-detection on the plans auto-detection fails: legends, dimension strings and neighbouring plans are outside the band by construction. `regionFit` scores a candidate on *miss* and *spill* against the stroke, **not** IoU — the band is thick, and plain IoU flags every generous stroke as a mismatch
  - `labelFrame.js` — a label array plus the window of the page it covers. Labels stay in crop space and carry their `frame` (absent means page-sized); re-expanding each to a page-sized array left it 16-81% `-1` padding, and the boundary search memoises one per kept ladder rung — which pushed three of seven fixtures past the memo's byte budget and cost them their memo for as long as the image stayed open
  - `garage.js` — the OCR-independent geometric garage detector behind `nonGla.js`'s garage source: a large near-rectangular cavity with one exterior-facing side drawn almost entirely as thin garage-door stroke. Porches fail the "other sides are real walls" guard; windows fail the door-run guard
  - `scale.js` — which rooms the project scale is taken from, decided without the user. Every labelled room is measured and the rooms outvote each other: the old flow calibrated from whichever room the user clicked, and the worst clickable room implies a scale 58-90% wrong — which, since area goes as scale squared, is a 3-4x area error. Deliberately little machinery: weighting samples by isotropy, pixel length or bounding walls each moved no fixture more than 0.8 pp, and isotropy weighting is *worse* than nothing because it promotes the one honest sample that is wrong. Only the confidence gate earns its place. Scored by `npm run bench:scale`
  - `cache.js` — memoises analysis and boundary per `(cacheKey, maxDimension, analyzeOptions)`, four entries, with a 32 MB budget on the search caches: past it the memo stops storing but deliberately does not clear what it holds, so the budget is a bound and not a cliff. `dropCacheKey` drops one image's entries rather than the whole cache, which is what used to throw away the other plan's work on every image change. **The memo is keyed on the data URL, not on its hash** — `hashDataUrl` folds an 8 KB prefix into 32 bits and the eraser and crop tools emit same-length URLs from one canvas, so a hash key can hand two images one entry and return the previous image's pixels with nothing looking wrong. The `cacheKey` (`hash#seq`) is minted once per decode and kept *with* the decode entry, and that stability is what makes N room clicks cost one trace instead of 2N. `MAX_DECODED` is 2, not 1: with two plans open, alternating evicted the other every time and made every trace after a switch cold (~1130 ms against ~130 ms)

  **Quality is a first-class output.** `traceFloorplanBoundaryCore` returns `quality: {confidence, warnings[], usedFallback, source, …}`; the worker forwards a whitelist of debug fields (it must never blanket-null them again); traces carry their quality into the store; `App.jsx` reports a doubtful trace as doubtful. `src/utils/boundaryQuality.js` decides the wording.

  `quality.source` is `'auto'` or `'drawn'`, and several checks are deliberately gentler for `'drawn'` — a label outside a hand-drawn outline is usually a deliberate exclusion, so it warns instead of erroring (in both `scoring.js` and `validate.js`, which each raise their own `label-outside`), and OCR constraints lose most of their scoring weight. A trace the detector itself rates `poor` or `failed` drops the user straight into draw mode rather than handing over an answer.

  Constraints flow the other way too: `options.constraints` carries `rooms[]` (known-inside rectangles) and `interiorPoints` (parsed dimension labels) from the store, geometry that excludes them is scored down, and a winner that still excludes one is re-searched (`remediate.js`). **The benchmark runs each fixture twice** — once bare and once with the truth file's room clicks as constraints — because that second run is the path the app actually takes after a scan, and it is the only one that exercises remediation.

  Reference material (papers, annotated examples) for this pipeline lives in `Reference Data for Wall Detection System/`.

**2. Dimension OCR** (`src/utils/dimensions/`, entry point `src/utils/DimensionsOCR.js`) — a multi-pass hybrid pipeline documented in detail at the top of `src/utils/dimensions/pipeline.js`:
  1. Preprocess (grayscale, CLAHE via OpenCV or JS fallback, denoise, unsharp)
  2. Full-page sparse Tesseract pass (runs concurrently with spatial analysis)
  3. Spatial glyph-clustering to find horizontal/vertical text-line candidates the full-page pass misses
  4. Targeted zoomed single-line Tesseract re-reads on ROIs (including both 90° rotations for vertical labels)
  5. Optional PaddleOCR neural "rescue" pass over ROIs Tesseract couldn't parse (browser-only; skipped if the model isn't warmed up or the time budget — `budgetMs`, default 2600ms — is spent)
  6. Merge: overlap-based dedup, confidence scoring, dominant unit-format inference

  A scan is ~90% Tesseract inference, so the speed levers are all about the calls: `ocrTesseract.js` keeps a **worker pool** (`max(1, min(cap, cores/2))`, where `cap` is 8 only when `hardwareConcurrency >= 16` *and* `deviceMemory >= 8`, else 4 — each worker holds the 5.2 MB traineddata plus a WASM heap, so the cap is a memory decision and an unknown `deviceMemory` counts as "not enough"; reads are bit-identical at any pool size. Preset-affine, torn down on a 60 s idle timer rather than after every scan) and phase 4 reads ROIs concurrently across it, while the speculative ROI tier (priority below `SPECULATIVE_PRIORITY` = 7 — spatial clusters nothing corroborates) gets two zoom rungs instead of the full ladder, and is capped in count as well as depth (`MAX_SPECULATIVE_ROIS` 12, `MAX_SPECULATIVE_VERTICAL_ROIS` 6; the overall `MAX_ROIS` bounds the queue but not its composition). `detectAllDimensions` runs through `scanQueue.js` — pure and testable, deliberately outside `DimensionsOCR.js`, which cannot load outside a browser. Three behaviours: a **four-entry LRU** keyed by data-URL identity rather than one slot (one slot is right only while one image is in play; with two plans open every scan went cold); **de-duplication**, so two callers asking for one image wait on one scan; and **serialisation**, which is the load-bearing one. The pipeline's budget is wall clock, so two scans running together do not each take twice as long — they each return *fewer dimensions*, with nothing in either result saying so, and fewer dimensions is a worse scale, and the scale multiplies every reported area. Failures are never memoised: an empty result would otherwise be served forever as "this plan has no labels". Two things that look like free wins are **not**, and are benchmarked shut: running CLAHE before the pre-OCR upscale instead of after (bilinear zoom is what creates the gradients CLAHE exists to flatten — costs six detections), and lowering `UPSCALE_MAX`/`TARGET_GLYPH_PX` (flat detection rate, more false positives).

  This pipeline core (`detectDimensionsCore` in `pipeline.js`) is deliberately environment-agnostic: it takes an `env` adapter (`toOcrInput`, optional `refineRois`, `budgetMs`) so the identical code path runs in the browser (`DimensionsOCR.js`'s `browserEnv()`) and in the Node benchmark harness (`scripts/ocrBenchmark.mjs`, which stubs `toOcrInput` with a PNG encoder and skips the PaddleOCR step). When changing pipeline behavior, prefer running the benchmark script over `fixtures/ExampleFloorplan.png` to check detection rate/accuracy/timings before/after.

  PaddleOCR model weights are committed under `public/models/ocr-det` and `public/models/ocr-rec` (`model.json` + `chunk_N.dat` — one chunk under `ocr-det`, two under `ocr-rec`, 11.9 MB committed). They are checked in deliberately — the app must work offline and on first paint — but note that regenerating them adds another copy to git history, so replace rather than accumulate.

  Tesseract's runtime assets are self-hosted (no jsdelivr at runtime): the worker script and core WASM come straight from `node_modules` via Vite `?url` imports — see the `configureTesseract` block in `DimensionsOCR.js`, which also does the SIMD probe — so they track the installed tesseract.js version automatically. The language data lives at `public/tesseract/eng.traineddata.gz`; regenerate it by gzipping the `eng.traineddata` that a Node benchmark run caches in the repo root.

  The scan emits **two** keyword collections beside the dimensions, and confusing them is a wrong answer either way. `exteriorLabels` (`dimensions/exteriorLabels.js`) carve their region *out* of the footprint they sit in. `areaLabels` (`dimensions/areaLabels.js`) carve nothing — they type the whole outline they sit in, via `traceClassification.js` and the store's `classifyTraceTypes`, so a basement stops being reported as living area. That is why the area vocabulary is short and holds only *level* names: a GARAGE label is a room inside a storey, so typing an outline from it would move a whole floor out of GLA, whereas nobody prints "BASEMENT" on a room of the first floor. `matchAreaLabel` also refuses a keyword that reads as a pointer ("DN TO BSMT") or a schedule row ("BASEMENT 800 SQ FT").

  Classification runs inside `runTrace`, on the outlines that trace just produced, and reports what it changed. Two rules are load-bearing: labels *inside* an outline outrank a caption outside it (a sheet may caption the basement plan "FLOOR 1" — that says where it sits in the stack, not what it is), and a caption two outlines are equally entitled to is dropped rather than given to the nearer one (`fixtures/ExampleFloorplan2` prints "FLOOR 2" nearer to the plan below it than to the one it belongs to). `typeSource` is the provenance that keeps this safe: `'user'` is never overwritten, `'detected'` is the app's own claim and is withdrawn when the label it rested on is gone, and a project saved before classification existed reads a non-default type as the user's.

### Build

**The icons under `public/` are build output, not artwork.** `npm run icons`
(`scripts/generateIcons.mjs`) rasterises every favicon, the `.ico`, `icon.svg` and
the apple-touch/android tiles from `src/components/markGeometry.js` — the same
coordinates `FloorTraceMark` draws at the left of the command bar. Edit the geometry and re-run;
never touch the files, or the tab icon starts quietly disagreeing with the app.
`android-chrome-*.png` are regenerated with the rest but are still referenced by
nothing — there is no web manifest.

`vite.config.js` sets `base: '/FloorTrace/'` for GitHub Pages, hashes all output filenames for cache-busting, and assigns `tesseract.js`, `konva`/`react-konva`, React and rollup's CommonJS interop helper to named chunks.

**Splitting is not lazying.** The konva chunk existed for a long time while `App.jsx → Canvas.jsx → react-konva` kept it in the entry's *static* module graph, so `index.html` modulepreloaded it and the browser fetched and compiled all 320 kB before the app could run — the opposite of what the config appeared to say. What actually defers it is `Canvas.jsx`, which lazy-loads the whole `<Stage>` subtree (`CanvasStage.jsx`) behind `React.lazy`; the manual chunks only decide *which file* the deferred code lands in. Two entries are load-bearing for that: React and `commonjsHelpers` are pinned to their own chunks because, left unassigned, rollup folds the dependency shared by konva and the entry *into the konva chunk*, and the entry then statically imports konva to reach it.

The same shape applies a second time, for OCR. `utils/ocrLazy.js` is a facade over `DimensionsOCR.js`, whose import pulls the whole dimension graph (45 kB, 17.8 kB gz) — code that cannot run before an image exists. **`App.jsx` and the two OCR hooks must import from `ocrLazy`, never `DimensionsOCR`**; one direct import returns the graph to the entry chunk. `terminateOcrWorker` is the shape-setter: it runs in an unmount cleanup and cannot await, so it reads the cached module handle and does nothing when OCR was never loaded. If you change `manualChunks`, rebuild and check `dist/index.html`: it must modulepreload **exactly `interop` and `react`**. A konva-only check is what let the tesseract regression stand — `tesseract.js/dist/worker.min.js?url` matched the tesseract rule, so a 15.9 kB chunk existed to export a 60-character URL string, entry-reachable and preloaded on every load, while the konva link was correctly absent. Hence the `!id.includes('?url')` guard on that rule.

## Conventions

- No comment blocks/docstrings beyond a short "why" line — several files already model this well (`pipeline.js`, `appStore.js`); match that density, not the verbosity of one-off code you're editing near.
- `eslint.config.js` treats unused vars as an error except names matching `^[A-Z_]`.
- `eslint.config.js` also errors on `%TypedArray%.from(x, fn)` with a mapper: it walks the iterator protocol and dispatches per element, ~92 ns/px against a plain loop's ~4 ns/px — which is the entire per-pixel budget in `detection/`. Allocate and loop.
- Prefer adding new cross-cutting interaction logic as a hook in `src/hooks/` rather than growing `App.jsx`.
- Detection results carry their own quality. Never drop a `warnings[]`/`confidence` on the way to the UI, and never report a trace as a plain success without consulting it — the failure mode this codebase is most prone to is a wrong answer that looks green.
