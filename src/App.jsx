import { useRef, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import ToolsPanel from './components/ToolsPanel';
import HelpModal from './components/HelpModal';
import OptionsOverlay from './components/OptionsOverlay';
import { loadImageFromFile, loadImageFromClipboard } from './utils/imageLoader';
import {
  detectRoomFromClick,
  getBoundaryForMode,
  traceFloorplanBoundary,
  terminateDetectionWorker,
} from './utils/detection';
import { terminateOcrWorker, warmupOcrEngines } from './utils/DimensionsOCR';
import useAppStore, { selectCombinedArea, selectPerimeterOverlay } from './store/appStore';
import * as undoManager from './store/undoManager';
import { useAutosave } from './hooks/useAutosave';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToolManager } from './hooks/useToolManager';
import { useProjectIO } from './hooks/useProjectIO';
import { useDragAndDrop } from './hooks/useDragAndDrop';

function App() {
  // ── Pull everything from the Zustand store ──────────────────────────────
  const image = useAppStore((s) => s.image);
  const roomOverlay = useAppStore((s) => s.roomOverlay);
  const perimeterOverlay = useAppStore(selectPerimeterOverlay);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const traceInteractionMode = useAppStore((s) => s.traceInteractionMode);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  const area = useAppStore(selectCombinedArea);
  const mode = useAppStore((s) => s.mode);
  const calibration = useAppStore((s) => s.calibration);
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
  const showPanelOptions = useAppStore((s) => s.showPanelOptions);
  const showHelpModal = useAppStore((s) => s.showHelpModal);
  const eraserToolActive = useAppStore((s) => s.eraserToolActive);
  const eraserBrushSize = useAppStore((s) => s.eraserBrushSize);
  const cropToolActive = useAppStore((s) => s.cropToolActive);
  const angleToolActive = useAppStore((s) => s.angleToolActive);
  const angleToolState = useAppStore((s) => s.angleToolState);

  // Floor management
  const addPerimeterTrace = useAppStore((s) => s.addPerimeterTrace);

  // Store actions (stable references — never cause re-renders)
  const setImage = useAppStore((s) => s.setImage);
  const setRoomOverlay = useAppStore((s) => s.setRoomOverlay);
  const setPerimeterOverlay = useAppStore((s) => s.setPerimeterOverlay);
  const setRoomDimensions = useAppStore((s) => s.setRoomDimensions);
  const setMode = useAppStore((s) => s.setMode);
  const applyRoomCalibration = useAppStore((s) => s.applyRoomCalibration);
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
  const setAngleToolState = useAppStore((s) => s.setAngleToolState);
  const setShowHelpModal = useAppStore((s) => s.setShowHelpModal);
  const setShowSideLengths = useAppStore((s) => s.setShowSideLengths);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);
  const setAutoSnapEnabled = useAppStore((s) => s.setAutoSnapEnabled);
  const setEraserBrushSize = useAppStore((s) => s.setEraserBrushSize);

  const resetOverlays = useAppStore((s) => s.resetOverlays);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dimensionEditActiveRef = useRef(false); // Prevents duplicate undo saves when focus moves between InchesInput sub-fields

  const notify = useCallback((message, durationMs = 3000) => {
    const msg = message.toLowerCase();
    if (msg.includes('error') || msg.includes('fail') || msg.includes('unable')) {
      toast.error(message, { duration: durationMs });
    } else if (msg.includes('success') || msg.includes('detected') || msg.includes('loaded')) {
      toast.success(message, { duration: durationMs });
    } else {
      toast(message, { duration: durationMs });
    }
  }, []);

  // ── Custom hooks ─────────────────────────────────────────────────────────

  const { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft } = useAutosave(notify);

  const {
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCropToolToggle,
    handleAngleToolToggle,
    handleClearTools,
  } = useToolManager();

  // Declared after handlePasteImage / handleFileOpen (see below) so the
  // shortcut hook can close over the stable callback references.

  // ── OCR engine warm-up & cleanup ─────────────────────────────────────────
  // Boot the OCR engines in the background at mount so the first dimension
  // scan doesn't pay multi-second engine initialisation.
  useEffect(() => {
    warmupOcrEngines();
    return () => {
      terminateDetectionWorker();
      terminateOcrWorker();
    };
  }, []);

  // Manage instructions toasts
  useEffect(() => {
    // 1. Perimeter vertex placement mode
    if (perimeterVertices !== null && perimeterVertices.length < 3) {
      toast.info(`Click to add perimeter vertices (${perimeterVertices.length}/3). Esc/Enter to finish.`, {
        id: 'perimeter-vertices-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('perimeter-vertices-toast');
    }

    // 2. Manual overlay placement mode (Click on canvas to place overlays)
    if (manualEntryMode) {
      toast.info('Click on the canvas to place room overlay.', {
        id: 'manual-entry-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('manual-entry-toast');
    }

    // 3. Line Tool
    if (lineToolActive) {
      toast.info('Click to place line endpoints. Esc to cancel.', {
        id: 'line-tool-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('line-tool-toast');
    }

    // 4. Draw Area Tool (Custom Shapes)
    if (drawAreaActive) {
      const vertexCount = currentCustomShape?.vertices?.length || 0;
      toast.info(`Click to draw custom shape vertices${vertexCount > 0 ? ` (${vertexCount})` : ''}. Enter/double-click first point to close. Esc to cancel.`, {
        id: 'draw-area-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('draw-area-toast');
    }

    // 5. Eraser Tool
    if (eraserToolActive) {
      toast.info('Click and drag to erase parts of the image. Esc to cancel.', {
        id: 'eraser-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('eraser-toast');
    }

    // 6. Crop Tool
    if (cropToolActive) {
      toast.info('Click and drag to select crop area. Esc to cancel.', {
        id: 'crop-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('crop-toast');
    }

    // 7. Angle Tool
    if (angleToolActive) {
      toast.info('Drag the angle arms or vertices to measure angles. Esc to cancel.', {
        id: 'angle-toast',
        duration: Infinity,
      });
    } else {
      toast.dismiss('angle-toast');
    }

    // Cleanup all toasts on unmount
    return () => {
      toast.dismiss('perimeter-vertices-toast');
      toast.dismiss('manual-entry-toast');
      toast.dismiss('line-tool-toast');
      toast.dismiss('draw-area-toast');
      toast.dismiss('eraser-toast');
      toast.dismiss('crop-toast');
      toast.dismiss('angle-toast');
    };
  }, [
    perimeterVertices,
    perimeterVertices?.length,
    manualEntryMode,
    lineToolActive,
    drawAreaActive,
    currentCustomShape?.vertices?.length,
    eraserToolActive,
    cropToolActive,
    angleToolActive
  ]);


  // Reset entire application
  const handleRestart = () => {
    if (image) {
      const confirmed = window.confirm('Are you sure you want to restart and clear the current project?');
      if (!confirmed) return;
    }
    clearAutosavedDraft();
    undoManager.clear();
    useAppStore.getState().restart();
    notify('Project reset successfully');
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
      }
      
      if (!imgSrc) {
        notify('Error: Please load an image first');
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
        terminateOcrWorker();
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
    setPerimeterVertices(null);
    setDetectedDimensions([]);

    await handleManualMode(image, true);
  }, [
    image,
    roomOverlay,
    perimeterOverlay,
    setRoomOverlay,
    setPerimeterOverlay,
    setPerimeterVertices,
    setDetectedDimensions,
    handleManualMode,
  ]);

  const {
    checkUnsavedChanges,
    handleFileOpen,
    handleFileUpload,
    handleSaveProject,
    handleSaveProjectNormal,
    handleSaveProjectAs,
  } = useProjectIO(notify, handleManualMode, fileInputRef);

  const {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  } = useDragAndDrop(notify, handleManualMode, checkUnsavedChanges);

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
    return true;
  }, []);

  // Handle trace perimeter using the detection worker.
  const handleTracePerimeter = async () => {
    if (!image) return;

    undoManager.save();
    setIsProcessing(true, 'Tracing exterior walls…');
    const startImage = image;
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });

      if (useAppStore.getState().image !== startImage) return;

      if (!traced) {
        notify('Unable to trace perimeter from this image.', 2500);
        setIsProcessing(false);
        return;
      }

      setTracedBoundaries(traced);
      const applied = applyTracedBoundary(traced, useInteriorWalls);

      if (!applied) {
        notify('No valid perimeter detected.', 2500);
        setIsProcessing(false);
        return;
      }

      notify(`Perimeter detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).`, 2200);
      setIsProcessing(false);
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Perimeter detection failed:', error);
        notify('Perimeter detection failed. Try another image region.');
        setIsProcessing(false);
      }
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

  const handleRotateCanvas = useCallback((direction) => {
    canvasRef.current?.rotateCanvas(direction);
    notify(`Canvas rotated ${direction === 'clockwise' ? 'clockwise' : 'counterclockwise'}`);
  }, [notify]);

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




  // Update scale based on room dimensions and overlay
  const updateScale = useCallback((dimensions, overlay) => {
    if (!dimensions.width || !dimensions.height || !overlay) return;
    
    const dimWidth = parseFloat(dimensions.width);
    const dimHeight = parseFloat(dimensions.height);
    const overlayWidth = Math.abs(overlay.x2 - overlay.x1);
    const overlayHeight = Math.abs(overlay.y2 - overlay.y1);
    
    if (overlayWidth === 0 || overlayHeight === 0) return;
    if (isNaN(dimWidth) || isNaN(dimHeight) || dimWidth <= 0 || dimHeight <= 0) return;
    
    // Scale X is based on horizontal width:
    const scaleX = dimWidth / overlayWidth;
    // Scale Y is based on vertical height:
    const scaleY = dimHeight / overlayHeight;
    
    // Only apply if the scale has actually changed
    const currentCalibration = useAppStore.getState().calibration;
    const currentScale = currentCalibration.feetPerPixel;
    
    const hasChanged = !currentCalibration.calibrated ||
      typeof currentScale !== 'object' ||
      Math.abs((currentScale?.x ?? 0) - scaleX) > 1e-9 ||
      Math.abs((currentScale?.y ?? 0) - scaleY) > 1e-9;
      
    if (hasChanged) {
      applyRoomCalibration({ x: scaleX, y: scaleY }, null, 'room-calibration');
    }
  }, [applyRoomCalibration]);

  // Update room overlay position
  const updateRoomOverlay = useCallback((overlay, saveAction = true) => {
    if (saveAction) undoManager.save();
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay);
    }
  }, [setRoomOverlay, roomDimensions, updateScale]);

  // Update perimeter vertices
  const updatePerimeterVertices = useCallback((vertices, saveAction = true) => {
    if (saveAction) undoManager.save();
    setPerimeterOverlay({ vertices });
  }, [setPerimeterOverlay]);

  // Handle adding perimeter vertex in manual mode
  const handleAddPerimeterVertex = useCallback((vertex) => {
    undoManager.save();
    const currentVertices = useAppStore.getState().perimeterVertices || [];
    const newVertices = [...currentVertices, vertex];
    setPerimeterVertices(newVertices);

    // Update the perimeter overlay in real-time
    if (newVertices.length > 0) {
      setPerimeterOverlay({ vertices: newVertices });
    }
  }, [setPerimeterVertices, setPerimeterOverlay]);

  // Handle closing the perimeter
  const handleClosePerimeter = useCallback(() => {
    const currentVertices = useAppStore.getState().perimeterVertices;
    if (currentVertices && currentVertices.length > 2) {
      undoManager.save();
      setPerimeterOverlay({ vertices: currentVertices });
      setPerimeterVertices(null); // Exit vertex placement mode
    }
  }, [setPerimeterOverlay, setPerimeterVertices]);

  // Handle removing last perimeter vertex in manual mode (only used by right-click during vertex placement)
  const handleRemovePerimeterVertex = useCallback(() => {
    const currentVertices = useAppStore.getState().perimeterVertices;
    if (currentVertices && currentVertices.length > 0) {
      undoManager.save();
      const newVertices = currentVertices.slice(0, -1);
      setPerimeterVertices(newVertices);
      setPerimeterOverlay({ vertices: newVertices });
    }
  }, [setPerimeterVertices, setPerimeterOverlay]);

  // Delete a specific perimeter vertex by index (right-click on vertex)
  const handleDeletePerimeterVertex = useCallback((index) => {
    const overlay = selectPerimeterOverlay(useAppStore.getState());
    if (!overlay?.vertices || overlay.vertices.length <= 3) return;
    updatePerimeterVertices(
      overlay.vertices.filter((_, i) => i !== index),
      true
    );
  }, [updatePerimeterVertices]);

  // Switch to manual outline drawing: clear the auto-detected perimeter and let the user draw fresh
  const handleManualOutlineMode = () => {
    undoManager.save();
    setPerimeterOverlay(null);
    setPerimeterVertices([]); // activate manual vertex placement
  };

  // Auto-trace exterior boundary after room overlay is placed.
  const autoTraceExterior = useCallback(async (overlayForScale, dims) => {
    setIsProcessing(true, 'Detecting exterior boundary…');
    const startImage = image;
    try {
      const traced = await traceFloorplanBoundary(image, {
        preprocess: { maxDimension: 1400 },
      });
      if (useAppStore.getState().image !== startImage) return;
      if (!traced) return;
      setTracedBoundaries(traced);

      const activeBoundary = getBoundaryForMode(traced, useInteriorWalls);
      if (!activeBoundary?.polygon?.length) return;

      const vertices = activeBoundary.polygon.map((p) => ({ x: p.x, y: p.y }));
      setPerimeterVertices(null);
      setPerimeterOverlay({ vertices });

      notify(`Perimeter auto-detected (${useInteriorWalls ? 'inner' : 'outer'} wall mode).`, 2500);
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Auto exterior tracing failed:', error);
      }
      // Non-fatal — user can still trace manually
    } finally {
      if (useAppStore.getState().image === startImage) {
        setIsProcessing(false);
      }
    }
  }, [image, useInteriorWalls, setTracedBoundaries, setPerimeterVertices, setPerimeterOverlay, setIsProcessing, notify]);

  // Handle dimension selection in manual mode
  const handleDimensionSelect = useCallback(async (dimension) => {
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
    const startImage = image;
    try {
      const roomResult = await detectRoomFromClick(image, { x: centerX, y: centerY }, {
        preprocess: { maxDimension: 1300 },
      });

      if (useAppStore.getState().image !== startImage) return;

      if (roomResult?.overlay) {
        nextOverlay = {
          ...roomResult.overlay,
          polygon: roomResult.polygon,
          confidence: roomResult.confidence,
        };
      }
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Room enclosure detection failed:', error);
      }
    }

    if (useAppStore.getState().image !== startImage) return;

    setRoomOverlay(nextOverlay);
    updateScale(dims, nextOverlay);

    setPerimeterVertices(null);
    setMode('normal');
    setDetectedDimensions([]);
    setManualEntryMode(false);

    // Automatically detect exterior boundary after room overlay is placed.
    // autoTraceExterior manages its own isProcessing state.
    autoTraceExterior(nextOverlay, dims);
  }, [setRoomDimensions, setIsProcessing, image, setRoomOverlay, updateScale, setPerimeterVertices, setMode, setDetectedDimensions, setManualEntryMode, autoTraceExterior]);

  // Handle canvas click for manual overlay placement
  const handleCanvasClick = useCallback((clickPoint) => {
    if (!manualEntryMode || !roomDimensions.width || !roomDimensions.height) return;
    
    // Validate dimensions
    const width = parseFloat(roomDimensions.width);
    const height = parseFloat(roomDimensions.height);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      notify('Error: Please enter valid room dimensions first');
      return;
    }

    undoManager.save();
    
    const fallbackOverlay = {
      x1: clickPoint.x - 100,
      y1: clickPoint.y - 100,
      x2: clickPoint.x + 100,
      y2: clickPoint.y + 100
    };

    const startImage = image;
    const placeOverlay = async () => {
      let nextOverlay = fallbackOverlay;
      setIsProcessing(true, 'Finding room…');
      try {
        const roomResult = await detectRoomFromClick(image, clickPoint, {
          preprocess: { maxDimension: 1300 },
        });

        if (useAppStore.getState().image !== startImage) return;

        if (roomResult?.overlay) {
          nextOverlay = {
            ...roomResult.overlay,
            polygon: roomResult.polygon,
            confidence: roomResult.confidence,
          };
        }
      } catch (error) {
        if (useAppStore.getState().image === startImage) {
          console.error('Manual room detection fallback failed:', error);
        }
      }

      if (useAppStore.getState().image !== startImage) return;

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
  }, [manualEntryMode, roomDimensions, image, setIsProcessing, setRoomOverlay, updateScale, setPerimeterVertices, setManualEntryMode, setMode, autoTraceExterior]);

  // ── Stable callback wrappers for inline handlers ──────────────────────────

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
    const unitNames = {
      decimal: 'Decimal Feet',
      inches: 'Feet & Inches',
      metric: 'Meters'
    };
    notify(`Unit format changed to ${unitNames[u] || u}`);
  }, [setUnit, notify]);

  const handleShowSideLengthsChange = useCallback((value) => {
    setShowSideLengths(value);
    notify(value ? 'Side lengths enabled' : 'Side lengths disabled');
  }, [setShowSideLengths, notify]);

  const handleAutoSnapChange = useCallback((value) => {
    setAutoSnapEnabled(value);
    notify(value ? 'Auto-snap enabled' : 'Auto-snap disabled');
  }, [setAutoSnapEnabled, notify]);

  const handleSaveOnExitChangeWithToast = useCallback((value) => {
    handleSaveOnExitChange(value);
    notify(value ? 'Autosave on exit enabled' : 'Autosave on exit disabled');
  }, [handleSaveOnExitChange, notify]);

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
  const handleAngleToolStateChange = useCallback((nextState) => {
    undoManager.save();
    setAngleToolState(nextState);
  }, [setAngleToolState]);

  // ── Keyboard shortcuts (wired after stable callbacks are defined) ─────────
  useKeyboardShortcuts({
    onPaste: handlePasteImage,
    onFileOpen: handleFileOpen,
    onSaveProject: handleSaveProject,
    eraserToolActive,
    eraserBrushSize,
    setEraserBrushSize,
    onRotateCanvas: handleRotateCanvas,
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
        onSaveProject={handleSaveProjectNormal}
        onSaveProjectAs={handleSaveProjectAs}
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
        onAddFloor={addPerimeterTrace}
        floorCount={perimeterTraces.length}
      />

      <div className="relative flex flex-1 overflow-hidden min-h-0 canvas-grid-bg">
        <div className="absolute inset-0 z-0 min-h-0">
          <Canvas
            ref={canvasRef}
            image={image}
            roomOverlay={roomOverlay}
            perimeterOverlay={perimeterOverlay}
            perimeterTraces={perimeterTraces}
            activeTraceId={activeTraceId}
            traceInteractionMode={traceInteractionMode}
            mode={mode}
            onRoomOverlayUpdate={updateRoomOverlay}
            onPerimeterUpdate={updatePerimeterVertices}
            isProcessing={isProcessing}
            processingMessage={processingMessage}
            detectedDimensions={detectedDimensions}
            onDimensionSelect={handleDimensionSelect}
            showSideLengths={showSideLengths}
            feetPerPixel={calibration.feetPerPixel}
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
            angleToolActive={angleToolActive}
            angleToolState={angleToolState}
            onAngleToolStateChange={handleAngleToolStateChange}
            onAngleToolToggle={handleAngleToolToggle}
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
          useInteriorWalls={useInteriorWalls}
          onInteriorWallToggle={handleInteriorWallToggle}
          perimeterOverlay={perimeterOverlay}
          onDimensionFocus={handleDimensionFocus}
          onDimensionBlur={handleDimensionBlur}
        />

        {showPanelOptions && (
          <OptionsOverlay
            showSideLengths={showSideLengths}
            onShowSideLengthsChange={handleShowSideLengthsChange}
            autoSnapEnabled={autoSnapEnabled}
            onAutoSnapChange={handleAutoSnapChange}
            perimeterOverlay={perimeterOverlay}
            saveOnExit={saveOnExit}
            onSaveOnExitChange={handleSaveOnExitChangeWithToast}
          />
        )}

        {/* Right-side overlay panels — stacked vertically */}
        <div className="relative z-10 flex shrink-0 flex-col self-start">
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
              angleToolActive={angleToolActive}
              onAngleToolToggle={handleAngleToolToggle}
              onRotateCanvas={handleRotateCanvas}
              measurementLines={measurementLines}
              customShapes={customShapes}
              currentMeasurementLine={currentMeasurementLine}
              currentCustomShape={currentCustomShape}
              onClearTools={handleClearTools}
              hasArea={area > 0}
            />
          )}
        </div>

        {/* Unified Toasts Container - Positioned within the content area, below toolbar */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
          {/* Processing Message */}
          {isProcessing && (
            <div className="pointer-events-auto bg-chrome-800 border border-chrome-700 rounded-lg px-5 py-3 shadow-xl flex items-center gap-3 animate-toast-in select-none">
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-accent/30 border-t-accent"></div>
              <span className="text-sm text-slate-200 font-medium">{processingMessage || 'Working…'}</span>
            </div>
          )}
        </div>

        {showHelpModal && (
          <HelpModal onClose={handleHelpClose} />
        )}

      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.floorplan"
        onChange={handleFileUpload}
        className="hidden"
      />
      <Toaster 
        position="top-center" 
        theme="dark"
        closeButton
        style={{ top: '56px' }}
        toastOptions={{
          classNames: {
            toast: 'group !bg-[#282A36] !border-[#44475A] !text-[#F8F8F2] rounded-lg shadow-xl font-medium text-xs font-sans select-none flex items-center gap-2 p-3 !w-fit !max-w-md',
            title: '!text-[#F8F8F2]',
            description: '!text-[#6272A4]',
            success: '!text-[#50FA7B] !border-[#50FA7B]/30',
            error: '!text-[#FF5555] !border-[#FF5555]/30',
            info: '!text-[#8BE9FD] !border-[#8BE9FD]/30',
            warning: '!text-[#FFB86C] !border-[#FFB86C]/30',
            closeButton: '!bg-[#282A36] !border-[#44475A] !text-[#F8F8F2] hover:!bg-[#44475A]',
          }
        }}
      />
    </div>
  );
}

export default App;
