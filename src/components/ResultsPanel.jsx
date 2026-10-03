import { useEffect, useRef } from 'react';
import {
  Plus, Eye, EyeOff, Trash2, Copy, Download, Loader2, Brush, Waypoints,
  ScanSearch, Ruler, MousePointerClick, RotateCcw,
} from 'lucide-react';
import useAppStore, {
  selectActiveAreaByType, selectWorkspaceArea,
} from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { formatArea, areaDisplayValue, formatAreaValue } from '../utils/unitConverter';
import { calculateArea, displayedBreakdownTotal } from '../utils/areaCalculator';
import { scaleProvenance } from '../utils/scaleProvenance';
import { DEFAULT_TRACE_TYPE, TRACE_TYPES, normalizeTraceType } from '../utils/traceTypes';
import { MAX_TRACES } from '../utils/planStage';
import { isUserAsserted } from '../utils/detection/validate';
import { MEASURE_STEPS, STEP_TITLES, measureStepIndex } from '../utils/progressSteps';
import { usePlanIssues } from '../hooks/usePlanIssues';
import { useToolRows } from '../hooks/useToolRows';
import { TOOL_GROUPS } from './toolCatalog';
import PanelSection, { StepMark, StepLine } from './PanelSection';
import TaskMenu from './TaskMenu';
import RoomSizeFields from './RoomSizeFields';
import ScaleLines from './ScaleLines';
import WorkSection from './WorkSection';

/**
 * The results panel: the answer, and under it the four steps it was reached by.
 *
 *   the area
 *   How it was measured
 *   ✓ Read the room sizes          7 room sizes on this plan        Read again
 *   ✓ Worked out the scale         Measured from 3 rooms…               Change
 *   ✓ Found the outside walls      1st Floor                            Change
 *   ✓ Added up the area            The sum behind 1,372 ft²       Show the sum
 *   [ Save image… ]                the end of the job, always in reach
 *
 * ## The steps stay
 *
 * While FloorTrace measures a plan the panel lists what it is doing — reading
 * the sizes, working out the scale, finding the walls. That list used to be
 * replaced, once the job was done, by three sections named for things (Outline,
 * Scale, How the area was calculated): a different screen, to be learned
 * separately. Now the same steps stay where they were and tick themselves off.
 * Each says its own conclusion in a line and carries the one way to change it,
 * so the finished panel reads top to bottom as *here is the area*, *here is how
 * it was reached*, *save it*. A step opens by itself only when it holds the
 * next thing to do.
 *
 * The step titles are in `progressSteps.js`, once, in three tenses: while it
 * runs, once it has produced something, and when there is nothing to show.
 *
 * ## What it does not say
 *
 * How well the outline follows the walls. There used to be a section for that,
 * "Things to check", listing what the detector doubted about its own trace — a
 * gap it had bridged, a stretch on no drawn wall. Every line described the
 * picture beside it: the outline is drawn over the plan, and the user checks it
 * by eye whatever the list says. So the list is gone, and with it the count
 * that held Save image back.
 *
 * What a picture cannot show is still said, inside the step it is about and
 * nowhere else (`usePlanIssues`): a scale the rooms disagree on, under the
 * scale; an area counted twice or a cut-out no longer taken off, under the
 * outline. Those are the wrong answers that look right. The step opens by
 * itself, its mark turns to an exclamation mark, and it wears a "Check" chip
 * while it holds one.
 *
 * Where things live:
 *
 *  - **Units** are a preference set once, so they are in Settings.
 *  - **Changing the outline** is the outline step: its "Change the outline"
 *    menu holds the tools (`toolCatalog.js`'s outline group), which open beside
 *    the panel, over the plan they act on. With no outline at all the step
 *    offers the ways to make one directly.
 *  - **Changing the scale** is the scale step: the scale is a number this
 *    panel states, and it is corrected where it is read.
 *  - **Reading the room sizes again** is the first step's own button.
 *  - **Inside or outside of the walls** is under the outline, with a sentence
 *    saying which one is the usual standard.
 *
 * ## The rules that did not change
 *
 * **No number without a scale.** With no scale the app falls back to one foot
 * per pixel and every area comes out as a pixel count — six figures of "ft²"
 * under "Gross living area". The figure refuses to print that. It says what is
 * missing and offers the way to supply it, the same way the exhibit prints "—".
 *
 * **Save image is the filled button as soon as there is an area to save.** It
 * is the end of the job. Whether the outline is right is the user's to see, and
 * a button that waited on the app's opinion of it never filled on some plans.
 *
 * **One component for both shells.** The phone's measurement sheet renders this
 * same tree (`mobile`), so the numbers cannot disagree between them. Handlers
 * the phone does not pass are optional; a step without one omits the action.
 * Anything said here is on the page, never only in a `title`.
 */

