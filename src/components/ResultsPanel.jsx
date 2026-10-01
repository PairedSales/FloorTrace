import { useEffect, useRef, useState } from 'react';
import {
  Eye, EyeOff, Trash2, Copy, Download, Loader2,
  ScanSearch, Ruler, MousePointerClick, RotateCcw, ScanText, Check, Minus,
} from 'lucide-react';
import useAppStore, {
  selectActiveAreaByType, selectWorkspaceArea, selectPickingRoom,
} from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { formatArea, areaDisplayValue, formatAreaValue } from '../utils/unitConverter';
import { calculateArea, displayedBreakdownTotal } from '../utils/areaCalculator';
import { scaleProvenance } from '../utils/scaleProvenance';
import { DEFAULT_TRACE_TYPE, TRACE_TYPES, normalizeTraceType } from '../utils/traceTypes';
import { isUserAsserted } from '../utils/detection/validate';
import { MEASURE_STEPS, measureStepIndex } from '../utils/progressSteps';
import { usePlanIssues } from '../hooks/usePlanIssues';
import PanelSection from './PanelSection';
import RoomSizeFields from './RoomSizeFields';
import ScaleLines from './ScaleLines';
import WorkSection from './WorkSection';

/**
 * The results panel: the answer and — folded away until it is wanted — what
 * the answer is made of.
 *
 *   the area
 *   ▸ Outline             what was measured
 *   ▸ Scale               what it was measured with
 *   ▸ How the area was calculated
 *   [ Save image… ]       the end of the job, always in reach
 *
 * ## What changed, and why
 *
 * This was four cards that were always open. A finished plan showed a unit
 * switch, a wall-face switch, an outline's name, its eye, its bin and its type,
 * four ways to redraw it, the size of some room, and four ways to re-scale —
 * some forty controls at rest, nearly all of them answers to questions the user
 * had not asked. Read top to bottom it now says two things: *here is the area*,
 * *save it*. Each section folds to one line that states its own conclusion
 * ("Measured from 3 rooms on this plan"), and opens by itself only when it
 * holds the next thing to do.
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
 * What a picture cannot show is still said, inside the section it is about and
 * nowhere else (`usePlanIssues`): a scale the rooms disagree on, under Scale;
 * an area counted twice or a cut-out no longer taken off, under Outline. Those
 * are the wrong answers that look right. The section opens by itself and wears
 * a "Check" chip while it holds one.
 *
 * Where things went:
 *
 *  - **Units** are a preference set once, so they are in Settings.
 *  - **Drawing or redrawing the outline by hand** is gone. FloorTrace traces
 *    the plan; with no outline the section offers to look again, and says why
 *    the last look found nothing.
 *  - **Changing the scale** stayed here, inside Scale: the scale is a number
 *    this panel states, and it is corrected where it is read.
 *  - **Inside or outside of the walls** moved under Outline, with a sentence
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
 * the phone does not pass are optional; a section without one omits the action.
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
 * What FloorTrace is doing while it measures a plan by itself — the job in
 * three steps, ticked off as they finish. It is the app saying what
 * "automatic" consists of at the one moment the user is watching it happen.
 *
 * A step that did not produce anything is not ticked: with no room sizes read
 * there is no scale, and the list must not draw a check beside one.
 */
