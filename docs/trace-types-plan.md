# Trace types with broken-out totals

Give each perimeter trace a type (GLA / below-grade / garage / porch / unfinished) and
break the reported totals out by type.

Today `selectCombinedArea` sums every visible trace into one number and `LeftPanel`
prints it with "Combined total · N floors" ([LeftPanel.jsx:110](../src/components/LeftPanel.jsx:110)).
A user who traces a house and its garage gets one figure they have to mentally unpick,
and nothing in the export says which part was which.

This is the ANSI Z765 *shape* — GLA reported separately from below-grade and from
non-living areas. It is not a compliance claim, and the UI copy says so rather than
letting the grouping imply certification.

## Decisions taken up front

| Question | Decision |
| --- | --- |
| Headline number | GLA only, with a per-type breakdown and a grand total beneath |
| Colour | Type sets the colour; a hand-picked colour wins and is preserved |
| Taxonomy | Flat 5-value enum, not a level × finish matrix |
| Detector | Types are user-assigned only. `nonGla.js` is not touched |

The detector decision keeps this change entirely in the store/UI layer: no detection
code runs differently, so `bench:detection` cannot move.

## 1. The type table — `src/utils/traceTypes.js` (new)

One module owns the enum, its display order, its labels and its base colours. Four
consumers need it (floorManager, the area selector, LeftPanel, the serializer's
normalizer), so it cannot live inside any of them.

```js
export const TRACE_TYPES = [
  { id: 'gla',         label: 'GLA',         color: '#BD93F9' },
  { id: 'below-grade', label: 'Below grade', color: '#8BE9FD' },
  { id: 'garage',      label: 'Garage',      color: '#FFB86C' },
  { id: 'porch',       label: 'Porch/patio', color: '#50FA7B' },
  { id: 'unfinished',  label: 'Unfinished',  color: '#F1FA8C' },
];
export const DEFAULT_TRACE_TYPE = 'gla';
export const normalizeTraceType = (t) => (KNOWN.has(t) ? t : DEFAULT_TRACE_TYPE);
```

Array order is load-bearing twice: it is the order rows appear in the breakdown, and
it is the reading order a report expects (GLA first, non-living last). Colours are
taken from the existing Dracula palette so nothing else in the UI has to change.

### Shades, because two GLA floors is the normal case

A two-storey house is two GLA traces. If type alone drove colour they would be the
same purple, and the per-trace colour that exists today would be a regression rather
than a feature. So the colour of a trace is `shade(baseColour, nth-of-that-type)` —
the hue says what kind of area it is, the lightness step distinguishes floors within
that kind.

```js
// pure, deterministic, list-order dependent only
export function assignTypeColors(traces) -> traces
```

It walks the list, counts each type as it goes, and rewrites `color` **only** for
traces whose `colorSource === 'type'`. Call it after add, delete, type change, and
`applyDetectedTraces`.

## 2. Trace shape

Two new fields on a trace:

- `type` — one of the five ids, default `'gla'`
- `colorSource` — `'type'` (colour is derived, restyle it freely) or `'user'`
  (colour was chosen and must be preserved)

`colorSource` has no UI yet — there is no colour picker today. It is not speculative
scaffolding: it is what makes migration non-destructive. See §4.

## 3. Store — `src/store/floorManager.js` and `appStore.js`

**floorManager**

- `addPerimeterTrace` — stamp `type: DEFAULT_TRACE_TYPE`, `colorSource: 'type'`,
  then `assignTypeColors`. The `colorIndex` palette cycle goes away.
- `setPerimeterTraceType(traceId, type)` — new action. `undoManager.save()` first:
  the type changes the reported totals, so it is document content, and the codebase's
  convention is that the caller saves before mutating. Then map, `assignTypeColors`,
  `isDirty: true`.
- `deletePerimeterTrace` — re-run `assignTypeColors` so shades close up.
- `applyDetectedTraces` — the identity-preserving branch already spreads `...t`, so a
  re-trace keeps the type. That is the behaviour to lock down with a test: flipping
  the interior/exterior wall toggle must not reset a garage back to GLA. The
  fresh-traces branch stamps `type: DEFAULT_TRACE_TYPE`.
- `resetPerimeterTraces` and `WORKING_STATE_DEFAULTS` — carry the two fields.

**appStore — replace the scalar selector with a typed one**

```js
export const selectAreaByType = (state) => ({ byType, gla, total, counts })
```

Same manual reference-equality memo as `selectCombinedArea` uses today (feetPerPixel
x/y plus per-index trace identity). The memo is not an optimisation here, it is a
correctness requirement: the selector now returns an *object*, and zustand's default
`Object.is` comparison would re-render every consumer on every unrelated `set()`
without a stable reference. `selectPerimeterOverlay` is the pattern to copy.

