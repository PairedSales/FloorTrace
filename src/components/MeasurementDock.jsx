import { useState, useEffect, useRef } from 'react';
import { Plus, Eye, EyeOff, Trash2, ChevronRight, ChevronDown, Crosshair, Copy, Share, AlertTriangle } from 'lucide-react';
import useAppStore, { selectActiveAreaByType, selectWorkspaceArea } from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import {
  formatDimensionInput, formatArea, metersToFeet,
  areaDisplayValue, formatAreaValue,
} from '../utils/unitConverter';
import {
  calculateArea, holeRings, isSubtracted, displayedBreakdownTotal,
} from '../utils/areaCalculator';
import { qualitySummary, scaleQualitySummary, rankedWarnings } from '../utils/boundaryQuality';
import { resolveAnchor } from '../utils/warningAnchors';
import { DEFAULT_TRACE_TYPE, TRACE_TYPES, normalizeTraceType } from '../utils/traceTypes';
import InchesInput from './InchesInput';
import ScaleSection from './ScaleSection';
import StageSpine from './StageSpine';

const SEVERITY_DOT = { error: 'bg-crit', warn: 'bg-warn', info: 'bg-fg-dim' };

/* ── warnings ─────────────────────────────────────────────────────────────
   Full-size prose, not 9px grey. The detector's doubts are the one output
   this app exists to be honest about; the old panel rendered them at 8-9px
   and 1.88-2.99:1, smaller and fainter than anything else on screen. */
const WarningRow = ({ warning, anchor, active, onFocus }) => (
  <div className="grid grid-cols-[auto_1fr_auto] items-start gap-2 py-2 border-t border-line-soft first:border-t-0">
    <span className={`mt-[6px] w-[7px] h-[7px] rounded-full shrink-0 ${SEVERITY_DOT[warning.severity] ?? SEVERITY_DOT.warn}`} />
    <div className="min-w-0">
      <p className="text-[12.5px] font-semibold leading-snug text-fg">{warning.label}</p>
      <p className="text-[12px] leading-snug text-fg-3 mt-0.5">{warning.detail}</p>
    </div>
    {anchor && (
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onFocus(); }}
        aria-pressed={active}
        title={active ? 'Hide on the plan' : 'Show on the plan'}
        className={`inline-flex items-center gap-1 h-[26px] px-2 rounded border text-[12px]
          shrink-0 transition-colors cursor-pointer
          ${active
            ? 'bg-accent text-accent-ink border-accent'
            : 'bg-panel-2 text-fg-3 border-line hover:text-accent hover:border-accent/50'}`}
      >
        <Crosshair className="w-3 h-3" aria-hidden="true" />
        Show
      </button>
    )}
  </div>
);

/**
 * The detector's reasons for doubting one trace, ranked and inspectable. The
 * collapsed line is the first entry of the same ranked list the expansion
 * shows, so the two cannot disagree about which warning is worst. Severity is
 * read from the warning rather than the trace: `label-outside` is deliberately
 * gentler on a hand-drawn outline, and must keep reading as a warning there.
 */
