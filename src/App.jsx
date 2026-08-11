import { useRef, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import Canvas from './components/Canvas';
import Toolbar from './components/Toolbar';
import LeftPanel from './components/LeftPanel';
import ToolsPanel from './components/ToolsPanel';
import HelpModal from './components/HelpModal';
import OptionsOverlay from './components/OptionsOverlay';
import { confirmToast } from './utils/confirmToast';
import {
  detectRoomFromClick,
  getFloorBoundariesForMode,
  traceFloorplanBoundary,
  terminateDetectionWorker,
} from './utils/detection';
import { detectAllDimensions, terminateOcrWorker, warmupOcrEngines } from './utils/DimensionsOCR';
import { scaleIsotropy, robustScale } from './utils/detection/validate';
import { qualitySummary } from './utils/boundaryQuality';
import useAppStore, { selectCombinedArea, selectPerimeterOverlay } from './store/appStore';
import * as undoManager from './store/undoManager';
import { useAutosave } from './hooks/useAutosave';
import { useEnhancedOcr } from './hooks/useEnhancedOcr';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToolManager } from './hooks/useToolManager';
import { useProjectIO } from './hooks/useProjectIO';
import { useDragAndDrop } from './hooks/useDragAndDrop';

// OCR non-GLA labels -> tracer exclude regions (keyword kept so garages can
// be reported distinctly from porch/patio carves).
const nonGlaExcludeRegions = () =>
  useAppStore.getState().exteriorLabels.map((l) => ({ ...l.bbox, keyword: l.keyword }));

// What the rest of the app already knows about this building, handed to the
// tracer as constraints. Rooms are inside by construction; a parsed dimension
// label is inside by definition — geometry that excludes either is provably
// wrong, and the detector had no way to be told so.
const boundaryConstraints = () => {
  const state = useAppStore.getState();
  const nonGla = state.exteriorLabels.map((l) => l.bbox);
  const overlapsNonGla = (bbox) => nonGla.some((n) =>
    bbox.x < n.x + n.width && n.x < bbox.x + bbox.width
    && bbox.y < n.y + n.height && n.y < bbox.y + bbox.height);
  return {
    rooms: state.rooms.map((r) => ({ name: r.name ?? null, rect: r.rect })),
    interiorPoints: state.detectedDimensions
      .filter((d) => d.bbox && !overlapsNonGla(d.bbox))
      .map((d) => ({
        x: d.bbox.x + d.bbox.width / 2,
        y: d.bbox.y + d.bbox.height / 2,
        name: d.text ?? null,
      })),
  };
};

// Pixels per foot the project already believes in, for the room detector to
// size the next room against. Prefers the rooms measured so far — a median
// over several rooms survives one bad rectangle, which the single calibration
// scale derived from the first room cannot. Null until there is something
// worth trusting, where the detector falls back to matching aspect alone.
const roomScaleHint = () => {
  const state = useAppStore.getState();
  const samples = state.rooms.flatMap((r) => (
    r.feetPerPixel?.x > 0 && r.feetPerPixel?.y > 0
      ? [1 / r.feetPerPixel.x, 1 / r.feetPerPixel.y]
      : []
  ));
  if (samples.length >= 4) {
    const robust = robustScale(samples);
    // A spread this wide means the rooms disagree about the drawing, not that
    // one of them is slightly off; sizing against their median would spread
    // the disagreement rather than resolve it.
    if (robust && robust.spread <= 2) return { x: robust.value, y: robust.value };
  }
  const { calibrated, feetPerPixel } = state.calibration;
  if (calibrated && feetPerPixel?.x > 0 && feetPerPixel?.y > 0) {
    return { x: 1 / feetPerPixel.x, y: 1 / feetPerPixel.y };
  }
  return null;
};

