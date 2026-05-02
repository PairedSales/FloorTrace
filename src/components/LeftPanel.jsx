import { useState, useEffect } from 'react';
import { formatDimensionInput, formatArea, metersToFeet } from '../utils/unitConverter';
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
  debugDetection,
  onDebugDetectionChange,
  showOptions,
  saveOnExit,
  onSaveOnExitChange,
  onDimensionFocus,
  onDimensionBlur,
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

  return (
    <div className="relative z-10 flex w-[228px] shrink-0 flex-col self-start max-h-full animate-slide-in-left overflow-y-auto border-r border-chrome-700 bg-chrome-800 pointer-events-none">

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
                className="panel-input"
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
                className="panel-input"
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
        <div className="bg-chrome-900/60 border border-chrome-700 rounded-lg px-3 py-2">
        <div className="font-mono font-bold text-accent leading-none text-center" style={{
            fontSize: areaText.length <= 7 ? '1.75rem' : areaText.length <= 9 ? '1.375rem' : '1.125rem',
          }}>
            {areaText}
            <span className="text-accent/60 text-sm font-medium ml-1">{areaSuffix}</span>
          </div>
        </div>
      </section>

      <div className="panel-divider mx-3" />

      {showOptions && (
        <>
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
                  label="Auto Snap"
                  checked={autoSnapEnabled}
                  onChange={onAutoSnapChange}
                />
              </section>
              <div className="panel-divider mx-3" />
            </>
          )}

          <section className="px-3 py-3 flex flex-col gap-2.5 pointer-events-auto">
            <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-0.5">
              Settings
            </h3>
            <Toggle
              label="Save on Exit"
              checked={saveOnExit}
              onChange={onSaveOnExitChange}
            />
            {import.meta.env.DEV && (
              <Toggle
                label="Detection Debug"
                checked={debugDetection}
                onChange={onDebugDetectionChange}
              />
            )}
          </section>
          <div className="panel-divider mx-3" />
        </>
      )}
    </div>
  );
};

export default LeftPanel;
