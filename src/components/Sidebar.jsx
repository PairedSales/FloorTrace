import { useState, useEffect } from 'react';
import { formatDimensionInput } from '../utils/unitConverter';

const Sidebar = ({ 
  roomDimensions, 
  onDimensionsChange, 
  mode, 
  manualEntryMode,
  detectedDimensions,
  onEnterManually,
  unit,
  onUnitChange,
  isProcessing
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
    // Allow free-form typing with minimal validation
    if (unit === 'decimal') {
      // Allow numbers and one decimal point
      const decimalPattern = /^[\d.]*$/;
      if (!decimalPattern.test(value)) {
        return;
      }
    } else {
      // For inches mode, allow numbers and space
      const inchesPattern = /^[\d\s]*$/;
      if (!inchesPattern.test(value)) {
        return;
      }
    }
    
    // Update display value immediately (for typing feedback)
    setDisplayValues(prev => ({ ...prev, [field]: value }));
  };

  const handleFocus = (field) => {
    setEditingField(field);
    // Store original value for potential cancel
    setOriginalValues(prev => ({ ...prev, [field]: displayValues[field] }));
    // Clear the field for quick entry
    setDisplayValues(prev => ({ ...prev, [field]: '' }));
  };

  const handleBlur = (field) => {
    const value = displayValues[field].trim();
    
    // If field is empty, restore original value (user cancelled)
    if (!value) {
      setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
      setEditingField(null);
      return;
    }
    
    // Parse the input
    let parsedValue = null;
    
    if (unit === 'decimal') {
      // Parse decimal input, round to 1 decimal place
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        parsedValue = Math.round(numValue * 10) / 10; // Round to 1 decimal
      }
    } else {
      // Parse inches mode: "12 5" means 12 feet 5 inches
      const parts = value.trim().split(/\s+/);
      if (parts.length === 1) {
        // Just feet
        const feet = parseInt(parts[0]);
        if (!isNaN(feet)) {
          parsedValue = feet;
        }
      } else if (parts.length >= 2) {
        // Feet and inches
        const feet = parseInt(parts[0]) || 0;
        let inches = parseInt(parts[1]) || 0;
        // Clamp inches to 0-11
        inches = Math.max(0, Math.min(11, inches));
        parsedValue = feet + inches / 12;
      }
    }
    
    // If we got a valid value, update the dimension
    if (parsedValue !== null && parsedValue > 0) {
      const newDimensions = { 
        ...localDimensions, 
        [field]: parsedValue.toString() 
      };
      setLocalDimensions(newDimensions);
      
      if (onDimensionsChange) {
        onDimensionsChange(newDimensions);
      }
      
      // Format and display the value
      const formatted = formatDimensionInput(parsedValue, unit);
      const finalValue = unit === 'decimal' ? `${formatted} ft` : formatted;
      setDisplayValues(prev => ({ ...prev, [field]: finalValue }));
    } else {
      // Invalid input, restore original value
      setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
    }
    
    setEditingField(null);
  };

  // Always show manual entry option in manual mode when not already in manual entry mode
  const showManualEntryButton = mode === 'manual' && !manualEntryMode;

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
            <input
              type="text"
              value={displayValues.width}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              onFocus={() => handleFocus('width')}
              onBlur={() => handleBlur('width')}
              className="w-24 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white text-sm"
              placeholder={unit === 'decimal' ? '0.0 ft' : "0' 0\""}
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Height</label>
            <input
              type="text"
              value={displayValues.height}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              onFocus={() => handleFocus('height')}
              onBlur={() => handleBlur('height')}
              className="w-24 px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white text-sm"
              placeholder={unit === 'decimal' ? '0.0 ft' : "0' 0\""}
            />
          </div>
        </div>

        {/* Instructions for manual mode */}
        {mode === 'manual' && !manualEntryMode && detectedDimensions && detectedDimensions.length > 0 && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-800 font-medium">
              Click on a detected dimension or use the button below to enter manually.
            </p>
          </div>
        )}
        
        {mode === 'manual' && !manualEntryMode && !isProcessing && (!detectedDimensions || detectedDimensions.length === 0) && (
          <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-md">
            <p className="text-xs text-blue-800 font-medium">
              No dimensions detected. Enter dimensions above and use the button below.
            </p>
          </div>
        )}

        {/* Instructions when in manual entry mode */}
        {manualEntryMode && (
          <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-md">
            <p className="text-xs text-green-800 font-medium">
              Click on the canvas to place overlays.
            </p>
          </div>
        )}
      </div>

      {/* Enter Dimensions Manually Button - Always available in manual mode */}
      {showManualEntryButton && (
        <button
          onClick={onEnterManually}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-md transition-colors duration-200 shadow-sm"
        >
          Place Overlays on Canvas
        </button>
      )}
    </div>
  );
};

export default Sidebar;