const TraceQuality = ({ trace, quality, expanded, onToggle, anchorCtx, focusedWarning, onFocus }) => {
  const [showNotes, setShowNotes] = useState(false);
  const ranked = rankedWarnings(quality.warnings);
  const notes = ranked.filter((w) => w.severity === 'info');
  const reasons = ranked.filter((w) => w.severity !== 'info');
  const perFloor = reasons.filter((w) => w.scope !== 'result');
  const wholeDrawing = reasons.filter((w) => w.scope === 'result');

  const tone = quality.level === 'good' ? 'text-fg-3'
    : quality.level === 'fair' ? 'text-warn' : 'text-crit';
  const headline = quality.level === 'good'
    ? `${ranked.length} note${ranked.length === 1 ? '' : 's'}`
    : `${quality.percent !== null ? `${quality.percent}% confidence` : 'unverified'}`
      + `${quality.reason ? ` · ${quality.reason}` : ''}`;

  const row = (warning) => (
    <WarningRow
      key={warning.index}
      warning={warning}
      anchor={resolveAnchor(quality.warnings[warning.index], anchorCtx)}
      active={focusedWarning?.traceId === trace.id && focusedWarning?.index === warning.index}
      onFocus={() => onFocus(warning.index)}
    />
  );

  return (
    <div className="mt-1.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
        className={`flex w-full items-start gap-1 text-left text-[12px] leading-snug
                    cursor-pointer hover:opacity-80 ${tone}`}
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />
          : <ChevronRight className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden="true" />}
        <span className="min-w-0">{headline}</span>
      </button>

      {expanded && (
        <div className="mt-1 pl-1">
          {perFloor.map(row)}
          {wholeDrawing.length > 0 && (
            <>
              <p className="pt-2.5 mt-1.5 border-t border-line text-[10.5px] font-bold uppercase tracking-[.07em] text-fg-dim">
                This drawing
              </p>
              {wholeDrawing.map(row)}
            </>
          )}
          {notes.length > 0 && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); setShowNotes((v) => !v); }}
              className="mt-1.5 text-[12px] text-fg-3 hover:text-fg cursor-pointer"
            >
              {showNotes ? '· hide notes' : `· ${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </button>
          )}
          {showNotes && notes.map(row)}
        </div>
      )}
    </div>
  );
};

// `−2 voids (1 yours)`. A subtraction the user asserted by hand reads
// differently from one the detector guessed, so a mixed set says which is which.
// A void the outline moved out from under is counted apart from both: it is no
// longer subtracted, so folding it into the count would overstate the deduction.
const VoidNote = ({ holes }) => {
  const list = holes ?? [];
  const rings = holeRings(list);
  const live = list.filter((h, i) => rings[i]?.length >= 3 && isSubtracted(h));
  const stale = list.filter((h, i) => rings[i]?.length >= 3 && !isSubtracted(h)).length;
  if (!live.length && !stale) return null;
  const mine = live.filter((h) => h?.source === 'user').length;
  const mixed = mine > 0 && mine < live.length;
  return (
    <>
      {live.length > 0 && (
        <span>
          −{live.length} {live.length === 1 ? 'void' : 'voids'}{mixed ? ` (${mine} yours)` : ''}
        </span>
      )}
      {stale > 0 && (
        <span className="text-crit font-semibold" title="Not subtracted — the outline moved out from under it">
          ⚠ {stale} outside
        </span>
      )}
    </>
  );
};

const Card = ({ title, action, children, id }) => (
  <section className="dock-card" id={id}>
    <header className="flex items-center gap-2 px-2.5 py-2 border-b border-line-soft">
      <h3 className="card-heading flex-1">{title}</h3>
      {action}
    </header>
    <div className="p-2.5">{children}</div>
  </section>
);

const MeasurementDock = ({
  roomDimensions,
  onDimensionsChange,
  area,
  mode,
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
  onExport,
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
  const image = useAppStore((s) => s.image);
  const feetPerPixel = useAppStore((s) => s.calibration?.feetPerPixel);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const calibrationSource = useAppStore((s) => s.calibration?.source);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  // Live state the warning anchors are derived from, so a crop or a re-scan
  // cannot leave a highlight pointing at the wrong part of the image.
  const rooms = useAppStore((s) => s.rooms);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const focusedWarning = useAppStore((s) => s.focusedWarning);
  const setFocusedWarning = useAppStore((s) => s.setFocusedWarning);
  const flashStatus = useWorkspaceStore((s) => s.flashStatus);
  const [openQualityTraceId, setOpenQualityTraceId] = useState(null);

  const scrollRef = useRef(null);

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

  const handleDimensionChange = (field, value) => {
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
        let storedValue;
        if (unit === 'metric') {
          // User entered meters — convert to feet for internal storage
          const parsed = Math.round(num * 100) / 100;
          storedValue = metersToFeet(parsed);
        } else {
          storedValue = Math.round(num * 10) / 10;
        }
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
  const areaCaption = noGla
    ? 'Total · no living-area outline'
    : `Gross Living Area · ${glaCount} ${glaCount === 1 ? 'level' : 'levels'}`
      + ` · ${useInteriorWalls ? 'interior' : 'exterior'} wall face`;
  // Whether this area can be trusted, stated where the area is read rather
  // than in a toast that has already gone by the time anyone asks.
  const scaleNote = scaleQualitySummary(scaleQuality);

  // Where the scale came from, in the user's terms rather than the store's.
  const fpp = feetPerPixel;
  const pxPerFoot = calibrated && fpp?.x > 0 && fpp?.y > 0
    ? { x: 1 / fpp.x, y: 1 / fpp.y }
    : null;
  const anisotropic = pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6;
  const measuredRooms = rooms?.length ?? 0;
  const scaleProvenance = !pxPerFoot
    ? 'Read the dimensions, or set it from a length you know.'
    : calibrationSource === 'line-calibration'
      ? 'From a line you drew.'
      : measuredRooms > 0
        ? `From ${measuredRooms} measured ${measuredRooms === 1 ? 'room' : 'rooms'}.`
        : 'From the room size below.';

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
    flashStatus('Area breakdown copied to the clipboard');
  };

  // ── the pipeline, derived from the same state the cards read ──────────────
  const tracedCount = perimeterTraces.filter((t) => t.vertices?.length >= 3).length;
  const worstTrace = perimeterTraces
    .filter((t) => t.quality)
    .map((t) => qualitySummary(t.quality).level);
  const outlineState = tracedCount === 0
    ? 'todo'
    : worstTrace.some((l) => l === 'poor' || l === 'failed' || l === 'fair') ? 'warn' : 'done';
  const reportState = area > 0
    ? ((areas.doubleCounted?.length > 0 || outlineState === 'warn') ? 'warn' : 'done')
    : 'todo';
  const stages = [
    { id: 'plan', label: 'Plan', state: image ? 'done' : 'todo',
      title: image ? 'A plan is loaded' : 'Open or paste a floorplan' },
    { id: 'scale', label: 'Scale',
      state: calibrated ? (scaleNote?.level === 'check' ? 'warn' : 'done') : 'todo',
      title: calibrated ? 'The scale is set' : 'Read dimensions, or set the scale by hand' },
    { id: 'outline', label: 'Outline', state: outlineState,
      title: tracedCount === 0 ? 'No outline traced yet' : `${tracedCount} outline(s) traced` },
    { id: 'report', label: 'Report', state: reportState,
      title: area > 0 ? 'An area is available' : 'No area yet' },
  ];

  const jumpTo = (id) => {
    const el = scrollRef.current?.querySelector(`#dock-${id}`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  };

  return (
    <aside
      className={mobile
        ? 'flex w-full flex-col bg-panel select-none'
        : 'flex w-[320px] shrink-0 flex-col min-h-0 bg-panel border-r border-line select-none'}
      aria-label="Measurement"
    >
      {/* The sheet supplies the "Measurement" title on mobile, so repeating it
          here would give the panel two headings. */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-soft shrink-0">
        <h2 className={mobile ? 'text-[12.5px] text-fg-3 flex-1' : 'card-heading flex-1'}>
          {mobile ? 'Units' : 'Measurement'}
        </h2>
        <div className="flex p-0.5 gap-0.5 bg-sunken border border-line rounded-md" role="group" aria-label="Units">
          {[['decimal', 'ft'], ['inches', 'ft-in'], ['metric', 'm']].map(([id, label]) => (
            <button
              key={id}
              onClick={() => onUnitChange(id)}
              aria-pressed={unit === id}
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
          : 'flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3'}
      >
        <StageSpine stages={stages} onSelect={jumpTo} />

        {/* ── Room size ──
            The first card, and the biggest numbers in the panel. This is a
            measurement of the building, checked against the plan by eye and
            corrected by hand; the scale it implies is arithmetic the app does
            afterwards. They used to be one card with those weights the other
            way round — a 19 px `1 ft = 91.0 px` over two 13 px fields — which
            printed the derived, technical number as the headline and the
            checkable one as its footnote. */}
        <div id="dock-roomsize">
          <Card title="Room size">
            <div className="grid grid-cols-2 gap-2">
              {['width', 'height'].map((field) => (
                <div key={field}>
                  <label
                    htmlFor={`dim-${field}`}
                    className="block text-[11.5px] text-fg-3 mb-1 capitalize"
                  >
                    {field}
                  </label>
                  {unit === 'inches' ? (
                    <InchesInput
                      id={`dim-${field}`}
                      large
                      value={localDimensions[field]}
                      onChange={(v) => handleDimensionChange(field, v)}
                      onFocus={() => handleFocus(field)}
                      onBlur={() => handleBlur(field)}
                    />
                  ) : (
                    <input
                      id={`dim-${field}`}
                      type="text"
                      value={displayValues[field]}
                      onChange={(e) => handleDimensionChange(field, e.target.value)}
                      onFocus={() => handleFocus(field)}
                      onBlur={() => handleBlur(field)}
                      className="panel-input panel-input-lg select-text"
                      placeholder={unit === 'metric' ? '0.00 m' : '0.0 ft'}
                    />
                  )}
                </div>
              ))}
            </div>

            {mode === 'manual' && ocrFailed && !isProcessing && (
              <p className="mt-2.5 px-2.5 py-2 bg-warn/10 border border-warn/30 rounded-md
                            text-[12px] text-warn font-medium">
                Could not read any dimensions — type a room size here instead.
              </p>
            )}
          </Card>
        </div>

        {/* ── Area ── */}
        <div id="dock-report">
          <Card
            title="Area"
            action={canSwitchWallFace && (
              // One setting for every outline on the canvas, not just the
              // selected one — the label says so, because two outlines measured
              // to different wall faces is an area nobody can reconcile.
              <div className="flex p-0.5 gap-0.5 bg-sunken border border-line rounded-md"
                   role="group" aria-label="Wall face for all outlines">
                <button
                  onClick={() => onInteriorWallToggle(false)}
                  title="Measure every outline to the exterior wall face"
                  aria-pressed={!useInteriorWalls}
                  className={`unit-pill ${!useInteriorWalls ? 'unit-pill-active' : 'unit-pill-inactive'}`}
                >
                  Exterior
                </button>
                <button
                  onClick={() => onInteriorWallToggle(true)}
                  title="Measure every outline to the interior wall face"
                  aria-pressed={useInteriorWalls}
                  className={`unit-pill ${useInteriorWalls ? 'unit-pill-active' : 'unit-pill-inactive'}`}
                >
                  Interior
                </button>
              </div>
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-bold tabular-nums text-fg leading-none tracking-tight"
                    style={{ fontSize: areaText.length <= 7 ? '2.25rem' : areaText.length <= 9 ? '1.75rem' : '1.375rem' }}>
                {areaText}
              </span>
              <span className="text-[15px] text-fg-3 font-medium">{areaSuffix}</span>
            </div>
            <p className="mt-1 text-[12px] text-fg-3">{areaCaption}</p>

            {showBreakdown && (
              <table className="w-full border-collapse mt-3 text-[12.5px]">
                <thead>
                  <tr>
                    <th className="text-left pb-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-dim">
                      Breakdown
                    </th>
                    <th className="text-right pb-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-dim">
                      {areaSuffix}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((t) => (
                    <tr key={t.id}>
                      <td className="py-1 border-t border-line-soft text-fg-2">
                        <span className="inline-block w-2 h-2 rounded-sm mr-2 align-middle"
                              style={{ backgroundColor: t.color }} />
                        {t.label}
                      </td>
                      <td className="py-1 border-t border-line-soft text-right font-mono tabular-nums text-fg">
                        {formatAreaValue(areaDisplayValue(areas.byType[t.id], unit), unit).value}
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pt-1.5 border-t border-line font-semibold text-fg">Total</td>
                    <td className="pt-1.5 border-t border-line text-right font-mono tabular-nums font-semibold text-fg">
                      {totalFormatted.value}
                    </td>
                  </tr>
                </tbody>
              </table>
            )}

            {/* The property, above the export button because it is the figure
                that goes in the report. Only when there is more than one plan
                contributing: on a single-plan job it would just restate the
                number directly above it. */}
            {property.isMultiPlan && (
              <div className="mt-4 pt-3 border-t border-line">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[10.5px] font-bold uppercase tracking-[.06em] text-fg-dim">
                    Property
                  </span>
                  {propertyLevels > 0 && (
                    <span className="text-[11px] text-fg-3">
                      {propertyLevels} {propertyLevels === 1 ? 'level' : 'levels'} across{' '}
                      {property.plans.length} plans
                    </span>
                  )}
                </div>

                <div className="mt-1.5 flex items-baseline gap-2">
                  <span className="font-mono font-bold tabular-nums text-fg leading-none tracking-tight text-[1.75rem]">
                    {property.gla > 0 ? propertyGla.value : propertyTotal.value}
                  </span>
                  <span className="text-[13px] text-fg-3 font-medium">{areaSuffix}</span>
                  <span className="text-[11px] text-fg-3">
                    {property.gla > 0 ? 'gross living area' : 'total, no living-area outline'}
                  </span>
                </div>

                <table className="w-full border-collapse mt-2.5 text-[12.5px]">
                  <tbody>
                    {property.plans.map((plan) => (
                      <tr key={plan.docId}>
                        <td className="py-1 border-t border-line-soft text-fg-2">
                          {plan.label}
                          {plan.isActive && (
                            <span className="ml-1.5 text-[10.5px] text-fg-dim">this plan</span>
                          )}
                          {/* A plan the workspace has not read back cannot be
                              re-measured; its figure is the one it last
                              reported. Said rather than hidden. */}
                          {plan.fromDisk && (
                            <span className="ml-1.5 text-[10.5px] text-fg-dim">from the last save</span>
                          )}
                        </td>
                        <td className="py-1 border-t border-line-soft text-right font-mono tabular-nums text-fg">
                          {formatAreaValue(areaDisplayValue(plan.total, unit), unit).value}
                        </td>
                      </tr>
                    ))}
                    <tr>
                      <td className="pt-1.5 border-t border-line font-semibold text-fg">Property total</td>
                      <td className="pt-1.5 border-t border-line text-right font-mono tabular-nums font-semibold text-fg">
                        {propertyTotal.value}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* The number is read here, so the way to take it away is here.
                Export first and copy second: a plain number pasted into a
                report carries none of the evidence under it, and this panel is
                the last place the two can still be told apart. */}
            <button
              type="button"
              onClick={onExport}
              disabled={!(area > 0)}
              className="mt-3 w-full inline-flex items-center justify-center gap-1.5 h-9 rounded-md
                         bg-accent text-accent-ink text-[12.5px] font-semibold
                         hover:brightness-110 transition-[filter] cursor-pointer
                         disabled:opacity-40 disabled:cursor-default disabled:hover:brightness-100"
            >
              <Share className="w-3.5 h-3.5" aria-hidden="true" />
              Export for workfile…
            </button>

            <button
              type="button"
              onClick={handleCopyArea}
              disabled={!(area > 0)}
              className="mt-2 w-full inline-flex items-center justify-center gap-1.5 h-8 rounded-md
                         border border-line bg-panel-2 text-[12.5px] text-fg-2 font-medium
                         hover:text-fg hover:border-accent/50 transition-colors cursor-pointer
                         disabled:opacity-40 disabled:cursor-default"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              {showBreakdown ? 'Copy breakdown as text' : 'Copy area as text'}
            </button>

            {/* Report-level warning. Stated, never auto-corrected — which of the
                two traces is wrong is the user's call. It sits on the total
                because that is the number it invalidates. */}
            {areas.doubleCounted?.length > 0 && (
              <div className="mt-3 p-2.5 rounded-md bg-warn/12 border border-warn/40">
                {areas.doubleCounted.map((d) => (
                  <div key={d.innerId} className="grid grid-cols-[auto_1fr] gap-2 items-start">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-warn shrink-0" aria-hidden="true" />
                    <p className="text-[12px] leading-snug text-fg-2">
                      <b className="text-warn font-semibold">{d.innerName} sits inside {d.outerName}</b>
                      {' — its area is counted twice. Retrace whichever outline is wrong, '}
                      or change one of their types.
                    </p>
                  </div>
                ))}
              </div>
            )}

            {scaleNote && area > 0 && (
              <p
                title={scaleNote.detail}
                className={`mt-2.5 text-[12px] leading-snug cursor-help
                  ${scaleNote.level === 'check' ? 'text-warn' : 'text-fg-3'}`}
              >
                {scaleNote.level === 'check' ? '⚠ ' : ''}{scaleNote.short}
              </p>
            )}

            {showBreakdown && (
              <p className="mt-2.5 pt-2.5 border-t border-line-soft text-[11.5px] leading-snug text-fg-dim">
                Grouped in the ANSI Z765 style — not a certified measurement.
              </p>
            )}
          </Card>
        </div>

        {/* ── Outlines ── */}
        {(perimeterTraces.length > 1
          || perimeterTraces.some((t) => t.vertices?.length >= 3)) && (
          <div id="dock-outline">
            <Card
              title="Outlines"
              action={perimeterTraces.length < 7 && (
                <button
                  onClick={addPerimeterTrace}
                  aria-label="Add an outline"
                  title="Add an outline"
                  className="grid place-items-center w-[26px] h-[26px] rounded text-fg-3
                             hover:bg-sunken hover:text-fg transition-colors cursor-pointer"
                >
                  <Plus className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            >
              <div className="-m-2.5">
                {perimeterTraces.map((trace) => {
                  const isActive = trace.id === activeTraceId;
                  const traceArea = trace.vertices && trace.vertices.length >= 3
                    ? calculateArea(trace.vertices, feetPerPixel, trace.holes)
                    : 0;
                  const { value: tAreaText } = formatArea(traceArea, unit);
                  const quality = trace.quality ? qualitySummary(trace.quality) : null;
                  const chipTone = !quality ? null
                    : quality.level === 'good' ? 'text-ok bg-ok/12 border-ok/35'
                      : quality.level === 'fair' ? 'text-warn bg-warn/12 border-warn/35'
                        : 'text-crit bg-crit/12 border-crit/35';

                  return (
                    <div
                      key={trace.id}
                      onClick={() => switchPerimeterTrace(trace.id)}
                      className={`group px-2.5 py-2 border-t border-line-soft first:border-t-0
                        cursor-pointer transition-colors
                        ${isActive
                          ? 'bg-accent/10 shadow-[inset_-2px_0_0_rgb(var(--accent))]'
                          : 'hover:bg-sunken'}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="w-2.5 h-2.5 rounded-sm shrink-0"
                          style={{ backgroundColor: trace.color }}
                        />
                        <input
                          type="text"
                          value={trace.name}
                          onChange={(e) => renamePerimeterTrace(trace.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => { if (!isActive) switchPerimeterTrace(trace.id); }}
                          aria-label="Outline name"
                          className={`flex-1 bg-transparent border-0 p-0 text-[13px] font-medium
                            focus:outline-none focus:ring-0 focus:border-b focus:border-accent
                            min-w-0 select-none focus:select-text
                            ${isActive ? 'text-fg' : 'text-fg-2'} ${trace.visible ? '' : 'opacity-45'}`}
                        />
                        <span className={`font-mono tabular-nums text-[12.5px] text-fg-2
                                          ${trace.visible ? '' : 'opacity-45'}`}>
                          {traceArea > 0 ? tAreaText : '—'}
                        </span>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); toggleVisibility(trace.id); }}
                          aria-pressed={trace.visible}
                          title={trace.visible ? 'Hide this outline' : 'Show this outline'}
                          aria-label={trace.visible ? 'Hide this outline' : 'Show this outline'}
                          className="grid place-items-center w-[26px] h-[26px] rounded shrink-0
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
                            flashStatus(`Removed ${traceName}`);
                          }}
                          title="Delete this outline"
                          aria-label="Delete this outline"
                          className="grid place-items-center w-[26px] h-[26px] rounded shrink-0
                                     text-fg-3 hover:bg-crit/12 hover:text-crit transition-colors
                                     cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100"
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                      </div>

                      <div className="flex items-center gap-2 mt-1.5 pl-[18px] text-[11.5px] text-fg-3">
                        <select
                          value={normalizeTraceType(trace.type)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setPerimeterTraceType(trace.id, e.target.value)}
                          aria-label="Area type"
                          title="Area type"
                          className="h-[26px] px-1.5 rounded border border-line bg-panel-2
                                     text-[11.5px] text-fg-2 cursor-pointer hover:border-accent/50
                                     focus:outline-none focus:ring-2 focus:ring-accent"
                        >
                          {TRACE_TYPES.map((t) => (
                            <option key={t.id} value={t.id}>{t.label}</option>
                          ))}
                        </select>
                        {quality && (
                          <span className={`chip ${chipTone}`}>
                            <span className="chip-dot" />
                            {quality.percent !== null ? `${quality.percent}%` : 'unverified'}
                          </span>
                        )}
                        <span className="flex items-center gap-1.5 ml-auto font-mono tabular-nums">
                          <VoidNote holes={trace.holes} />
                        </span>
                      </div>

                      {/* A low-confidence outline stays marked as one after it is
                          on the canvas, and every reason it carries is
                          inspectable rather than hidden in a tooltip. */}
                      {quality && (quality.level !== 'good' || quality.warnings.length > 0) && (
                        <TraceQuality
                          trace={trace}
                          quality={quality}
                          expanded={openQualityTraceId === trace.id}
                          onToggle={() => setOpenQualityTraceId(
                            openQualityTraceId === trace.id ? null : trace.id
                          )}
                          anchorCtx={{ trace, traces: perimeterTraces, rooms, detectedDimensions }}
                          focusedWarning={focusedWarning}
                          onFocus={(index) => setFocusedWarning(
                            focusedWarning?.traceId === trace.id && focusedWarning?.index === index
                              ? null
                              : { traceId: trace.id, index }
                          )}
                        />
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        )}

        {/* ── Scale ──
            Last, and small. It is the number every area on this panel is
            derived from, so it has to be *available* — an unstated scale is how
            a plan gets measured at someone else's px/ft — but it is not a
            number anyone reads to do their job, and it sat at the top in 19 px
            type for a long time saying otherwise. The chip is the part that
            matters: it says whether the rooms agreed.

            `#dock-scale` stays this card's id — StageSpine's SCALE stage jumps
            here, which is where the provenance and the way to override it are.
            It used to appear only as `px/ft` inside ScaleSection, which renders
            nothing at all on the normal room-label path — so the number the
            whole measurement rests on was invisible unless you had drawn a
            scale line by hand. */}
        <div id="dock-scale">
          <Card
            title="Scale"
            action={scaleNote && (
              <span
                title={scaleNote.detail}
                className={`chip cursor-help ${scaleNote.level === 'check'
                  ? 'text-warn bg-warn/12 border-warn/35'
                  : 'text-ok bg-ok/12 border-ok/35'}`}
              >
                <span className="chip-dot" />
                {scaleNote.level === 'check' ? 'Check' : 'Agrees'}
              </span>
            )}
          >
            <div className="flex items-baseline gap-2">
              <span className="font-mono font-semibold tabular-nums text-[13px] text-fg-2">
                {pxPerFoot
                  ? (anisotropic
                    ? `${pxPerFoot.x.toFixed(2)} × ${pxPerFoot.y.toFixed(2)} px/ft`
                    : `1 ft = ${pxPerFoot.x.toFixed(1)} px`)
                  : 'Not set'}
              </span>
            </div>
            <p className="mt-1 text-[12px] text-fg-3">{scaleProvenance}</p>

            <button
              type="button"
              onClick={onScaleTool}
              className="mt-2.5 w-full h-8 rounded-md border border-line bg-panel-2
                         text-[12.5px] text-fg-2 font-medium hover:text-fg hover:border-accent/50
                         transition-colors cursor-pointer"
            >
              Set from a length you know
            </button>

            <ScaleSection unit={unit} />
          </Card>
        </div>
      </div>
    </aside>
  );
};

export default MeasurementDock;
