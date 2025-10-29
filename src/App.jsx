import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import Canvas from './components/Canvas';
import Sidebar from './components/Sidebar';
import MobileUI from './components/MobileUI';
import { loadImageFromFile, loadImageFromClipboard } from './utils/imageLoader';
import { calculateArea } from './utils/areaCalculator';
import FloorTraceLogo from './assets/logo.svg';

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
  const [cornerPoints, setCornerPoints] = useState([]); // Store detected corner points for snapping
  const [mobileSheetOpen, setMobileSheetOpen] = useState(true);
  const [manualEntryMode, setManualEntryMode] = useState(false); // User entering dimensions manually
  const [ocrFailed, setOcrFailed] = useState(false); // Track if OCR failed in manual mode
  const [unit, setUnit] = useState('decimal'); // 'decimal' or 'inches'
  
  // Detect mobile device on mount (Android/iPhone only)
  const isMobile = useMemo(() => /Android|iPhone/i.test(navigator.userAgent), []);
  const [sidebarHeight, setSidebarHeight] = useState(0);
  const [lineToolActive, setLineToolActive] = useState(false);
  const [measurementLines, setMeasurementLines] = useState([]); // Array of { start, end }
  const [currentMeasurementLine, setCurrentMeasurementLine] = useState(null); // The line currently being drawn
  const [drawAreaActive, setDrawAreaActive] = useState(false);
  const [customShapes, setCustomShapes] = useState([]); // Array of { vertices, closed, area }
  const [currentCustomShape, setCurrentCustomShape] = useState(null); // The shape currently being drawn
  const [perimeterVertices, setPerimeterVertices] = useState(null); // Vertices being placed in manual mode (null = not active, [] = active)
  const [lastAction, setLastAction] = useState(null); // Track last action for undo/redo
  const [notification, setNotification] = useState({ show: false, message: '' });
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
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setDrawAreaActive(false);
    setCustomShapes([]);
    setCurrentCustomShape(null);
    setPerimeterVertices(null);
    setLastAction(null);
  }, []);

  // Reset entire application
  const handleRestart = () => {
    setImage(null);
    resetOverlays();
  };

  // Handle file upload
  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        // Clear existing image before loading new one to ensure state change
        setImage(null);
        // Clear overlays as well
        resetOverlays();

        const loadedImage = await loadImageFromFile(file);
        setImage(loadedImage);
        handleManualMode(loadedImage); // Automatically enter manual mode
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
  }, [resetOverlays, handleManualMode]);

  // Handle clipboard paste
  const handlePasteImage = useCallback(async () => {
    try {
      // Clear existing image before loading new one to ensure state change
      setImage(null);
      // Clear overlays as well
      resetOverlays();

      const loadedImage = await loadImageFromClipboard();
      if (loadedImage) {
        setImage(loadedImage);
        handleManualMode(loadedImage); // Automatically enter manual mode
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      alert('Failed to paste image. Make sure an image is copied to your clipboard.');
    }
  }, [resetOverlays, handleManualMode]);

  // Handle find room - disabled until automatic detection is rewritten
  const handleFindRoom = async () => {
    alert('Automatic room detection feature coming soon! Please use Manual Mode for now.');
  };

  // Handle trace perimeter - placeholder for future implementation
  const handleTracePerimeter = async () => {
    setNotification({ show: true, message: 'Coming Soon' });
    setTimeout(() => setNotification({ show: false, message: '' }), 2000);
  };

  // Handle manual mode
  const handleManualMode = useCallback(async (imgSrc = image) => {
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
      
      if (!imgSrc) {
        alert('Please load an image first');
        return;
      }
      
      setIsProcessing(true);
      setMode('manual');
      setManualEntryMode(false);
      setOcrFailed(false);
      
      try {
        const { detectAllDimensions } = await import('./utils/DimensionsOCR');
        const result = await detectAllDimensions(imgSrc);
        
        // Handle new return format (object with dimensions and detectedFormat)
        const dimensions = result.dimensions || result || [];
        const detectedFormat = result.detectedFormat;
        
        console.log('Manual Mode - Result:', { dimensions: dimensions.length, detectedFormat, currentUnit: unit });
        
        console.log('Manual Mode - Dimensions received:', dimensions.length);
        setDetectedDimensions(dimensions);
        
        if (dimensions.length === 0) {
          // OCR failed - automatically create 200x200 room overlay at center
          setOcrFailed(true);
          setNotification({ show: true, message: 'No dimensions found. Please enter manually.' });
          setTimeout(() => setNotification({ show: false, message: '' }), 3000);

          // Get image dimensions to center the overlay
          const img = new Image();
          img.onload = () => {
            const centerX = img.width / 2;
            const centerY = img.height / 2;

            // Create 200x200 room overlay at center
            const newRoomOverlay = {
              x1: centerX - 100,
              y1: centerY - 100,
              x2: centerX + 100,
              y2: centerY + 100
            };

            setRoomOverlay(newRoomOverlay);
            setPerimeterVertices([]);
            setMode('normal');
          };
          img.src = imgSrc;
        } else {
          // OCR succeeded - clear the failed flag
          setOcrFailed(false);
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
        // OCR failed - automatically create 200x200 room overlay at center
        setOcrFailed(true);
        setNotification({ show: true, message: 'Error detecting dimensions. Please enter manually.' });
        setTimeout(() => setNotification({ show: false, message: '' }), 3000);

        // Get image dimensions to center the overlay
        const img = new Image();
        img.onload = () => {
          const centerX = img.width / 2;
          const centerY = img.height / 2;

          // Create 200x200 room overlay at center
          const newRoomOverlay = {
            x1: centerX - 100,
            y1: centerY - 100,
            x2: centerX + 100,
            y2: centerY + 100
          };

          setRoomOverlay(newRoomOverlay);
          setPerimeterVertices([]);
          setMode('normal');
        };
        img.src = imgSrc;
      } finally {
        setIsProcessing(false);
      }
    }
  }, [image, mode, roomOverlay, perimeterOverlay, unit]);

  // Handle manual dimension entry button click
  const handleEnterManually = () => {
    setManualEntryMode(true);
    setDetectedDimensions([]); // Clear detected dimensions
  };

  // Handle interior/exterior wall toggle - placeholder for future implementation
  const handleInteriorWallToggle = (e) => {
    const newValue = e.target.checked;
    setUseInteriorWalls(newValue);
    // TODO: Re-implement perimeter detection when automatic tracing is restored
  };

  // Handle fit to window
  const handleFitToWindow = () => {
    if (canvasRef.current) {
      canvasRef.current.fitToWindow();
    }
  };

  // Toggle line tool
  const handleLineToolToggle = () => {
    const newState = !lineToolActive;
    setLineToolActive(newState);
    if (newState) {
      // Deactivate draw area tool when line tool is activated
      setDrawAreaActive(false);
      setCurrentCustomShape(null); // Stop drawing custom shape
    } else {
      setCurrentMeasurementLine(null); // Stop drawing line
    }
  };

  // Toggle draw area tool
  const handleDrawAreaToggle = () => {
    const newState = !drawAreaActive;
    setDrawAreaActive(newState);
    if (newState) {
      // Deactivate line tool when draw area tool is activated
      setLineToolActive(false);
      setCurrentMeasurementLine(null); // Stop drawing line
    } else {
      setCurrentCustomShape(null); // Stop drawing custom shape
    }
  };

  // Clear all lines and custom shapes
  const handleClearTools = () => {
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setCustomShapes([]);
    setCurrentCustomShape(null);
  };

  // Handle save image (screenshot entire app)
  const handleSaveImage = async () => {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const appElement = document.getElementById('app-container');
      if (!appElement) {
        alert('Could not capture screenshot');
        return;
      }

      const canvas = await html2canvas(appElement, {
        backgroundColor: '#ffffff',
        scale: 2,
        logging: false,
        useCORS: true,
        // Ensure all elements are rendered
        scrollX: 0,
        scrollY: -window.scrollY,
        windowWidth: document.documentElement.offsetWidth,
        windowHeight: document.documentElement.offsetHeight,
      });

      canvas.toBlob((blob) => {
        if (!blob) {
          alert('Failed to create image');
          return;
        }
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
        link.download = `floortrace-${timestamp}.webp`;
        link.href = url;
        link.click();
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
    
    // If perimeter already exists, recalculate area with new scale (only if room overlay exists)
    if (perimeterOverlay && perimeterOverlay.vertices && overlay) {
      const calculatedArea = calculateArea(perimeterOverlay.vertices, newScale);
      setArea(calculatedArea);
    }
  };

  // Update room overlay position
  const updateRoomOverlay = (overlay, saveAction = true, previousState = null) => {
    if (saveAction && roomOverlay) {
      setLastAction({
        type: 'updateRoom',
        previousState: previousState || roomOverlay,
        currentState: overlay,
        isUndone: false
      });
    }
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay);
    }
  };

  // Update perimeter vertices
  const updatePerimeterVertices = (vertices, saveAction = true, previousState = null) => {
    if (saveAction && perimeterOverlay && perimeterOverlay.vertices) {
      setLastAction({
        type: 'updatePerimeter',
        previousState: previousState ? [...previousState] : [...perimeterOverlay.vertices],
        currentState: [...vertices],
        isUndone: false
      });
    }
    setPerimeterOverlay({ ...perimeterOverlay, vertices });
    // Only calculate area if room overlay exists
    if (roomOverlay) {
      const calculatedArea = calculateArea(vertices, scale);
      setArea(calculatedArea);
    } else {
      setArea(0);
    }
  };

  // Handle adding perimeter vertex in manual mode
  const handleAddPerimeterVertex = (vertex) => {
    const newVertices = [...perimeterVertices, vertex];
    
    // Save action for undo
    setLastAction({
      type: 'addVertex',
      previousState: [...perimeterVertices],
      currentState: newVertices,
      isUndone: false
    });
    
    setPerimeterVertices(newVertices);

    // Update the perimeter overlay in real-time
    if (newVertices.length > 0) {
      setPerimeterOverlay({ vertices: newVertices });
    }

  };

  // Handle closing the perimeter
  const handleClosePerimeter = () => {
    if (perimeterVertices && perimeterVertices.length > 2) {
      setPerimeterOverlay({ vertices: perimeterVertices });
      if (roomOverlay) {
        const calculatedArea = calculateArea(perimeterVertices, scale);
        setArea(calculatedArea);
      } else {
        setArea(0);
      }
      setPerimeterVertices(null); // Exit vertex placement mode
    }
  };

  // Handle removing last perimeter vertex in manual mode (only used by right-click during vertex placement)
  const handleRemovePerimeterVertex = () => {
    if (perimeterVertices && perimeterVertices.length > 0) {
      const newVertices = perimeterVertices.slice(0, -1);
      setLastAction({
        type: 'removeVertex',
        previousState: [...perimeterVertices],
        currentState: newVertices,
        isUndone: false
      });
      setPerimeterVertices(newVertices);
    }
  };
  
  // Handle undo/redo with right-click
  const handleUndoRedo = () => {
    if (!lastAction) return false;
    
    const isCurrentlyUndone = lastAction.isUndone;
    
    if (!isCurrentlyUndone) {
      // Perform undo - revert to previous state
      switch (lastAction.type) {
        case 'addVertex':
        case 'removeVertex':
          setPerimeterVertices(lastAction.previousState);
          break;
        case 'updatePerimeter':
          // Use the update function with saveAction=false to avoid creating new action
          updatePerimeterVertices(lastAction.previousState, false);
          break;
        case 'updateRoom':
          // Use the update function with saveAction=false to avoid creating new action
          updateRoomOverlay(lastAction.previousState, false);
          break;
        case 'updateCustomShape':
          setCustomShapes(lastAction.previousState);
          break;
      }
      setLastAction({ ...lastAction, isUndone: true });
    } else {
      // Perform redo - apply current state
      switch (lastAction.type) {
        case 'addVertex':
        case 'removeVertex':
          setPerimeterVertices(lastAction.currentState);
          break;
        case 'updatePerimeter':
          // Use the update function with saveAction=false to avoid creating new action
          updatePerimeterVertices(lastAction.currentState, false);
          break;
        case 'updateRoom':
          // Use the update function with saveAction=false to avoid creating new action
          updateRoomOverlay(lastAction.currentState, false);
          break;
        case 'updateCustomShape':
          setCustomShapes(lastAction.currentState);
          break;
      }
      setLastAction({ ...lastAction, isUndone: false });
    }
    
    return true;
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
    
    // Don't create perimeter overlay - user will click to add vertices
    setPerimeterVertices([]);
    
    // Exit manual mode after selection but stay in vertex placement mode
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
    
    // Don't create perimeter overlay - user will click to add vertices
    setPerimeterVertices([]);
    
    // Exit manual entry mode
    setManualEntryMode(false);
    setMode('normal');
  };

  // Auto-load example floorplan for testing (temporary)
  useEffect(() => {
    const loadExampleImage = async () => {
      try {
        console.log('Loading ExampleFloorplan.png for testing...');
        const response = await fetch('./ExampleFloorplan.png');
        const blob = await response.blob();

        // Create file object
        const file = new File([blob], 'ExampleFloorplan.png', { type: 'image/png' });

        // Use the existing file upload logic
        const loadedImage = await loadImageFromFile(file);
        setImage(loadedImage);
        console.log('ExampleFloorplan.png loaded successfully');
      } catch (error) {
        console.error('Failed to load example image:', error);
        // Don't show error to user for now - it's temporary testing code
      }
    };

    loadExampleImage();
  }, []);

  // Automatically detect lines and calculate intersections when image is loaded for snapping support
  // DISABLED: Line detection utilities (lineDetector, snappingHelper) don't exist yet
  useEffect(() => {
    const detectLinesForSnapping = async () => {
      if (!image) {
        setCornerPoints([]);
        setLineData(null);
        return;
      }

      // TODO: Re-implement when line detection utilities are available
      console.log('Line detection for snapping disabled until utilities are rewritten');
      setCornerPoints([]);
      setLineData(null);
    };

    detectLinesForSnapping();
  }, [image]);

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
        measurementLines={measurementLines}
        currentMeasurementLine={currentMeasurementLine}
        onMeasurementLineUpdate={setCurrentMeasurementLine}
        onAddMeasurementLine={(line) => setMeasurementLines(prev => [...prev, line])}
        drawAreaActive={drawAreaActive}
        customShapes={customShapes}
        currentCustomShape={currentCustomShape}
        onCustomShapeUpdate={setCurrentCustomShape}
        onAddCustomShape={(shape) => setCustomShapes(prev => [...prev, shape])}
        area={area}
        lineData={lineData}
        cornerPoints={cornerPoints}
        mobileSheetOpen={mobileSheetOpen}
        setMobileSheetOpen={setMobileSheetOpen}
        fileInputRef={fileInputRef}
        handleFileUpload={handleFileUpload}
        handleFindRoom={handleFindRoom}
        handleManualMode={handleManualMode}
        handleFitToWindow={handleFitToWindow}
        roomDimensions={roomDimensions}
        setRoomDimensions={setRoomDimensions}
        setUnit={setUnit}
        handleLineToolToggle={handleLineToolToggle}
        handleDrawAreaToggle={handleDrawAreaToggle}
        setShowSideLengths={setShowSideLengths}
        useInteriorWalls={useInteriorWalls}
        handleInteriorWallToggle={handleInteriorWallToggle}
        handleRestart={handleRestart}
        perimeterVertices={perimeterVertices}
        onAddPerimeterVertex={handleAddPerimeterVertex}
        onRemovePerimeterVertex={handleRemovePerimeterVertex}
        onUndoRedo={handleUndoRedo}
        ocrFailed={ocrFailed}
      />
    );
  }

  // Desktop UI
  return (
    <div id="app-container" className="flex flex-col h-screen bg-white">
      {/* Title Bar */}
      <header className="bg-gradient-to-r from-slate-800 to-slate-700 border-b border-slate-600 px-6 py-3 shadow-sm">
        <div 
          className="flex items-center gap-3 hover:opacity-80 transition-opacity w-fit cursor-pointer select-none"
          onClick={handleRestart}
          title="Restart FloorTrace"
        >
          <img src={FloorTraceLogo} alt="FloorTrace Logo" className="w-8 h-8" />
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
          {/* Add other tools here later */}
        </div>
        
        {/* Right Group */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTracePerimeter}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image || isProcessing}
          >
            Find Perimeter
          </button>
          <button
            onClick={handleFitToWindow}
            className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-slate-700 hover:text-white rounded-md transition-colors duration-200 shadow-sm disabled:opacity-40 disabled:hover:bg-white disabled:hover:text-slate-700"
            disabled={!image}
          >
            Fit to Window
          </button>

          {/* Conditionally render Clear button */}
          {(measurementLines.length > 0 || customShapes.length > 0 || currentMeasurementLine || currentCustomShape) && (
            <button
              onClick={handleClearTools}
              className="px-5 py-2.5 text-sm font-medium text-slate-700 bg-white hover:bg-red-500 hover:text-white rounded-md transition-colors duration-200 shadow-sm"
            >
              Clear
            </button>
          )}
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
          measurementLines={measurementLines}
          currentMeasurementLine={currentMeasurementLine}
          onMeasurementLineUpdate={setCurrentMeasurementLine}
          onAddMeasurementLine={(line) => setMeasurementLines(prev => [...prev, line])}
          drawAreaActive={drawAreaActive}
          customShapes={customShapes}
          currentCustomShape={currentCustomShape}
          onCustomShapeUpdate={setCurrentCustomShape}
          onAddCustomShape={(shape) => setCustomShapes(prev => [...prev, shape])}
          isMobile={false}
          lineData={lineData}
          cornerPoints={cornerPoints}
          perimeterVertices={perimeterVertices}
          onAddPerimeterVertex={handleAddPerimeterVertex}
          onClosePerimeter={handleClosePerimeter}
          onRemovePerimeterVertex={handleRemovePerimeterVertex}
          onUndoRedo={handleUndoRedo}
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
            isProcessing={isProcessing}
            ocrFailed={ocrFailed}
          />
        </div>

        {/* Notification Popup */}
        {notification.show && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 bg-slate-800 text-white text-sm font-medium px-4 py-2 rounded-md shadow-lg animate-fade-in-out">
            {notification.message}
          </div>
        )}

        {/* Area Display Box - positioned to the right of sidebar */}
        <div className="absolute top-0 left-64 z-10 m-0">
          <div 
            className="bg-slate-50 border-r border-b border-slate-200 p-4 shadow-sm w-48 flex flex-col gap-6 self-start"
            style={{ height: sidebarHeight > 0 ? `${sidebarHeight}px` : 'auto' }}
          >
            <div>
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Area</h2>
              <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm">
                <div 
                  className="font-bold text-slate-800 whitespace-nowrap"
                  style={{
                    fontSize: (() => {
                      const areaText = area > 0 ? Math.round(area).toLocaleString() : '0';
                      const length = areaText.length;
                      if (length <= 7) return '1.5rem'; // text-2xl (24px)
                      if (length <= 9) return '1.25rem'; // text-xl (20px)
                      if (length <= 11) return '1.125rem'; // text-lg (18px)
                      return '1rem'; // text-base (16px)
                    })()
                  }}
                >
                  {area > 0 ? Math.round(area).toLocaleString() : '0'} ft²
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Options Panel - positioned to the right of area box, only visible when perimeter exists */}
        {perimeterOverlay && (
          <div className="absolute top-0 left-[28rem] z-10 m-0">
            <div 
              className="bg-slate-50 border-r border-b border-slate-200 p-4 shadow-sm w-48 flex flex-col gap-4 self-start"
              style={{ height: sidebarHeight > 0 ? `${sidebarHeight}px` : 'auto' }}
            >
              <div>
                <h2 className="text-sm font-semibold text-slate-700 mb-3">Options</h2>
                <div className="bg-white border border-slate-200 rounded-lg p-4 shadow-sm flex flex-col gap-2.5">
                  
                  {/* Show Side Lengths Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Show Lengths</span>
                    <button
                      onClick={() => setShowSideLengths(!showSideLengths)}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 ${
                        showSideLengths ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 ${
                          showSideLengths ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Exterior Walls Toggle */}
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-700">Exterior Walls</span>
                    <button
                      onClick={() => handleInteriorWallToggle({ target: { checked: !useInteriorWalls } })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-slate-400 focus:ring-offset-1 ${
                        !useInteriorWalls ? 'bg-slate-700' : 'bg-slate-300'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform duration-200 ${
                          !useInteriorWalls ? 'translate-x-5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                </div>
              </div>
            </div>
          </div>
        )}

        {/* Measurement Tool Buttons - positioned to the right of options panel, only visible when area is calculated */}
        {area > 0 && (
          <div className="absolute top-4 z-10 m-0 flex flex-col gap-2.5" style={{ left: 'calc(28rem + 12rem + 0.625rem)' }}>
            {/* Line Tool Button */}
            <button
              onClick={handleLineToolToggle}
              className={`w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 shadow-sm ${
                lineToolActive 
                  ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white shadow-md scale-105' 
                  : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600 border border-slate-200'
              }`}
              title="Measure distances"
            >
              <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="6" y1="26" x2="26" y2="6" />
                <circle cx="6" cy="26" r="3" fill="currentColor" stroke="none" />
                <circle cx="26" cy="6" r="3" fill="currentColor" stroke="none" />
              </svg>
            </button>

            {/* Draw Area Tool Button */}
            <button
              onClick={handleDrawAreaToggle}
              className={`w-12 h-12 flex items-center justify-center rounded-lg transition-all duration-200 shadow-sm ${
                drawAreaActive 
                  ? 'bg-gradient-to-r from-slate-800 to-slate-700 text-white shadow-md scale-105' 
                  : 'bg-white text-slate-400 hover:bg-slate-50 hover:text-slate-600 border border-slate-200'
              }`}
              title="Draw custom area"
            >
              <svg className="w-6 h-6" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M16 4 L28 11 L24 26 L8 26 L4 11 Z" />
                <circle cx="16" cy="4" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="28" cy="11" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="24" cy="26" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="8" cy="26" r="2.5" fill="currentColor" stroke="none" />
                <circle cx="4" cy="11" r="2.5" fill="currentColor" stroke="none" />
              </svg>
            </button>
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
