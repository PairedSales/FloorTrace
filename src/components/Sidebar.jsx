import { useState, useEffect } from 'react';

const Sidebar = ({ roomDimensions, area, onDimensionsChange }) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);

  useEffect(() => {
    setLocalDimensions(roomDimensions);
  }, [roomDimensions]);

  const handleDimensionChange = (field, value) => {
    const newDimensions = { ...localDimensions, [field]: value };
    setLocalDimensions(newDimensions);
    if (onDimensionsChange) {
      onDimensionsChange(newDimensions);
    }
  };

  return (
    <div className="w-64 bg-slate-50 border border-t-0 border-slate-200 p-4 flex flex-col gap-6 self-start shadow-sm">
      {/* Room Dimensions Section */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Room Dimensions</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Width (ft)</label>
            <input
              type="text"
              value={localDimensions.width}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              placeholder="0.0"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Height (ft)</label>
            <input
              type="text"
              value={localDimensions.height}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              className="w-full px-3 py-2 border border-slate-300 rounded-md focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent bg-white"
              placeholder="0.0"
            />
          </div>
        </div>
      </div>

      {/* Area Display */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Area</h2>
        <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
          <div className="text-2xl font-bold text-slate-800">
            {area > 0 ? area.toFixed(2) : '0.00'} ft²
          </div>
        </div>
      </div>

      {/* Sidebar ends after Area section */}
    </div>
  );
};

export default Sidebar;
