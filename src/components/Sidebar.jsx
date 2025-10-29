import { useState, useEffect } from 'react';
import { formatDimensionInput } from '../utils/unitConverter';
import InchesInput from './InchesInput';

const Sidebar = ({ 
  roomDimensions, 
  onDimensionsChange, 
  mode, 
  manualEntryMode,
  detectedDimensions,
  unit,
  onUnitChange,
  isProcessing,
  ocrFailed
}) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });
  const [editingField, setEditingField] = useState(null); // Track which field is being edited
  const [originalValues, setOriginalValues] = useState({ width: '', height: '' }); // Store original values for cancel

  // Update local dimensions when roomDimensions prop changes
  useEffect(() => {
    setLocalDimensions(roomDimensions);
    // Only update display if not currently editing
    if (!editingField) {
      const formattedWidth = formatDimensionInput(roomDimensions.width, unit);
      const formattedHeight = formatDimensionInput(roomDimensions.height, unit);
      
      // Add "ft" suffix in decimal mode
      setDisplayValues({
        width: unit === 'decimal' && formattedWidth ? `${formattedWidth} ft` : formattedWidth,
        height: unit === 'decimal' && formattedHeight ? `${formattedHeight} ft` : formattedHeight
      });
    }
  }, [roomDimensions, unit, editingField]);

  const handleDimensionChange = (field, value) => {
    if (unit === 'decimal') {
      const decimalPattern = /^[\d.]*$/;
      if (decimalPattern.test(value)) {
        setDisplayValues(prev => ({ ...prev, [field]: value }));
      }
    } else {
      const newDimensions = { ...localDimensions, [field]: value };
      setLocalDimensions(newDimensions);
      if (onDimensionsChange) {
        onDimensionsChange(newDimensions);
      }
    }
  };

  const handleFocus = (field) => {
    setEditingField(field);
    if (unit === 'decimal') {
      setOriginalValues(prev => ({ ...prev, [field]: displayValues[field] }));
      setDisplayValues(prev => ({ ...prev, [field]: '' }));
    }
  };

  const handleBlur = (field) => {
    if (unit === 'decimal') {
      const value = displayValues[field].trim();
      if (!value) {
        setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
        setEditingField(null);
        return;
      }

      const numValue = parseFloat(value);
      if (!isNaN(numValue) && numValue > 0) {
        const parsedValue = Math.round(numValue * 10) / 10;
        const newDimensions = { ...localDimensions, [field]: parsedValue.toString() };
        setLocalDimensions(newDimensions);
        if (onDimensionsChange) {
          onDimensionsChange(newDimensions);
        }
        const formatted = formatDimensionInput(parsedValue, unit);
        setDisplayValues(prev => ({ ...prev, [field]: `${formatted} ft` }));
      } else {
        setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
      }
    }
    setEditingField(null);
  };

  return (
    <div className="w-64 bg-slate-50 border border-t-0 border-slate-200 p-4 flex flex-col gap-6 self-start shadow-sm">
      {/* Room Dimensions Section */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center justify-center flex-1">
            <h2 className="text-sm font-semibold text-slate-700 text-center">Room Dimensions</h2>
          </div>
          <div className="flex items-center justify-center flex-1 gap-1">
            <button
              onClick={() => onUnitChange('decimal')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 ${
                unit === 'decimal'
                  ? 'bg-slate-700 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              Decimal
            </button>
            <button
              onClick={() => onUnitChange('inches')}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors duration-200 ${
                unit === 'inches'
                  ? 'bg-slate-700 text-white'
                  : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-300'
              }`}
            >
              Inches
            </button>
          </div>
        </div>
        <div className="flex gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Width</label>
            {unit === 'inches' ? (
              <InchesInput
                value={localDimensions.width}
                onChange={(val) => handleDimensionChange('width', val)}
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
                className="w-24 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white text-sm"
                placeholder="0.0 ft"
              />
            )}
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Height</label>
            {unit === 'inches' ? (
              <InchesInput
                value={localDimensions.height}
                onChange={(val) => handleDimensionChange('height', val)}
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
                className="w-24 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white text-sm"
                placeholder="0.0 ft"
              />
            )}
          </div>
        </div>

        {/* Instructions for manual mode - OCR succeeded */}
        {mode === 'manual' && !manualEntryMode && detectedDimensions && detectedDimensions.length > 0 && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-800 font-medium">
              Click on a detected room dimension.
            </p>
          </div>
        )}
        
        {/* Instructions for manual mode - OCR failed */}
        {mode === 'manual' && ocrFailed && !isProcessing && (
          <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
            <p className="text-xs text-yellow-800 font-medium">
              Room Scanning Failed. Enter Room Size Manually.
            </p>
          </div>
        )}
      </div>

    </div>
  );
};

export default Sidebar;
