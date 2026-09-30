import { useState, useEffect, useRef } from 'react';
import {
  Plus, Eye, EyeOff, Trash2, Copy, Share, AlertTriangle, ChevronDown, ChevronRight,
  Loader2, Brush, Waypoints, ScanSearch, Shuffle, Ruler, MousePointerClick, RotateCcw, ScanText,
} from 'lucide-react';
import useAppStore, { selectActiveAreaByType, selectWorkspaceArea } from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import {
  formatDimensionInput, formatArea, metersToFeet,
  areaDisplayValue, formatAreaValue,
} from '../utils/unitConverter';
import { calculateArea, displayedBreakdownTotal } from '../utils/areaCalculator';
import { scaleQualitySummary } from '../utils/boundaryQuality';
import { scaleProvenance } from '../utils/scaleProvenance';
import { summariseIssues } from '../utils/traceIssues';
import { DEFAULT_TRACE_TYPE, TRACE_TYPES, normalizeTraceType } from '../utils/traceTypes';
import { MAX_TRACES } from '../utils/planStage';
import Card from './DockCard';
import InchesInput from './InchesInput';
import ScaleSection from './ScaleSection';
import ChecksCard from './ChecksCard';
import WorkCard from './WorkCard';

/**
 * The measurement panel: the answer first, then how far to trust it, then the
 * two things it is made of — the outline and the scale — each with its own way
 * to fix it.
 *
 *   Area  →  Things to check  →  Outline  →  Scale
 *
 * ## What changed, and why
 *
 * It opened with a four-stage progress strip (PLAN · SCALE · OUTLINE · REPORT)
 * and then a "Room size" card, so the first large numbers a user met were the
 * width and height of whichever room the scale happened to come from — a
 * laundry room's 6' 5" × 5' 4" above the house's square footage. The strip
 * narrated a pipeline that finishes on its own in a few seconds; the room size
 * is the scale's evidence, not a measurement anyone came for. The strip is gone
 * and the room size lives in the Scale card, as "the room outlined in green".
 *
 * The outline's corrections used to hang off a caret in the top bar and the
 * scale's off another. They are on these cards now, beside the result they
 * correct, and the outline's open by themselves when there is something to
 * check.
 *
 * ## No number without a scale
 *
 * With no scale the app falls back to one foot per pixel and every area comes
 * out as a pixel count — six figures of "ft²" under "Gross Living Area". The
 * headline refuses to print that. It says what is missing and where to supply
 * it, the same way the exhibit prints "—" for an outline with no scale.
 */

const SectionLabel = ({ children }) => (
  <p className="text-[13px] font-semibold text-fg-2">{children}</p>
);

