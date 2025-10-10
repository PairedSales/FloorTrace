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
    <div className="w-64 bg-white border border-t-0 border-gray-200 p-4 flex flex-col gap-6 self-start">
      {/* Room Dimensions Section */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Room Dimensions</h2>
        <div className="flex flex-col gap-3">
          <div>
            <label className="block text-xs text-gray-600 mb-1">Width (ft)</label>
            <input
              type="text"
              value={localDimensions.width}
              onChange={(e) => handleDimensionChange('width', e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              placeholder="0.0"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-600 mb-1">Height (ft)</label>
            <input
              type="text"
              value={localDimensions.height}
              onChange={(e) => handleDimensionChange('height', e.target.value)}
              className="w-full px-2 py-1 border border-gray-300 rounded focus:outline-none focus:border-blue-500"
              placeholder="0.0"
            />
          </div>
        </div>
      </div>

      {/* Area Display */}
      <div>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Area</h2>
        <div className="bg-gray-100 rounded p-3">
          <div className="text-2xl font-bold text-gray-800">
            {area > 0 ? area.toFixed(2) : '0.00'} ft²
          </div>
        </div>
      </div>

      {/* Sidebar ends after Area section */}
    </div>
  );
};

export default Sidebar;