Keep `selectCombinedArea` exported as `(state) => selectAreaByType(state).total` so
`App.jsx:127` and every other consumer keep working unchanged. Only the Area panel
opts into `.gla`.

The visibility filter is unchanged: `t.visible && t.vertices?.length >= 3`. A hidden
garage drops out of its own subtotal *and* the grand total, which is what hiding a
trace means today.

## 4. Persistence and migration

No change to `PERSISTENT_FLOOR_FIELDS`, `AUTOSAVE_FIELDS`, or `SNAPSHOT_FIELDS` —
`perimeterTraces` is already in all three and the new fields ride inside it. Stating
that explicitly because CLAUDE.md flags this exact place for silent drift.

`perimeterTraceSchema` in `projectSerializer.js` gains `type` and `colorSource` as
optional strings. The schema has `.catchall(z.any())` so an undeclared field would
validate anyway — declaring them is the house rule the `scaleQualitySchema` comment
already states: what the app depends on gets declared, not left to key-stripping.

**Migration is where the colour decision earns itself.** An old trace has no `type`,
so it becomes GLA — and if it were also restyled to the GLA colour, every project
reopened after this ships would collapse its multi-coloured floors into one hue. So:

```js
type: normalizeTraceType(t.type)
colorSource: t.colorSource ?? (t.type ? 'type' : 'user')
```

A trace that predates types keeps the colour the user last saw. New work gets type
colours. One `normalizeTraces(traces)` helper, called at all three entry points:
`deserializeSketch`, the autosave restore path, and `applySnapshot` — the last one
because a `.floorplan` carries its undo stacks, and undoing into a pre-migration
snapshot would otherwise hand back untyped traces.

## 5. UI — `LeftPanel.jsx`

**Area section.** Headline becomes `areas.gla`. The `floorsInTotal > 1` caption is
replaced by a breakdown, rendered only when more than one type has area:

```
    ┌──────────────────┐
    │   2,140  ft²     │
    └──────────────────┘
      GLA · 2 floors
      ───────────────
      Below grade   850
      Garage        420
      ───────────────
      Total       3,410

    Grouped in the ANSI Z765 style — not a certified measurement.
```

Rows appear only for types with nonzero area, in `TRACE_TYPES` order. With only GLA
traces present the panel looks exactly as it does today.

*Empty-GLA fallback:* if no trace is typed GLA the headline would read 0 and the app
would look broken. When `gla === 0 && total > 0`, show the grand total with the
caption "Total · no GLA trace".

*Copy.* `handleCopyArea` copies the tab-separated breakdown when one exists (paste-ready
into a report or spreadsheet) and the single figure otherwise. Update the toast text
and the `title=` tooltip to match — a double-click that silently copies something
different from what it used to is worse than the problem being fixed.

**Perimeters list.** A native `<select>` styled as a small chip on each row's meta
line, left of the `N pts` text. Native because it stays keyboard-accessible for
roughly a tenth of the code of a custom dropdown, in a 228px panel. The existing
colour dot now reads as the type indicator without any change to it.

## 6. Tests

Existing files: `src/store/__tests__/floorManager.test.js`,
`src/store/__tests__/appStore.test.js`.

- a new trace defaults to `gla` and takes its colour from the type table
- `setPerimeterTraceType` pushes an undo snapshot and sets `isDirty`
- `applyDetectedTraces` with a matching count preserves `type` (the re-trace guarantee)
- two GLA traces get distinguishable colours; deleting the first re-shades the second
- `selectAreaByType`: subtotals are right, a hidden trace is excluded from both its
  subtotal and the total, and the returned object is reference-stable across an
  unrelated `set()`
- serializer round-trip: `type` survives export → import; a file with no `type`
  imports as `gla` with its original colour intact

Gate: `npm test`, `npm run lint`. `npm run bench:detection` should be run and is
expected to be byte-identical — no detection code is touched.

## 7. Known gaps, deliberately

- **Double counting is not detected.** On a plan where `nonGla.js` already carved the
  garage out of the footprint, a user who also traces the garage by hand gets it
  counted once in the garage subtotal and zero times in GLA — correct. But on a plan
  where the carve *failed*, the garage is inside the GLA trace and tracing it again
  double counts it. No overlap check ships here.
- **`generateTraceName` still names everything "Nth Floor".** A garage trace arrives
  called "3rd Floor" until renamed. Naming from the type would be a small follow-up.
- **A finished basement and an unfinished basement are the same value.** That is the
  cost of the flat enum, taken knowingly.
