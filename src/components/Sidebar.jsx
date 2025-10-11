import { useState, useEffect } from 'react';
import { parseLength, formatDimensionInput } from '../utils/unitConverter';

const Sidebar = ({ 
  roomDimensions, 
  onDimensionsChange, 
  mode, 
  ocrFailed, 
  manualEntryMode,
  detectedDimensions,
  onEnterManually,
  unit,
  onUnitChange
}) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });

  // Update local dimensions when roomDimensions prop changes
  useEffect(() => {
    setLocalDimensions(roomDimensions);
    // Format display values based on current unit
    setDisplayValues({
      width: formatDimensionInput(roomDimensions.width, unit),
      height: formatDimensionInput(roomDimensions.height, unit)
    });
  }, [roomDimensions, unit]);

  const handleDimensionChange = (field, value) => {
    // Update display value immediately (for typing feedback)
    setDisplayValues(prev => ({ ...prev, [field]: value }));
    
    // Parse the input to get decimal feet value
    const parsedValue = parseLength(value);
    
    // Update the stored dimension (always in decimal feet)
    const newDimensions = { 
      ...localDimensions, 
      [field]: parsedValue !== null ? parsedValue.toString() : value 
    };
    setLocalDimensions(newDimensions);
    
    if (onDimensionsChange) {
      onDimensionsChange(newDimensions);
    }
  };

  const handleBlur = (field) => {
    // On blur, format the display value properly
    const parsedValue = parseLength(displayValues[field]);
    if (parsedValue !== null) {
      setDisplayValues(prev => ({
        ...prev,
        [field]: formatDimensionInput(parsedValue, unit)
      }));
    }
  };

  // Show "Enter Dimensions Manually" button when:
  // - In manual mode AND
  // - OCR succeeded (detected dimensions exist) AND
  // - Not already in manual entry mode AND
  // - No overlays placed yet
  const showManualEntryButton = mode === 'manual' && 
                                 !ocrFailed && 
                                 detectedDimensions && 
                                 detectedDimensions.length > 0 && 
                                 !manualEntryMode;

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
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">Width</label>
            <input
              type="text"
              value={displayValues.width}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              onBlur={() => handleBlur('width')}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              placeholder={unit === 'decimal' ? '0.0' : "0' 0\""}
            />
          </div>
          <div className="flex-1">
            <label className="block text-xs text-slate-600 mb-1">Height</label>
            <input
              type="text"
              value={displayValues.height}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              onBlur={() => handleBlur('height')}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              placeholder={unit === 'decimal' ? '0.0' : "0' 0\""}
            />
          </div>
        </div>

        {/* Instructions when OCR failed */}
        {ocrFailed && !manualEntryMode && (
          <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-md">
            <p className="text-xs text-orange-800 font-medium">
              No dimensions detected. Enter dimensions above and click on the room to place overlays.
            </p>
          </div>
        )}

        {/* Instructions when in manual entry mode */}
        {manualEntryMode && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-800 font-medium">
              Click on the canvas to place overlays.
            </p>
          </div>
        )}
      </div>

      {/* Enter Dimensions Manually Button */}
      {showManualEntryButton && (
        <button
          onClick={onEnterManually}
          className="w-full px-4 py-2 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm border border-slate-300"
        >
          Enter Dimensions Manually
        </button>
      )}
    </div>
  );
};

export default Sidebar;