// A full-width choice, for the short lists of ways to do something.
const ChoiceButton = ({ icon: Icon, children, onClick, primary = false, title, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    disabled={disabled}
    className={`btn w-full justify-start ${primary ? 'btn-primary' : 'btn-secondary'}`}
  >
    {Icon && <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />}
    <span className="truncate">{children}</span>
  </button>
);

/**
 * The same four steps while FloorTrace is still doing them, ticked off as they
 * finish. It is the app saying what "automatic" consists of at the one moment
 * the user is watching it happen — and the list they will find here afterwards.
 *
 * A step that did not produce anything is not ticked: with no room sizes read
 * there is no scale, and the list must not draw a check beside one.
 */
const MeasuringSteps = ({ at, hasLabels, calibrated }) => {
  const settled = { read: hasLabels, scale: calibrated };
  const steps = [
    ...MEASURE_STEPS.map((step, i) => ({
      id: step.id,
      label: step.label,
      state: i > at ? 'todo' : i === at ? 'active' : (settled[step.id] ? 'done' : 'skipped'),
    })),
    // Not a job of its own: it is done the moment the other three are.
    { id: 'area', label: STEP_TITLES.area.doing, state: 'todo' },
  ];
  return (
    <ol className="flex flex-col">
      {steps.map((step, i) => (
        <li
          key={step.id}
          data-state={step.state}
          aria-current={step.state === 'active' ? 'step' : undefined}
          className="relative flex items-start gap-3.5 px-7 py-2.5"
        >
          {i < steps.length - 1 && <StepLine />}
          <StepMark state={step.state} number={i + 1} />
          <span data-step-title className={`pt-0.5 text-[16.5px] leading-snug
            ${step.state === 'active' ? 'font-bold text-accent-strong'
            : step.state === 'done' ? 'font-bold text-fg' : 'text-fg-3'}`}>
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
};

// The reason a trace found nothing arrives as a clause ("the walls are drawn
// too thin…") or as whole sentences, depending on which stage gave up. Either
// way it reads as a sentence here.
const asSentence = (text) => {
  const t = String(text ?? '').trim();
  if (!t) return '';
  return t[0].toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.');
};

// A step holding something a picture cannot show. Never a count: there is at
// most a handful of these in the whole app, and each is read where it sits.
const CheckChip = () => (
  <span className="chip chip-warn">
    <span className="chip-dot" />
    Check
  </span>
);

// One such thing: what it is, why it matters, and what to do about it.
const CheckNote = ({ issue, className = '' }) => (
  <div className={`note note-warn font-normal ${className}`}>
    <p className="font-semibold text-warn">{issue.label}</p>
    <p className="mt-1 text-fg-2">
      {issue.detail}
      {issue.remedy && <> {issue.remedy}</>}
    </p>
  </div>
);

// "GLA" is the trade's word and the one the exhibit prints; the list of
// choices is where it is spelled out once.
const typeOptionLabel = (type) => (type.id === DEFAULT_TRACE_TYPE ? 'Living area (GLA)' : type.label);

// The outline step's one line: the outline by name, or the few of them by name,
// or how many when there are too many to name in a line.
const outlinesInALine = (traces) => {
  if (traces.length === 1) return traces[0].name;
  if (traces.length > 3) return `${traces.length} outlines`;
  const names = traces.map((t) => t.name);
  return `${traces.length} outlines: ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

// The tools that change an outline, as `toolCatalog.js` lists them.
const OUTLINE_GROUP = TOOL_GROUPS.find((group) => group.id === 'outline');

const ResultsPanel = ({
  roomDimensions,
  onDimensionsChange,
  area,
  unit,
  isProcessing,
  ocrFailed,
  useInteriorWalls,
  onInteriorWallToggle,
  canSwitchWallFace,
  onDimensionFocus,
  onDimensionBlur,
  onExport,
  // The scale's corrections, and the ways to draw an outline when there is
  // none. Optional: a step with no handler simply does not offer the action.
  onScaleTool,
  onSelectRoom,
  onRestoreAutoScale,
  onRescan,
  onFindOutline,
  onPaintOutline,
  onPlaceCorners,
  onAddOutline,
  // Starts a tool or a command by its `toolCatalog.js` id. With it the outline
  // step carries the menu of ways to change an outline that exists.
  onSelectTool,
  // Rendered inside the mobile bottom sheet rather than beside the plan.
  // Everything below this line — the area maths, the breakdown, the outline
  // list, the checks and their canvas anchors — is the same code on both,
  // which is the point: a second mobile-only panel is a second place for the
  // numbers to disagree.
  mobile = false,
}) => {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const switchPerimeterTrace = useAppStore((s) => s.switchPerimeterTrace);
  const deletePerimeterTrace = useAppStore((s) => s.deletePerimeterTrace);
  const renamePerimeterTrace = useAppStore((s) => s.renamePerimeterTrace);
  const toggleVisibility = useAppStore((s) => s.togglePerimeterTraceVisibility);
  const setPerimeterTraceType = useAppStore((s) => s.setPerimeterTraceType);
  const areas = useAppStore(selectActiveAreaByType);
  const property = useAppStore(selectWorkspaceArea);
  const feetPerPixel = useAppStore((s) => s.calibration?.feetPerPixel);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const lastTraceOutcome = useAppStore((s) => s.lastTraceOutcome);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions) || [];
  const calibrationSource = useAppStore((s) => s.calibration?.source);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const roomOverlay = useAppStore((s) => s.roomOverlay);
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const setScaleRoomShown = useWorkspaceStore((s) => s.setScaleRoomShown);
  // An outline being drawn by hand right now. The step then says how to
  // finish it instead of offering three other ways to start.
  const painting = useAppStore((s) => s.drawModeActive);
  const placingCorners = useAppStore((s) => s.perimeterVertices !== null);
  // The rooms the detector confirmed — whether there are any is what decides
  // if "go back to the automatic scale" has anything to go back to.
  const rooms = useAppStore((s) => s.rooms);
  const flashStatus = useWorkspaceStore((s) => s.flashStatus);
  // What a picture cannot show, from the one place it is gathered, sorted into
  // the step each belongs to.
  const issues = usePlanIssues();
  const scaleNotes = issues.issues.filter((i) => i.kind === 'scale' || i.kind === 'rescale');
  const overlapNotes = issues.issues.filter((i) => i.kind === 'double-counted');
  const staleByTrace = new Map(
    issues.issues.filter((i) => i.kind === 'stale-void').map((i) => [i.traceId, i]),
  );
  const outlineNeedsLook = overlapNotes.length > 0 || staleByTrace.size > 0;
  // What each row of "Change the outline" may do right now.
  const toolRowState = useToolRows({ hasArea: area > 0 });

  const scrollRef = useRef(null);

  // ── the area ──
  // The headline is GLA, per the ANSI Z765 shape. With no GLA outline at all
  // it would read 0 and the app would look broken, so the grand total stands in.
  const typedRows = TRACE_TYPES.filter((t) => (areas.byType[t.id] ?? 0) > 0);
  const showBreakdown = typedRows.length > 1;
  const noGla = areas.gla === 0 && areas.total > 0;
  const glaCount = areas.counts[DEFAULT_TRACE_TYPE] ?? 0;
  const breakdownRows = noGla
    ? typedRows
    : typedRows.filter((t) => t.id !== DEFAULT_TRACE_TYPE);
  // The printed total is the sum of the printed rows. Rounding the raw sum on
  // its own lets the breakdown fail to reach the total sitting under it, and
  // this table is what gets copied into a report.
  const propertyTotal = formatAreaValue(displayedBreakdownTotal(property.byType, unit), unit);
  const propertyGla = formatAreaValue(areaDisplayValue(property.gla, unit), unit);
  const propertyLevels = property.counts?.[DEFAULT_TRACE_TYPE] ?? 0;

  const totalDisplay = displayedBreakdownTotal(areas.byType, unit);
  const totalFormatted = formatAreaValue(totalDisplay, unit);
  const { value: areaText, suffix: areaSuffix } = noGla
    ? totalFormatted
    : formatAreaValue(areaDisplayValue(areas.gla, unit), unit);

  // An area is only a measurement once there is a scale to measure it with.
  const measured = !!calibrated && area > 0;
  // The first run on a plan: a job is under way and there is no answer yet.
  const measuringByItself = isProcessing && !measured;
  // Which of the steps that run is under way, or -1 for a job that is none of
  // them (drawing the outline from a painting, say).
  const measuringAt = measuringByItself ? measureStepIndex(processingMessage) : -1;

  const traced = perimeterTraces.filter((t) => t.vertices?.length >= 3);
  const traceFailed = lastTraceOutcome?.level === 'failed' || lastTraceOutcome?.level === 'poor';

  // What the figure is, in the one line under it. Only said when there is
  // something to say: a single level measured to the outside of its walls is
  // what "gross living area" already means.
  const caption = [
    property.isMultiPlan && 'This plan',
    noGla && 'No outline counts as living area',
    !noGla && glaCount > 1 && `${glaCount} levels`,
    useInteriorWalls && 'Measured to the inside of the walls',
  ].filter(Boolean).join(' · ');

  // What the figure says in place of a number, and why.
  const areaMessage = (() => {
    if (measured || isProcessing) return null;
    if (!calibrated) {
      if (ocrFailed) {
        return 'FloorTrace couldn’t read any room sizes on this plan, so it can’t work out '
          + 'the scale by itself. Set it under the scale, below.';
      }
      return area > 0 ? 'Set the scale to see the area.' : 'No area yet.';
    }
    if (traced.length > 0) return 'Every outline is hidden. Show one under the outline, below, to see the area.';
    // Mid-way through drawing one by hand, "No outline yet" reads as the app
    // having lost it. The figure is on its way, and says so.
    if (painting || placingCorners) return 'The area will show here once the new outline is drawn.';
    return traceFailed
      ? 'FloorTrace couldn’t find the outline on its own. Draw it under the outline, below.'
      : 'No outline yet.';
  })();

  const handleCopyArea = () => {
    if (!showBreakdown) {
      navigator.clipboard.writeText(`${areaText} ${areaSuffix}`);
      flashStatus(`Area copied — ${areaText} ${areaSuffix}`);
      return;
    }
    // Tab-separated so it pastes into a report or a spreadsheet as rows.
    const lines = typedRows.map(
      (t) => `${t.label}\t${formatAreaValue(areaDisplayValue(areas.byType[t.id], unit), unit).value} ${areaSuffix}`
    );
    lines.push(`Total\t${totalFormatted.value} ${areaSuffix}`);
    if (property.isMultiPlan) {
      lines.push('');
      for (const plan of property.plans) {
        lines.push(`${plan.label}: ${formatAreaValue(areaDisplayValue(plan.total, unit), unit).value} ${areaSuffix}`);
      }
      lines.push(`Property total: ${propertyTotal.value} ${areaSuffix}`);
    }
    navigator.clipboard.writeText(lines.join('\n'));
    flashStatus('Area breakdown copied');
  };

  // ── the room sizes ──
  const hasLabels = detectedDimensions.length > 0;
  const sizesSummary = hasLabels
    ? `${detectedDimensions.length} room ${detectedDimensions.length === 1 ? 'size' : 'sizes'} on this plan`
    : (ocrFailed ? 'FloorTrace couldn’t read any on this plan' : null);

  // ── the scale ──
  const provenance = calibrated
    ? scaleProvenance({ calibration: { calibrated, source: calibrationSource, quality: scaleQuality } })
    : 'Not set yet.';
  // The room the scale is measured against, as a box on the plan. Not while a
  // drawn line is the scale: the box would then be evidence for nothing.
  const showRoomFields = !!roomOverlay && calibrationSource !== 'line-calibration';
  // The way back from a scale set by hand — a drawn line, or a room the user
  // picked or resized — to the one the rooms agreed on. Only where there are
  // measured rooms to go back to.
  const canRestore = !!onRestoreAutoScale && rooms?.length > 0
    && isUserAsserted({ quality: scaleQuality });
  const roomFields = showRoomFields && (
    <div className="mt-3.5">
      <p className="mb-2 text-[15.5px] leading-snug text-fg-2">
        {calibrated
          ? 'Room used for the scale (the green box on the plan). Correct its size if it was misread:'
          : 'Or use a whole room: drag the green box on the plan over a room you know the size of, then type its size:'}
      </p>
      <RoomSizeFields
        roomDimensions={roomDimensions}
        unit={unit}
        onDimensionsChange={onDimensionsChange}
        onDimensionFocus={onDimensionFocus}
        onDimensionBlur={onDimensionBlur}
      />
    </div>
  );

  // ── the outline ──
  // Whether this shell offers any way to draw an outline by hand. The phone
  // passes none, and the empty step must not end on a colon over nothing.
  const canDraw = !!(onPaintOutline || onPlaceCorners);
  const canAddOutline = !!onAddOutline && traced.length > 0 && perimeterTraces.length < MAX_TRACES;
  const outlineSummary = traced.length === 0 ? null : outlinesInALine(perimeterTraces);

  // Neither the scale nor the outline folds (the owner's decision, October
  // 2026): what each came to and the ways to change it are always on show.
  // Only the sum does, behind its own saved preference (`WorkSection`).

  // The room the scale came from is drawn on the plan while the scale step is
  // on show, which is where it is explained — and the step is always on show
  // once the panel has steps at all. The phone draws it always: its sheet has
  // to be closed to reach the plan, and the box with it would be gone.
  const scaleOpen = !measuringByItself;
  useEffect(() => {
    if (mobile) return undefined;
    setScaleRoomShown(scaleOpen);
    return () => setScaleRoomShown(false);
  }, [mobile, scaleOpen, setScaleRoomShown]);

  const reveal = (key) => {
    setTimeout(() => {
      scrollRef.current?.querySelector(`#panel-${key}`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 0);
  };

  // The end of the job: the filled button as soon as there is an area to save.
  // Without a scale the area is not one yet, and the filled button is the
  // scale's.
  const saveBlock = area > 0 && (
    <button
      type="button"
      onClick={onExport}
      className={`btn w-full ${mobile ? '' : 'btn-lg'} ${measured ? 'btn-primary' : 'btn-secondary'}`}
    >
      <Download className="w-5 h-5" aria-hidden="true" />
      Save image…
    </button>
  );

  return (
    <aside
      className={mobile
        ? 'flex w-full flex-col bg-panel-2 select-none'
        : 'flex w-[420px] shrink-0 flex-col min-h-0 bg-panel-2 border-r border-line select-none'}
      aria-label="Results"
    >
      {/* One scroll container, not two: on mobile the sheet already scrolls,
          and nesting a second one means a flick either moves the wrong thing
          or nothing at all depending on where the finger landed. */}
      <div
        ref={scrollRef}
        className={mobile
          ? 'flex flex-col pb-6'
          : 'flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden'}
      >
        {/* ── the area ── */}
        <div id="panel-area" className="px-7 pt-6 pb-5">
          <div className="flex items-center justify-between gap-2 min-h-[32px]">
            <h2 className="text-[16px] text-fg-3">{noGla ? 'Total area' : 'Gross living area'}</h2>
            {measured && (
              <button
                type="button"
                onClick={handleCopyArea}
                title={showBreakdown ? 'Copy the breakdown as text' : 'Copy the area as text'}
                className="link-btn"
              >
                <Copy className="w-4 h-4" aria-hidden="true" />
                Copy
              </button>
            )}
          </div>

          {measured ? (
            <>
              <div className="mt-1 flex items-baseline gap-2.5">
                <span
                  className="font-bold tabular-nums text-fg leading-none tracking-tight"
                  style={{ fontSize: areaText.length <= 7 ? '3.75rem' : areaText.length <= 9 ? '3rem' : '2.25rem' }}
                >
                  {areaText}
                </span>
                <span className="text-[24px] text-fg-3">{areaSuffix}</span>
              </div>
              {caption && <p className="mt-2 text-[15.5px] leading-snug text-fg-3">{caption}</p>}
            </>
          ) : measuringByItself && measuringAt < 0 ? (
            // A job that is none of the steps says itself in a line.
            <p className="mt-3 flex items-center gap-2.5 text-[16px] font-bold text-accent-strong">
              <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
              <span>{processingMessage || 'Measuring…'}</span>
            </p>
          ) : (
            <>
              <span className="block mt-1 text-[3.25rem] leading-none font-bold text-fg-dim" aria-hidden="true">—</span>
              {measuringByItself ? (
                <p className="mt-3 text-[16px] leading-snug text-fg-3">The area will show here in a moment.</p>
              ) : (
                <>
                  <p className={`mt-3 text-[16px] leading-snug ${ocrFailed && !calibrated ? 'text-warn font-medium' : 'text-fg-2'}`}>
                    {areaMessage}
                  </p>
                  {!calibrated && (
                    <button type="button" onClick={() => reveal('scale')} className="mt-3 btn btn-secondary w-full">
                      Set the scale
                    </button>
                  )}
                </>
              )}
            </>
          )}

          {measured && showBreakdown && (
            <table className="w-full border-collapse mt-4 text-[16px]">
              <tbody>
                {breakdownRows.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 border-t border-line text-fg-2">
                      <span className="inline-block w-3 h-3 rounded-sm mr-2.5 align-middle"
                            style={{ backgroundColor: t.color }} />
                      {t.label}
                    </td>
                    <td className="py-1.5 border-t border-line text-right tabular-nums text-fg">
                      {formatAreaValue(areaDisplayValue(areas.byType[t.id], unit), unit).value}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-1.5 border-t-[1.5px] border-fg font-bold text-fg">Total</td>
                  <td className="pt-1.5 border-t-[1.5px] border-fg text-right tabular-nums font-bold text-fg">
                    {totalFormatted.value} {areaSuffix}
                  </td>
                </tr>
              </tbody>
            </table>
          )}

          {/* The property: the figure that goes in the report. Only when more
              than one plan contributes — on a single-plan job it would just
              restate the number directly above it. */}
          {measured && property.isMultiPlan && (
            <div className="mt-5 pt-4 border-t border-line">
              <div className="flex items-baseline justify-between gap-2">
                <p className="label-sm">Whole property</p>
                {propertyLevels > 0 && (
                  <span className="text-[15px] text-fg-3">
                    {propertyLevels} {propertyLevels === 1 ? 'level' : 'levels'} across{' '}
                    {property.plans.length} plans
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-bold tabular-nums text-fg leading-none tracking-tight text-[2.25rem]">
                  {property.gla > 0 ? propertyGla.value : propertyTotal.value}
                </span>
                <span className="text-[17px] text-fg-3">{areaSuffix}</span>
                <span className="text-[15px] text-fg-3">
                  {property.gla > 0 ? 'gross living area' : 'total, no living-area outline'}
                </span>
              </div>

              <table className="w-full border-collapse mt-3 text-[16px]">
                <tbody>
                  {property.plans.map((plan) => (
                    <tr key={plan.docId}>
                      {/* A file name is one unbreakable word; without
                          `anywhere` its min-content width stretches the
                          table past the panel and it scrolls sideways. */}
                      <td className="py-1.5 border-t border-line text-fg-2 [overflow-wrap:anywhere]">
                        {plan.label}
                        {plan.isActive && (
                          <span className="ml-1.5 text-[14px] text-fg-dim">this plan</span>
                        )}
                        {/* A plan the workspace has not read back cannot be
                            re-measured; its figure is the one it last
                            reported. Said rather than hidden. */}
                        {plan.fromDisk && (
                          <span className="ml-1.5 text-[14px] text-fg-dim">from the last save</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 border-t border-line text-right tabular-nums text-fg whitespace-nowrap">
                        {formatAreaValue(areaDisplayValue(plan.total, unit), unit).value}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 border-t-[1.5px] border-fg font-bold text-fg">Property total</td>
                    <td className="pt-1.5 border-t-[1.5px] border-fg text-right tabular-nums font-bold text-fg">
                      {propertyTotal.value}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* On the phone the sheet scrolls as one piece, so the way out sits
              under the figure rather than pinned to a foot it does not have. */}
          {mobile && saveBlock && <div className="mt-4">{saveBlock}</div>}
        </div>

        {/* ── the steps ── while FloorTrace is still measuring the plan by
            itself they are a list being ticked off: the outline is on its way
            and the scale is being worked out, and "not set" over a button to
            set it by hand would be the app interrupting its own answer. A job
            that is none of the steps has said itself above, and shows none. */}
        {measuringByItself && measuringAt >= 0 && (
          <div id="panel-steps" className="flex-1 border-t border-line bg-panel pt-4 pb-3">
            <h2 className="px-7 mb-1.5 text-[16px] font-bold text-fg">How FloorTrace is measuring it</h2>
            <MeasuringSteps at={measuringAt} hasLabels={hasLabels} calibrated={!!calibrated} />
          </div>
        )}

        {!measuringByItself && (
        <div id="panel-steps" className="flex-1 border-t border-line bg-panel pt-4 pb-3">
          <h2 className="px-7 mb-1.5 text-[16px] font-bold text-fg">How it was measured</h2>

          {/* ── 1 · the room sizes ── nothing to fold: what was read is on the
              plan, and the one thing to do about it is read it again. */}
          <PanelSection
            id="panel-sizes"
            number={1}
            state={hasLabels ? 'done' : (ocrFailed ? 'skipped' : 'todo')}
            title={hasLabels ? STEP_TITLES.read.done : STEP_TITLES.read.missing}
            summary={sizesSummary}
            action={onRescan && (
              <button type="button" onClick={onRescan} disabled={isProcessing} className="link-btn text-[15px]">
                Read again
              </button>
            )}
          />

          {/* ── 2 · the scale ──
              The number every area on this panel is derived from, said as
              where it came from rather than as pixels per foot, with the ways
              to change it — and, when the rooms did not agree, that.

              A bad room implies a scale that can be 58-90% out, and area goes
              as scale squared. Unlike a wrong outline, a wrong scale looks
              exactly like a right one, so a doubt about it is the one thing
              this panel says without being asked, as the step's first
              paragraph.

              It does not fold (the owner's decision, October 2026): the room
              the scale came from and the ways to change it are always on
              show, with the green box on the plan beside them. */}
          <PanelSection
            id="panel-scale"
            number={2}
            state={scaleNotes.length > 0 ? 'check' : (calibrated ? 'done' : 'todo')}
            title={calibrated ? STEP_TITLES.scale.done : STEP_TITLES.scale.missing}
            summary={calibrated ? provenance.replace(/\.$/, '') : null}
            badge={scaleNotes.length > 0 ? <CheckChip /> : null}
            open
          >
            {calibrated ? (
              <>
                <p className="text-[15.5px] leading-snug text-fg-2">{provenance}</p>
                {scaleNotes.map((issue) => (
                  <CheckNote key={issue.kind} issue={issue} className="mt-3" />
                ))}
              </>
            ) : ocrFailed && !isProcessing ? (
              <p className="note note-warn">
                FloorTrace couldn’t read any room sizes on this plan, so it needs one
                measurement from you.
              </p>
            ) : (
              <p className="text-[15.5px] leading-snug text-fg-3">{provenance}</p>
            )}

            {/* The lengths drawn with the tool, and the box to type each one
                into: the second half of measuring a known length, so it leads. */}
            <ScaleLines unit={unit} />

            {/* While a length is being measured the step is that and nothing
                else: the other ways to set the scale, and the two fields that
                belong to one of them, stand down until it is done. */}
            {!scaleToolActive && (
            <>
            {/* With a scale, the room it came from leads and the ways to
                change it follow. Without one the order turns over: the way to
                set it comes first, as the one filled button on the panel. */}
            {calibrated && roomFields}

            <div className="mt-3.5 flex flex-col gap-2">
              {/* Room sizes first, then the manual override: picking a room
                  re-uses what was already read, which is cheaper and usually
                  right. */}
              {hasLabels && onSelectRoom && (
                <ChoiceButton icon={MousePointerClick} onClick={onSelectRoom} disabled={isProcessing}
                              primary={!calibrated}
                              title="Show the room sizes FloorTrace read, and click the one to trust">
                  {calibrated ? 'Use a different room' : 'Pick a room to scale from'}
                </ChoiceButton>
              )}
              {onScaleTool && (
                <>
                  <ChoiceButton icon={Ruler} onClick={onScaleTool}
                                primary={!calibrated && !(hasLabels && onSelectRoom)}
                                title="Click both ends of something whose length you know, then type the length">
                    Measure a length you know
                  </ChoiceButton>
                  {!calibrated && (
                    <p className="text-[15.5px] leading-snug text-fg-3">
                      Click both ends of a wall or a room whose length you know, then type
                      the length.
                    </p>
                  )}
                </>
              )}
              {/* The way back, which two of the scale messages promise by name:
                  `applyDecision` refuses to write over a user-asserted scale
                  forever, so without it a hand-set scale is permanent. */}
              {canRestore && (
                <ChoiceButton icon={RotateCcw} onClick={onRestoreAutoScale}>
                  Go back to the automatic scale
                </ChoiceButton>
              )}
            </div>

            {!calibrated && roomFields}
            </>
            )}
          </PanelSection>

          {/* ── 3 · the outline ── */}
          <PanelSection
            id="panel-outline"
            number={3}
            state={outlineNeedsLook ? 'check' : (traced.length > 0 ? 'done' : 'todo')}
            title={traced.length > 0 ? STEP_TITLES.outline.done : STEP_TITLES.outline.missing}
            summary={outlineSummary}
            badge={outlineNeedsLook ? <CheckChip /> : null}
            open
          >
            {traced.length === 0 ? (
              painting || placingCorners ? (
                <p className="text-[15.5px] leading-snug text-fg-2">
                  {painting
                    ? 'Paint roughly over the outside walls on the plan, then click “Draw the outline” above the plan.'
                    : 'Click each outside corner on the plan. Click the first corner again to finish.'}
                </p>
              ) : (
                <>
                  <p className="text-[15.5px] leading-snug text-fg-2">
                    {traceFailed
                      ? `FloorTrace couldn’t find the outline on its own.${canDraw ? ' Draw it yourself — it only takes a minute:' : ''}`
                      : `No outline yet.${canDraw ? ' Let FloorTrace find it, or draw it yourself:' : ''}`}
                  </p>
                  {/* Why, when the trace said. With no outline there is no
                      picture to read it from, so this is the one time the
                      detector's reason is put into words. */}
                  {traceFailed && lastTraceOutcome?.reason && (
                    <p className="mt-2 text-[15.5px] leading-snug text-fg-3">
                      {asSentence(lastTraceOutcome.reason)}
                    </p>
                  )}
                  {/* One filled button on the panel at a time. With no scale
                      either, that one is the scale's: it is what the figure
                      above is asking for. */}
                  <div className="mt-3 flex flex-col gap-2">
                    {!traceFailed && onFindOutline && (
                      <ChoiceButton icon={ScanSearch} primary={!!calibrated} onClick={onFindOutline}>
                        Find the outline
                      </ChoiceButton>
                    )}
                    {onPaintOutline && (
                      <ChoiceButton icon={Brush} primary={traceFailed && !!calibrated} onClick={onPaintOutline}
                                    title="Paint roughly over the outside walls and FloorTrace draws the outline">
                        Paint over the walls
                      </ChoiceButton>
                    )}
                    {onPlaceCorners && (
                      <ChoiceButton icon={Waypoints} onClick={onPlaceCorners}
                                    title="Click each outside corner in turn">
                        Click the corners
                      </ChoiceButton>
                    )}
                  </div>
                  {traceFailed && onFindOutline && (
                    <button type="button" onClick={onFindOutline} className="link-btn mt-3">
                      Try the automatic outline again
                    </button>
                  )}
                </>
              )
            ) : (
              <>
                {overlapNotes.map((issue, i) => (
                  <CheckNote key={`overlap-${i}`} issue={issue} className="mb-3" />
                ))}

                {/* The outlines as one card: a row each, and under the last of
                    them the one setting they all share. A card rather than a
                    list bled to the panel's edge, so everything in the step —
                    the rows, the setting, the two buttons — has one width. */}
                <div className="overflow-hidden rounded-xl border border-line bg-panel-2">
                  {perimeterTraces.map((trace) => {
                    const isActive = trace.id === activeTraceId;
                    const drawn = trace.vertices && trace.vertices.length >= 3;
                    const traceArea = drawn
                      ? calculateArea(trace.vertices, feetPerPixel, trace.holes)
                      : 0;
                    const { value: tAreaText, suffix: tSuffix } = formatArea(traceArea, unit);

                    return (
                      <div
                        key={trace.id}
                        onClick={() => switchPerimeterTrace(trace.id)}
                        className={`pl-3.5 pr-2 py-3 border-t border-line first:border-t-0 cursor-pointer transition-colors
                          ${isActive && perimeterTraces.length > 1
                            ? 'bg-accent/10 shadow-[inset_3px_0_0_rgb(var(--accent))]'
                            : 'hover:bg-sunken/60'}`}
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="w-3 h-3 rounded-sm shrink-0"
                            style={{ backgroundColor: trace.color }}
                          />
                          <input
                            type="text"
                            value={trace.name}
                            onChange={(e) => renamePerimeterTrace(trace.id, e.target.value)}
                            onClick={(e) => e.stopPropagation()}
                            onFocus={() => { if (!isActive) switchPerimeterTrace(trace.id); }}
                            aria-label="Outline name"
                            title="Click to rename"
                            className={`flex-1 min-w-0 bg-transparent border-0 border-b border-transparent px-0 py-0.5
                              text-[16px] font-bold hover:border-line-strong
                              focus:outline-none focus:ring-0 focus:border-accent
                              select-none focus:select-text
                              ${isActive ? 'text-fg' : 'text-fg-2'} ${trace.visible ? '' : 'opacity-45'}`}
                          />
                          <span className={`tabular-nums text-[15.5px] text-fg-2 whitespace-nowrap
                                            ${trace.visible ? '' : 'opacity-45'}`}>
                            {drawn && calibrated ? `${tAreaText} ${tSuffix}` : '—'}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); toggleVisibility(trace.id); }}
                            aria-pressed={trace.visible}
                            title={trace.visible
                              ? 'Hide this outline — it leaves the total while hidden'
                              : 'Show this outline'}
                            aria-label={trace.visible ? 'Hide this outline' : 'Show this outline'}
                            className="icon-btn w-9 h-9"
                          >
                            {trace.visible
                              ? <Eye className="w-[18px] h-[18px]" aria-hidden="true" />
                              : <EyeOff className="w-[18px] h-[18px]" aria-hidden="true" />}
                          </button>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              const traceName = trace.name;
                              deletePerimeterTrace(trace.id);
                              flashStatus(`Removed ${traceName} — Undo brings it back`);
                            }}
                            title="Delete this outline"
                            aria-label="Delete this outline"
                            className="icon-btn w-9 h-9 hover:bg-crit/12 hover:text-crit"
                          >
                            <Trash2 className="w-[18px] h-[18px]" aria-hidden="true" />
                          </button>
                        </div>

                        {/* What this outline *is*. How well it follows the walls
                            is on the plan, to be looked at, and is not said
                            here. The choice runs the width of the row, so it
                            lines up with the card's other controls. */}
                        <div className="flex items-center gap-2.5 mt-2 pr-1.5 text-[15.5px] text-fg-2">
                          <label htmlFor={`type-${trace.id}`} className="shrink-0">Counts as</label>
                          <select
                            id={`type-${trace.id}`}
                            value={normalizeTraceType(trace.type)}
                            onClick={(e) => e.stopPropagation()}
                            onChange={(e) => setPerimeterTraceType(trace.id, e.target.value)}
                            // A type the app assigned has to say what it read it
                            // from — the user never chose it and the plan is the
                            // only place the answer lives.
                            title={trace.typeSource === 'detected' && trace.typeEvidence?.text
                              ? `Read from "${trace.typeEvidence.text.trim()}" on the plan`
                              : 'What this outline counts as in the total'}
                            className="flex-1 min-w-0 h-10 px-2 rounded-lg border border-line-strong bg-panel-2
                                       text-[15.5px] text-fg cursor-pointer hover:border-accent
                                       focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            {TRACE_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>{typeOptionLabel(t)}</option>
                            ))}
                          </select>
                        </div>

                        {/* A type FloorTrace chose moves this outline's area
                            out of the living area — so where it read that from
                            is on the page, not in a tooltip. */}
                        {trace.typeSource === 'detected' && trace.typeEvidence?.text && (
                          <p className="mt-1.5 pr-1.5 text-[15px] leading-snug text-fg-3">
                            Set from “{trace.typeEvidence.text.trim()}” on the plan.
                          </p>
                        )}

                        {!drawn && (
                          <p className="mt-2 pr-1.5 text-[15.5px] leading-snug text-fg-3">
                            Not drawn yet — click its corners on the plan, or paint over its walls.
                          </p>
                        )}

                        {staleByTrace.has(trace.id) && (
                          <p className="mt-2 pr-1.5 text-[15.5px] leading-snug text-warn">
                            <span className="font-semibold">{staleByTrace.get(trace.id).label}.</span>
                            {' '}{staleByTrace.get(trace.id).detail}
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {/* One setting for every outline, not just the selected one —
                      two outlines measured to different wall faces is an area
                      nobody can reconcile. So it is the card's last row, under
                      all of them, as a two-way switch the width of the card. */}
                  {measured && canSwitchWallFace && (
                    <div className="px-3.5 py-3 border-t border-line bg-panel">
                      <p className="text-[15.5px] text-fg-2">Measured to the</p>
                      <div className="seg mt-1.5 flex w-full" role="group" aria-label="Measure every outline to">
                        <button
                          type="button"
                          onClick={() => onInteriorWallToggle(false)}
                          aria-pressed={!useInteriorWalls}
                          className="seg-option flex-[3] whitespace-nowrap"
                        >
                          Outside of walls
                        </button>
                        <button
                          type="button"
                          onClick={() => onInteriorWallToggle(true)}
                          aria-pressed={!!useInteriorWalls}
                          className="seg-option flex-[2] whitespace-nowrap"
                        >
                          Inside
                        </button>
                      </div>
                      <p className="mt-1.5 text-[15px] leading-snug text-fg-3">
                        Living area is normally measured to the outside of the walls.
                      </p>
                    </div>
                  )}
                </div>

                {/* What can be done about the outlines, last: two buttons of one
                    size. "Change the outline" is the menu of ways to change one
                    that exists, opening beside the panel over the plan they act
                    on; "Add another outline" is left out of that menu because
                    it is the button under it. */}
                {((onSelectTool && OUTLINE_GROUP) || canAddOutline) && (
                  <div className="mt-3 flex flex-col gap-2">
                    {onSelectTool && OUTLINE_GROUP && (
                      <TaskMenu
                        group={OUTLINE_GROUP}
                        menuGroup="panel"
                        label="Change the outline"
                        rowState={toolRowState}
                        onSelect={onSelectTool}
                        omit={['addOutline']}
                        placement="side"
                        triggerClassName="btn btn-secondary w-full justify-start [&>span]:flex-1 [&>span]:text-left"
                      />
                    )}
                    {canAddOutline && (
                      <button
                        type="button"
                        onClick={() => onAddOutline()}
                        className="btn btn-secondary w-full justify-start"
                      >
                        <Plus className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
                        Add another outline
                      </button>
                    )}
                  </div>
                )}
                {canAddOutline && (
                  <p className="mt-2 text-[15px] leading-snug text-fg-3">
                    Add one for a garage, a porch or another level, then choose what it counts as.
                  </p>
                )}
              </>
            )}
          </PanelSection>

          {/* ── 4 · the area ── the sum, only for a measured area. With no
              scale its figures would be the one-foot-per-pixel fallback — the
              pixel count the figure above refuses to print — so until then
              the step is only its own name. */}
          {measured ? (
            <WorkSection unit={unit} summary={`The sum behind ${areaText} ${areaSuffix}`} />
          ) : (
            <PanelSection
              id="panel-area-step"
              number={4}
              state="todo"
              title={STEP_TITLES.area.missing}
              last
            />
          )}
        </div>
        )}
      </div>

      {/* The end of the job, pinned to the foot of the panel so it is in reach
          however far the steps above have been scrolled. */}
      {!mobile && saveBlock && (
        <div className="shrink-0 px-7 py-4 border-t border-line bg-panel-2">
          {saveBlock}
        </div>
      )}
    </aside>
  );
};

export default ResultsPanel;
