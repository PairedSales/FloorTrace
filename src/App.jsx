import { useState, useRef, useEffect, useCallback } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import ToolsPanel from './components/ToolsPanel';
import { loadImageFromFile, loadImageFromClipboard } from './utils/imageLoader';
import { calculateArea } from './utils/areaCalculator';
import {
  detectRoomFromClick,
  getBoundaryForMode,
  traceFloorplanBoundary,
  terminateDetectionWorker,
} from './utils/detection';

const LOCAL_DRAFT_STORAGE_KEY = 'floortrace:autosave:v1';

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
  const [autoSnapEnabled, setAutoSnapEnabled] = useState(true);
  const [manualEntryMode, setManualEntryMode] = useState(false); // User entering dimensions manually
  const [ocrFailed, setOcrFailed] = useState(false); // Track if OCR failed in manual mode
  const [unit, setUnit] = useState('decimal'); // 'decimal' or 'inches'
  
  const [lineToolActive, setLineToolActive] = useState(false);
  const [measurementLines, setMeasurementLines] = useState([]); // Array of { start, end }
  const [currentMeasurementLine, setCurrentMeasurementLine] = useState(null); // The line currently being drawn
  const [drawAreaActive, setDrawAreaActive] = useState(false);
  const [customShapes, setCustomShapes] = useState([]); // Array of { vertices, closed, area }
  const [currentCustomShape, setCurrentCustomShape] = useState(null); // The shape currently being drawn
  const [perimeterVertices, setPerimeterVertices] = useState(null); // Vertices being placed in manual mode (null = not active, [] = active)
  const [tracedBoundaries, setTracedBoundaries] = useState(null);
  const [debugDetection, setDebugDetection] = useState(false);
  const [detectionDebugData, setDetectionDebugData] = useState(null);
  const [notification, setNotification] = useState({ show: false, message: '' });
  const [showPanelOptions, setShowPanelOptions] = useState(false);
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const undoStackRef = useRef([]);
  const redoStackRef = useRef([]);
  const appStateRef = useRef({});
  const hasRestoredStateRef = useRef(false);

  const clearAutosavedDraft = useCallback(() => {
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
  }, []);

  const saveAutosavedDraft = useCallback((snapshot) => {
    try {
      localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error('Failed to autosave local draft:', error);
      setNotification({ show: true, message: 'Autosave unavailable (storage full or blocked).' });
      setTimeout(() => setNotification({ show: false, message: '' }), 3000);
    }
  }, []);

  const cloneSnapshot = (value) => {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  };

  const createSnapshot = useCallback(() => cloneSnapshot(appStateRef.current), []);

  const pushUndoState = useCallback(() => {
    if (!image) return;
    undoStackRef.current.push(createSnapshot());
    if (undoStackRef.current.length > 100) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
  }, [createSnapshot, image]);

  const clearHistory = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
  }, []);

  const applySnapshot = useCallback((snapshot) => {
    setRoomOverlay(snapshot.roomOverlay);
    setPerimeterOverlay(snapshot.perimeterOverlay);
    setRoomDimensions(snapshot.roomDimensions);
    setArea(snapshot.area);
    setScale(snapshot.scale);
    setMode(snapshot.mode);
    setManualEntryMode(snapshot.manualEntryMode);
    setOcrFailed(snapshot.ocrFailed);
    setLineToolActive(snapshot.lineToolActive);
    setMeasurementLines(snapshot.measurementLines);
    setCurrentMeasurementLine(snapshot.currentMeasurementLine);
    setDrawAreaActive(snapshot.drawAreaActive);
    setCustomShapes(snapshot.customShapes);
    setCurrentCustomShape(snapshot.currentCustomShape);
    setPerimeterVertices(snapshot.perimeterVertices);
    setTracedBoundaries(snapshot.tracedBoundaries ?? null);
    setDebugDetection(snapshot.debugDetection ?? false);
    setDetectionDebugData(snapshot.detectionDebugData ?? null);
    setShowSideLengths(snapshot.showSideLengths);
    setUseInteriorWalls(snapshot.useInteriorWalls);
    setAutoSnapEnabled(snapshot.autoSnapEnabled ?? true);
    setUnit(snapshot.unit);
  }, []);

  // Reset overlays
  const resetOverlays = useCallback(() => {
    setRoomOverlay(null);
    setPerimeterOverlay(null);
    setRoomDimensions({ width: '', height: '' });
    setArea(0);
    setScale(1);
    setDetectedDimensions([]);
    setMode('normal');
    setManualEntryMode(false);
    setOcrFailed(false);
    setLineToolActive(false);
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setDrawAreaActive(false);
    setCustomShapes([]);
    setCurrentCustomShape(null);
    setPerimeterVertices(null);
    setTracedBoundaries(null);
    setDetectionDebugData(null);
    setAutoSnapEnabled(true);
    clearHistory();
  }, [clearHistory]);

  // Reset entire application
  const handleRestart = () => {
    clearAutosavedDraft();
    setImage(null);
    resetOverlays();
  };

  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return false;
    const previousSnapshot = undoStackRef.current.pop();
    redoStackRef.current.push(createSnapshot());
    applySnapshot(previousSnapshot);
    return true;
  }, [applySnapshot, createSnapshot]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return false;
    const nextSnapshot = redoStackRef.current.pop();
    undoStackRef.current.push(createSnapshot());
    applySnapshot(nextSnapshot);
    return true;
  }, [applySnapshot, createSnapshot]);

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

  const applyTracedBoundary = useCallback((boundaryResult, interiorMode) => {
    const activeBoundary = getBoundaryForMode(boundaryResult, interiorMode);
    if (!activeBoundary?.polygon?.length) {
      return false;
    }

    const vertices = activeBoundary.polygon.map((point) => ({
      x: point.x,
      y: point.y,
    }));
    setPerimeterVertices(null);
    setPerimeterOverlay({ vertices });
    if (roomOverlay) {
      setArea(calculateArea(vertices, scale));
    }
    return true;
  }, [roomOverlay, scale]);

  // Handle trace perimeter using the detection worker.
  const handleTracePerimeter = async () => {
    if (!image) return;

    setIsProcessing(true);
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });

      if (!traced) {
        setNotification({ show: true, message: 'Unable to trace perimeter from this image.' });
        setTimeout(() => setNotification({ show: false, message: '' }), 2500);
        return;
      }

      setTracedBoundaries(traced);
      setDetectionDebugData(traced.debug ?? null);
      const applied = applyTracedBoundary(traced, useInteriorWalls);

      if (!applied) {
        setNotification({ show: true, message: 'No valid perimeter detected.' });
        setTimeout(() => setNotification({ show: false, message: '' }), 2500);
        return;
      }

      setNotification({ show: true, message: `Perimeter detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).` });
      setTimeout(() => setNotification({ show: false, message: '' }), 2200);
    } catch (error) {
      console.error('Perimeter detection failed:', error);
      setNotification({ show: true, message: 'Perimeter detection failed. Try another image region.' });
      setTimeout(() => setNotification({ show: false, message: '' }), 3000);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInteriorWallToggle = (value) => {
    setUseInteriorWalls(value);
    if (tracedBoundaries) {
      applyTracedBoundary(tracedBoundaries, value);
    }
  };

  // Handle fit to window
  const handleFitToWindow = () => {
    if (canvasRef.current) {
      canvasRef.current.fitToWindow();
    }
  };

  // Toggle line tool
  const handleLineToolToggle = () => {
    pushUndoState();
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
    pushUndoState();
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
    pushUndoState();
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setCustomShapes([]);
    setCurrentCustomShape(null);
  };

  const handleAddMeasurementLine = useCallback((line) => {
    pushUndoState();
    setMeasurementLines((prev) => [...prev, line]);
  }, [pushUndoState]);

  const handleMeasurementLinesChange = useCallback((nextLines) => {
    pushUndoState();
    setMeasurementLines(nextLines);
  }, [pushUndoState]);

  const handleAddCustomShape = useCallback((shape) => {
    pushUndoState();
    setCustomShapes((prev) => [...prev, shape]);
  }, [pushUndoState]);

  const handleCustomShapesChange = useCallback((nextShapes) => {
    pushUndoState();
    setCustomShapes(nextShapes);
  }, [pushUndoState]);

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
        onclone: (clonedDoc) => {
          // html2canvas skips background rendering for pointer-events:none elements;
          // remove that style from matched nodes so panels render correctly.
          clonedDoc.querySelectorAll('.pointer-events-none').forEach((el) => {
            el.classList.remove('pointer-events-none');
          });
          clonedDoc.querySelectorAll('[style*="pointer-events"]').forEach((el) => {
            el.style.pointerEvents = '';
          });
        },
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
  const updateRoomOverlay = (overlay, saveAction = true) => {
    if (saveAction) pushUndoState();
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay);
    }
  };

  // Update perimeter vertices
  const updatePerimeterVertices = (vertices, saveAction = true) => {
    if (saveAction) pushUndoState();
    setPerimeterOverlay({ ...perimeterOverlay, vertices });
    if (roomOverlay) {
      const calculatedArea = calculateArea(vertices, scale);
      setArea(calculatedArea);
    } else {
      setArea(0);
    }
  };

  // Handle adding perimeter vertex in manual mode
  const handleAddPerimeterVertex = (vertex) => {
    pushUndoState();
    const newVertices = [...perimeterVertices, vertex];
    setPerimeterVertices(newVertices);

    // Update the perimeter overlay in real-time
    if (newVertices.length > 0) {
      setPerimeterOverlay({ vertices: newVertices });
    }

  };

  // Handle closing the perimeter
  const handleClosePerimeter = () => {
    if (perimeterVertices && perimeterVertices.length > 2) {
      pushUndoState();
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
      pushUndoState();
      const newVertices = perimeterVertices.slice(0, -1);
      setPerimeterVertices(newVertices);
    }
  };

  // Delete a specific perimeter vertex by index (right-click on vertex)
  const handleDeletePerimeterVertex = (index) => {
    if (!perimeterOverlay?.vertices || perimeterOverlay.vertices.length <= 3) return;
    updatePerimeterVertices(
      perimeterOverlay.vertices.filter((_, i) => i !== index),
      true
    );
  };

  // Switch to manual outline drawing: clear the auto-detected perimeter and let the user draw fresh
  const handleManualOutlineMode = () => {
    pushUndoState();
    setPerimeterOverlay(null);
    setArea(0);
    setPerimeterVertices([]); // activate manual vertex placement
  };

  // Auto-trace exterior boundary after room overlay is placed.
  const autoTraceExterior = async (overlayForScale, dims) => {
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });
      if (!traced) return;
      setTracedBoundaries(traced);
      setDetectionDebugData((prev) => ({ ...(prev ?? {}), ...(traced.debug ?? {}) }));

      const activeBoundary = getBoundaryForMode(traced, useInteriorWalls);
      if (!activeBoundary?.polygon?.length) return;

      const vertices = activeBoundary.polygon.map((p) => ({ x: p.x, y: p.y }));
      setPerimeterVertices(null);
      setPerimeterOverlay({ vertices });

      // Calculate area now that we have both room overlay and perimeter
      const dimW = parseFloat(dims.width);
      const dimH = parseFloat(dims.height);
      const oW = Math.abs(overlayForScale.x2 - overlayForScale.x1);
      const oH = Math.abs(overlayForScale.y2 - overlayForScale.y1);
      const autoScale = Math.min(dimW, dimH) / Math.min(oW, oH);
      setArea(calculateArea(vertices, autoScale));

      setNotification({ show: true, message: `Perimeter auto-detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).` });
      setTimeout(() => setNotification({ show: false, message: '' }), 2500);
    } catch (error) {
      console.error('Auto exterior tracing failed:', error);
      // Non-fatal — user can still trace manually
    }
  };

  // Handle dimension selection in manual mode
  const handleDimensionSelect = async (dimension) => {
    const dims = {
      width: dimension.width.toString(),
      height: dimension.height.toString(),
    };
    setRoomDimensions(dims);

    const centerX = dimension.bbox.x + dimension.bbox.width / 2;
    const centerY = dimension.bbox.y + dimension.bbox.height / 2;
    let nextOverlay = {
      x1: centerX - 100,
      y1: centerY - 100,
      x2: centerX + 100,
      y2: centerY + 100,
    };

    try {
      const roomResult = await detectRoomFromClick(image, { x: centerX, y: centerY }, {
        preprocess: { maxDimension: 1300 },
      });

      if (roomResult?.overlay) {
        nextOverlay = {
          ...roomResult.overlay,
          polygon: roomResult.polygon,
          confidence: roomResult.confidence,
        };
        setDetectionDebugData(roomResult.debug ?? null);
      }
    } catch (error) {
      console.error('Room enclosure detection failed:', error);
    }

    setRoomOverlay(nextOverlay);
    updateScale(dims, nextOverlay);

    setPerimeterVertices(null);
    setMode('normal');
    setDetectedDimensions([]);
    setManualEntryMode(false);

    // Automatically detect exterior boundary after room overlay is placed.
    autoTraceExterior(nextOverlay, dims);
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
    
    const fallbackOverlay = {
      x1: clickPoint.x - 100,
      y1: clickPoint.y - 100,
      x2: clickPoint.x + 100,
      y2: clickPoint.y + 100
    };

    const placeOverlay = async () => {
      let nextOverlay = fallbackOverlay;
      try {
        const roomResult = await detectRoomFromClick(image, clickPoint, {
          preprocess: { maxDimension: 1300 },
        });
        if (roomResult?.overlay) {
          nextOverlay = {
            ...roomResult.overlay,
            polygon: roomResult.polygon,
            confidence: roomResult.confidence,
          };
          setDetectionDebugData(roomResult.debug ?? null);
        }
      } catch (error) {
        console.error('Manual room detection fallback failed:', error);
      }

      setRoomOverlay(nextOverlay);
      updateScale(roomDimensions, nextOverlay);
      setPerimeterVertices(null);
      setManualEntryMode(false);
      setMode('normal');

      // Automatically detect exterior boundary after manual overlay placement.
      autoTraceExterior(nextOverlay, roomDimensions);
    };

    placeOverlay();
  };

  // Restore locally autosaved data first, otherwise auto-load example floorplan for testing
  useEffect(() => {
    const restoreOrLoadExampleImage = async () => {
      try {
        const savedStateRaw = localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY);
        if (savedStateRaw) {
          const savedState = JSON.parse(savedStateRaw);
          if (savedState?.image) {
            setImage(savedState.image);
            setRoomOverlay(savedState.roomOverlay ?? null);
            setPerimeterOverlay(savedState.perimeterOverlay ?? null);
            setRoomDimensions(savedState.roomDimensions ?? { width: '', height: '' });
            setArea(savedState.area ?? 0);
            setScale(savedState.scale ?? 1);
            setMode(savedState.mode ?? 'normal');
            setIsProcessing(false);
            setDetectedDimensions(savedState.detectedDimensions ?? []);
            setShowSideLengths(savedState.showSideLengths ?? false);
            setUseInteriorWalls(savedState.useInteriorWalls ?? true);
            setAutoSnapEnabled(savedState.autoSnapEnabled ?? true);
            setManualEntryMode(savedState.manualEntryMode ?? false);
            setOcrFailed(savedState.ocrFailed ?? false);
            setUnit(savedState.unit ?? 'decimal');
            setLineToolActive(savedState.lineToolActive ?? false);
            setMeasurementLines(savedState.measurementLines ?? []);
            setCurrentMeasurementLine(savedState.currentMeasurementLine ?? null);
            setDrawAreaActive(savedState.drawAreaActive ?? false);
            setCustomShapes(savedState.customShapes ?? []);
            setCurrentCustomShape(savedState.currentCustomShape ?? null);
            setPerimeterVertices(savedState.perimeterVertices ?? null);
            setTracedBoundaries(savedState.tracedBoundaries ?? null);
            setDebugDetection(savedState.debugDetection ?? false);
            setDetectionDebugData(savedState.detectionDebugData ?? null);
            hasRestoredStateRef.current = true;
            return;
          }
        }
      } catch (error) {
        console.error('Failed to restore autosaved draft:', error);
      }

      try {
        console.log('Loading ExampleFloorplan.png for testing...');
        const response = await fetch('./ExampleFloorplan.png');
        const blob = await response.blob();

        // Create file object
        const file = new File([blob], 'ExampleFloorplan.png', { type: 'image/png' });

        // Use the existing file upload logic
        const loadedImage = await loadImageFromFile(file);
        setImage(loadedImage);
        hasRestoredStateRef.current = true;
        console.log('ExampleFloorplan.png loaded successfully');
      } catch (error) {
        console.error('Failed to load example image:', error);
        // Don't show error to user for now - it's temporary testing code
      } finally {
        hasRestoredStateRef.current = true;
      }
    };

    restoreOrLoadExampleImage();
  }, []);

  useEffect(() => {
    appStateRef.current = {
      roomOverlay,
      perimeterOverlay,
      roomDimensions,
      area,
      scale,
      mode,
      manualEntryMode,
      ocrFailed,
      lineToolActive,
      measurementLines,
      currentMeasurementLine,
      drawAreaActive,
      customShapes,
      currentCustomShape,
      perimeterVertices,
      tracedBoundaries,
      debugDetection,
      detectionDebugData,
      showSideLengths,
      useInteriorWalls,
      autoSnapEnabled,
      unit
    };
  }, [roomOverlay, perimeterOverlay, roomDimensions, area, scale, mode, manualEntryMode, ocrFailed, lineToolActive, measurementLines, currentMeasurementLine, drawAreaActive, customShapes, currentCustomShape, perimeterVertices, tracedBoundaries, debugDetection, detectionDebugData, showSideLengths, useInteriorWalls, autoSnapEnabled, unit]);

  // Autosave draft to local storage when working state changes.
  useEffect(() => {
    if (!hasRestoredStateRef.current) {
      return;
    }

    if (!image) {
      clearAutosavedDraft();
      return;
    }

    saveAutosavedDraft({
      image,
      roomOverlay,
      perimeterOverlay,
      roomDimensions,
      area,
      scale,
      mode,
      detectedDimensions,
      showSideLengths,
      useInteriorWalls,
      autoSnapEnabled,
      manualEntryMode,
      ocrFailed,
      unit,
      lineToolActive,
      measurementLines,
      currentMeasurementLine,
      drawAreaActive,
      customShapes,
      currentCustomShape,
      perimeterVertices,
      tracedBoundaries,
      debugDetection,
      detectionDebugData
    });
  }, [image, roomOverlay, perimeterOverlay, roomDimensions, area, scale, mode, detectedDimensions, showSideLengths, useInteriorWalls, autoSnapEnabled, manualEntryMode, ocrFailed, unit, lineToolActive, measurementLines, currentMeasurementLine, drawAreaActive, customShapes, currentCustomShape, perimeterVertices, tracedBoundaries, debugDetection, detectionDebugData, clearAutosavedDraft, saveAutosavedDraft]);

  useEffect(() => () => terminateDetectionWorker(), []);

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();

        switch (key) {
          case 'v':
            e.preventDefault();
            handlePasteImage();
            break;
          case 'o':
            e.preventDefault();
            fileInputRef.current?.click();
            break;
          case 'z':
            e.preventDefault();
            if (e.shiftKey) {
              handleRedo();
            } else {
              handleUndo();
            }
            break;
          case 'y':
            e.preventDefault();
            handleRedo();
            break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handlePasteImage, handleRedo, handleUndo]);

  // Handle side mouse buttons for undo (button 3 = back) and redo (button 4 = forward)
  useEffect(() => {
    const handleMouseDown = (e) => {
      if (e.button === 3) {
        e.preventDefault();
        handleUndo();
      } else if (e.button === 4) {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [handleUndo, handleRedo]);

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

  // Desktop UI
  return (
    <div id="app-container" className="flex flex-col h-screen bg-chrome-900">
      <Toolbar
        image={image}
        isProcessing={isProcessing}
        measurementLines={measurementLines}
        customShapes={customShapes}
        currentMeasurementLine={currentMeasurementLine}
        currentCustomShape={currentCustomShape}
        onFileOpen={() => fileInputRef.current?.click()}
        onSaveImage={handleSaveImage}
        onTracePerimeter={handleTracePerimeter}
        onFitToWindow={handleFitToWindow}
        onClearTools={handleClearTools}
        onRestart={handleRestart}
        showPanelOptions={showPanelOptions}
        onOptionsToggle={() => setShowPanelOptions((v) => !v)}
        hasAutoDetection={!!tracedBoundaries}
        onManualMode={handleManualOutlineMode}
        perimeterOverlay={perimeterOverlay}
      />

      <div className="relative flex flex-1 overflow-hidden min-h-0 canvas-grid-bg">
        <div className="absolute inset-0 z-0 min-h-0">
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
            onAddMeasurementLine={handleAddMeasurementLine}
            onMeasurementLinesChange={handleMeasurementLinesChange}
            drawAreaActive={drawAreaActive}
            customShapes={customShapes}
            currentCustomShape={currentCustomShape}
            onCustomShapeUpdate={setCurrentCustomShape}
            onAddCustomShape={handleAddCustomShape}
            onCustomShapesChange={handleCustomShapesChange}
            perimeterVertices={perimeterVertices}
            onAddPerimeterVertex={handleAddPerimeterVertex}
            onClosePerimeter={handleClosePerimeter}
            autoSnapEnabled={autoSnapEnabled}
            debugDetection={debugDetection}
            detectionDebugData={detectionDebugData}
            onRemovePerimeterVertex={handleRemovePerimeterVertex}
            onDeletePerimeterVertex={handleDeletePerimeterVertex}
          />
        </div>

        <LeftPanel
          roomDimensions={roomDimensions}
          onDimensionsChange={(dims) => {
            setRoomDimensions(dims);
            if (roomOverlay) {
              updateScale(dims, roomOverlay);
            }
          }}
          area={area}
          mode={mode}
          unit={unit}
          onUnitChange={setUnit}
          isProcessing={isProcessing}
          ocrFailed={ocrFailed}
          showSideLengths={showSideLengths}
          onShowSideLengthsChange={setShowSideLengths}
          useInteriorWalls={useInteriorWalls}
          onInteriorWallToggle={handleInteriorWallToggle}
          autoSnapEnabled={autoSnapEnabled}
          onAutoSnapChange={setAutoSnapEnabled}
          perimeterOverlay={perimeterOverlay}
          debugDetection={debugDetection}
          onDebugDetectionChange={setDebugDetection}
          showOptions={showPanelOptions}
        />

        {area > 0 && (
          <ToolsPanel
            lineToolActive={lineToolActive}
            onLineToolToggle={handleLineToolToggle}
            drawAreaActive={drawAreaActive}
            onDrawAreaToggle={handleDrawAreaToggle}
          />
        )}

        {notification.show && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="pointer-events-auto bg-chrome-800 border border-chrome-700 text-slate-100 text-xs font-medium px-4 py-2 rounded-lg shadow-xl animate-toast-in">
              {notification.message}
            </div>
          </div>
        )}
      </div>

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
