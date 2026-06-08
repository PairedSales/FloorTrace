import { useState, useEffect } from 'react';
import { Plus, Eye, EyeOff, Trash2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { formatDimensionInput, formatArea, metersToFeet } from '../utils/unitConverter';
import { calculateArea } from '../utils/areaCalculator';
import InchesInput from './InchesInput';
import { toast } from 'sonner';

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
  const addFloor = useAppStore((s) => s.addFloor);
  const switchFloor = useAppStore((s) => s.switchFloor);
  const closeFloor = useAppStore((s) => s.closeFloor);
  const renameFloor = useAppStore((s) => s.renameFloor);
  const toggleVisibility = useAppStore((s) => s.togglePerimeterTraceVisibility);
  const scale = useAppStore((s) => s.scale);

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
        </div>
      </section>

      {perimeterTraces.length > 1 && (
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
                  onClick={addFloor}
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
                    ? calculateArea(trace.vertices, scale) 
                    : 0;
                  const { value: tAreaText, suffix: tAreaSuffix } = formatArea(traceArea, unit);

                  return (
                    <div
                      key={trace.id}
                      onClick={() => switchFloor(trace.id)}
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
                          onChange={(e) => renameFloor(trace.id, e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          onFocus={() => {
                            if (!isActive) switchFloor(trace.id);
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
                            closeFloor(trace.id);
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
                        </span>
                        <span>
                          {traceArea > 0 ? `${tAreaText} ${tAreaSuffix}` : '—'}
                        </span>
                      </div>
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
