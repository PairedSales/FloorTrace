import { useRef, useEffect, useCallback } from 'react';
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
import * as undoManager from './store/undoManager';
import { useAutosave } from './hooks/useAutosave';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToolManager } from './hooks/useToolManager';

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
  const notifications = useAppStore((s) => s.notifications);
  const showPanelOptions = useAppStore((s) => s.showPanelOptions);
  const showHelpModal = useAppStore((s) => s.showHelpModal);
  const eraserToolActive = useAppStore((s) => s.eraserToolActive);
  const eraserBrushSize = useAppStore((s) => s.eraserBrushSize);
  const cropToolActive = useAppStore((s) => s.cropToolActive);

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
  const setCurrentMeasurementLine = useAppStore((s) => s.setCurrentMeasurementLine);
  const setMeasurementLines = useAppStore((s) => s.setMeasurementLines);
  const setCurrentCustomShape = useAppStore((s) => s.setCurrentCustomShape);
  const setCustomShapes = useAppStore((s) => s.setCustomShapes);
  const setPerimeterVertices = useAppStore((s) => s.setPerimeterVertices);
  const setTracedBoundaries = useAppStore((s) => s.setTracedBoundaries);
  const setDetectionDebugData = useAppStore((s) => s.setDetectionDebugData);
  const addNotification = useAppStore((s) => s.addNotification);
  const removeNotification = useAppStore((s) => s.removeNotification);
  const setShowHelpModal = useAppStore((s) => s.setShowHelpModal);
  const setShowSideLengths = useAppStore((s) => s.setShowSideLengths);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);
  const setAutoSnapEnabled = useAppStore((s) => s.setAutoSnapEnabled);
  const setDebugDetection = useAppStore((s) => s.setDebugDetection);
  const setEraserBrushSize = useAppStore((s) => s.setEraserBrushSize);

  const resetOverlays = useAppStore((s) => s.resetOverlays);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dimensionEditActiveRef = useRef(false); // Prevents duplicate undo saves when focus moves between InchesInput sub-fields

  const notify = useCallback((message, durationMs = 3000) => {
    const id = Date.now() + '-' + Math.random().toString(36).substr(2, 9);
    addNotification({ id, message });
    setTimeout(() => {
      removeNotification(id);
    }, durationMs);
  }, [addNotification, removeNotification]);

  // ── Custom hooks ─────────────────────────────────────────────────────────

  const { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft } = useAutosave(notify);

  const {
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCropToolToggle,
    handleClearTools,
  } = useToolManager();

  // Declared after handlePasteImage / handleFileOpen (see below) so the
  // shortcut hook can close over the stable callback references.

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => () => terminateDetectionWorker(), []);


  // Reset entire application
  const handleRestart = () => {
    clearAutosavedDraft();
    undoManager.clear();
    useAppStore.getState().restart();
  };

  // Handle manual mode
  const handleManualMode = useCallback(async (imgSrc = image, forceEnter = false) => {
    if (!forceEnter && mode === 'manual') {
      // Exiting manual mode
      undoManager.save();
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
        // Save undo state before clearing overlays
        undoManager.save();
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
          notify('No dimensions found. Please enter manually.');

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
            const label = detectedFormat === 'inches' ? 'feet-inches' : 'decimal feet';
            notify(`Switched to ${label} mode based on detected dimensions.`);
          }
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        // OCR failed - automatically create 200x200 room overlay at center
        setOcrFailed(true);
        notify('Error detecting dimensions. Please enter manually.');

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
  }, [image, mode, roomOverlay, perimeterOverlay, unit, notify]);

  // Find room size: non-destructively re-scan dimensions from the image
  const handleFindRoomSize = useCallback(async () => {
    if (!image) return;

    if (roomOverlay || perimeterOverlay) {
      const confirmed = window.confirm(
        'Scanning for room size will clear your existing room and perimeter overlays. Are you sure?'
      );
      if (!confirmed) return;
    }

    undoManager.save();
    
    setRoomOverlay(null);
    setPerimeterOverlay(null);
    setArea(0);
    setPerimeterVertices(null);
    setDetectedDimensions([]);

    await handleManualMode(image, true);
  }, [
    image,
    roomOverlay,
    perimeterOverlay,
    setRoomOverlay,
    setPerimeterOverlay,
    setArea,
    setPerimeterVertices,
    setDetectedDimensions,
    handleManualMode,
  ]);

  // Handle file upload
  const handleFileUpload = useCallback(async (event) => {
    const file = event.target.files[0];
    if (file) {
      try {
        // Clear existing image before loading new one to ensure state change
        setImage(null);
        // Clear overlays as well
        resetOverlays();
        undoManager.clear();

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
      undoManager.clear();

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
      undoManager.clear();
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

    undoManager.save();
    setIsProcessing(true, 'Tracing exterior walls…');
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });

      if (!traced) {
        notify('Unable to trace perimeter from this image.', 2500);
        return;
      }

      setTracedBoundaries(traced);
      setDetectionDebugData(traced.debug ?? null);
      const applied = applyTracedBoundary(traced, useInteriorWalls);

      if (!applied) {
        notify('No valid perimeter detected.', 2500);
        return;
      }

      notify(`Perimeter detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).`, 2200);
    } catch (error) {
      console.error('Perimeter detection failed:', error);
      notify('Perimeter detection failed. Try another image region.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handleInteriorWallToggle = (value) => {
    undoManager.save();
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

  // Handle image update from eraser or crop tool (saves undo point before changing)
  const handleImageUpdate = useCallback((newImageDataUrl) => {
    undoManager.save();
    setImage(newImageDataUrl);
  }, [setImage]);

  const handleAddMeasurementLine = useCallback((line) => {
    // Clear the in-progress line before saving the snapshot so that undo restores
    // a clean state (no half-drawn line) rather than the mid-draw state.
    setCurrentMeasurementLine(null);
    undoManager.save();
    setMeasurementLines([...useAppStore.getState().measurementLines, line]);
  }, [setMeasurementLines, setCurrentMeasurementLine]);

  const handleMeasurementLinesChange = useCallback((nextLines) => {
    undoManager.save();
    setMeasurementLines(nextLines);
  }, [setMeasurementLines]);

  const handleAddCustomShape = useCallback((shape) => {
    undoManager.save();
    setCustomShapes([...useAppStore.getState().customShapes, shape]);
  }, [setCustomShapes]);

  const handleCustomShapesChange = useCallback((nextShapes) => {
    undoManager.save();
    setCustomShapes(nextShapes);
  }, [setCustomShapes]);

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
  const updateScale = useCallback((dimensions, overlay) => {
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
    const currentPerimeter = useAppStore.getState().perimeterOverlay;
    if (currentPerimeter && currentPerimeter.vertices && overlay) {
      const calculatedArea = calculateArea(currentPerimeter.vertices, newScale);
      setArea(calculatedArea);
    }
  }, [setScale, setArea]);

  // Update room overlay position
  const updateRoomOverlay = (overlay, saveAction = true) => {
    if (saveAction) undoManager.save();
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay);
    }
  };

  // Update perimeter vertices
  const updatePerimeterVertices = (vertices, saveAction = true) => {
    if (saveAction) undoManager.save();
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
    undoManager.save();
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
      undoManager.save();
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
      undoManager.save();
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
    undoManager.save();
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

      notify(`Perimeter auto-detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).`, 2500);
    } catch (error) {
      console.error('Auto exterior tracing failed:', error);
      // Non-fatal — user can still trace manually
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle dimension selection in manual mode
  const handleDimensionSelect = async (dimension) => {
    undoManager.save();
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

    undoManager.save();
    
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

  // ── Stable callback wrappers for inline handlers ──────────────────────────
  const handleFileOpen = useCallback(() => fileInputRef.current?.click(), []);
  const handleOptionsToggle = useCallback(() => {
    const s = useAppStore.getState();
    s.setShowPanelOptions(!s.showPanelOptions);
  }, []);
  const handleHelpOpen = useCallback(() => {
    const s = useAppStore.getState();
    s.setShowHelpModal(!s.showHelpModal);
  }, []);
  const handleDimensionsChange = useCallback((dims) => {
    setRoomDimensions(dims);
    if (useAppStore.getState().roomOverlay) {
      updateScale(dims, useAppStore.getState().roomOverlay);
    }
  }, [setRoomDimensions, updateScale]);
  const handleUnitChange = useCallback((u) => {
    undoManager.save();
    setUnit(u);
  }, [setUnit]);
  const handleDimensionFocus = useCallback(() => {
    if (!dimensionEditActiveRef.current) {
      dimensionEditActiveRef.current = true;
      undoManager.save();
    }
  }, []);
  const handleDimensionBlur = useCallback(() => {
    setTimeout(() => { dimensionEditActiveRef.current = false; }, 0);
  }, []);
  const handleHelpClose = useCallback(() => setShowHelpModal(false), [setShowHelpModal]);
  const handleSaveUndoPoint = useCallback(() => undoManager.save(), []);
  const handleCancelUndoSave = useCallback(() => undoManager.cancelLastSave(), []);

  // ── Keyboard shortcuts (wired after stable callbacks are defined) ─────────
  useKeyboardShortcuts({
    onPaste: handlePasteImage,
    onFileOpen: handleFileOpen,
    eraserToolActive,
    eraserBrushSize,
    setEraserBrushSize,
  });

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
        onFileOpen={handleFileOpen}
        onSaveImage={handleSaveImage}
        onTracePerimeter={handleTracePerimeter}
        onFitToWindow={handleFitToWindow}
        onRestart={handleRestart}
        showPanelOptions={showPanelOptions}
        onOptionsToggle={handleOptionsToggle}
        hasAutoDetection={!!tracedBoundaries}
        onManualMode={handleManualOutlineMode}
        perimeterOverlay={perimeterOverlay}
        onFindRoomSize={handleFindRoomSize}
        onHelpOpen={handleHelpOpen}
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
            onSaveUndoPoint={handleSaveUndoPoint}
            onCancelUndoSave={handleCancelUndoSave}
            eraserToolActive={eraserToolActive}
            eraserBrushSize={eraserBrushSize}
            onEraserBrushSizeChange={setEraserBrushSize}
            cropToolActive={cropToolActive}
            onCropToolToggle={handleCropToolToggle}
            onImageUpdate={handleImageUpdate}
          />
        </div>

        <LeftPanel
          roomDimensions={roomDimensions}
          onDimensionsChange={handleDimensionsChange}
          area={area}
          mode={mode}
          unit={unit}
          onUnitChange={handleUnitChange}
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
          onDimensionFocus={handleDimensionFocus}
          onDimensionBlur={handleDimensionBlur}
        />

        {image && (
          <ToolsPanel
            lineToolActive={lineToolActive}
            onLineToolToggle={handleLineToolToggle}
            drawAreaActive={drawAreaActive}
            onDrawAreaToggle={handleDrawAreaToggle}
            eraserToolActive={eraserToolActive}
            onEraserToolToggle={handleEraserToolToggle}
            cropToolActive={cropToolActive}
            onCropToolToggle={handleCropToolToggle}
            measurementLines={measurementLines}
            customShapes={customShapes}
            currentMeasurementLine={currentMeasurementLine}
            currentCustomShape={currentCustomShape}
            onClearTools={handleClearTools}
            hasArea={area > 0}
          />
        )}

        {/* Unified Toasts Container - Positioned within the content area, below toolbar */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {/* Processing Message */}
          {isProcessing && (
            <div className="pointer-events-auto bg-chrome-800 border border-chrome-700 rounded-lg px-5 py-3 shadow-xl flex items-center gap-3 animate-toast-in">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent/30 border-t-accent"></div>
              <span className="text-sm text-slate-200 font-medium">{processingMessage || 'Working…'}</span>
            </div>
          )}
          
          {/* Notifications Stack */}
          {notifications.map(toast => (
            <div key={toast.id} className="pointer-events-auto bg-chrome-800 border border-chrome-700 text-slate-100 text-xs font-medium px-4 py-2 rounded-lg shadow-xl animate-toast-in shadow-black/50">
              {toast.message}
            </div>
          ))}
        </div>

        {showHelpModal && (
          <HelpModal onClose={handleHelpClose} />
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
