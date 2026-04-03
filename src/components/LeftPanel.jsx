import { useState, useEffect } from 'react';
import { Ruler, Pentagon } from 'lucide-react';
import { formatDimensionInput } from '../utils/unitConverter';
import InchesInput from './InchesInput';
import Toggle from './Toggle';

const LeftPanel = ({
  roomDimensions,
  onDimensionsChange,
  area,
  mode,
  unit,
  onUnitChange,
  isProcessing,
  ocrFailed,
  showSideLengths,
  onShowSideLengthsChange,
  useInteriorWalls,
  onInteriorWallToggle,
  autoSnapEnabled,
  onAutoSnapChange,
  perimeterOverlay,
  hasAutoDetection,
  onManualMode,
  lineToolActive,
  onLineToolToggle,
  drawAreaActive,
  onDrawAreaToggle,
  debugDetection,
  onDebugDetectionChange,
  showOptions,
}) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });
  const [editingField, setEditingField] = useState(null);
  const [originalValues, setOriginalValues] = useState({ width: '', height: '' });

  useEffect(() => {
    setLocalDimensions(roomDimensions);
    if (!editingField) {
      const fw = formatDimensionInput(roomDimensions.width, unit);
      const fh = formatDimensionInput(roomDimensions.height, unit);
      setDisplayValues({
        width: unit === 'decimal' && fw ? `${fw} ft` : fw,
        height: unit === 'decimal' && fh ? `${fh} ft` : fh,
      });
    }
  }, [roomDimensions, unit, editingField]);

  const handleDimensionChange = (field, value) => {
    if (unit === 'decimal') {
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
    setEditingField(field);
    if (unit === 'decimal') {
      setOriginalValues((p) => ({ ...p, [field]: displayValues[field] }));
      setDisplayValues((p) => ({ ...p, [field]: '' }));
    }
  };

  const handleBlur = (field) => {
    if (unit === 'decimal') {
      const value = displayValues[field].trim();
      if (!value) {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
        setEditingField(null);
        return;
      }
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        const parsed = Math.round(num * 10) / 10;
        const next = { ...localDimensions, [field]: parsed.toString() };
        setLocalDimensions(next);
        onDimensionsChange?.(next);
        const formatted = formatDimensionInput(parsed, unit);
        setDisplayValues((p) => ({ ...p, [field]: `${formatted} ft` }));
      } else {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
      }
    }
    setEditingField(null);
  };

  const areaText = area > 0 ? Math.round(area).toLocaleString() : '0';

  return (
    <div className="relative z-10 flex w-[264px] shrink-0 flex-col self-start max-h-full animate-slide-in-left overflow-y-auto border-r border-chrome-700 bg-chrome-800 pointer-events-none">

      {/* Room Dimensions + Tools */}
      <section className="px-3 py-3 pointer-events-auto">
        <div className="flex gap-2">
          {/* Room Size */}
          <div className="flex-1 min-w-0">
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
                    className="panel-input"
                    placeholder="0.0 ft"
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
                    className="panel-input"
                    placeholder="0.0 ft"
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
          </div>

          {/* Tools — only shown when area has been calculated */}
          {area > 0 && (
            <div className="flex flex-col shrink-0 gap-1.5">
              <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-0.5">
                Tools
              </h3>
              <button
                onClick={onLineToolToggle}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
                  lineToolActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title="Measure Line"
              >
                <Ruler className="w-4 h-4" />
                Measure
              </button>
              <button
                onClick={onDrawAreaToggle}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
                  drawAreaActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title="Draw Area"
              >
                <Pentagon className="w-4 h-4" />
                Draw
              </button>
            </div>
          )}
        </div>
      </section>

      <div className="panel-divider mx-3" />

      {/* Area Display */}
      <section className="px-3 py-3">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
          Area
        </h3>
        <div className="bg-chrome-900/60 border border-chrome-700 rounded-lg px-3 py-3">
          <div className="font-mono font-bold text-accent leading-none" style={{
            fontSize: areaText.length <= 7 ? '1.75rem' : areaText.length <= 9 ? '1.375rem' : '1.125rem',
          }}>
            {areaText}
            <span className="text-accent/60 text-sm font-medium ml-1">ft²</span>
          </div>
        </div>
      </section>

      <div className="panel-divider mx-3" />

      {showOptions && (
        <>
          <section className="px-3 py-3 pointer-events-auto">
            <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2.5">
              Detection
            </h3>
            <Toggle
              label="Debug Overlays"
              checked={debugDetection}
              onChange={onDebugDetectionChange}
            />
          </section>

          <div className="panel-divider mx-3" />

          {/* Options */}
          {perimeterOverlay && (
            <>
              <section className="px-3 py-3 flex flex-col gap-2.5 pointer-events-auto">
                <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-0.5">
                  Options
                </h3>
                <Toggle
                  label="Show Lengths"
                  checked={showSideLengths}
                  onChange={onShowSideLengthsChange}
                />
                <Toggle
                  label="Exterior Walls"
                  checked={!useInteriorWalls}
                  onChange={(v) => onInteriorWallToggle(!v)}
                />
                <Toggle
                  label="Auto Snap"
                  checked={autoSnapEnabled}
                  onChange={onAutoSnapChange}
                />
                {hasAutoDetection && (
                  <button
                    onClick={onManualMode}
                    className="flex items-center gap-2 px-2.5 py-2 rounded-md text-xs font-medium transition-all duration-200 cursor-pointer bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600"
                  >
                    Manual Mode
                  </button>
                )}
              </section>
              <div className="panel-divider mx-3" />
            </>
          )}
        </>
      )}
    </div>
  );
};

export default LeftPanel;
