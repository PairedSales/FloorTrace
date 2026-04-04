import { useState, useRef, useEffect, useCallback } from 'react';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import ToolsPanel from './components/ToolsPanel';
import HelpModal from './components/HelpModal';
import { loadImageFromFile, loadImageFromClipboard } from './utils/imageLoader';
import { calculateArea } from './utils/areaCalculator';
import {
  detectRoomFromClick,
  getBoundaryForMode,
  traceFloorplanBoundary,
  terminateDetectionWorker,
} from './utils/detection';
import useAppStore from './store/appStore';

const LOCAL_DRAFT_STORAGE_KEY = 'floortrace:autosave:v1';
const SAVE_ON_EXIT_KEY = 'floortrace:saveOnExit';

function App() {
  // ── Pull everything from the Zustand store ──────────────────────────────
  const image = useAppStore((s) => s.image);
  const roomOverlay = useAppStore((s) => s.roomOverlay);
  const perimeterOverlay = useAppStore((s) => s.perimeterOverlay);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  const area = useAppStore((s) => s.area);
  const mode = useAppStore((s) => s.mode);
  const scale = useAppStore((s) => s.scale);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const showSideLengths = useAppStore((s) => s.showSideLengths);
  const useInteriorWalls = useAppStore((s) => s.useInteriorWalls);
  const autoSnapEnabled = useAppStore((s) => s.autoSnapEnabled);
  const manualEntryMode = useAppStore((s) => s.manualEntryMode);
  const ocrFailed = useAppStore((s) => s.ocrFailed);
  const unit = useAppStore((s) => s.unit);
  const lineToolActive = useAppStore((s) => s.lineToolActive);
  const measurementLines = useAppStore((s) => s.measurementLines);
  const currentMeasurementLine = useAppStore((s) => s.currentMeasurementLine);
  const drawAreaActive = useAppStore((s) => s.drawAreaActive);
  const customShapes = useAppStore((s) => s.customShapes);
  const currentCustomShape = useAppStore((s) => s.currentCustomShape);
  const perimeterVertices = useAppStore((s) => s.perimeterVertices);
  const tracedBoundaries = useAppStore((s) => s.tracedBoundaries);
  const debugDetection = useAppStore((s) => s.debugDetection);
  const detectionDebugData = useAppStore((s) => s.detectionDebugData);
  const notification = useAppStore((s) => s.notification);
  const showPanelOptions = useAppStore((s) => s.showPanelOptions);
  const showHelpModal = useAppStore((s) => s.showHelpModal);

  // Store actions (stable references — never cause re-renders)
  const setImage = useAppStore((s) => s.setImage);
  const setRoomOverlay = useAppStore((s) => s.setRoomOverlay);
  const setPerimeterOverlay = useAppStore((s) => s.setPerimeterOverlay);
  const setRoomDimensions = useAppStore((s) => s.setRoomDimensions);
  const setArea = useAppStore((s) => s.setArea);
  const setMode = useAppStore((s) => s.setMode);
  const setScale = useAppStore((s) => s.setScale);
  const setIsProcessing = useAppStore((s) => s.setIsProcessing);
  const setDetectedDimensions = useAppStore((s) => s.setDetectedDimensions);
  const setManualEntryMode = useAppStore((s) => s.setManualEntryMode);
  const setOcrFailed = useAppStore((s) => s.setOcrFailed);
  const setUnit = useAppStore((s) => s.setUnit);
  const setLineToolActive = useAppStore((s) => s.setLineToolActive);
  const setMeasurementLines = useAppStore((s) => s.setMeasurementLines);
  const setCurrentMeasurementLine = useAppStore((s) => s.setCurrentMeasurementLine);
  const setDrawAreaActive = useAppStore((s) => s.setDrawAreaActive);
  const setCustomShapes = useAppStore((s) => s.setCustomShapes);
  const setCurrentCustomShape = useAppStore((s) => s.setCurrentCustomShape);
  const setPerimeterVertices = useAppStore((s) => s.setPerimeterVertices);
  const setTracedBoundaries = useAppStore((s) => s.setTracedBoundaries);
  const setDetectionDebugData = useAppStore((s) => s.setDetectionDebugData);
  const setNotification = useAppStore((s) => s.setNotification);
  const setShowHelpModal = useAppStore((s) => s.setShowHelpModal);
  const setHasRestoredState = useAppStore((s) => s.setHasRestoredState);
  const setShowSideLengths = useAppStore((s) => s.setShowSideLengths);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);
  const setAutoSnapEnabled = useAppStore((s) => s.setAutoSnapEnabled);
  const setDebugDetection = useAppStore((s) => s.setDebugDetection);

  const pushUndoState = useAppStore((s) => s.pushUndoState);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
  const handleUndo = useAppStore((s) => s.handleUndo);
  const handleRedo = useAppStore((s) => s.handleRedo);

  const [saveOnExit, setSaveOnExit] = useState(() => {
    const stored = localStorage.getItem(SAVE_ON_EXIT_KEY);
    return stored === null ? true : stored === 'true';
  });
  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);

  const clearAutosavedDraft = useCallback(() => {
    localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
  }, []);

  const handleSaveOnExitChange = useCallback((enabled) => {
    setSaveOnExit(enabled);
    localStorage.setItem(SAVE_ON_EXIT_KEY, String(enabled));
    if (!enabled) {
      localStorage.removeItem(LOCAL_DRAFT_STORAGE_KEY);
    }
  }, []);

  const saveAutosavedDraft = useCallback((snapshot) => {
    try {
      localStorage.setItem(LOCAL_DRAFT_STORAGE_KEY, JSON.stringify(snapshot));
    } catch (error) {
      console.error('Failed to autosave local draft:', error);
      setNotification({ show: true, message: 'Autosave unavailable (storage full or blocked).' });
      setTimeout(() => setNotification({ show: false, message: '' }), 3000);
    }
  }, [setNotification]);

  // Reset entire application
  const handleRestart = () => {
    clearAutosavedDraft();
    useAppStore.getState().restart();
  };

  // Handle manual mode
  const handleManualMode = useCallback(async (imgSrc = image, forceEnter = false) => {
    if (!forceEnter && mode === 'manual') {
      // Exiting manual mode
      setMode('normal');
      setDetectedDimensions([]);
      setManualEntryMode(false);
      setOcrFailed(false);
    } else {
      // Entering manual mode - check if overlays exist (skip confirmation when force-entering from image load)
      if (!forceEnter && (roomOverlay || perimeterOverlay)) {
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
      
      setIsProcessing(true, 'Scanning for dimensions…');
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

  // Start over: clear all overlays and re-process the current image as if freshly pasted
  const handleStartOver = useCallback(async () => {
    if (!image) return;
    const currentImage = image;
    resetOverlays();
    await handleManualMode(currentImage, true);
  }, [image, resetOverlays, handleManualMode]);

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
        handleManualMode(loadedImage, true); // Automatically enter manual mode
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
        handleManualMode(loadedImage, true); // Automatically enter manual mode
      }
    } catch (error) {
      console.error('Error pasting image:', error);
      alert('Failed to paste image. Make sure an image is copied to your clipboard.');
    }
  }, [resetOverlays, handleManualMode]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback(async (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      resetOverlays();
      const loadedImage = await loadImageFromFile(file);
      setImage(loadedImage);
      handleManualMode(loadedImage, true);
    } catch (error) {
      console.error('Error loading dropped image:', error);
      alert('Failed to load image. Please try again.');
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

    setIsProcessing(true, 'Tracing exterior walls…');
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
    setMeasurementLines([...useAppStore.getState().measurementLines, line]);
  }, [pushUndoState, setMeasurementLines]);

  const handleMeasurementLinesChange = useCallback((nextLines) => {
    pushUndoState();
    setMeasurementLines(nextLines);
  }, [pushUndoState]);

  const handleAddCustomShape = useCallback((shape) => {
    pushUndoState();
    setCustomShapes([...useAppStore.getState().customShapes, shape]);
  }, [pushUndoState, setCustomShapes]);

  const handleCustomShapesChange = useCallback((nextShapes) => {
    pushUndoState();
    setCustomShapes(nextShapes);
  }, [pushUndoState]);

  // Handle save image (one-click screenshot of the entire app)
  const handleSaveImage = async () => {
    try {
      const { toPng } = await import('html-to-image');
      const appElement = document.getElementById('app-container');
      if (!appElement) {
        alert('Could not capture screenshot');
        return;
      }

      const dataUrl = await toPng(appElement, { pixelRatio: 2, skipFonts: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      const base64 = dataUrl.split(',')[1];
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'image/png' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.download = `floortrace-${timestamp}.png`;
      link.href = url;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 100);
    } catch (error) {
      if (error.name === 'AbortError') return;
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
    setIsProcessing(true, 'Detecting exterior boundary…');
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });
      if (!traced) return;
      setTracedBoundaries(traced);
      setDetectionDebugData({ ...(useAppStore.getState().detectionDebugData ?? {}), ...(traced.debug ?? {}) });

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
    } finally {
      setIsProcessing(false);
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

    setIsProcessing(true, 'Finding room…');
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
    // autoTraceExterior manages its own isProcessing state.
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
      setIsProcessing(true, 'Finding room…');
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
      // autoTraceExterior manages its own isProcessing state.
      autoTraceExterior(nextOverlay, roomDimensions);
    };

    placeOverlay();
  };

  // Restore locally autosaved data on startup (if save-on-exit is enabled)
  useEffect(() => {
    const restoreAutosavedDraft = async () => {
      const saveOnExitEnabled = localStorage.getItem(SAVE_ON_EXIT_KEY) !== 'false';
      try {
        const savedStateRaw = saveOnExitEnabled ? localStorage.getItem(LOCAL_DRAFT_STORAGE_KEY) : null;
        if (savedStateRaw) {
          const savedState = JSON.parse(savedStateRaw);
          if (savedState?.image) {
            useAppStore.getState().restoreFromSaved(savedState);
            setHasRestoredState(true);
            return;
          }
        }
      } catch (error) {
        console.error('Failed to restore autosaved draft:', error);
      }

      setHasRestoredState(true);
    };

    restoreAutosavedDraft();
  }, [setHasRestoredState]);

  // Autosave draft to local storage when working state changes (debounced).
  // Uses Zustand's subscribe to listen for ANY working-state change, replacing
  // the old useEffect with a 24-item dependency array.
  const autosaveTimerRef = useRef(null);
  useEffect(() => {
    const unsub = useAppStore.subscribe((state, prevState) => {
      if (!state._hasRestoredState) return;
      if (!saveOnExit) return;

      if (!state.image) {
        clearAutosavedDraft();
        return;
      }

      // Skip if nothing autosave-relevant changed
      if (state.image === prevState.image &&
          state.roomOverlay === prevState.roomOverlay &&
          state.perimeterOverlay === prevState.perimeterOverlay &&
          state.roomDimensions === prevState.roomDimensions &&
          state.area === prevState.area &&
          state.scale === prevState.scale &&
          state.mode === prevState.mode &&
          state.detectedDimensions === prevState.detectedDimensions &&
          state.showSideLengths === prevState.showSideLengths &&
          state.useInteriorWalls === prevState.useInteriorWalls &&
          state.autoSnapEnabled === prevState.autoSnapEnabled &&
          state.manualEntryMode === prevState.manualEntryMode &&
          state.ocrFailed === prevState.ocrFailed &&
          state.unit === prevState.unit &&
          state.lineToolActive === prevState.lineToolActive &&
          state.measurementLines === prevState.measurementLines &&
          state.currentMeasurementLine === prevState.currentMeasurementLine &&
          state.drawAreaActive === prevState.drawAreaActive &&
          state.customShapes === prevState.customShapes &&
          state.currentCustomShape === prevState.currentCustomShape &&
          state.perimeterVertices === prevState.perimeterVertices &&
          state.tracedBoundaries === prevState.tracedBoundaries &&
          state.debugDetection === prevState.debugDetection &&
          state.detectionDebugData === prevState.detectionDebugData) {
        return;
      }

      // Debounce: wait 2 seconds of inactivity before writing to localStorage.
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }

      autosaveTimerRef.current = setTimeout(() => {
        saveAutosavedDraft(useAppStore.getState().getAutosaveState());
      }, 2000);
    });

    return () => {
      unsub();
      if (autosaveTimerRef.current) {
        clearTimeout(autosaveTimerRef.current);
      }
    };
  }, [saveOnExit, clearAutosavedDraft, saveAutosavedDraft]);

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
    <div
      id="app-container"
      className="flex flex-col h-screen bg-chrome-900"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <Toolbar
        image={image}
        isProcessing={isProcessing}
        onFileOpen={() => fileInputRef.current?.click()}
        onSaveImage={handleSaveImage}
        onTracePerimeter={handleTracePerimeter}
        onFitToWindow={handleFitToWindow}
        onRestart={handleRestart}
        showPanelOptions={showPanelOptions}
        onOptionsToggle={() => { const s = useAppStore.getState(); s.setShowPanelOptions(!s.showPanelOptions); }}
        hasAutoDetection={!!tracedBoundaries}
        onManualMode={handleManualOutlineMode}
        perimeterOverlay={perimeterOverlay}
        onStartOver={handleStartOver}
        onHelpOpen={() => { const s = useAppStore.getState(); s.setShowHelpModal(!s.showHelpModal); }}
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
            processingMessage={processingMessage}
            detectedDimensions={detectedDimensions}
            onDimensionSelect={handleDimensionSelect}
            showSideLengths={showSideLengths}
            pixelsPerFoot={scale}
            manualEntryMode={manualEntryMode}
            onCanvasClick={handleCanvasClick}
            unit={unit}
            lineToolActive={lineToolActive}
            onLineToolToggle={handleLineToolToggle}
            measurementLines={measurementLines}
            currentMeasurementLine={currentMeasurementLine}
            onMeasurementLineUpdate={setCurrentMeasurementLine}
            onAddMeasurementLine={handleAddMeasurementLine}
            onMeasurementLinesChange={handleMeasurementLinesChange}
            drawAreaActive={drawAreaActive}
            onDrawAreaToggle={handleDrawAreaToggle}
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
          saveOnExit={saveOnExit}
          onSaveOnExitChange={handleSaveOnExitChange}
        />

        {area > 0 && (
          <ToolsPanel
            lineToolActive={lineToolActive}
            onLineToolToggle={handleLineToolToggle}
            drawAreaActive={drawAreaActive}
            onDrawAreaToggle={handleDrawAreaToggle}
            measurementLines={measurementLines}
            customShapes={customShapes}
            currentMeasurementLine={currentMeasurementLine}
            currentCustomShape={currentCustomShape}
            onClearTools={handleClearTools}
          />
        )}

        {notification.show && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
            <div className="pointer-events-auto bg-chrome-800 border border-chrome-700 text-slate-100 text-xs font-medium px-4 py-2 rounded-lg shadow-xl animate-toast-in">
              {notification.message}
            </div>
          </div>
        )}

        {showHelpModal && (
          <HelpModal onClose={() => setShowHelpModal(false)} />
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