const excludedAreasNote = (traced) => {
  const garages = traced.excludedGarages ?? 0;
  const others = (traced.excludedRegions ?? 0) - garages;
  if (garages && others > 0) return ' Garage and porch/patio areas excluded.';
  if (garages) return ' Garage area excluded.';
  if (others > 0) return ' Porch/patio areas excluded.';
  return '';
};

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
  const setExteriorLabels = useAppStore((s) => s.setExteriorLabels);
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

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dimensionEditActiveRef = useRef(false); // Prevents duplicate undo saves when focus moves between InchesInput sub-fields

  // Central toast helper. Prefer an explicit type so severity isn't guessed
  // from wording: notify('Saved', { type: 'success' }).
  // Back-compat: a bare number is still treated as the duration, and when no
  // type is given the severity is inferred from the message text.
  const notify = useCallback((message, options = {}) => {
    const opts = typeof options === 'number' ? { duration: options } : options;
    const { duration = 3000, id } = opts;
    const toastOpts = id ? { duration, id } : { duration };

    let type = opts.type;
    if (!type) {
      const msg = message.toLowerCase();
      if (msg.includes('error') || msg.includes('fail') || msg.includes('unable')) type = 'error';
      else if (msg.includes('success') || msg.includes('detected') || msg.includes('loaded')) type = 'success';
      else type = 'default';
    }

    const emit = { success: toast.success, error: toast.error, warning: toast.warning, info: toast.info }[type] || toast;
    emit(message, toastOpts);
  }, []);

  // ── Custom hooks ─────────────────────────────────────────────────────────

  const { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft } = useAutosave(notify);
  const { enhancedOcr, handleEnhancedOcrChange } = useEnhancedOcr(notify);

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
  const handleRestart = async () => {
    if (image) {
      const confirmed = await confirmToast('Restart and clear the current project?', {
        confirmLabel: 'Restart',
      });
      if (!confirmed) return;
    }
    clearAutosavedDraft();
    undoManager.clear();
    useAppStore.getState().restart();
    notify('Project reset.', { type: 'success' });
  };

  // OCR found nothing usable: drop a placeholder overlay in the middle of the
  // image for the user to size by hand.
  const placeCentredOverlay = useCallback((imgSrc) => {
    const img = new Image();
    img.onload = () => {
      const centerX = img.width / 2;
      const centerY = img.height / 2;
      setRoomOverlay({
        x1: centerX - 100, y1: centerY - 100, x2: centerX + 100, y2: centerY + 100,
      });
      setPerimeterVertices([]);
      setMode('normal');
    };
    img.src = imgSrc;
  }, [setRoomOverlay, setPerimeterVertices, setMode]);

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
        const confirmed = await confirmToast(
          'Entering Manual Mode will clear existing overlays. Continue?',
          { confirmLabel: 'Continue' }
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
        notify('Please load an image first.', { type: 'error' });
        return;
      }
      
      setIsProcessing(true, 'Scanning for dimensions…');
      setMode('manual');
      setManualEntryMode(false);
      setOcrFailed(false);
      
      try {
        const result = await detectAllDimensions(imgSrc);

        const dimensions = result.dimensions || result || [];
        const detectedFormat = result.detectedFormat;

        // Garage/porch/patio/deck/balcony labels: kept for perimeter tracing
        // so non-GLA features get carved out of the footprint.
        setExteriorLabels(result.exteriorLabels || []);
        setDetectedDimensions(dimensions);

        if (dimensions.length === 0) {
          setOcrFailed(true);
          notify('No dimensions found — enter room size manually.', { type: 'warning' });
          placeCentredOverlay(imgSrc);
        } else {
          setOcrFailed(false);
          const count = dimensions.length;
          notify(`Detected ${count} dimension${count === 1 ? '' : 's'}. Select one to place the room.`, { type: 'success' });
          // Auto-switch unit based on detected format. The parser's vocabulary
          // is {inches, decimal, meters} and the UI's is {inches, decimal,
          // metric}; without the mapping a metric plan set a unit no formatter
          // recognised.
          const uiUnit = detectedFormat === 'meters' ? 'metric' : detectedFormat;
          if (uiUnit && unit !== uiUnit) {
            setUnit(uiUnit);
            const label = uiUnit === 'inches' ? 'feet-inches'
              : uiUnit === 'metric' ? 'meters' : 'decimal feet';
            notify(`Switched to ${label} mode based on detected dimensions.`, { type: 'info' });
          }
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        setOcrFailed(true);
        notify('Could not scan dimensions — enter room size manually.', { type: 'error' });
        placeCentredOverlay(imgSrc);
      } finally {
        setIsProcessing(false);
        // Terminate to release the worker's WASM heap, then re-warm in the
        // background so the next scan doesn't pay engine bootstrap inside
        // its own time budget.
        terminateOcrWorker().then(() => warmupOcrEngines());
      }
    }
  }, [image, mode, roomOverlay, perimeterOverlay, unit, notify, placeCentredOverlay, setDetectedDimensions, setExteriorLabels, setIsProcessing, setManualEntryMode, setMode, setOcrFailed, setPerimeterOverlay, setRoomOverlay, setUnit]);

  // Find room size: non-destructively re-scan dimensions from the image
  const handleFindRoomSize = useCallback(async () => {
    if (!image) return;

    if (roomOverlay || perimeterOverlay) {
      const confirmed = await confirmToast(
        'Scanning for room size will clear your existing room and perimeter overlays. Continue?',
        { confirmLabel: 'Scan' }
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

  // Switch to manual outline drawing: clear the auto-detected perimeter and
  // let the user draw the exterior themselves. This is the fallback whenever
  // the tracer is unsure, so it is offered from the failure toast as well as
  // from the toolbar.
  const handleDrawExterior = useCallback(() => {
    undoManager.save();
    setPerimeterOverlay(null);
    setPerimeterVertices([]); // activate manual vertex placement
    notify('Click to place the exterior outline. Esc/Enter to finish.', { type: 'info' });
  }, [setPerimeterOverlay, setPerimeterVertices, notify]);

  // Apply detected boundaries to perimeter traces. Returns the number of
  // floors applied (0 = nothing usable). A single floor updates the active
  // trace as before; multiple floors replace the trace list with one trace
  // per floor, each independently editable afterwards. Each trace carries the
  // detector's confidence and reasons, so a doubtful outline stays marked as
  // doubtful after it is on the canvas.
  const applyTracedBoundary = useCallback((boundaryResult, interiorMode) => {
    const floors = getFloorBoundariesForMode(boundaryResult, interiorMode);
    if (!floors.length) return 0;

    const shaped = floors.map((boundary) => ({
      vertices: boundary.polygon.map((point) => ({ x: point.x, y: point.y })),
      holes: boundary.holes.map((hole) => hole.map((point) => ({ x: point.x, y: point.y }))),
      quality: {
        source: 'auto',
        confidence: boundary.confidence,
        warnings: boundary.warnings,
      },
    }));

    if (shaped.length === 1) {
      setPerimeterVertices(null);
      setPerimeterOverlay(shaped[0]);
    } else {
      useAppStore.getState().applyDetectedTraces(shaped);
    }
    return shaped.length;
  }, [setPerimeterOverlay, setPerimeterVertices]);

  // Report the trace honestly. A low-confidence outline is applied but
  // announced as one to check, with the reason and a one-click way to draw it
  // by hand instead — the previous behaviour fired an unconditional green
  // "Perimeter detected" even for a footprint covering 6% of the building.
  const reportTrace = useCallback((traced, floorCount) => {
    const quality = qualitySummary(traced?.quality);
    const mode = useInteriorWalls ? 'inner' : 'outer';
    const excludedNote = excludedAreasNote(traced ?? {});
    const drawAction = { label: 'Draw exterior', onClick: handleDrawExterior };

    if (!floorCount) {
      toast.error(quality.reason
        ? `No usable perimeter — ${quality.reason}.`
        : 'No usable perimeter detected.', { duration: 8000, action: drawAction });
      return;
    }

    const what = floorCount > 1
      ? `Detected ${floorCount} floors (${mode} wall mode)`
      : `Perimeter detected (${mode} wall mode)`;

    if (quality.level === 'good') {
      notify(`${what}.${excludedNote}`, { type: 'success', duration: 2500 });
      return;
    }
    const confidenceNote = quality.percent === null ? '' : ` (${quality.percent}% confidence)`;
    const reason = quality.reason ? ` — ${quality.reason}` : '';
    const emit = quality.level === 'fair' ? toast.warning : toast.error;
    emit(`${what}${confidenceNote}: check it${reason}.`, {
      duration: 10000,
      action: drawAction,
    });
  }, [useInteriorWalls, handleDrawExterior, notify]);

  const runTrace = useCallback(async (message) => {
    if (!image) return;
    setIsProcessing(true, message);
    const startImage = image;
    try {
      const traced = await traceFloorplanBoundary(image, {
        excludeRegions: nonGlaExcludeRegions(),
        constraints: boundaryConstraints(),
      });

      if (useAppStore.getState().image !== startImage) return;
      setTracedBoundaries(traced);
      const floorCount = traced ? applyTracedBoundary(traced, useInteriorWalls) : 0;
      reportTrace(traced, floorCount);
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Perimeter detection failed:', error);
        toast.error('Perimeter detection failed.', {
          duration: 8000,
          action: { label: 'Draw exterior', onClick: handleDrawExterior },
        });
      }
    } finally {
      if (useAppStore.getState().image === startImage) {
        setIsProcessing(false);
      }
    }
  }, [image, useInteriorWalls, setTracedBoundaries, applyTracedBoundary, setIsProcessing,
    reportTrace, handleDrawExterior]);

  const handleTracePerimeter = useCallback(async () => {
    if (!image) return;
    undoManager.save();
    await runTrace('Tracing exterior walls…');
  }, [image, runTrace]);

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

  // Handle image update from eraser or crop tool (saves undo point before
  // changing). The cached detection result describes the *previous* image, so
  // it is dropped — kept, toggling inner/outer after a crop re-applied
  // pre-crop geometry.
  const handleImageUpdate = useCallback((newImageDataUrl) => {
    undoManager.save();
    setImage(newImageDataUrl);
    setTracedBoundaries(null);
  }, [setImage, setTracedBoundaries]);

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




  // Update scale based on room dimensions and overlay.
  //
  // Two scalars come out of one room and the area is their product, so an
  // error in either is silently reinterpreted as "the drawing has non-square
  // pixels" - a room measured wrong one way and wrong the other way still
  // lands inside the plausible range. Comparing them is the cheapest
  // correctness check the app has, and every room the detector has placed is
  // a second opinion on the same number.
  const updateScale = useCallback((dimensions, overlay, options = {}) => {
    if (!dimensions.width || !dimensions.height || !overlay) return;

    const dimWidth = parseFloat(dimensions.width);
    const dimHeight = parseFloat(dimensions.height);
    const overlayWidth = Math.abs(overlay.x2 - overlay.x1);
    const overlayHeight = Math.abs(overlay.y2 - overlay.y1);

    if (overlayWidth === 0 || overlayHeight === 0) return;
    if (isNaN(dimWidth) || isNaN(dimHeight) || dimWidth <= 0 || dimHeight <= 0) return;

    // Scale X is based on horizontal width:
    let scaleX = dimWidth / overlayWidth;
    // Scale Y is based on vertical height:
    let scaleY = dimHeight / overlayHeight;

    if (!scaleIsotropy(scaleX, scaleY).ok && options.announce !== false) {
      // Pool every room measured so far. One bad rectangle cannot move the
      // median, so the project keeps a usable scale instead of adopting the
      // outlier.
      const samples = useAppStore.getState().rooms
        .flatMap((r) => (r.feetPerPixel ? [r.feetPerPixel.x, r.feetPerPixel.y] : []));
      const robust = samples.length >= 4 ? robustScale(samples) : null;
      if (robust) {
        scaleX = robust.value;
        scaleY = robust.value;
        notify(
          'This room\u2019s width and height disagree about the scale; using the '
          + 'median of the rooms measured so far.',
          { type: 'warning', duration: 6000 },
        );
      } else {
        notify(
          'This room\u2019s width and height disagree about the scale \u2014 check '
          + 'the room outline and its label.',
          { type: 'warning', duration: 6000 },
        );
      }
    }

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
  }, [applyRoomCalibration, notify]);

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

  // Handle closing the perimeter
  const handleClosePerimeter = useCallback(() => {
    const currentVertices = useAppStore.getState().perimeterVertices;
    if (currentVertices && currentVertices.length > 2) {
      undoManager.save();
      setPerimeterOverlay({ vertices: currentVertices });
      setPerimeterVertices(null); // Exit vertex placement mode
    }
  }, [setPerimeterOverlay, setPerimeterVertices]);

  // Delete a specific perimeter vertex by index (right-click on vertex)
  const handleDeletePerimeterVertex = useCallback((index) => {
    const overlay = selectPerimeterOverlay(useAppStore.getState());
    if (!overlay?.vertices || overlay.vertices.length <= 3) return;
    updatePerimeterVertices(
      overlay.vertices.filter((_, i) => i !== index),
      true
    );
  }, [updatePerimeterVertices]);

  // Auto-trace exterior boundary after a room overlay is placed.
  const autoTraceExterior = useCallback(
    () => runTrace('Detecting exterior boundary…'),
    [runTrace],
  );

  /**
   * Place a room: run the detector, record the result as reusable evidence,
   * calibrate from it, then trace the exterior. The two entry points (clicking
   * a detected dimension pill and clicking the canvas in manual mode) differ
   * only in whether a label bounding box is known.
   */
  const placeRoom = useCallback(async ({ point, dims, labelBbox, labelId }) => {
    let overlay = {
      x1: point.x - 100,
      y1: point.y - 100,
      x2: point.x + 100,
      y2: point.y + 100,
    };
    let detected = null;

    setIsProcessing(true, 'Finding room\\u2026');
    const startImage = image;
    try {
      detected = await detectRoomFromClick(image, point, {
        labelBbox, labelDims: dims, pixelsPerFoot: roomScaleHint(),
      });
      if (useAppStore.getState().image === startImage && detected?.overlay) {
        overlay = {
          ...detected.overlay,
          polygon: detected.polygon,
          confidence: detected.confidence,
        };
      }
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Room detection failed:', error);
      }
    } finally {
      if (useAppStore.getState().image === startImage) {
        setIsProcessing(false);
      }
    }

    if (useAppStore.getState().image !== startImage) return;

    if (!detected) {
      // A failed room detection used to fall through to a hardcoded 200x200
      // box and calibrate the whole project from it, without a word.
      notify(
        'Could not find the room outline \\u2014 drag the overlay to match the room, '
        + 'then check the area.',
        { type: 'warning', duration: 6000 },
      );
    } else {
      useAppStore.getState().addRoom({
        labelId: labelId ?? null,
        name: null,
        rect: detected.rect,
        confidence: detected.confidence,
        sides: detected.sides,
        feetPerPixel: detected.pixelsPerFoot
          ? { x: 1 / detected.pixelsPerFoot.x, y: 1 / detected.pixelsPerFoot.y }
          : null,
      });
      // The detector already knows when it could not confirm this room's
      // walls, and the very next statement calibrates the whole project from
      // the rectangle. Saying nothing made a doubtful room indistinguishable
      // from a certain one at exactly the moment it mattered most.
      if (detected.confidence < 0.5) {
        notify(
          'This room’s outline is uncertain, and the scale comes from it — '
          + 'check the overlay against the room before trusting the area.',
          { type: 'warning', duration: 8000 },
        );
      }
    }

    const dimStrings = { width: String(dims.width), height: String(dims.height) };
    setRoomDimensions(dimStrings);
    setRoomOverlay(overlay);
    updateScale(dimStrings, overlay);

    setPerimeterVertices(null);
    setManualEntryMode(false);
    setMode('normal');

    // Trace the exterior with the label set still in hand: it used to be
    // cleared one statement earlier, so the tracer ran blind to every room
    // size the OCR pass had just found.
    await autoTraceExterior();
    setDetectedDimensions([]);
  }, [image, setIsProcessing, setRoomDimensions, setRoomOverlay, updateScale,
    setPerimeterVertices, setManualEntryMode, setMode, setDetectedDimensions,
    autoTraceExterior, notify]);

  // Handle dimension selection in manual mode
  const handleDimensionSelect = useCallback((dimension) => {
    undoManager.save();
    placeRoom({
      point: {
        x: dimension.bbox.x + dimension.bbox.width / 2,
        y: dimension.bbox.y + dimension.bbox.height / 2,
      },
      dims: { width: dimension.width, height: dimension.height },
      labelBbox: dimension.bbox,
      labelId: `${dimension.text ?? ''}@${Math.round(dimension.bbox.x)},${Math.round(dimension.bbox.y)}`,
    });
  }, [placeRoom]);

  // Handle canvas click for manual overlay placement
  const handleCanvasClick = useCallback((clickPoint) => {
    if (!manualEntryMode || !roomDimensions.width || !roomDimensions.height) return;

    const width = parseFloat(roomDimensions.width);
    const height = parseFloat(roomDimensions.height);
    if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
      notify('Please enter valid room dimensions first.', { type: 'error' });
      return;
    }

    undoManager.save();
    placeRoom({ point: clickPoint, dims: { width, height } });
  }, [manualEntryMode, roomDimensions, placeRoom, notify]);

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
        onDrawExterior={handleDrawExterior}
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
            onClosePerimeter={handleClosePerimeter}
            autoSnapEnabled={autoSnapEnabled}
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
            enhancedOcr={enhancedOcr}
            onEnhancedOcrChange={handleEnhancedOcrChange}
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
            actionButton: '!bg-[#BD93F9] !text-[#282A36] !font-semibold hover:!bg-[#A97EF0]',
            cancelButton: '!bg-[#44475A] !text-[#F8F8F2] hover:!bg-[#6272A4]',
            closeButton: '!bg-[#282A36] !border-[#44475A] !text-[#F8F8F2] hover:!bg-[#44475A]',
          }
        }}
      />
    </div>
  );
}

export default App;
