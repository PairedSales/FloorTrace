import { useState, useRef, useEffect, useCallback } from 'react';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import MobileUI from './components/MobileUI';
import { loadImageFromFile, loadImageFromClipboard } from './utils/imageLoader';
import { detectRoom } from './utils/roomDetector';
import { calculateArea } from './utils/areaCalculator';

function App() {
  const [image, setImage] = useState(null);
  const [roomOverlay, setRoomOverlay] = useState(null);
  const [perimeterOverlay, setPerimeterOverlay] = useState(null);
  const [roomDimensions, setRoomDimensions] = useState({ width: '', height: '' });
  const [area, setArea] = useState(0);
  const [mode, setMode] = useState('normal'); // 'normal' or 'manual'
  const [scale, setScale] = useState(1);
  const [isProcessing, setIsProcessing] = useState(false);
  const [detectedDimensions, setDetectedDimensions] = useState([]);
  const [showSideLengths, setShowSideLengths] = useState(false);
  const [useInteriorWalls, setUseInteriorWalls] = useState(true);
  const [lineData, setLineData] = useState(null); // Store line detection data
  const [isMobile, setIsMobile] = useState(false);
  const [mobileSheetOpen, setMobileSheetOpen] = useState(true);
  const [manualEntryMode, setManualEntryMode] = useState(false); // User entering dimensions manually
  const [ocrFailed, setOcrFailed] = useState(false); // Track if OCR failed in manual mode
  const [unit, setUnit] = useState('decimal'); // 'decimal' or 'inches'
  
  // Debug: Log unit changes
  useEffect(() => {
    console.log('Unit state changed to:', unit);
  }, [unit]);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [lineToolActive, setLineToolActive] = useState(false);
  const [measurementLine, setMeasurementLine] = useState(null); // { start: {x, y}, end: {x, y} }
  const [drawAreaActive, setDrawAreaActive] = useState(false);
  const [customShape, setCustomShape] = useState(null); // { vertices: [{x, y}], closed: boolean }
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const sidebarRef = useRef(null);

  // Reset overlays
  const resetOverlays = useCallback(() => {
    setRoomOverlay(null);
    setPerimeterOverlay(null);
    setRoomDimensions({ width: '', height: '' });
    setArea(0);
    setScale(1);
    setDetectedDimensions([]);
    setMode('normal');
    setLineData(null);
    setManualEntryMode(false);
    setOcrFailed(false);
    setLineToolActive(false);
    setMeasurementLine(null);
    setDrawAreaActive(false);
    setCustomShape(null);
  }, []);

  // Reset entire application
  const handleRestart = () => {
    setImage(null);
    resetOverlays();
  };

  // Handle file upload
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        const loadedImage = await loadImageFromFile(file);
        setImage(loadedImage);
        resetOverlays();
      } catch (error) {
        console.error('Error loading image:', error);
        alert('Failed to load image. Please try again.');
      } finally {
        // Reset file input so the same file can be selected again
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
      }
    }
  };

  // Handle clipboard paste
  const handlePasteImage = useCallback(async () => {
    try {
      const loadedImage = await loadImageFromClipboard();
      if (loadedImage) {
        setImage(loadedImage);
        resetOverlays();
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      alert('Failed to paste image. Make sure an image is copied to your clipboard.');
    }
  }, [resetOverlays]);

  // Handle find room
  const handleFindRoom = async () => {
    if (!image) {
      alert('Please load an image first');
      return;
    }
    
    setIsProcessing(true);
    try {
      const result = await detectRoom(image);
      if (result) {
        setRoomOverlay(result.overlay);
        setRoomDimensions(result.dimensions);
        updateScale(result.dimensions, result.overlay);
        
        // Store line data for perimeter detection
        if (result.lineData) {
          setLineData(result.lineData);
          console.log('Line data stored for perimeter detection');
        }
        
        // Auto-switch unit based on detected format
        if (result.detectedFormat) {
          console.log('Find Room - Detected format:', result.detectedFormat, 'Current unit:', unit);
          // If current unit doesn't match detected format, switch it
          if (unit !== result.detectedFormat) {
            console.log(`Find Room - Auto-switching unit from ${unit} to ${result.detectedFormat}`);
            setUnit(result.detectedFormat);
            console.log('Find Room - setUnit called with:', result.detectedFormat);
          } else {
            console.log('Find Room - Unit already matches, no switch needed');
          }
        } else {
          console.log('Find Room - No format detected');
        }
      } else {
        alert('Could not detect room dimensions. Try Manual Mode.');
      }
    } catch (error) {
      console.error('Error detecting room:', error);
      alert('Error detecting room. Please try again.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle trace perimeter
  const handleTracePerimeter = async () => {
    if (!image) {
      alert('Please load an image first');
      return;
    }
    
    setIsProcessing(true);
    try {
      // Import the new perimeter detector
      const { detectPerimeter } = await import('./utils/perimeterDetector');
      
      // Use existing line data if available, otherwise detect lines
      const result = await detectPerimeter(image, useInteriorWalls, lineData);
      
      if (result) {
        setPerimeterOverlay({ vertices: result.vertices });
        
        // Only calculate area if we have scale (room dimensions exist)
        if (scale > 1 || (roomDimensions.width && roomDimensions.height)) {
          const calculatedArea = calculateArea(result.vertices, scale);
          setArea(calculatedArea);
        }
        
        // Store line data if we didn't have it before
        if (result.lineData && !lineData) {
          setLineData(result.lineData);
        }
      } else {
        alert('Could not detect perimeter. Try adjusting the room overlay or use Manual Mode.');
      }
    } catch (error) {
      console.error('Error tracing perimeter:', error);
      alert('Error during perimeter tracing.');
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle manual mode
  const handleManualMode = async () => {
    if (mode === 'manual') {
      // Exiting manual mode
      setMode('normal');
      setDetectedDimensions([]);
      setManualEntryMode(false);
      setOcrFailed(false);
    } else {
      // Entering manual mode - check if overlays exist
      if (roomOverlay || perimeterOverlay) {
        const confirmed = window.confirm(
          'Entering Manual Mode will clear existing overlays. Are you sure?'
        );
        if (!confirmed) {
          return;
        }
        // Clear overlays
        setRoomOverlay(null);
        setPerimeterOverlay(null);
        setArea(0);
      }
      
      if (!image) {
        alert('Please load an image first');
        return;
      }
      
      setIsProcessing(true);
      setMode('manual');
      setManualEntryMode(false);
      setOcrFailed(false);
      
      try {
        const { detectAllDimensions } = await import('./utils/roomDetector');
        const result = await detectAllDimensions(image);
        
        // Handle new return format (object with dimensions and detectedFormat)
        const dimensions = result.dimensions || result || [];
        const detectedFormat = result.detectedFormat;
        
        console.log('Manual Mode - Result:', { dimensions: dimensions.length, detectedFormat, currentUnit: unit });
        
        setDetectedDimensions(dimensions);
        
        if (dimensions.length === 0) {
          // OCR failed - enter manual entry mode
          setOcrFailed(true);
        } else {
          // Auto-switch unit based on detected format
          if (detectedFormat && unit !== detectedFormat) {
            console.log(`Manual Mode - Auto-switching unit from ${unit} to ${detectedFormat}`);
            setUnit(detectedFormat);
            console.log('Manual Mode - setUnit called with:', detectedFormat);
          } else {
            console.log(`Manual Mode - Unit already matches (${unit}) or no format detected`);
          }
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        // OCR failed - enter manual entry mode
        setOcrFailed(true);
      } finally {
        setIsProcessing(false);
      }
    }
  };

  // Handle manual dimension entry button click
  const handleEnterManually = () => {
    setManualEntryMode(true);
    setDetectedDimensions([]); // Clear detected dimensions
  };

  // Handle interior/exterior wall toggle
  const handleInteriorWallToggle = async (e) => {
    const newValue = e.target.checked;
    
    // If perimeter exists, confirm before changing
    if (perimeterOverlay) {
      const confirmed = window.confirm(
        'Changing wall detection will reposition the perimeter vertices. Are you sure?'
      );
      if (!confirmed) {
        return;
      }
      
      // Redetect perimeter with new setting
      setIsProcessing(true);
      try {
        const { detectPerimeter } = await import('./utils/perimeterDetector');
        const result = await detectPerimeter(image, newValue, lineData);
        
        if (result) {
          setPerimeterOverlay({ vertices: result.vertices });
          const calculatedArea = calculateArea(result.vertices, scale);
          setArea(calculatedArea);
        }
      } catch (error) {
        console.error('Error redetecting perimeter:', error);
        alert('Error repositioning perimeter.');
      } finally {
        setIsProcessing(false);
      }
    }
    
    setUseInteriorWalls(newValue);
  };

  // Handle fit to window
  const handleFitToWindow = () => {
    if (canvasRef.current) {
      canvasRef.current.fitToWindow();
    }
  };

  // Handle line tool toggle
  const handleLineToolToggle = () => {
    setLineToolActive(!lineToolActive);
    setMeasurementLine(null); // Clear any existing line
  };

  // Handle draw area tool toggle
  const handleDrawAreaToggle = () => {
    setDrawAreaActive(!drawAreaActive);
    setCustomShape(null); // Clear any existing shape
  };

  // Handle save image (screenshot entire app)
  const handleSaveImage = async () => {
    try {
      // Use html2canvas to capture the entire app
      const html2canvas = (await import('html2canvas')).default;
      
      // Get the root element
      const appElement = document.getElementById('root');
      if (!appElement) {
        alert('Could not capture screenshot');
        return;
      }
      
      // Capture the screenshot
      const canvas = await html2canvas(appElement, {
        backgroundColor: '#ffffff',
        scale: 2, // Higher quality
        logging: false,
        useCORS: true
      });
      
      // Convert to WebP blob
      canvas.toBlob((blob) => {
        if (!blob) {
          alert('Failed to create image');
          return;
        }
        
        // Create download link
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `floortrace-${timestamp}.webp`;
        link.href = url;
        link.click();
        
        // Clean up
        URL.revokeObjectURL(url);
      }, 'image/webp', 0.95);
      
    } catch (error) {
      console.error('Error saving screenshot:', error);
      alert('Error saving screenshot. Please try again.');
    }
  };


  // Update scale based on room dimensions and overlay
  const updateScale = (dimensions, overlay) => {
    if (!dimensions.width || !dimensions.height || !overlay) return;
    
    const dimWidth = parseFloat(dimensions.width);
    const dimHeight = parseFloat(dimensions.height);
    const overlayWidth = Math.abs(overlay.x2 - overlay.x1);
    const overlayHeight = Math.abs(overlay.y2 - overlay.y1);
    
    // Match smallest dimension to smallest measurement
    const minDim = Math.min(dimWidth, dimHeight);
    const minOverlay = Math.min(overlayWidth, overlayHeight);
    
    const newScale = minDim / minOverlay; // feet per pixel
    setScale(newScale);
    
    // If perimeter already exists, recalculate area with new scale
    if (perimeterOverlay && perimeterOverlay.vertices) {
      const calculatedArea = calculateArea(perimeterOverlay.vertices, newScale);
      setArea(calculatedArea);
    }
  };

  // Update room overlay position
  const updateRoomOverlay = (overlay) => {
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay);
    }
  };

  // Update perimeter vertices
  const updatePerimeterVertices = (vertices) => {
    setPerimeterOverlay({ ...perimeterOverlay, vertices });
    const calculatedArea = calculateArea(vertices, scale);
    setArea(calculatedArea);
  };

  // Handle dimension selection in manual mode
  const handleDimensionSelect = (dimension) => {
    setRoomDimensions({ 
      width: dimension.width.toString(), 
      height: dimension.height.toString() 
    });
    
    // Create fixed-size 200x200 room overlay centered on dimension
    const centerX = dimension.bbox.x + dimension.bbox.width / 2;
    const centerY = dimension.bbox.y + dimension.bbox.height / 2;
    const roomOverlay = {
      x1: centerX - 100,
      y1: centerY - 100,
      x2: centerX + 100,
      y2: centerY + 100
    };
    
    setRoomOverlay(roomOverlay);
    updateScale({ 
      width: dimension.width.toString(), 
      height: dimension.height.toString() 
    }, roomOverlay);
    
    // Create fixed-size 400x400 perimeter overlay centered on dimension
    const perimeterVertices = [
      { x: centerX - 200, y: centerY - 200 }, // Top-left
      { x: centerX + 200, y: centerY - 200 }, // Top-right
      { x: centerX + 200, y: centerY + 200 }, // Bottom-right
      { x: centerX - 200, y: centerY + 200 }  // Bottom-left
    ];
    
    setPerimeterOverlay({ vertices: perimeterVertices });
    
    // Calculate area with the new perimeter
    const calculatedArea = calculateArea(perimeterVertices, scale);
    setArea(calculatedArea);
    
    // Exit manual mode after selection
    setMode('normal');
    setDetectedDimensions([]);
    setManualEntryMode(false);
  };

  // Handle canvas click for manual overlay placement
  const handleCanvasClick = (clickPoint) => {
    if (!manualEntryMode || !roomDimensions.width || !roomDimensions.height) return;
    
    // Validate dimensions
    const width = parseFloat(roomDimensions.width);
    const height = parseFloat(roomDimensions.height);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      alert('Please enter valid room dimensions first');
      return;
    }
    
    // Create fixed-size 200x200 room overlay centered on click
    const roomOverlay = {
      x1: clickPoint.x - 100,
      y1: clickPoint.y - 100,
      x2: clickPoint.x + 100,
      y2: clickPoint.y + 100
    };
    
    setRoomOverlay(roomOverlay);
    updateScale(roomDimensions, roomOverlay);
    
    // Create fixed-size 400x400 perimeter overlay centered on click
    const perimeterVertices = [
      { x: clickPoint.x - 200, y: clickPoint.y - 200 }, // Top-left
      { x: clickPoint.x + 200, y: clickPoint.y - 200 }, // Top-right
      { x: clickPoint.x + 200, y: clickPoint.y + 200 }, // Bottom-right
      { x: clickPoint.x - 200, y: clickPoint.y + 200 }  // Bottom-left
    ];
    
    setPerimeterOverlay({ vertices: perimeterVertices });
    
    // Calculate area with the new perimeter
    const calculatedArea = calculateArea(perimeterVertices, scale);
    setArea(calculatedArea);
    
    // Exit manual entry mode
    setManualEntryMode(false);
    setMode('normal');
  };

  // Detect mobile device on mount (Android/iPhone only)
  useEffect(() => {
    const isMobileDevice = /Android|iPhone/i.test(navigator.userAgent);
    setIsMobile(isMobileDevice);
  }, []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        switch (e.key) {
          case 'v':
            e.preventDefault();
            handlePasteImage();
            break;
          case 'o':
            e.preventDefault();
            fileInputRef.current?.click();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePasteImage]);

  // Disable right-click context menu unless text is selected
  useEffect(() => {
    const handleContextMenu = (e) => {
      const selection = window.getSelection();
      const hasTextSelected = selection && selection.toString().length > 0;
      
      if (!hasTextSelected) {
        e.preventDefault();
      }
    };

    window.addEventListener('contextmenu', handleContextMenu);
    return () => window.removeEventListener('contextmenu', handleContextMenu);
  }, []);

  // Match Area box height to Sidebar height
  useEffect(() => {
    const updateHeight = () => {
      if (sidebarRef.current) {
        setSidebarHeight(sidebarRef.current.offsetHeight);
      }
    };

    updateHeight();
    window.addEventListener('resize', updateHeight);
    
    // Use MutationObserver to detect content changes in sidebar
    const observer = new MutationObserver(updateHeight);
    if (sidebarRef.current) {
      observer.observe(sidebarRef.current, { childList: true, subtree: true });
    }

    return () => {
      window.removeEventListener('resize', updateHeight);
      observer.disconnect();
    };
  }, [mode, ocrFailed, manualEntryMode, perimeterOverlay]);

  // Render mobile UI if on mobile device
  if (isMobile) {
    return (
      <MobileUI
        ref={canvasRef}
        image={image}
        roomOverlay={roomOverlay}
        perimeterOverlay={perimeterOverlay}
        mode={mode}
        updateRoomOverlay={updateRoomOverlay}
        updatePerimeterVertices={updatePerimeterVertices}
        isProcessing={isProcessing}
        detectedDimensions={detectedDimensions}
        handleDimensionSelect={handleDimensionSelect}
        showSideLengths={showSideLengths}
        scale={scale}
        manualEntryMode={manualEntryMode}
        handleCanvasClick={handleCanvasClick}
        unit={unit}
        lineToolActive={lineToolActive}
        measurementLine={measurementLine}
        setMeasurementLine={setMeasurementLine}
        drawAreaActive={drawAreaActive}
        customShape={customShape}
        setCustomShape={setCustomShape}
        area={area}
        mobileSheetOpen={mobileSheetOpen}
        setMobileSheetOpen={setMobileSheetOpen}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        handleFindRoom={handleFindRoom}
        handleTracePerimeter={handleTracePerimeter}
        handleManualMode={handleManualMode}
        handleFitToWindow={handleFitToWindow}
        roomDimensions={roomDimensions}
        setRoomDimensions={setRoomDimensions}
        setUnit={setUnit}
        handleEnterManually={handleEnterManually}
        handleLineToolToggle={handleLineToolToggle}
        handleDrawAreaToggle={handleDrawAreaToggle}
        setShowSideLengths={setShowSideLengths}
        useInteriorWalls={useInteriorWalls}
        handleInteriorWallToggle={handleInteriorWallToggle}
        handleRestart={handleRestart}
      />
    );
  }

  // Desktop UI
  return (
    <div className="flex flex-col h-screen bg-white">
      {/* Title Bar */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 px-6 py-3 shadow-sm">
        <div 
          className="flex items-center gap-3 cursor-pointer hover:opacity-80 transition-opacity w-fit"
          onClick={handleRestart}
          title="Restart FloorTrace"
        >
          <img src={`${import.meta.env.BASE_URL}favicon-32x32.png`} alt="FloorTrace" className="w-8 h-8" />
          <h1 className="text-xl font-semibold text-white tracking-tight">FloorTrace</h1>
        </div>
      </header>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-6 py-4 bg-slate-50 border-b border-slate-200 flex-wrap">
        
        {/* Left Group */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={isProcessing}
          >
            Load Image
          </button>

          <button
            onClick={handleSaveImage}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image}
          >
            Save Image
          </button>
        </div>
        
        {/* Center Group */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleFindRoom}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image || isProcessing}
          >
            Find Room
          </button>
          
          <button
            onClick={handleTracePerimeter}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image || isProcessing}
          >
            Trace Perimeter
          </button>
          
          <button
            onClick={handleManualMode}
            className={`px-5 py-2.5 text-sm font-medium rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 ${
              mode === 'manual' 
                ? 'bg-slate-700 text-white hover:bg-slate-600' 
                : 'text-slate-700 bg-white hover:bg-slate-700 hover:text-white disabled:hover:bg-white disabled:hover:text-slate-700'
            }`}
            disabled={!image || isProcessing}
          >
            Manual Mode
          </button>
        </div>
        
        {/* Right Group */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleFitToWindow}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image}
          >
            Fit to Window
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="relative flex-1 overflow-hidden min-h-0">
        {/* Canvas fills all available space */}
        <Canvas
          ref={canvasRef}
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
          isMobile={false}
        />

        {/* Sidebar overlay (flush to edges) */}
        <div ref={sidebarRef} className="absolute top-0 left-0 z-10 m-0">
          <Sidebar
            roomDimensions={roomDimensions}
            setRoomDimensions={setRoomDimensions}
            area={area}
            onDimensionsChange={(dims) => {
              setRoomDimensions(dims);
              if (roomOverlay) {
                updateScale(dims, roomOverlay);
              }
            }}
            mode={mode}
            manualEntryMode={manualEntryMode}
            detectedDimensions={detectedDimensions}
            onEnterManually={handleEnterManually}
            unit={unit}
            onUnitChange={setUnit}
          />
        </div>

        {/* Area Display Box - positioned to the right of sidebar */}
        <div className="absolute top-0 left-64 z-10 m-0">
          <div 
            className="bg-slate-50 border-r border-b border-slate-200 p-4 shadow-sm w-48 flex flex-col gap-6 self-start"
            style={{ height: sidebarHeight > 0 ? `${sidebarHeight}px` : 'auto' }}
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Area</h2>
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <div className="text-2xl font-bold text-slate-800">
                  {area > 0 ? Math.round(area).toLocaleString() : '0'} ft²
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Measurement Options Panel - positioned to the right of area box, only visible when scale is known */}
        {scale > 1 && (
          <div className="absolute top-0 left-[28rem] z-10 m-0">
            <div 
              className="bg-slate-50 border-r border-b border-slate-200 p-4 shadow-sm w-56 flex flex-col gap-4 self-start"
              style={{ height: sidebarHeight > 0 ? `${sidebarHeight}px` : 'auto' }}
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Measurement Options</h2>
                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col gap-4">
                  
                  {/* Line Tool Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Line Tool</span>
                    <button
                      onClick={handleLineToolToggle}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
                        lineToolActive ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                          lineToolActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Draw Area Tool Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-slate-700">Draw Area</span>
                    <button
                      onClick={handleDrawAreaToggle}
                      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
                        drawAreaActive ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                          drawAreaActive ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Show Side Lengths Toggle - only when perimeter exists */}
                  {perimeterOverlay && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Show Lengths</span>
                      <button
                        onClick={() => setShowSideLengths(!showSideLengths)}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
                          showSideLengths ? 'bg-slate-700' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                            showSideLengths ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  )}

                  {/* Exterior Walls Toggle - only when perimeter exists */}
                  {perimeterOverlay && (
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-slate-700">Exterior Walls</span>
                      <button
                        onClick={() => handleInteriorWallToggle({ target: { checked: !useInteriorWalls } })}
                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-2 ${
                          !useInteriorWalls ? 'bg-slate-700' : 'bg-slate-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform duration-200 ${
                            !useInteriorWalls ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  )}

                </div>
              </div>
            </div>
          </div>
        )}
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
}

export default App;
