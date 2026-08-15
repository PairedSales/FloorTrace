import { useState, useEffect } from 'react';
import { Plus, Eye, EyeOff, Trash2, ChevronRight, ChevronDown, Crosshair } from 'lucide-react';
import useAppStore from '../store/appStore';
import { formatDimensionInput, formatArea, metersToFeet } from '../utils/unitConverter';
import { calculateArea } from '../utils/areaCalculator';
import { qualitySummary, scaleQualitySummary, rankedWarnings } from '../utils/boundaryQuality';
import { resolveAnchor } from '../utils/warningAnchors';
import InchesInput from './InchesInput';
import { toast } from 'sonner';

const SEVERITY_DOT = { error: 'bg-red-400', warn: 'bg-amber-400', info: 'bg-slate-500' };

const WarningRow = ({ warning, anchor, active, onFocus }) => (
  <div className="flex items-start gap-1.5 py-0.5">
    <span className={`mt-[3px] w-1.5 h-1.5 rounded-full shrink-0 ${SEVERITY_DOT[warning.severity] ?? SEVERITY_DOT.warn}`} />
    <div className="min-w-0 flex-1">
      <p className="text-[9px] font-semibold leading-tight text-slate-300">{warning.label}</p>
      <p className="text-[9px] leading-tight text-slate-500">{warning.detail}</p>
    </div>
    {anchor && (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onFocus();
        }}
        title={active ? 'Hide on canvas' : 'Show on canvas'}
        className={`p-0.5 rounded shrink-0 transition-colors ${
          active ? 'text-accent bg-chrome-800' : 'text-slate-500 hover:text-slate-200 hover:bg-chrome-800'
        }`}
      >
        <Crosshair className="w-3 h-3" />
      </button>
    )}
  </div>
);

