import { forwardRef } from 'react';
import Canvas from './Canvas';

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
  handleEnterManually,
  handleRestart
}, ref) => {
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Mobile Header */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 px-4 py-3 shadow-sm flex items-center justify-between">
        <div 
          className="flex items-center gap-2 cursor-pointer active:opacity-70 transition-opacity"
          onClick={handleRestart}
          title="Restart FloorTrace"
        >
          <img src={`${import.meta.env.BASE_URL}favicon-32x32.png`} alt="FloorTrace" className="w-7 h-7" />
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
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-slate-600 mb-1">Width</label>
                <input
                  type="text"
                  value={roomDimensions.width}
                  onChange={(e) => setRoomDimensions({ ...roomDimensions, width: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white text-base"
                  placeholder={unit === 'decimal' ? '0.0' : "0' 0\""}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-600 mb-1">Height</label>
                <input
                  type="text"
                  value={roomDimensions.height}
                  onChange={(e) => setRoomDimensions({ ...roomDimensions, height: e.target.value })}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-slate-500 bg-white text-base"
                  placeholder={unit === 'decimal' ? '0.0' : "0' 0\""}
                />
              </div>
            </div>

            {mode === 'manual' && !manualEntryMode && detectedDimensions && detectedDimensions.length > 0 && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 font-medium">
                  Tap on a detected dimension or use the button below to enter manually.
                </p>
              </div>
            )}
            
            {mode === 'manual' && !manualEntryMode && (!detectedDimensions || detectedDimensions.length === 0) && (
              <div className="mt-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                <p className="text-xs text-blue-800 font-medium">
                  No dimensions detected. Enter dimensions above and use the button below.
                </p>
              </div>
            )}

            {manualEntryMode && (
              <div className="mt-3 p-3 bg-green-50 border border-green-200 rounded-lg">
                <p className="text-xs text-green-800 font-medium">
                  Tap on the canvas to place overlays.
                </p>
              </div>
            )}
            
            {/* Place Overlays Button - Always available in manual mode */}
            {mode === 'manual' && !manualEntryMode && (
              <button
                onClick={handleEnterManually}
                className="w-full mt-3 px-4 py-3 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors shadow-sm"
              >
                Place Overlays on Canvas
              </button>
            )}
          </div>

          {/* Action Buttons */}
          <div className="p-4 space-y-3">
            {/* Show Load Image button only when no image is loaded */}
            {!image && (
              <button
                onClick={() => { fileInputRef.current?.click(); setMobileSheetOpen(false); }}
                className="w-full px-4 py-3 text-sm font-medium text-white bg-slate-700 hover:bg-slate-600 rounded-lg transition-colors shadow-sm disabled:opacity-40 disabled:bg-slate-300"
                disabled={isProcessing}
              >
                📁 Load Image
              </button>
            )}

            {/* Show main actions prominently when image is loaded */}
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