// A quiet full-width choice, for the lists of ways to fix something.
const FixButton = ({ icon: Icon, children, onClick, primary = false, title, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    title={title}
    disabled={disabled}
    className={`btn w-full justify-start ${primary ? 'btn-primary' : 'btn-secondary'}`}
  >
    {Icon && <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />}
    <span className="truncate">{children}</span>
  </button>
);

// A small text-link button, for the secondary way out of a card.
const LinkButton = ({ children, onClick, icon: Icon, disabled = false }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-strong
               hover:underline cursor-pointer
               disabled:opacity-40 disabled:cursor-default disabled:hover:no-underline"
  >
    {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
    {children}
  </button>
);

/**
 * The size of the room the scale is taken from, typed or corrected by hand.
 * The two fields and their edit bookkeeping are one piece: decimal and metric
 * are edited as text and committed on blur, feet-inches through its own field.
 */
const RoomSizeFields = ({ roomDimensions, unit, onDimensionsChange, onDimensionFocus, onDimensionBlur }) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });
  const [editingField, setEditingField] = useState(null);
  const [originalValues, setOriginalValues] = useState({ width: '', height: '' });

  useEffect(() => {
    setLocalDimensions(roomDimensions);
    if (!editingField) {
      const fw = formatDimensionInput(roomDimensions.width, unit);
      const fh = formatDimensionInput(roomDimensions.height, unit);
      const suffix = unit === 'metric' ? ' m' : unit === 'decimal' ? ' ft' : '';
      setDisplayValues({
        width: (unit === 'decimal' || unit === 'metric') && fw ? `${fw}${suffix}` : fw,
        height: (unit === 'decimal' || unit === 'metric') && fh ? `${fh}${suffix}` : fh,
      });
    }
  }, [roomDimensions, unit, editingField]);

  const handleChange = (field, value) => {
    if (unit === 'decimal' || unit === 'metric') {
      if (/^[\d.]*$/.test(value)) {
        setDisplayValues((p) => ({ ...p, [field]: value }));
      }
    } else {
      const next = { ...localDimensions, [field]: value };
      setLocalDimensions(next);
      onDimensionsChange?.(next);
    }
  };

  const handleFocus = (field) => {
    onDimensionFocus?.();
    setEditingField(field);
    if (unit === 'decimal' || unit === 'metric') {
      setOriginalValues((p) => ({ ...p, [field]: displayValues[field] }));
      setDisplayValues((p) => ({ ...p, [field]: '' }));
    }
  };

  const handleBlur = (field) => {
    onDimensionBlur?.();
    if (unit === 'decimal' || unit === 'metric') {
      const value = displayValues[field].trim();
      if (!value) {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
        setEditingField(null);
        return;
      }
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        // Metres are converted to feet for storage; feet are kept to a tenth.
        const storedValue = unit === 'metric'
          ? metersToFeet(Math.round(num * 100) / 100)
          : Math.round(num * 10) / 10;
        const next = { ...localDimensions, [field]: storedValue.toString() };
        setLocalDimensions(next);
        onDimensionsChange?.(next);
        const formatted = formatDimensionInput(storedValue, unit);
        const suffix = unit === 'metric' ? ' m' : ' ft';
        setDisplayValues((p) => ({ ...p, [field]: `${formatted}${suffix}` }));
      } else {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
      }
    }
    setEditingField(null);
  };

  // "Length", not "Height": to anyone who measures houses, a room's height is
  // its ceiling.
  const FIELDS = [['width', 'Width'], ['height', 'Length']];

  return (
    <div className="grid grid-cols-2 gap-2">
      {FIELDS.map(([field, label]) => (
        <div key={field}>
          <label htmlFor={`dim-${field}`} className="block text-[12.5px] text-fg-3 mb-1">
            {label}
          </label>
          {unit === 'inches' ? (
            <InchesInput
              id={`dim-${field}`}
              large
              value={localDimensions[field]}
              onChange={(v) => handleChange(field, v)}
              onFocus={() => handleFocus(field)}
              onBlur={() => handleBlur(field)}
            />
          ) : (
            <input
              id={`dim-${field}`}
              type="text"
              value={displayValues[field]}
              onChange={(e) => handleChange(field, e.target.value)}
              onFocus={() => handleFocus(field)}
              onBlur={() => handleBlur(field)}
              className="panel-input panel-input-lg select-text"
              placeholder={unit === 'metric' ? '0.00 m' : '0.0 ft'}
            />
          )}
        </div>
      ))}
    </div>
  );
};

const UNIT_PILLS = [
  ['decimal', 'ft', 'Decimal feet'],
  ['inches', 'ft & in', 'Feet and inches'],
  ['metric', 'm', 'Meters'],
];