/**
 * The detector's reasons for doubting one trace, ranked and inspectable.
 * The collapsed line is the first entry of the same ranked list the expansion
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

  const tone = quality.level === 'good' ? 'text-slate-500'
    : quality.level === 'fair' ? 'text-amber-400' : 'text-red-400';
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
    <div className="pl-3.5">
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(e) => {
          e.stopPropagation();
          onToggle();
        }}
        className={`flex w-full items-start gap-0.5 text-left text-[9px] leading-tight cursor-pointer hover:opacity-80 ${tone}`}
      >
        {expanded
          ? <ChevronDown className="w-2.5 h-2.5 mt-px shrink-0" />
          : <ChevronRight className="w-2.5 h-2.5 mt-px shrink-0" />}
        <span className="min-w-0">{headline}</span>
      </button>

      {expanded && (
        <div className="mt-1 space-y-0.5">
          {perFloor.map(row)}
          {wholeDrawing.length > 0 && (
            <>
              <p className="pt-1 text-[8px] uppercase tracking-wider text-slate-600">This drawing</p>
              {wholeDrawing.map(row)}
            </>
          )}
          {notes.length > 0 && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowNotes((v) => !v);
              }}
              className="text-[9px] text-slate-600 hover:text-slate-400 cursor-pointer"
            >
              {showNotes ? '· hide' : `· ${notes.length} note${notes.length === 1 ? '' : 's'}`}
            </button>
          )}
          {showNotes && notes.map(row)}
        </div>
      )}
    </div>
  );
};

const LeftPanel = ({
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
  perimeterOverlay,
  onDimensionFocus,
  onDimensionBlur,
}) => {
  const perimeterTraces = useAppStore((s) => s.perimeterTraces) || [];
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const addPerimeterTrace = useAppStore((s) => s.addPerimeterTrace);
  const switchPerimeterTrace = useAppStore((s) => s.switchPerimeterTrace);
  const deletePerimeterTrace = useAppStore((s) => s.deletePerimeterTrace);
  const renamePerimeterTrace = useAppStore((s) => s.renamePerimeterTrace);
  const toggleVisibility = useAppStore((s) => s.togglePerimeterTraceVisibility);
  const feetPerPixel = useAppStore((s) => s.calibration?.feetPerPixel);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  // Live state the warning anchors are derived from, so a crop or a re-scan
  // cannot leave a highlight pointing at the wrong part of the image.
  const rooms = useAppStore((s) => s.rooms);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const focusedWarning = useAppStore((s) => s.focusedWarning);
  const setFocusedWarning = useAppStore((s) => s.setFocusedWarning);
  const [openQualityTraceId, setOpenQualityTraceId] = useState(null);

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

  const { value: areaText, suffix: areaSuffix } = formatArea(area, unit);
  // Whether this area can be trusted, stated where the area is read rather
  // than in a toast that has already gone by the time anyone asks.
  const scaleNote = scaleQualitySummary(scaleQuality);
  const floorsInTotal = perimeterTraces.filter(
    (t) => t.visible && t.vertices && t.vertices.length >= 3
  ).length;

  const handleCopyArea = () => {
    navigator.clipboard.writeText(`${areaText} ${areaSuffix}`);
    toast.success(`Area copied to clipboard: ${areaText} ${areaSuffix}`);
  };

  return (
    <div className="relative z-10 flex w-[228px] shrink-0 flex-col self-start max-h-full animate-slide-in-left overflow-y-auto border-r border-b border-chrome-700 rounded-br-xl bg-chrome-800 pointer-events-none select-none">

      {/* Room Dimensions */}
        <section className="px-3 py-3 pointer-events-auto">
          <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
            Room Size
          </h3>
          <div className="flex gap-0.5 mb-2.5">
            <button
              onClick={() => onUnitChange('decimal')}
              className={`unit-pill ${unit === 'decimal' ? 'unit-pill-active' : 'unit-pill-inactive'}`}
            >
              Decimal
            </button>
            <button
              onClick={() => onUnitChange('inches')}
              className={`unit-pill ${unit === 'inches' ? 'unit-pill-active' : 'unit-pill-inactive'}`}
            >
              Inches
            </button>
            <button
              onClick={() => onUnitChange('metric')}
              className={`unit-pill ${unit === 'metric' ? 'unit-pill-active' : 'unit-pill-inactive'}`}
            >
              Meters
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                Width
              </label>
              {unit === 'inches' ? (
                <InchesInput
                  value={localDimensions.width}
                  onChange={(v) => handleDimensionChange('width', v)}
                  onFocus={() => handleFocus('width')}
                  onBlur={() => handleBlur('width')}
                />
              ) : (
                <input
                  type="text"
                  value={displayValues.width}
                  onChange={(e) => handleDimensionChange('width', e.target.value)}
                  onFocus={() => handleFocus('width')}
                  onBlur={() => handleBlur('width')}
                  className="panel-input select-text"
                  placeholder={unit === 'metric' ? '0.00 m' : '0.0 ft'}
                />
              )}
            </div>
            <div>
              <label className="block text-[10px] text-slate-500 mb-1 uppercase tracking-wide">
                Height
              </label>
              {unit === 'inches' ? (
                <InchesInput
                  value={localDimensions.height}
                  onChange={(v) => handleDimensionChange('height', v)}
                  onFocus={() => handleFocus('height')}
                  onBlur={() => handleBlur('height')}
                />
              ) : (
                <input
                  type="text"
                  value={displayValues.height}
                  onChange={(e) => handleDimensionChange('height', e.target.value)}
                  onFocus={() => handleFocus('height')}
                  onBlur={() => handleBlur('height')}
                  className="panel-input select-text"
                  placeholder={unit === 'metric' ? '0.00 m' : '0.0 ft'}
                />
              )}
            </div>
          </div>

          {mode === 'manual' && ocrFailed && !isProcessing && (
            <div className="mt-2.5 px-2.5 py-2 bg-amber-500/10 border border-amber-500/20 rounded-md">
              <p className="text-[11px] text-amber-400 font-medium">
                Scan failed — enter room size manually.
              </p>
            </div>
          )}
        </section>

        <div className="panel-divider mx-3" />

        {/* Area Display */}
        <section className="px-3 py-3">
          <div className="flex items-center justify-between mb-2.5">
            <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
              Area
            </h3>
            {perimeterOverlay && (
              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  type="button"
                  onClick={() => onInteriorWallToggle(false)}
                  className={`text-[11px] font-semibold cursor-pointer transition-colors duration-150 ${
                    !useInteriorWalls ? 'text-accent' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Exterior
                </button>
                <button
                  type="button"
                  onClick={() => onInteriorWallToggle(true)}
                  className={`text-[11px] font-semibold cursor-pointer transition-colors duration-150 ${
                    useInteriorWalls ? 'text-accent' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  Interior
                </button>
              </div>
            )}
          </div>
          <div 
            onDoubleClick={handleCopyArea}
            title="Double-click to copy to clipboard"
            className="bg-chrome-900/60 border border-chrome-700 rounded-lg px-3 py-2 cursor-pointer hover:bg-chrome-950/80 hover:border-accent/40 active:scale-[0.98] transition-all duration-200 pointer-events-auto"
          >
            <div className="font-mono font-bold text-accent leading-none text-center" style={{
              fontSize: areaText.length <= 7 ? '1.75rem' : areaText.length <= 9 ? '1.375rem' : '1.125rem',
            }}>
              {areaText}
              <span className="text-accent/60 text-sm font-medium ml-1">{areaSuffix}</span>
            </div>
            {floorsInTotal > 1 && (
              <p className="mt-1 text-[10px] text-slate-500 text-center">
                Combined total · {floorsInTotal} floors
              </p>
            )}
        </div>
        {scaleNote && area > 0 && (
          <p
            title={scaleNote.detail}
            className={`mt-1.5 text-[10px] leading-snug text-center cursor-help ${
              scaleNote.level === 'check' ? 'text-amber-400/90' : 'text-slate-500'
            }`}
          >
            {scaleNote.level === 'check' ? '⚠ ' : ''}{scaleNote.short}
          </p>
        )}
      </section>

      {/* Shown for a single traced floor too: this section carries the
          per-trace confidence line, and a doubtful outline must stay marked
          as doubtful after its toast has gone. */}
      {(perimeterTraces.length > 1
        || perimeterTraces.some((t) => t.vertices?.length >= 3)) && (
        <>
          <div className="panel-divider mx-3" />

          {/* Traces List */}
          <section className="px-3 py-3 pointer-events-auto flex flex-col min-h-0">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
                Perimeters
              </h3>
              {perimeterTraces.length < 7 && (
                <button
                  onClick={addPerimeterTrace}
                  className="flex items-center gap-1 text-[10px] font-semibold text-accent hover:text-accent/80 transition-colors cursor-pointer"
                  title="Add new perimeter trace"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              )}
            </div>

            <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-0.5">
              {perimeterTraces.length === 0 ? (
                <p className="text-[11px] text-slate-500 italic py-2 text-center">
                  No perimeters defined.
                </p>
              ) : (
                perimeterTraces.map((trace) => {
                  const isActive = trace.id === activeTraceId;
                  const traceArea = trace.vertices && trace.vertices.length >= 3
                    ? calculateArea(trace.vertices, feetPerPixel, trace.holes)
                    : 0;
                  const { value: tAreaText, suffix: tAreaSuffix } = formatArea(traceArea, unit);
                  const quality = trace.quality ? qualitySummary(trace.quality) : null;

                  return (
                    <div
                      key={trace.id}
                      onClick={() => switchPerimeterTrace(trace.id)}
                      className={`group flex flex-col gap-1 px-2 py-1.5 rounded-md transition-all border cursor-pointer ${
                        isActive
                          ? 'bg-chrome-950/70 border-accent/40 shadow-sm'
                          : 'bg-chrome-900/35 border-transparent hover:bg-chrome-900/50 hover:border-chrome-700/50'
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {/* Color Dot */}
                        <span
                          className="w-2 h-2 rounded-full shrink-0 shadow-sm transition-transform group-hover:scale-110"
                          style={{ backgroundColor: trace.color }}
                        />

                        {/* Rename Input */}
                        <input
                          type="text"
                          value={trace.name}
                          onChange={(e) => renamePerimeterTrace(trace.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => {
                            if (!isActive) switchPerimeterTrace(trace.id);
                          }}
                          className={`flex-1 bg-transparent border-0 p-0 text-[11px] font-medium focus:ring-0 focus:outline-none focus:border-b focus:border-accent/50 min-w-0 select-none focus:select-text ${
                            isActive ? 'text-slate-100' : 'text-slate-400 group-hover:text-slate-300'
                          }`}
                        />

                        {/* Visibility Toggle */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleVisibility(trace.id);
                          }}
                          className={`p-0.5 rounded hover:bg-chrome-800 transition-colors shrink-0 ${
                            trace.visible ? 'text-slate-400 hover:text-slate-200' : 'text-slate-600 hover:text-slate-400'
                          }`}
                          title={trace.visible ? 'Hide perimeter' : 'Show perimeter'}
                        >
                          {trace.visible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {/* Delete button */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const traceName = trace.name;
                            deletePerimeterTrace(trace.id);
                            toast.success(`Removed perimeter: ${traceName}`);
                          }}
                          className="p-0.5 rounded text-slate-500 hover:text-red-400 hover:bg-chrome-800 transition-colors shrink-0 opacity-0 group-hover:opacity-100 focus:opacity-100"
                          title="Delete perimeter"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Derived Area & Status */}
                      <div className="flex items-center justify-between pl-3.5 text-[9px] text-slate-500 font-mono">
                        <span>
                          {trace.vertices ? `${trace.vertices.length} pts` : '0 pts'}
                          {trace.closed ? ' (Closed)' : ' (Drawing)'}
                          {trace.holes?.length ? ` −${trace.holes.length} void` : ''}
                        </span>
                        <span>
                          {traceArea > 0 ? `${tAreaText} ${tAreaSuffix}` : '—'}
                        </span>
                      </div>

                      {/* Detection quality — a low-confidence outline stays
                          marked as one after it is on the canvas, and every
                          reason it carries is inspectable rather than hidden
                          in a tooltip the user cannot read or act on. */}
                      {quality && (quality.level !== 'good' || quality.warnings.length > 0) && (
                        <TraceQuality
                          trace={trace}
                          quality={quality}
                          expanded={openQualityTraceId === trace.id}
                          onToggle={() => setOpenQualityTraceId(
                            openQualityTraceId === trace.id ? null : trace.id
                          )}
                          anchorCtx={{
                            trace, traces: perimeterTraces, rooms, detectedDimensions,
                          }}
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
                })
              )}
            </div>
          </section>
        </>
      )}

      {/* Options/Settings Divider */}
      {/* (LeftPanel ends after the Perimeters list) */}
    </div>
  );
};

export default LeftPanel;