const MeasuringSteps = ({ message, hasLabels, calibrated }) => {
  const at = measureStepIndex(message);
  if (at < 0) {
    return (
      <p className="mt-3 flex items-center gap-2.5 text-[14.5px] font-medium text-accent-strong">
        <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
        <span>{message || 'Measuring…'}</span>
      </p>
    );
  }

  const settled = { read: hasLabels, scale: calibrated };
  return (
    <ol className="mt-4 flex flex-col gap-3">
      {MEASURE_STEPS.map((step, i) => {
        const state = i > at ? 'todo' : i === at ? 'active' : (settled[step.id] ? 'done' : 'skipped');
        return (
          <li
            key={step.id}
            aria-current={state === 'active' ? 'step' : undefined}
            className={`flex items-center gap-3 text-[14.5px] leading-snug
              ${state === 'active' ? 'font-semibold text-accent-strong'
            : state === 'done' ? 'text-fg-2' : 'text-fg-dim'}`}
          >
            <span className="grid place-items-center w-5 h-5 shrink-0">
              {state === 'active' && <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />}
              {state === 'done' && <Check className="w-[18px] h-[18px] text-ok" aria-hidden="true" />}
              {state === 'skipped' && <Minus className="w-4 h-4" aria-hidden="true" />}
              {state === 'todo' && <span className="w-2 h-2 rounded-full bg-line" />}
            </span>
            {step.label}
          </li>
        );
      })}
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

// A section holding something a picture cannot show. Never a count: there is
// at most a handful of these in the whole app, and each is read where it sits.
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
  // The scale's corrections, and the way to look for an outline when there is
  // none. Optional: a section with no handler simply does not offer the action.
  onScaleTool,
  onSelectRoom,
  onRestoreAutoScale,
  onRescan,
  onFindOutline,
  // Rendered inside the mobile bottom sheet rather than beside the plan.
  // Everything below this line — the area maths, the breakdown, the outline
  // list, the checks and their canvas anchors — is the same code on both,
  // which is the point: a second mobile-only panel is a second place for the
  // numbers to disagree.
  mobile = false,
}) => {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
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
  // The room sizes FloorTrace read are on the plan as buttons, to pick one.
  // Never during the automatic run, which passes through the same state: opening
  // Scale for that left it open — green box, fields and all — on every plan
  // FloorTrace had just finished measuring by itself.
  const pickingRoom = useAppStore(selectPickingRoom);
  const setScaleRoomShown = useWorkspaceStore((s) => s.setScaleRoomShown);
  // The rooms the detector confirmed — whether there are any is what decides
  // if "go back to the automatic scale" has anything to go back to.
  const rooms = useAppStore((s) => s.rooms);
  const flashStatus = useWorkspaceStore((s) => s.flashStatus);
  // What a picture cannot show, from the one place it is gathered, sorted into
  // the section each belongs to.
  const issues = usePlanIssues();
  const scaleNotes = issues.issues.filter((i) => i.kind === 'scale' || i.kind === 'rescale');
  const overlapNotes = issues.issues.filter((i) => i.kind === 'double-counted');
  const staleByTrace = new Map(
    issues.issues.filter((i) => i.kind === 'stale-void').map((i) => [i.traceId, i]),
  );
  const outlineNeedsLook = overlapNotes.length > 0 || staleByTrace.size > 0;

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
          + 'the scale by itself. Set it under Scale.';
      }
      return area > 0 ? 'Set the scale to see the area.' : 'No area yet.';
    }
    if (traced.length > 0) return 'Every outline is hidden. Show one under Outline to see the area.';
    return traceFailed
      ? 'FloorTrace couldn’t find the outline on this plan.'
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

  // ── the scale ──
  const provenance = calibrated
    ? scaleProvenance({ calibration: { calibrated, source: calibrationSource, quality: scaleQuality } })
    : 'Not set yet.';
  // The room the scale is measured against, as a box on the plan. Not while a
  // drawn line is the scale: the box would then be evidence for nothing.
  const showRoomFields = !!roomOverlay && calibrationSource !== 'line-calibration';
  // The way back from a scale set by hand — a drawn line, or a room the user
  // picked or retyped — to the one the rooms agreed on. Only where there are
  // measured rooms to go back to.
  const canRestore = !!onRestoreAutoScale && rooms?.length > 0
    && isUserAsserted({ quality: scaleQuality });
  const hasLabels = detectedDimensions.length > 0;
  // Only with a scale: the box is the room the scale came from, and without a
  // scale there is no such room.
  const roomFields = showRoomFields && calibrated && (
    <div className="mt-3.5">
      <p className="mb-2 text-[13.5px] leading-snug text-fg-3">
        Room used for the scale (the green box on the plan). Correct its size if it was misread:
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
  const outlineSummary = traced.length === 0 ? 'Not found yet'
    : perimeterTraces.length === 1 ? perimeterTraces[0].name
      : `${perimeterTraces.length} outlines`;

  // ── which sections are open ──
  // A section opens by itself when it holds the next thing to do, and stays
  // however it was last set by hand.
  const autoOpen = {
    outline: traced.length === 0 || perimeterTraces.length > 1 || outlineNeedsLook,
    scale: !calibrated || scaleNotes.length > 0,
  };
  const [byHand, setByHand] = useState({});
  const isOpen = (key) => byHand[key] ?? autoOpen[key];
  const toggle = (key) => setByHand((prev) => ({ ...prev, [key]: !(prev[key] ?? autoOpen[key]) }));

  // A different plan is a different set of questions.
  useEffect(() => { setByHand({}); }, [activeDocumentId]);
  // Setting the scale from a known length ends with typing it into Scale, and
  // picking a room ends with checking its green box and its size there — so starting
  // either opens the section wherever it was left.
  // After the reset above, and on a plan switch too: a plan that comes back
  // mid-measurement comes back with Scale open.
  useEffect(() => {
    if (scaleToolActive || pickingRoom) setByHand((prev) => ({ ...prev, scale: true }));
  }, [scaleToolActive, pickingRoom, activeDocumentId]);

  // The room the scale came from is drawn on the plan while Scale is open,
  // which is where it is explained. The phone draws it always: its sheet has
  // to be closed to reach the plan, and the box with it would be gone.
  const scaleOpen = !measuringByItself && isOpen('scale');
  useEffect(() => {
    if (mobile) return undefined;
    setScaleRoomShown(scaleOpen);
    return () => setScaleRoomShown(false);
  }, [mobile, scaleOpen, setScaleRoomShown]);

  const reveal = (key) => {
    setByHand((prev) => ({ ...prev, [key]: true }));
    // After the section has opened, so there is something to scroll to.
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
      <Download className="w-[18px] h-[18px]" aria-hidden="true" />
      Save image…
    </button>
  );

  return (
    <aside
      className={mobile
        ? 'flex w-full flex-col bg-panel-2 select-none'
        : 'flex w-[360px] shrink-0 flex-col min-h-0 bg-panel-2 border-r border-line select-none'}
      aria-label="Results"
    >
      {/* One scroll container, not two: on mobile the sheet already scrolls,
          and nesting a second one means a flick either moves the wrong thing
          or nothing at all depending on where the finger landed. */}
      <div
        ref={scrollRef}
        className={mobile
          ? 'flex flex-col pb-6'
          : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden'}
      >
        {/* ── the area ── */}
        <div id="panel-area" className="px-5 pt-5 pb-5">
          <div className="flex items-center justify-between gap-2 min-h-[32px]">
            <h2 className="label-sm">{noGla ? 'Total area' : 'Gross living area'}</h2>
            {measured && (
              <button
                type="button"
                onClick={handleCopyArea}
                title={showBreakdown ? 'Copy the breakdown as text' : 'Copy the area as text'}
                className="btn btn-quiet btn-sm -mr-2"
              >
                <Copy className="w-4 h-4" aria-hidden="true" />
                Copy
              </button>
            )}
          </div>

          {measured ? (
            <>
              <div className="flex items-baseline gap-2">
                <span
                  className="font-semibold tabular-nums text-fg leading-none tracking-tight"
                  style={{ fontSize: areaText.length <= 7 ? '2.75rem' : areaText.length <= 9 ? '2.25rem' : '1.75rem' }}
                >
                  {areaText}
                </span>
                <span className="text-[18px] text-fg-3 font-medium">{areaSuffix}</span>
              </div>
              {caption && <p className="mt-2 text-[13.5px] leading-snug text-fg-3">{caption}</p>}
            </>
          ) : isProcessing ? (
            <MeasuringSteps message={processingMessage} hasLabels={hasLabels} calibrated={!!calibrated} />
          ) : (
            <>
              <span className="block text-[2.5rem] leading-none font-semibold text-fg-dim" aria-hidden="true">—</span>
              <p className={`mt-3 text-[14px] leading-snug ${ocrFailed && !calibrated ? 'text-warn font-medium' : 'text-fg-2'}`}>
                {areaMessage}
              </p>
              {!calibrated && (
                <button type="button" onClick={() => reveal('scale')} className="mt-3 btn btn-secondary w-full">
                  Set the scale
                </button>
              )}
            </>
          )}

          {measured && showBreakdown && (
            <table className="w-full border-collapse mt-4 text-[14px]">
              <tbody>
                {breakdownRows.map((t) => (
                  <tr key={t.id}>
                    <td className="py-1.5 border-t border-line-soft text-fg-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm mr-2 align-middle"
                            style={{ backgroundColor: t.color }} />
                      {t.label}
                    </td>
                    <td className="py-1.5 border-t border-line-soft text-right tabular-nums text-fg">
                      {formatAreaValue(areaDisplayValue(areas.byType[t.id], unit), unit).value}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-1.5 border-t border-line font-semibold text-fg">Total</td>
                  <td className="pt-1.5 border-t border-line text-right tabular-nums font-semibold text-fg">
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
                  <span className="text-[13px] text-fg-3">
                    {propertyLevels} {propertyLevels === 1 ? 'level' : 'levels'} across{' '}
                    {property.plans.length} plans
                  </span>
                )}
              </div>

              <div className="mt-1.5 flex items-baseline gap-2">
                <span className="font-semibold tabular-nums text-fg leading-none tracking-tight text-[1.875rem]">
                  {property.gla > 0 ? propertyGla.value : propertyTotal.value}
                </span>
                <span className="text-[15px] text-fg-3 font-medium">{areaSuffix}</span>
                <span className="text-[13px] text-fg-3">
                  {property.gla > 0 ? 'gross living area' : 'total, no living-area outline'}
                </span>
              </div>

              <table className="w-full border-collapse mt-3 text-[14px]">
                <tbody>
                  {property.plans.map((plan) => (
                    <tr key={plan.docId}>
                      {/* A file name is one unbreakable word; without
                          `anywhere` its min-content width stretches the
                          table past the panel and it scrolls sideways. */}
                      <td className="py-1.5 border-t border-line-soft text-fg-2 [overflow-wrap:anywhere]">
                        {plan.label}
                        {plan.isActive && (
                          <span className="ml-1.5 text-[12.5px] text-fg-dim">this plan</span>
                        )}
                        {/* A plan the workspace has not read back cannot be
                            re-measured; its figure is the one it last
                            reported. Said rather than hidden. */}
                        {plan.fromDisk && (
                          <span className="ml-1.5 text-[12.5px] text-fg-dim">from the last save</span>
                        )}
                      </td>
                      <td className="py-1.5 pl-2 border-t border-line-soft text-right tabular-nums text-fg whitespace-nowrap">
                        {formatAreaValue(areaDisplayValue(plan.total, unit), unit).value}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 border-t border-line font-semibold text-fg">Property total</td>
                    <td className="pt-1.5 border-t border-line text-right tabular-nums font-semibold text-fg">
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

        {/* While FloorTrace is still measuring the plan by itself there is
            nothing to fold: the outline is on its way and the scale is being
            worked out, and "Not set yet" over a button to set it by hand would
            be the app interrupting its own answer. */}
        {!measuringByItself && (
        <div className="border-t border-line-soft">
          {/* ── Outline ── */}
          <PanelSection
            id="panel-outline"
            title={perimeterTraces.length > 1 ? 'Outlines' : 'Outline'}
            summary={outlineSummary}
            badge={outlineNeedsLook ? <CheckChip /> : null}
            open={isOpen('outline')}
            onToggle={() => toggle('outline')}
          >
            {traced.length === 0 ? (
              <>
                <p className="text-[14px] leading-snug text-fg-2">
                  {traceFailed
                    ? 'FloorTrace couldn’t find the outline on this plan.'
                    : 'No outline yet.'}
                </p>
                {/* Why, when the trace said. With no outline there is no
                    picture to read it from, so this is the one time the
                    detector's reason is put into words. */}
                {traceFailed && lastTraceOutcome?.reason && (
                  <p className="mt-2 text-[13.5px] leading-snug text-fg-3">
                    {asSentence(lastTraceOutcome.reason)}
                  </p>
                )}
                {/* One filled button on the panel at a time. With no scale
                    either, that one is the scale's: it is what the figure
                    above is asking for. */}
                {onFindOutline && (
                  <div className="mt-3">
                    <ChoiceButton icon={ScanSearch} primary={!!calibrated} onClick={onFindOutline}
                                  disabled={isProcessing}>
                      {traceFailed ? 'Try again' : 'Find the outline'}
                    </ChoiceButton>
                  </div>
                )}
              </>
            ) : (
              <>
                {overlapNotes.map((issue, i) => (
                  <CheckNote key={`overlap-${i}`} issue={issue} className="mb-3.5" />
                ))}
                <div className="-mx-5 border-y border-line-soft">
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
                        className={`px-5 py-3 border-t border-line-soft first:border-t-0 cursor-pointer transition-colors
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
                              text-[14.5px] font-medium hover:border-line
                              focus:outline-none focus:ring-0 focus:border-accent
                              select-none focus:select-text
                              ${isActive ? 'text-fg' : 'text-fg-2'} ${trace.visible ? '' : 'opacity-45'}`}
                          />
                          <span className={`tabular-nums text-[14px] text-fg-2 whitespace-nowrap
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
                            className="icon-btn w-8 h-8"
                          >
                            {trace.visible
                              ? <Eye className="w-4 h-4" aria-hidden="true" />
                              : <EyeOff className="w-4 h-4" aria-hidden="true" />}
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
                            className="icon-btn w-8 h-8 hover:bg-crit/12 hover:text-crit"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>

                        {/* What this outline *is*. How well it follows the walls
                            is on the plan, to be looked at, and is not said
                            here. */}
                        <div className="flex items-center gap-2 mt-2 pl-5 text-[13.5px] text-fg-3">
                          <label htmlFor={`type-${trace.id}`}>Counts as</label>
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
                            className="h-8 px-2 rounded-md border border-line bg-panel-2
                                       text-[13.5px] text-fg-2 cursor-pointer hover:border-accent/50
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
                          <p className="mt-1.5 pl-5 text-[13px] leading-snug text-fg-3">
                            Set from “{trace.typeEvidence.text.trim()}” on the plan.
                          </p>
                        )}

                        {staleByTrace.has(trace.id) && (
                          <p className="mt-2 pl-5 text-[13.5px] leading-snug text-warn">
                            <span className="font-semibold">{staleByTrace.get(trace.id).label}.</span>
                            {' '}{staleByTrace.get(trace.id).detail}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* One setting for every outline, not just the selected one —
                    two outlines measured to different wall faces is an area
                    nobody can reconcile. */}
                {measured && canSwitchWallFace && (
                  <div className="mt-4 pt-4 border-t border-line-soft">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[14px] text-fg-2">Measure to the</span>
                      <div className="seg" role="group" aria-label="Measure every outline to">
                        <button
                          type="button"
                          onClick={() => onInteriorWallToggle(false)}
                          aria-pressed={!useInteriorWalls}
                          className="seg-option"
                        >
                          Outside of walls
                        </button>
                        <button
                          type="button"
                          onClick={() => onInteriorWallToggle(true)}
                          aria-pressed={!!useInteriorWalls}
                          className="seg-option"
                        >
                          Inside
                        </button>
                      </div>
                    </div>
                    <p className="mt-2 text-[13.5px] leading-snug text-fg-3">
                      Living area is normally measured to the outside of the walls.
                    </p>
                  </div>
                )}
              </>
            )}
          </PanelSection>

          {/* ── Scale ──
              The number every area on this panel is derived from, said as
              where it came from rather than as pixels per foot, with the ways
              to change it — and, when the rooms did not agree, that.

              A bad room implies a scale that can be 58-90% out, and area goes
              as scale squared. Unlike a wrong outline, a wrong scale looks
              exactly like a right one, so a doubt about it is the one thing
              this panel says without being asked: the section opens by itself
              and the doubt is its first paragraph. */}
          <PanelSection
            id="panel-scale"
            title="Scale"
            summary={calibrated ? provenance.replace(/\.$/, '') : 'Not set yet'}
            badge={scaleNotes.length > 0 ? <CheckChip /> : null}
            open={isOpen('scale')}
            onToggle={() => toggle('scale')}
          >
            {calibrated ? (
              <>
                <p className="text-[14px] leading-snug text-fg-2">{provenance}</p>
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
              <p className="text-[14px] leading-snug text-fg-3">{provenance}</p>
            )}

            {/* The lengths drawn with the tool, and the box to type each one
                into: the second half of setting the scale from a known length,
                so it leads. */}
            <ScaleLines unit={unit} />

            {/* While a length is being drawn the section is that and
                nothing else: the other ways to set the scale, and the two
                fields that belong to one of them, stand down until it is done. */}
            {!scaleToolActive && (
            <>
            {/* The room the scale came from leads, and the ways to change it
                follow. */}
            {roomFields}

            <div className="mt-3.5 flex flex-col gap-2">
              {/* Room sizes first, then the known length: picking a room
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
                    Set scale using known length
                  </ChoiceButton>
                  {!calibrated && (
                    <p className="text-[13.5px] leading-snug text-fg-3">
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

            {onRescan && (
              <button type="button" onClick={onRescan} disabled={isProcessing} className="link-btn mt-3">
                <ScanText className="w-4 h-4" aria-hidden="true" />
                Read the room sizes again
              </button>
            )}
            </>
            )}
          </PanelSection>

          {/* ── How the area was calculated ── only for a measured area. With
              no scale its figures would be the one-foot-per-pixel fallback —
              the pixel count the figure above refuses to print. */}
          {measured && <WorkSection unit={unit} />}
        </div>
        )}
      </div>

      {/* The end of the job, pinned to the foot of the panel so it is in reach
          however far the sections above have been scrolled. */}
      {!mobile && saveBlock && (
        <div className="shrink-0 px-5 py-4 border-t border-line bg-panel-2">
          {saveBlock}
        </div>
      )}
    </aside>
  );
};

export default ResultsPanel;