const MeasurementDock = ({
  roomDimensions,
  onDimensionsChange,
  area,
  unit,
  onUnitChange,
  isProcessing,
  ocrFailed,
  useInteriorWalls,
  onInteriorWallToggle,
  canSwitchWallFace,
  onDimensionFocus,
  onDimensionBlur,
  onScaleTool,
  onSelectRoom,
  onRestoreAutoScale,
  onExport,
  // The outline's and the scale's corrections. Optional: the phone shell does
  // not pass them, and a card with no handler simply does not offer the action.
  onFindOutline,
  onPaintOutline,
  onPlaceCorners,
  onUseAlternative,
  alternativeCount = 0,
  onRescan,
  // Rendered inside the mobile bottom sheet rather than docked beside the
  // canvas. Everything below this line — the area maths, the breakdown, the
  // outline list, the detector's warnings and their canvas anchors — is the
  // same code on both, which is the point: a second mobile-only measurement
  // panel is a second place for the numbers to disagree.
  mobile = false,
}) => {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const addPerimeterTrace = useAppStore((s) => s.addPerimeterTrace);
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
  // An outline being drawn by hand right now. The card then says how to
  // finish it instead of offering three other ways to start.
  const painting = useAppStore((s) => s.drawModeActive);
  const placingCorners = useAppStore((s) => s.perimeterVertices !== null);
  // The rooms the detector confirmed — whether there are any is what decides
  // if "go back to the measured scale" has anything to go back to.
  const rooms = useAppStore((s) => s.rooms);
  const showWork = useWorkspaceStore((s) => s.showWork);
  const setShowWork = useWorkspaceStore((s) => s.setShowWork);
  const flashStatus = useWorkspaceStore((s) => s.flashStatus);
  // A scale this plan measured while parked was held back — a reason to doubt
  // the area like any other, so it counts with the rest.
  const needsRescale = useAppStore((s) => Boolean(s.documents?.[s.activeDocumentId]?.needsRescale));

  const scrollRef = useRef(null);
  const [fixOpen, setFixOpen] = useState(null);

  // ── the area ──
  // The headline is GLA, per the ANSI Z765 shape. With no GLA trace at all it
  // would read 0 and the app would look broken, so the grand total stands in.
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
  // The property, when there is one. A two-storey house is two plans, and the
  // sum used to be made on a calculator and typed into the report by hand.
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

  const areaCaption = noGla
    ? 'Total area — no outline counts as living area'
    : `Gross living area${glaCount > 1 ? ` · ${glaCount} levels` : ''}`
      + (useInteriorWalls && !canSwitchWallFace ? ' · to inside of walls' : '');

  // Whether this area can be trusted is counted once, here and on the Checks
  // card below, from the same summary the exhibit prints.
  const scaleNote = scaleQualitySummary(scaleQuality);
  const issues = summariseIssues(perimeterTraces, scaleNote, areas.doubleCounted, lastTraceOutcome, needsRescale);

  const traced = perimeterTraces.filter((t) => t.vertices?.length >= 3);
  const traceFailed = lastTraceOutcome?.level === 'failed' || lastTraceOutcome?.level === 'poor';

  // What the headline says in place of a number, and why.
  const areaMessage = (() => {
    if (measured || isProcessing) return null;
    if (!calibrated) {
      if (ocrFailed) {
        return 'FloorTrace couldn’t read any room sizes on this plan, so it can’t work out '
          + 'the scale yet. Set it in the Scale section below.';
      }
      return area > 0 ? 'Set the scale to see the area.' : 'No area yet.';
    }
    if (traced.length > 0) return 'Every outline is hidden. Show one in the Outline section to see the area.';
    return traceFailed
      ? 'FloorTrace couldn’t find the outline on its own. Draw it in the Outline section below.'
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

  const jumpTo = (target) => {
    const el = scrollRef.current?.querySelector(`#dock-${target}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  // ── the scale ──
  const provenance = calibrated
    ? scaleProvenance({ calibration: { calibrated, source: calibrationSource, quality: scaleQuality } })
    : 'Not set yet.';
  // The room the scale is measured against, as a box on the plan. Not while a
  // drawn line is the scale: the box would then be evidence for nothing.
  const showRoomFields = !!roomOverlay && calibrationSource !== 'line-calibration';
  const canRestore = !!onRestoreAutoScale && !!calibrationSource
    && calibrationSource !== 'room-calibration' && rooms?.length > 0;

  // Whether this shell offers any way to draw an outline by hand. The phone
  // passes none, and the empty card must not end on a colon over nothing.
  const canDraw = !!(onPaintOutline || onPlaceCorners);

  // ── the outline's fixes ──
  // Open by themselves when there is something to check; closed by hand, they
  // stay closed.
  const fixesOpen = fixOpen ?? issues.count > 0;
  const canAddOutline = traced.length > 0 && perimeterTraces.length < MAX_TRACES;

  return (
    <aside
      className={mobile
        ? 'flex w-full flex-col bg-panel select-none'
        : 'flex w-[340px] shrink-0 flex-col min-h-0 bg-panel border-r border-line select-none'}
      aria-label="Measurements"
    >
      {/* The sheet supplies the "Measurement" title on mobile, so repeating it
          here would give the panel two headings. */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-line-soft shrink-0">
        <h2 className={mobile ? 'text-[13px] text-fg-3 flex-1' : 'text-[15px] font-semibold text-fg flex-1'}>
          {mobile ? 'Units' : 'Measurements'}
        </h2>
        <div className="flex p-0.5 gap-0.5 bg-sunken border border-line rounded-md" role="group" aria-label="Units">
          {UNIT_PILLS.map(([id, label, title]) => (
            <button
              key={id}
              onClick={() => onUnitChange(id)}
              aria-pressed={unit === id}
              title={title}
              className={`unit-pill ${unit === id ? 'unit-pill-active' : 'unit-pill-inactive'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* One scroll container, not two: on mobile the sheet already scrolls,
          and nesting a second one means a flick either moves the wrong thing
          or nothing at all depending on where the finger landed. */}
      <div
        ref={scrollRef}
        className={mobile
          ? 'p-3 pb-6 flex flex-col gap-3'
          : 'flex-1 min-h-0 overflow-y-auto overflow-x-hidden p-3 flex flex-col gap-3'}
      >
        {/* ── Area ── */}
        <div id="dock-report">
          <Card
            title="Area"
            action={measured && (
              <button
                type="button"
                onClick={handleCopyArea}
                title={showBreakdown ? 'Copy the breakdown as text' : 'Copy the area as text'}
                className="btn btn-quiet h-7 px-2 text-[13px]"
              >
                <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                Copy
              </button>
            )}
          >
            {measured ? (
              <div className="flex items-baseline gap-2">
                <span className="font-semibold tabular-nums text-fg leading-none tracking-tight"
                      style={{ fontSize: areaText.length <= 7 ? '2.5rem' : areaText.length <= 9 ? '2rem' : '1.5rem' }}>
                  {areaText}
                </span>
                <span className="text-[17px] text-fg-3 font-medium">{areaSuffix}</span>
              </div>
            ) : isProcessing ? (
              <div className="flex items-center gap-2.5 py-1.5 text-[14px] font-medium text-accent-strong">
                <Loader2 className="w-5 h-5 animate-spin shrink-0" aria-hidden="true" />
                <span>{processingMessage || 'Measuring…'}</span>
              </div>
            ) : (
              <>
                <span className="block text-[2rem] leading-none font-semibold text-fg-dim" aria-hidden="true">—</span>
                <p className={`mt-2 text-[13.5px] leading-snug ${ocrFailed && !calibrated ? 'text-warn font-medium' : 'text-fg-2'}`}>
                  {areaMessage}
                </p>
                {!calibrated && (
                  <button
                    type="button"
                    onClick={() => jumpTo('scale')}
                    className="mt-2.5 btn btn-secondary w-full"
                  >
                    Set the scale
                  </button>
                )}
              </>
            )}

            {measured && <p className="mt-1.5 text-[13px] text-fg-3">{areaCaption}</p>}

            {/* One setting for every outline, not just the selected one — two
                outlines measured to different wall faces is an area nobody can
                reconcile. */}
            {measured && canSwitchWallFace && (
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-[13px] text-fg-2">Measure to</span>
                <div className="flex p-0.5 gap-0.5 bg-sunken border border-line rounded-md"
                     role="group" aria-label="Measure every outline to">
                  <button
                    onClick={() => onInteriorWallToggle(false)}
                    title="Measure every outline to the outside face of the walls (the ANSI standard)"
                    aria-pressed={!useInteriorWalls}
                    className={`unit-pill ${!useInteriorWalls ? 'unit-pill-active' : 'unit-pill-inactive'}`}
                  >
                    Outside walls
                  </button>
                  <button
                    onClick={() => onInteriorWallToggle(true)}
                    title="Measure every outline to the inside face of the walls"
                    aria-pressed={useInteriorWalls}
                    className={`unit-pill ${useInteriorWalls ? 'unit-pill-active' : 'unit-pill-inactive'}`}
                  >
                    Inside walls
                  </button>
                </div>
              </div>
            )}

            {measured && showBreakdown && (
              <table className="w-full border-collapse mt-3 text-[13.5px]">
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

            {/* The property, above the export button because it is the figure
                that goes in the report. Only when there is more than one plan
                contributing: on a single-plan job it would just restate the
                number directly above it. */}
            {measured && property.isMultiPlan && (
              <div className="mt-4 pt-3 border-t border-line">
                <div className="flex items-baseline justify-between gap-2">
                  <SectionLabel>Whole property</SectionLabel>
                  {propertyLevels > 0 && (
                    <span className="text-[12.5px] text-fg-3">
                      {propertyLevels} {propertyLevels === 1 ? 'level' : 'levels'} across{' '}
                      {property.plans.length} plans
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-semibold tabular-nums text-fg leading-none tracking-tight text-[1.75rem]">
                    {property.gla > 0 ? propertyGla.value : propertyTotal.value}
                  </span>
                  <span className="text-[14px] text-fg-3 font-medium">{areaSuffix}</span>
                  <span className="text-[12.5px] text-fg-3">
                    {property.gla > 0 ? 'gross living area' : 'total, no living-area outline'}
                  </span>
                </div>

                <table className="w-full border-collapse mt-2.5 text-[13.5px]">
                  <tbody>
                    {property.plans.map((plan) => (
                      <tr key={plan.docId}>
                        {/* A file name is one unbreakable word; without
                            `anywhere` its min-content width stretches the
                            table past the panel and the dock scrolls sideways. */}
                        <td className="py-1.5 border-t border-line-soft text-fg-2 [overflow-wrap:anywhere]">
                          {plan.label}
                          {plan.isActive && (
                            <span className="ml-1.5 text-[12px] text-fg-dim">this plan</span>
                          )}
                          {/* A plan the workspace has not read back cannot be
                              re-measured; its figure is the one it last
                              reported. Said rather than hidden. */}
                          {plan.fromDisk && (
                            <span className="ml-1.5 text-[12px] text-fg-dim">from the last save</span>
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

            {/* What must not move is the *fact* that there is something to
                check: an area offered clean while the detector doubts it is the
                failure this app is most prone to, so the count sits on the
                figure, just above the button that takes it away. */}
            {measured && issues.count > 0 && (
              <button
                type="button"
                onClick={() => jumpTo('checks')}
                className={`mt-3 flex w-full items-start gap-2 text-left text-[13.5px] font-medium
                            leading-snug cursor-pointer hover:underline
                            ${issues.level === 'error' ? 'text-crit' : 'text-warn'}`}
              >
                <AlertTriangle className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />
                <span>
                  {issues.count} {issues.count === 1 ? 'thing' : 'things'} to check before you
                  use this area
                </span>
              </button>
            )}

            {/* Filled only when nothing is left to check. Export is the end of
                the job, and a filled button under a doubtful number is the
                doubt looking settled. */}
            {area > 0 && (
              <button
                type="button"
                onClick={onExport}
                className={`btn w-full mt-3 ${measured && issues.count === 0 ? 'btn-primary' : 'btn-secondary'}`}
              >
                <Share className="w-4 h-4" aria-hidden="true" />
                Export image…
              </button>
            )}

            {/* An appraisal report has to show its working for the area
                sketch, and the way into it belongs under the figure it
                explains rather than in a menu. Off until asked for. */}
            {measured && (
              <button
                type="button"
                onClick={() => setShowWork(!showWork)}
                aria-expanded={showWork}
                aria-controls="dock-work"
                className="mt-2 w-full inline-flex items-center justify-center gap-1 h-8
                           text-[13px] text-fg-3 font-medium hover:text-fg
                           transition-colors cursor-pointer"
              >
                {showWork ? <ChevronDown className="w-4 h-4" aria-hidden="true" />
                  : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                {showWork ? 'Hide how the area was calculated' : 'Show how the area was calculated'}
              </button>
            )}
          </Card>
        </div>

        {/* ── How this area was calculated ── directly under the figure it
            explains. Renders nothing while the preference is off. */}
        {/* Only for a measured area. With no scale its figures would be the
            one-foot-per-pixel fallback — the pixel count the headline above
            refuses to print. */}
        {measured && <WorkCard unit={unit} />}

        {/* ── Things to check ── every verdict on the plan, in one place,
            directly under the number it qualifies. */}
        <ChecksCard />

        {/* ── Outline ── */}
        <div id="dock-outline">
          <Card title={perimeterTraces.length > 1 ? 'Outlines' : 'Outline'}>
            {traced.length === 0 ? (
              isProcessing ? (
                <p className="flex items-center gap-2 text-[13.5px] text-fg-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                  Working on it…
                </p>
              ) : painting || placingCorners ? (
                <p className="text-[13.5px] leading-snug text-fg-2">
                  {painting
                    ? 'Paint roughly over the outside walls on the plan, then click “Draw the outline” above the plan.'
                    : 'Click each outside corner on the plan. Click the first corner again to finish.'}
                </p>
              ) : (
                <>
                  <p className="text-[13.5px] leading-snug text-fg-2">
                    {traceFailed
                      ? `FloorTrace couldn’t find the outline on its own.${canDraw ? ' Draw it yourself — it only takes a minute:' : ''}`
                      : `No outline yet.${canDraw ? ' Let FloorTrace find it, or draw it yourself:' : ''}`}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    {!traceFailed && onFindOutline && (
                      <FixButton icon={ScanSearch} primary onClick={onFindOutline}>
                        Find the outline automatically
                      </FixButton>
                    )}
                    {onPaintOutline && (
                      <FixButton icon={Brush} primary={traceFailed} onClick={onPaintOutline}
                                 title="Paint roughly over the outside walls and FloorTrace draws the outline">
                        Paint over the outside walls
                      </FixButton>
                    )}
                    {onPlaceCorners && (
                      <FixButton icon={Waypoints} onClick={onPlaceCorners}
                                 title="Click each outside corner in turn">
                        Click the corners
                      </FixButton>
                    )}
                  </div>
                  {traceFailed && onFindOutline && (
                    <div className="mt-2.5">
                      <LinkButton onClick={onFindOutline}>Try the automatic outline again</LinkButton>
                    </div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="-mx-3 -mt-3">
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
                        className={`px-3 py-2.5 border-b border-line-soft cursor-pointer transition-colors
                          ${isActive && perimeterTraces.length > 1
                            ? 'bg-accent/10 shadow-[inset_-3px_0_0_rgb(var(--accent))]'
                            : 'hover:bg-sunken'}`}
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
                              text-[14px] font-medium hover:border-line
                              focus:outline-none focus:ring-0 focus:border-accent
                              select-none focus:select-text
                              ${isActive ? 'text-fg' : 'text-fg-2'} ${trace.visible ? '' : 'opacity-45'}`}
                          />
                          <span className={`tabular-nums text-[13.5px] text-fg-2 whitespace-nowrap
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
                            className="grid place-items-center w-7 h-7 rounded shrink-0
                                       text-fg-3 hover:bg-sunken hover:text-fg transition-colors cursor-pointer"
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
                            className="grid place-items-center w-7 h-7 rounded shrink-0
                                       text-fg-3 hover:bg-crit/12 hover:text-crit transition-colors cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </div>

                        {/* What this outline *is*. How good it is — and the
                            detector's reasons — is read on the Checks card, so
                            this stays a list of outlines rather than of verdicts. */}
                        <div className="flex items-center gap-2 mt-2 pl-5 text-[13px] text-fg-3">
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
                            className="h-7 px-1.5 rounded border border-line bg-panel-2
                                       text-[13px] text-fg-2 cursor-pointer hover:border-accent/50
                                       focus:outline-none focus:ring-2 focus:ring-accent"
                          >
                            {TRACE_TYPES.map((t) => (
                              <option key={t.id} value={t.id}>{t.label}</option>
                            ))}
                          </select>
                        </div>

                        {!drawn && (
                          <p className="mt-1.5 pl-5 text-[12.5px] text-fg-3">
                            Not drawn yet — click its corners on the plan, or choose Paint in the tools.
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>

                {canAddOutline && (
                  <div className="mt-2.5" title="For a garage, a porch or another level. Click its corners, then set what it counts as.">
                    <LinkButton icon={Plus} onClick={addPerimeterTrace}>
                      Add another outline
                    </LinkButton>
                  </div>
                )}

                {(onPaintOutline || onPlaceCorners || onFindOutline) && (
                  <div className="mt-3 pt-2.5 border-t border-line-soft">
                    <button
                      type="button"
                      onClick={() => setFixOpen(!fixesOpen)}
                      aria-expanded={fixesOpen}
                      className="flex w-full items-center gap-1 text-[13.5px] font-medium text-fg-2
                                 hover:text-fg cursor-pointer"
                    >
                      {fixesOpen ? <ChevronDown className="w-4 h-4" aria-hidden="true" />
                        : <ChevronRight className="w-4 h-4" aria-hidden="true" />}
                      Outline not right?
                    </button>
                    {fixesOpen && (
                      <div className="mt-2.5">
                        <p className="text-[13px] leading-snug text-fg-3">
                          Drag any corner on the plan to move it, or right-click a corner to
                          delete it. To redo the whole outline:
                        </p>
                        <div className="mt-2.5 flex flex-col gap-2">
                          {alternativeCount > 0 && onUseAlternative && (
                            <FixButton icon={Shuffle} onClick={onUseAlternative} disabled={isProcessing || painting}
                                       title="FloorTrace found more than one possible outline; this swaps in the next one">
                              {alternativeCount > 1
                                ? `Try another outline FloorTrace found (${alternativeCount})`
                                : 'Try another outline FloorTrace found'}
                            </FixButton>
                          )}
                          {onPaintOutline && (
                            <FixButton icon={Brush} onClick={onPaintOutline}
                                       title="Paint roughly over the outside walls and FloorTrace draws the outline">
                              Paint over the outside walls
                            </FixButton>
                          )}
                          {onPlaceCorners && (
                            <FixButton icon={Waypoints} onClick={onPlaceCorners}
                                       title="Click each outside corner in turn">
                              Click the corners
                            </FixButton>
                          )}
                          {onFindOutline && (
                            <FixButton icon={ScanSearch} onClick={onFindOutline} disabled={isProcessing || painting}
                                       title="Useful after erasing notes or cropping the plan">
                              Find the outline again
                            </FixButton>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </Card>
        </div>

        {/* ── Scale ──
            The number every area on this panel is derived from, said as where
            it came from rather than as pixels per foot, with the ways to
            change it. Whether the rooms *agreed* is a verdict, and reads on
            the Checks card with the rest of them.

            A bad room implies a scale that can be 58-90% out, and area goes as
            scale squared — so this is the most consequential correction the
            app has, and it belongs where the scale is read. */}
        <div id="dock-scale">
          <Card title="Scale">
            <p className={`text-[13.5px] leading-snug ${calibrated ? 'text-fg-2' : 'text-fg-3'}`}>
              {provenance}
            </p>

            {ocrFailed && !calibrated && !isProcessing && (
              <p className="mt-2.5 px-3 py-2.5 bg-warn/10 border border-warn/30 rounded-md
                            text-[13px] leading-snug text-warn font-medium">
                FloorTrace couldn’t read any room sizes on this plan. Drag the green box on
                the plan over a room you know the size of, then type its size below — or
                measure a length you know.
              </p>
            )}

            {showRoomFields && (
              <div className="mt-3">
                <p className="mb-2 text-[13px] leading-snug text-fg-3">
                  {ocrFailed && !calibrated
                    ? 'Size of the room in the green box:'
                    : 'Room used for the scale (the green box on the plan). Correct its size if it was misread:'}
                </p>
                <RoomSizeFields
                  roomDimensions={roomDimensions}
                  unit={unit}
                  onDimensionsChange={onDimensionsChange}
                  onDimensionFocus={onDimensionFocus}
                  onDimensionBlur={onDimensionBlur}
                />
              </div>
            )}

            <div className="mt-3 flex flex-col gap-2">
              {/* Labels first, then the manual override: picking a different
                  room re-uses what the scan already read, which is cheaper and
                  usually right. */}
              {detectedDimensions.length > 0 && (
                <FixButton icon={MousePointerClick} onClick={onSelectRoom} disabled={isProcessing}
                           title="Show the room sizes FloorTrace read, and click the one to trust">
                  {calibrated ? 'Use a different room' : 'Pick a room to scale from'}
                </FixButton>
              )}
              <FixButton icon={Ruler} onClick={onScaleTool}
                         title="Click both ends of something whose length you know, then type the length">
                Measure a length you know
              </FixButton>
              {/* The way back, which two of the scale messages promise by name:
                  `applyDecision` refuses to write over a user-asserted scale
                  forever, so without it a hand-set scale is permanent. */}
              {canRestore && (
                <FixButton icon={RotateCcw} onClick={onRestoreAutoScale}>
                  Go back to the automatic scale
                </FixButton>
              )}
            </div>

            {onRescan && (
              <div className="mt-2.5">
                <LinkButton icon={ScanText} onClick={onRescan} disabled={isProcessing}>
                  Read the room sizes again
                </LinkButton>
              </div>
            )}

            <ScaleSection unit={unit} />
          </Card>
        </div>
      </div>
    </aside>
  );
};

export default MeasurementDock;
