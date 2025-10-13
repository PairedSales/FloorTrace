import { forwardRef, useState, useEffect } from 'react';
import Canvas from './Canvas';
import FloorTraceLogo from '../assets/logo.svg';
import { formatDimensionInput } from '../utils/unitConverter';

const MobileUI = forwardRef(({
  image,
  roomOverlay,
  perimeterOverlay,
  mode,
  updateRoomOverlay,
  updatePerimeterVertices,
  isProcessing,
  detectedDimensions,
  handleDimensionSelect,
  showSideLengths,
  scale,
  manualEntryMode,
  handleCanvasClick,
  unit,
  lineToolActive,
  measurementLine,
  setMeasurementLine,
  drawAreaActive,
  customShape,
  setCustomShape,
  area,
  lineData,
  mobileSheetOpen,
  setMobileSheetOpen,
  fileInputRef,
  handleFileUpload,
  handleFindRoom,
  handleTracePerimeter,
  handleManualMode,
  handleFitToWindow,
  roomDimensions,
  setRoomDimensions,
  setUnit,
  handleLineToolToggle,
  handleDrawAreaToggle,
  setShowSideLengths,
  useInteriorWalls,
  handleInteriorWallToggle,
  handleRestart,
  perimeterVertices,
  onAddPerimeterVertex,
  onRemovePerimeterVertex,
  onUndoRedo,
  ocrFailed
}, ref) => {
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });
  const [editingField, setEditingField] = useState(null);
  const [originalValues, setOriginalValues] = useState({ width: '', height: '' });

  // Update display values when roomDimensions or unit changes
  useEffect(() => {
    // Only update display if not currently editing
    if (!editingField) {
      const formattedWidth = formatDimensionInput(roomDimensions.width, unit);
      const formattedHeight = formatDimensionInput(roomDimensions.height, unit);
      
      setDisplayValues({
        width: unit === 'decimal' && formattedWidth ? `${formattedWidth} ft` : formattedWidth,
        height: unit === 'decimal' && formattedHeight ? `${formattedHeight} ft` : formattedHeight
      });
    }
  }, [roomDimensions, unit, editingField]);

  const handleDimensionChange = (field, value) => {
    // Allow free-form typing with minimal validation
    if (unit === 'decimal') {
      const decimalPattern = /^[\d.]*$/;
      if (!decimalPattern.test(value)) return;
    } else {
      const inchesPattern = /^[\d\s]*$/;
      if (!inchesPattern.test(value)) return;
    }
    
    setDisplayValues(prev => ({ ...prev, [field]: value }));
  };

  const handleFocus = (field) => {
    setEditingField(field);
    setOriginalValues(prev => ({ ...prev, [field]: displayValues[field] }));
    setDisplayValues(prev => ({ ...prev, [field]: '' }));
  };

  const handleBlur = (field) => {
    const value = displayValues[field].trim();
    
    if (!value) {
      setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
      setEditingField(null);
      return;
    }
    
    let parsedValue = null;
    
    if (unit === 'decimal') {
      const numValue = parseFloat(value);
      if (!isNaN(numValue)) {
        parsedValue = Math.round(numValue * 10) / 10;
      }
    } else {
      const parts = value.trim().split(/\s+/);
      if (parts.length === 1) {
        const feet = parseInt(parts[0]);
        if (!isNaN(feet)) {
          parsedValue = feet;
        }
      } else if (parts.length >= 2) {
        const feet = parseInt(parts[0]) || 0;
        let inches = parseInt(parts[1]) || 0;
        inches = Math.max(0, Math.min(11, inches));
        parsedValue = feet + inches / 12;
      }
    }
    
    if (parsedValue !== null && parsedValue > 0) {
      setRoomDimensions({ ...roomDimensions, [field]: parsedValue.toString() });
      
      const formatted = formatDimensionInput(parsedValue, unit);
      const finalValue = unit === 'decimal' ? `${formatted} ft` : formatted;
      setDisplayValues(prev => ({ ...prev, [field]: finalValue }));
    } else {
      setDisplayValues(prev => ({ ...prev, [field]: originalValues[field] }));
    }
    
    setEditingField(null);
  };

  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Mobile Header */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 px-4 py-3 shadow-sm flex items-center justify-between">
        <div 
          className="flex items-center gap-2 active:opacity-70 transition-opacity cursor-pointer select-none"
          onClick={handleRestart}
          title="Restart FloorTrace"
        >
          <img src={FloorTraceLogo} alt="FloorTrace Logo" className="w-7 h-7" />
          <h1 className="text-lg font-semibold text-white tracking-tight">FloorTrace</h1>
        </div>
        <button
          onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
          className="p-2 text-white hover:bg-slate-700 rounded-md transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
      </header>

      {/* Mobile Canvas - Full Screen */}
      <div className="relative flex-1 overflow-hidden">
        {/* Tap to Load Image Overlay - Only show when no image */}
        {!image && (
          <div 
            className="absolute inset-0 flex items-center justify-center bg-slate-50 z-20"
            onClick={() => fileInputRef.current?.click()}
          >
            <div className="text-center px-6">
              <div className="mb-4">
                <svg className="w-20 h-20 mx-auto text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
              </div>
              <p className="text-xl text-slate-600 font-medium mb-2">Tap to Load Image</p>
              <p className="text-sm text-slate-500">Load a floor plan to get started</p>
            </div>
          </div>
        )}
        
        <Canvas
          ref={ref}
          image={image}
          roomOverlay={roomOverlay}
          perimeterOverlay={perimeterOverlay}
          mode={mode}
          onRoomOverlayUpdate={updateRoomOverlay}
          onPerimeterUpdate={updatePerimeterVertices}
          isProcessing={isProcessing}
          detectedDimensions={detectedDimensions}
          onDimensionSelect={handleDimensionSelect}
          showSideLengths={showSideLengths}
          pixelsPerFoot={scale}
          manualEntryMode={manualEntryMode}
          onCanvasClick={handleCanvasClick}
          unit={unit}
          lineToolActive={lineToolActive}
          measurementLine={measurementLine}
          onMeasurementLineUpdate={setMeasurementLine}
          drawAreaActive={drawAreaActive}
          customShape={customShape}
          onCustomShapeUpdate={setCustomShape}
          isMobile={true}
          lineData={lineData}
          perimeterVertices={perimeterVertices}
          onAddPerimeterVertex={onAddPerimeterVertex}
          onRemovePerimeterVertex={onRemovePerimeterVertex}
          onUndoRedo={onUndoRedo}
        />

        {/* Mobile Area Display - Floating Top Right */}
        {area > 0 && (
          <div className="absolute top-4 right-4 z-10">
            <div className="bg-slate-800 bg-opacity-95 rounded-lg px-4 py-3 shadow-lg">
              <div className="text-xs text-slate-300 mb-1">Area</div>
              <div className="text-xl font-bold text-white">
                {Math.round(area).toLocaleString()} ft²
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Mobile Bottom Sheet */}
      <div 
        className={`fixed inset-x-0 bottom-0 z-50 bg-white border-t border-slate-200 shadow-2xl transition-transform duration-300 ease-out ${
          mobileSheetOpen ? 'translate-y-0' : 'translate-y-[calc(100%-3.5rem)]'
        }`}
        style={{ maxHeight: '85vh' }}
      >
        {/* Sheet Handle */}
        <div 
          className="flex items-center justify-center py-3 border-b border-slate-200 bg-slate-50"
          onClick={() => setMobileSheetOpen(!mobileSheetOpen)}
        >
          <div className="w-12 h-1 bg-slate-300 rounded-full"></div>
        </div>

        {/* Sheet Content */}
        <div className="overflow-y-auto" style={{ maxHeight: 'calc(85vh - 3.5rem)' }}>
          {/* Room Dimensions - Always at the top */}
          <div className="p-4 border-b border-slate-200 bg-slate-50">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-slate-700">Room Dimensions</h2>
              <div className="flex gap-1">
                <button
                  onClick={() => setUnit('decimal')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    unit === 'decimal'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  Decimal
                </button>
                <button
                  onClick={() => setUnit('inches')}
                  className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                    unit === 'inches'
                      ? 'bg-slate-700 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
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
                  className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white text-base"
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
                  className="w-28 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white text-base"
                  placeholder={unit === 'decimal' ? '0.0 ft' : "0' 0\""}
                />
              </div>
            </div>

            {/* Instructions for manual mode - OCR succeeded */}
            {mode === 'manual' && !manualEntryMode && detectedDimensions && detectedDimensions.length > 0 && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 font-medium">
                  Tap on a detected room dimension.
                </p>
              </div>
            )}
            
            {/* Instructions for manual mode - OCR failed */}
            {mode === 'manual' && ocrFailed && !isProcessing && (
              <div className="mt-3 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
                <p className="text-xs text-yellow-800 font-medium">
                  Room Scanning Failed. Enter Room Size Manually.
                </p>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-4 space-y-3">
            {/* Show main actions only when image is loaded */}
            {image && (
              <>
                <button
                  onClick={() => { handleFindRoom(); setMobileSheetOpen(false); }}
                  className="w-full px-4 py-3 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:bg-slate-300"
                  disabled={isProcessing}
                >
                  🔍 Find Room
                </button>
                
                <button
                  onClick={() => { handleTracePerimeter(); setMobileSheetOpen(false); }}
                  className="w-full px-4 py-3 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:bg-slate-300"
                  disabled={isProcessing}
                >
                  ✏️ Trace Perimeter
                </button>

                <button
                  onClick={() => { handleManualMode(); setMobileSheetOpen(false); }}
                  className={`w-full px-4 py-3 text-sm font-medium rounded-lg transition-colors shadow-sm disabled:opacity-40 ${
                    mode === 'manual' 
                      ? 'bg-blue-600 text-white hover:bg-blue-700' 
                      : 'text-white bg-slate-700 hover:bg-slate-600 disabled:bg-slate-300'
                  }`}
                  disabled={isProcessing}
                >
                  ✋ Manual Mode
                </button>

                <button
                  onClick={() => { handleFitToWindow(); setMobileSheetOpen(false); }}
                  className="w-full px-4 py-3 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-40 disabled:bg-slate-50 mt-4"
                >
                  🖼️ Fit to Window
                </button>
              </>
            )}
          </div>

          {/* Measurement Options */}
          {scale > 1 && (
            <div className="p-4 border-t border-slate-200">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Measurement Options</h2>
              
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Line Tool</span>
                  <button
                    onClick={handleLineToolToggle}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                      lineToolActive ? 'bg-slate-700' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        lineToolActive ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-700">Draw Area</span>
                  <button
                    onClick={handleDrawAreaToggle}
                    className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                      drawAreaActive ? 'bg-slate-700' : 'bg-slate-300'
                    }`}
                  >
                    <span
                      className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                        drawAreaActive ? 'translate-x-7' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                {perimeterOverlay && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Show Lengths</span>
                    <button
                      onClick={() => setShowSideLengths(!showSideLengths)}
                      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                        showSideLengths ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                          showSideLengths ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                )}

                {perimeterOverlay && (
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Exterior Walls</span>
                    <button
                      onClick={() => handleInteriorWallToggle({ target: { checked: !useInteriorWalls } })}
                      className={`relative inline-flex h-8 w-14 items-center rounded-full transition-colors ${
                        !useInteriorWalls ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-6 w-6 transform rounded-full bg-white transition-transform ${
                          !useInteriorWalls ? 'translate-x-7' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileUpload}
        className="hidden"
      />
    </div>
  );
});

MobileUI.displayName = 'MobileUI';

export default MobileUI;
