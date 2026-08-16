import { useRef, useEffect, useCallback } from 'react';
import { Toaster, toast } from 'sonner';
import Canvas from './components/Canvas';
import MenuBar from './components/MenuBar';
import CommandBar from './components/CommandBar';
import ContextBar from './components/ContextBar';
import ToolRail from './components/ToolRail';
import MeasurementDock from './components/MeasurementDock';
import StatusBar from './components/StatusBar';
import HelpModal from './components/HelpModal';
import ExportDialog from './components/ExportDialog';
import { confirmToast } from './utils/confirmToast';
import {
  detectRoomFromClick,
  getFloorBoundaryFaces,
  traceFloorplanBoundary,
  terminateDetectionWorker,
} from './utils/detection';
import {
  detectAllDimensions,
  terminateOcrWorker,
  releaseOcrWorkersWhenIdle
} from './utils/DimensionsOCR';
import {
  robustScale, orientDimsToBox, resolveScaleUpdate,
} from './utils/detection/validate';
import { ringSetArea } from './utils/detection/polygon';
import { roomIsNonGla } from './utils/dimensions/exteriorLabels';
import { useAutoScale } from './hooks/useAutoScale';
import { qualitySummary, scaleQualitySummary } from './utils/boundaryQuality';
import useAppStore, {
  selectCombinedArea, selectPerimeterOverlay, selectCanSwitchWallFace, otherRoomScaleSamples,
} from './store/appStore';
import * as undoManager from './store/undoManager';
import { useAutosave } from './hooks/useAutosave';
import { useEnhancedOcr } from './hooks/useEnhancedOcr';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToolManager } from './hooks/useToolManager';
import { useProjectIO } from './hooks/useProjectIO';
import { useExhibitExport } from './hooks/useExhibitExport';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useOcrWarmup } from './hooks/useOcrWarmup';
import { useTheme } from './hooks/useTheme';

// What the status bar calls each mode, and the one-line reminder beside it.
// Deliberately separate from ContextBar's copy: that bar states the whole
// instruction, this is the glance version.
const MODE_LABEL = {
  select: 'Select',
  draw: 'Paint outline',
  vertex: 'Place corners',
  void: 'Cut out',
  scale: 'Set scale',
  line: 'Measure',
  angle: 'Measure angle',
  area: 'Draw area',
  crop: 'Crop',
  eraser: 'Erase',
  place: 'Place room',
};

const MODE_HINT = {
  select: 'Drag a corner to adjust an outline',
  draw: 'Paint over the exterior walls',
  vertex: 'Click each corner of the exterior',
  void: 'Drag over a courtyard or light well',
  scale: 'Click both ends of a known length',
  line: 'Click a start and an end point',
  angle: 'Drag the arms onto two walls',
  area: 'Click each corner of the area',
  crop: 'Drag the region to keep',
  eraser: 'Drag over clutter to remove it',
  place: 'Click the room on the plan',
};

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
    // A garage is inside the drawing but is exactly what the tracer is being
    // asked to carve out, so asserting it as known-inside is wrong input even
    // where it happens not to change the answer (candidates are scored before
    // the carve — see floorplan-image.test.js). Same rule the interior points
    // below have always followed; `rooms` only escaped it while it held the one
    // room the user had clicked.
    rooms: state.rooms
      .filter((r) => r.rect && !roomIsNonGla(r, nonGla))
      .map((r) => ({ name: r.name ?? null, rect: r.rect })),
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

// Traced floor area in image pixels. Every floor, not the largest: the labels
// are spread over all of them, and weighing them against one floor reports a
// correct scale on a multi-floor sheet as implausible.
const tracedAreaPx = (traced) => {
  const floors = traced?.floors?.length ? traced.floors : (traced ? [traced] : []);
  return floors.reduce((sum, floor) => (
    floor?.outer?.polygon ? sum + ringSetArea(floor.outer.polygon, floor.holes ?? []) : sum
  ), 0);
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
  const canSwitchWallFace = useAppStore(selectCanSwitchWallFace);
  const showHelpModal = useAppStore((s) => s.showHelpModal);
  const showExportDialog = useAppStore((s) => s.showExportDialog);
  const eraserToolActive = useAppStore((s) => s.eraserToolActive);
  const eraserBrushSize = useAppStore((s) => s.eraserBrushSize);
  const cropToolActive = useAppStore((s) => s.cropToolActive);
  const voidToolActive = useAppStore((s) => s.voidToolActive);
  const angleToolActive = useAppStore((s) => s.angleToolActive);
  const angleToolState = useAppStore((s) => s.angleToolState);
  const drawModeActive = useAppStore((s) => s.drawModeActive);
  const drawBrushSize = useAppStore((s) => s.drawBrushSize);
  const drawStrokes = useAppStore((s) => s.drawStrokes);
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);

  // Floor management
  const addPerimeterTrace = useAppStore((s) => s.addPerimeterTrace);
  const clearWallFaces = useAppStore((s) => s.clearWallFaces);

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
  const setRooms = useAppStore((s) => s.setRooms);
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
  const setDrawBrushSize = useAppStore((s) => s.setDrawBrushSize);
  const setDrawStrokes = useAppStore((s) => s.setDrawStrokes);
  const setDrawModeActive = useAppStore((s) => s.setDrawModeActive);

  const fileInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dimensionEditActiveRef = useRef(false); // Prevents duplicate undo saves when focus moves between InchesInput sub-fields
  const dimensionWarnTimerRef = useRef(null); // Holds the scale warning until typing settles
  const dimensionBlurTimerRef = useRef(null); // Survives focus moving between sub-fields

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
  const { measureAndCalibrate, reviewAgainstFootprint } = useAutoScale(notify);
  // The scan runs before the exterior trace is even defined in this file, and
  // the automatic path needs both. A ref rather than a reordering: moving
  // handleManualMode below the tracer would drag handleFindRoomSize and its
  // call sites with it.
  const afterScanRef = useRef(null);

  const {
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCropToolToggle,
    handleAngleToolToggle,
    handleDrawModeToggle,
    handleScaleToolToggle,
    handleClearTools,
    handleVoidToolToggle,
    deactivateAll,
  } = useToolManager();

  // Declared after handlePasteImage / handleFileOpen (see below) so the
  // shortcut hook can close over the stable callback references.

  // ── OCR engine warm-up & cleanup ─────────────────────────────────────────
  // Warm-up is deliberately *not* at mount — see useOcrWarmup for why booting
  // tesseract eagerly cost every visitor ~4.4 MB gz on the critical path.
  useOcrWarmup();

  useEffect(() => {
    return () => {
      terminateDetectionWorker();
      terminateOcrWorker();
      clearTimeout(dimensionWarnTimerRef.current);
      clearTimeout(dimensionBlurTimerRef.current);
    };
  }, []);

  // Mode is shown by <ContextBar>, docked under the command bar. It used to be
  // eight `duration: Infinity` toasts — the app's only persistent mode
  // indicator, rendered over the canvas, stacking with real notifications, and
  // carrying the sole documentation of Esc-to-cancel.
  const activeTool = drawModeActive ? 'draw'
    : perimeterVertices !== null ? 'vertex'
      : voidToolActive ? 'void'
        : scaleToolActive ? 'scale'
          : lineToolActive ? 'line'
            : angleToolActive ? 'angle'
              : drawAreaActive ? 'area'
                : cropToolActive ? 'crop'
                  : eraserToolActive ? 'eraser'
                    : manualEntryMode ? 'place'
                      : 'select';

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
          notify(`Detected ${count} dimension${count === 1 ? '' : 's'}.`, { type: 'success' });
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
          // Everything from here is automatic: every label is measured, the
          // rooms that agree set the scale, and the exterior is traced. The
          // pills stay on screen, so clicking one still pins the scale to that
          // room when the user can see the app chose badly.
          await afterScanRef.current?.(dimensions);
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        setOcrFailed(true);
        notify('Could not scan dimensions — enter room size manually.', { type: 'error' });
        placeCentredOverlay(imgSrc);
      } finally {
        setIsProcessing(false);
        // Keep the warm worker pool around for a re-scan or a second image,
        // then release its WASM heaps once the user has clearly moved on.
        // Tearing down immediately made every scan after the first pay engine
        // bootstrap inside its own time budget.
        releaseOcrWorkersWhenIdle(60000);
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
    // The rooms measured from the previous scan describe labels this one is
    // about to re-read. Left behind, they voted in the new scan's scale and
    // were still handed to the tracer as known-inside evidence.
    setRooms([]);

    await handleManualMode(image, true);
  }, [
    image,
    roomOverlay,
    perimeterOverlay,
    setRoomOverlay,
    setPerimeterOverlay,
    setPerimeterVertices,
    setDetectedDimensions,
    setRooms,
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

  const { openExport, closeExport, copyExhibitNow } = useExhibitExport(notify);

  const {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  } = useDragAndDrop(notify, handleManualMode, checkUnsavedChanges);

  // Vertex-by-vertex outline placement. Draw mode is the default fallback now,
  // but placing exact corners is still the right tool when the plan is clean
  // and the user knows precisely where the wall goes.
  const handleDrawExterior = useCallback(() => {
    undoManager.save();
    setDrawModeActive(false);
    setPerimeterOverlay(null);
    setPerimeterVertices([]); // activate manual vertex placement
    notify('Click to place the exterior outline. Esc/Enter to finish.', { type: 'info' });
  }, [setDrawModeActive, setPerimeterOverlay, setPerimeterVertices, notify]);

  // Draw mode: paint roughly over the exterior walls and let the tracer read
  // the strokes as a corridor. This is the fallback whenever auto-detection
  // fails, so it is entered from the failure path as well as from the toolbar.
  const handleDrawMode = useCallback(({ message, keepStrokes = false } = {}) => {
    undoManager.save();
    setPerimeterVertices(null);
    setPerimeterOverlay(null);
    if (!keepStrokes) setDrawStrokes([]);
    // Always enters; the toggle would turn it back off when already on.
    if (!useAppStore.getState().drawModeActive) handleDrawModeToggle();
    notify(message ?? 'Paint over the exterior walls. [ and ] resize the brush, Enter when done.',
      { type: 'info', duration: 7000 });
  }, [setPerimeterVertices, setPerimeterOverlay, setDrawStrokes, handleDrawModeToggle, notify]);

  // Apply detected boundaries to perimeter traces. Returns the number of
  // floors applied (0 = nothing usable). A single floor updates the active
  // trace as before; multiple floors replace the trace list with one trace
  // per floor, each independently editable afterwards. Each trace carries the
  // detector's confidence and reasons, so a doubtful outline stays marked as
  // doubtful after it is on the canvas.
  const applyTracedBoundary = useCallback((boundaryResult, interiorMode) => {
    const faces = getFloorBoundaryFaces(boundaryResult);
    const key = interiorMode ? 'inner' : 'outer';
    const floors = faces.filter((floor) => floor[key]);
    if (!floors.length) return 0;

    const source = boundaryResult?.quality?.source ?? 'auto';
    // The one boundary where pipeline holes become trace holes, and so the one
    // place the provenance tag is applied — the detector itself keeps emitting
    // bare rings.
    const shapeFace = (face) => face && {
      vertices: face.polygon.map((point) => ({ x: point.x, y: point.y })),
      holes: face.holes.map((hole, i) => ({
        id: `hole-auto-${i}`,
        ring: hole.map((point) => ({ x: point.x, y: point.y })),
        source: 'auto',
      })),
    };

    const shaped = floors.map((floor) => {
      // Both faces ride along on the trace, so a later flip of the switch moves
      // this outline too — even once a further detection run has replaced
      // `tracedBoundaries` with a result that knows nothing about it.
      const wallFaces = { outer: shapeFace(floor.outer), inner: shapeFace(floor.inner) };
      return {
        ...wallFaces[key],
        wallFaces,
        quality: {
          source,
          confidence: floor.confidence,
          warnings: floor.warnings,
        },
      };
    });

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
    const drawn = traced?.quality?.source === 'drawn';
    // A drawn trace that went wrong is corrected by painting again, not by
    // switching to a different tool, so the offer differs from the auto path's.
    const drawAction = drawn
      ? { label: 'Redraw', onClick: () => handleDrawMode({ keepStrokes: true,
        message: 'Add or adjust strokes, then press Enter.' }) }
      : { label: 'Draw mode', onClick: () => handleDrawMode() };

    if (!floorCount) {
      toast.error(quality.reason
        ? `No usable perimeter — ${quality.reason}.`
        : 'No usable perimeter detected.', { duration: 8000, action: drawAction });
      return;
    }

    const noun = drawn ? 'Exterior traced from your outline' : 'Perimeter detected';
    const what = floorCount > 1
      ? `${drawn ? 'Traced' : 'Detected'} ${floorCount} floors (${mode} wall mode)`
      : `${noun} (${mode} wall mode)`;

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
  }, [useInteriorWalls, handleDrawMode, notify]);

  // Returns the quality level of the applied trace, so the caller can decide
  // whether to fall back. `brush` carries draw mode's strokes (original image
  // px) and turns the whole stage into a search inside those strokes.
  const runTrace = useCallback(async (message, brush = null) => {
    if (!image) return null;
    setIsProcessing(true, message);
    const startImage = image;
    try {
      const traced = await traceFloorplanBoundary(image, {
        excludeRegions: nonGlaExcludeRegions(),
        constraints: boundaryConstraints(),
        ...(brush ? { brush } : {}),
      });

      if (useAppStore.getState().image !== startImage) return null;
      // Kept for brush results too: a drawn trace has the same inner/outer
      // pair, so toggling wall mode afterwards must still work.
      setTracedBoundaries(traced);
      const floorCount = traced ? applyTracedBoundary(traced, useInteriorWalls) : 0;
      // Every trace, not only the one the automatic scan ran: the footprint is
      // the one check on the scale that survives a majority of bad rooms, and a
      // toolbar re-trace or a draw-mode pass changes it. It re-runs a pure
      // selection over rooms already measured, and no-ops unless the scale in
      // force is still the automatic one.
      if (floorCount) reviewAgainstFootprint(tracedAreaPx(traced));
      reportTrace(traced, floorCount);
      return floorCount ? qualitySummary(traced?.quality).level : 'failed';
    } catch (error) {
      if (useAppStore.getState().image === startImage) {
        console.error('Perimeter detection failed:', error);
        toast.error('Perimeter detection failed.', {
          duration: 8000,
          action: { label: 'Draw mode', onClick: () => handleDrawMode() },
        });
      }
      return 'failed';
    } finally {
      if (useAppStore.getState().image === startImage) {
        setIsProcessing(false);
      }
    }
  }, [image, useInteriorWalls, setTracedBoundaries, applyTracedBoundary, setIsProcessing,
    reportTrace, handleDrawMode, reviewAgainstFootprint]);

  // Auto-detection, with draw mode as its fallback. A result the detector
  // itself rates poor or worse is not something to hand over as an answer, so
  // the brush is put in the user's hand rather than merely offered.
  const handleTracePerimeter = useCallback(async () => {
    if (!image) return;
    undoManager.save();
    const level = await runTrace('Tracing exterior walls…');
    if (level === 'failed' || level === 'poor') {
      handleDrawMode({
        message: 'Auto-detection could not read this plan. Paint over the exterior walls instead — [ and ] resize the brush, Enter when done.',
      });
    }
  }, [image, runTrace, handleDrawMode]);

  // Draw mode's commit: hand the painted strokes to the tracer as a corridor.
  const handleFinishDrawMode = useCallback(async () => {
    const state = useAppStore.getState();
    const strokes = state.drawStrokes;
    if (!strokes.length) {
      setDrawModeActive(false);
      notify('Nothing painted — draw mode closed.', { type: 'info' });
      return;
    }
    undoManager.save();
    setDrawModeActive(false);
    const level = await runTrace('Reading your outline…', {
      strokes,
      radius: state.drawBrushSize / 2,
    });
    // The strokes are kept when the result is doubtful: re-entering draw mode
    // to add one more pass is the natural correction, and discarding them
    // would make the user paint the whole outline again.
    if (level === 'good' || level === 'fair') setDrawStrokes([]);
  }, [runTrace, setDrawModeActive, setDrawStrokes, notify]);

  // One setting over every outline. Each traced outline carries the detector's
  // own inner/outer pair, so the switch reaches outlines from earlier detection
  // runs as well as the current one; re-applying `tracedBoundaries` is only the
  // fallback for drafts saved before the pair was stored, and it can move
  // nothing but the most recent run.
  const handleInteriorWallToggle = (value) => {
    undoManager.save();
    setUseInteriorWalls(value);
    const switched = useAppStore.getState().setWallFaceMode(value);
    if (!switched && tracedBoundaries) {
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
  // pre-crop geometry. The per-trace wall-face pairs are the same cache one
  // level down and go with it, or the switch would walk straight back into it.
  const handleImageUpdate = useCallback((newImageDataUrl) => {
    undoManager.save();
    setImage(newImageDataUrl);
    setTracedBoundaries(null);
    clearWallFaces();
    // Room rectangles are in image pixels, so a crop moves every one of them
    // and an erase can remove the wall a room was measured against.
    setRooms([]);
    // `scaleLines` and `calibration` deliberately survive: the crop tool keeps
    // the canvas at full size and redraws the selection in place, and neither
    // it nor the eraser resamples, so image-pixel coordinates — and therefore
    // feet-per-pixel — are invariant across both. Do not add a defensive reset.
  }, [setImage, setTracedBoundaries, setRooms, clearWallFaces]);

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




  // Set the project scale from one room. The decision — which rooms get a
  // vote, what the verdict is, whether anything moved — is resolveScaleUpdate's
  // and is unit-tested there; what is left here is the store write and the
  // toast, the two things a pure function cannot do.
  const updateScale = useCallback((dimensions, overlay, options = {}) => {
    const state = useAppStore.getState();
    const resolved = resolveScaleUpdate({
      dimensions,
      overlay,
      otherSamples: otherRoomScaleSamples(state.rooms, overlay),
      calibration: state.calibration,
      pinned: !!options.pinned,
    });
    if (!resolved) return;

    // Say it out loud only when the answer changed or is in doubt; the Area
    // panel carries the same verdict for as long as the scale is in force,
    // because that is where the question is actually asked.
    const summary = scaleQualitySummary(resolved.quality);
    if (summary && summary.level === 'check' && options.announce !== false) {
      notify(summary.detail, {
        type: 'warning',
        duration: 8000,
        // One id: the blur check and the typing backstop can both land on the
        // same mismatch, and it is one problem, not two.
        id: 'room-scale-disagreement',
      });
    }

    if (resolved.changed) {
      applyRoomCalibration(resolved.scale, null, 'room-calibration', resolved.quality);
    }
  }, [applyRoomCalibration, notify]);

  // Update room overlay position. Pinned: dragging the overlay is the user
  // correcting the room the app got wrong, and unpinned it was outvoted by the
  // consensus that produced the wrong room — then adopted verbatim on the very
  // next drag, once the rejected write had pinned the calibration.
  const updateRoomOverlay = useCallback((overlay, saveAction = true) => {
    if (saveAction) undoManager.save();
    setRoomOverlay(overlay);
    if (roomDimensions.width && roomDimensions.height) {
      updateScale(roomDimensions, overlay, { pinned: true });
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

  // Delete a specific perimeter vertex by index (right-click, or Delete on a
  // selected vertex). The floor of three needs a voice: with a visible
  // selection and a Delete key, a silent no-op reads as a broken keybinding.
  const handleDeletePerimeterVertex = useCallback((index) => {
    const overlay = selectPerimeterOverlay(useAppStore.getState());
    if (!overlay?.vertices) return;
    if (overlay.vertices.length <= 3) {
      notify('A perimeter needs at least three points.', { type: 'warning' });
      return;
    }
    updatePerimeterVertices(
      overlay.vertices.filter((_, i) => i !== index),
      true
    );
  }, [updatePerimeterVertices, notify]);

  // Auto-trace exterior boundary after a room overlay is placed.
  const autoTraceExterior = useCallback(
    () => runTrace('Detecting exterior boundary…'),
    [runTrace],
  );

  /**
   * The automatic path, run once a scan has found labels: measure every one of
   * them, calibrate from the rooms that agree, trace the exterior with those
   * rooms as evidence, then judge the scale against the building it produced.
   */
  const runAutoScale = useCallback(async (dimensions) => {
    const labels = dimensions
      .filter((d) => d.bbox && d.width > 0 && d.height > 0)
      .map((d) => ({
        id: `${d.text ?? ''}@${Math.round(d.bbox.x)},${Math.round(d.bbox.y)}`,
        point: { x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 },
        labelBbox: d.bbox,
        labelDims: { width: d.width, height: d.height },
      }));
    if (!labels.length) return;

    setIsProcessing(true, 'Measuring rooms…');
    let decision = null;
    try {
      decision = await measureAndCalibrate(labels);
    } finally {
      setIsProcessing(false);
    }
    if (!decision) {
      // Nothing measurable. The user still has the pills, which is the flow
      // they had before this ran at all, so this is not worth a warning.
      return;
    }

    // The footprint cross-check runs inside runTrace now, so it lands here too
    // — and equally on every later re-trace, which used to leave the verdict
    // this trace produced standing against a building that no longer existed.
    await autoTraceExterior();
  }, [measureAndCalibrate, autoTraceExterior, setIsProcessing]);

  useEffect(() => {
    afterScanRef.current = runAutoScale;
  }, [runAutoScale]);

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

    setIsProcessing(true, 'Finding room…');
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
        'Could not find the room outline — drag the overlay to match the room, '
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

    // Store the label the way the room is drawn, so the panel, the overlay and
    // the scale all describe the same rectangle.
    const placed = orientDimsToBox(
      dims.width, dims.height,
      Math.abs(overlay.x2 - overlay.x1), Math.abs(overlay.y2 - overlay.y1),
    );
    const dimStrings = { width: String(placed.width), height: String(placed.height) };
    setRoomDimensions(dimStrings);
    setRoomOverlay(overlay);
    updateScale(dimStrings, overlay, { pinned: true });

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

  const handleHelpOpen = useCallback(() => {
    const s = useAppStore.getState();
    s.setShowHelpModal(!s.showHelpModal);
  }, []);
  // Typing a dimension fires this per keystroke, and half of a typed pair
  // disagrees with the room by construction: 16.7 entered as the width of a
  // room whose height still reads 16.7 is not a mismatch worth reporting. The
  // scale still follows every keystroke; only the warning waits until the
  // numbers stop moving, and then judges what the user actually left behind.
  const handleDimensionsChange = useCallback((dims) => {
    setRoomDimensions(dims);
    if (!useAppStore.getState().roomOverlay) return;
    updateScale(dims, useAppStore.getState().roomOverlay, { announce: false });
    clearTimeout(dimensionWarnTimerRef.current);
    dimensionWarnTimerRef.current = setTimeout(() => {
      // Backstop for an edit that never blurs (Enter, or the panel closing).
      // While a field still has focus the pair is mid-edit by definition.
      if (dimensionEditActiveRef.current) return;
      const s = useAppStore.getState();
      if (s.roomOverlay && s.roomDimensions.width && s.roomDimensions.height) {
        updateScale(s.roomDimensions, s.roomOverlay);
      }
    }, 1200);
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

  // Focus moving between the feet and inches sub-fields is one edit, not two:
  // cancelling the pending clear is what makes "still editing" true for the
  // whole visit, rather than false from the first tab onward.
  const handleDimensionFocus = useCallback(() => {
    clearTimeout(dimensionBlurTimerRef.current);
    if (!dimensionEditActiveRef.current) {
      dimensionEditActiveRef.current = true;
      undoManager.save();
    }
  }, []);
  const handleDimensionBlur = useCallback(() => {
    clearTimeout(dimensionBlurTimerRef.current);
    dimensionBlurTimerRef.current = setTimeout(() => {
      dimensionEditActiveRef.current = false;
      // The user has left the fields: now the pair on screen is what they
      // meant, and is worth judging out loud.
      const s = useAppStore.getState();
      if (s.roomOverlay && s.roomDimensions.width && s.roomDimensions.height) {
        updateScale(s.roomDimensions, s.roomOverlay);
      }
    }, 0);
  }, [updateScale]);
  const handleHelpClose = useCallback(() => setShowHelpModal(false), [setShowHelpModal]);
  const handleSaveUndoPoint = useCallback(() => undoManager.save(), []);
  const handleCancelUndoSave = useCallback(() => undoManager.cancelLastSave(), []);
  const handleAngleToolStateChange = useCallback((nextState) => {
    undoManager.save();
    setAngleToolState(nextState);
  }, [setAngleToolState]);

  // ── Keyboard shortcuts (wired after stable callbacks are defined) ─────────
  // Whichever brush [ and ] currently resize. Draw mode wins when both are
  // somehow on, but the tool manager makes them mutually exclusive anyway.
  const activeBrush = drawModeActive
    ? { field: 'drawBrushSize', setSize: setDrawBrushSize, min: 8, max: 400, step: 6 }
    : eraserToolActive
      ? { field: 'eraserBrushSize', setSize: setEraserBrushSize, min: 4, max: 200, step: 4 }
      : null;

  useKeyboardShortcuts({
    onPaste: handlePasteImage,
    onFileOpen: handleFileOpen,
    onSaveProject: handleSaveProject,
    onExport: openExport,
    onCopyExhibit: copyExhibitNow,
    activeBrush,
    onRotateCanvas: handleRotateCanvas,
    onFitToWindow: handleFitToWindow,
    hasArea: area > 0,
    onLineToolToggle: handleLineToolToggle,
    onDrawAreaToggle: handleDrawAreaToggle,
    onAngleToolToggle: handleAngleToolToggle,
    onOutlineByVertex: handleDrawExterior,
    onCropToolToggle: handleCropToolToggle,
    onEraserToolToggle: handleEraserToolToggle,
    onDrawExterior: handleDrawMode,
    onVoidToolToggle: handleVoidToolToggle,
    onScaleToolToggle: handleScaleToolToggle,
  });

  // ── Shell wiring ──────────────────────────────────────────────────────────
  const { theme, cycleTheme } = useTheme();
  const dockOpen = useAppStore((s) => s.dockOpen);
  const setDockOpen = useAppStore((s) => s.setDockOpen);
  const handleDockToggle = useCallback(
    () => setDockOpen(!useAppStore.getState().dockOpen),
    [setDockOpen],
  );

  // Leaving a tool: drop every flag, and drop vertex-placement and room
  // placement too — neither is a tool-manager flag, but both are modes.
  const handleCancelTool = useCallback(() => {
    deactivateAll();
    setPerimeterVertices(null);
    setManualEntryMode(false);
  }, [deactivateAll, setPerimeterVertices, setManualEntryMode]);

  // The rail speaks the same tool ids as ContextBar, and each maps to the very
  // toggle the keyboard already binds — so the two routes into a tool cannot
  // drift apart the way the old panel and the digit map had.
  const handleToolSelect = useCallback((id) => {
    switch (id) {
      case 'select': return handleCancelTool();
      case 'draw': return handleDrawMode();
      case 'vertex': return handleDrawExterior();
      case 'void': return handleVoidToolToggle();
      case 'scale': return handleScaleToolToggle();
      case 'line': return handleLineToolToggle();
      case 'angle': return handleAngleToolToggle();
      case 'area': return handleDrawAreaToggle();
      case 'crop': return handleCropToolToggle();
      case 'eraser': return handleEraserToolToggle();
      default: return undefined;
    }
  }, [handleCancelTool, handleDrawMode, handleDrawExterior, handleVoidToolToggle,
    handleScaleToolToggle, handleLineToolToggle, handleAngleToolToggle,
    handleDrawAreaToggle, handleCropToolToggle, handleEraserToolToggle]);

  const handleZoom = useCallback((direction) => {
    canvasRef.current?.zoomByStep(direction);
  }, []);

  const contextCount = activeTool === 'vertex'
    ? (perimeterVertices?.length ?? 0)
    : activeTool === 'area'
      ? (currentCustomShape?.vertices?.length ?? 0)
      : 0;
  const contextBrush = activeTool === 'draw' ? drawBrushSize
    : activeTool === 'eraser' ? eraserBrushSize : 0;
  const onContextBrushChange = activeTool === 'draw' ? setDrawBrushSize : setEraserBrushSize;
  const contextDone = activeTool === 'draw' ? handleFinishDrawMode
    : activeTool === 'vertex' ? handleClosePerimeter : null;

  const hasToolData = measurementLines?.length > 0 || customShapes?.length > 0
    || !!currentMeasurementLine || !!currentCustomShape;

  // Desktop UI - five bands: menu, commands, tool context, body, status.
  return (
    <div
      id="app-container"
      className="flex flex-col h-screen bg-shell"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <MenuBar
        image={image}
        onFileOpen={handleFileOpen}
        onPasteImage={handlePasteImage}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onExport={openExport}
        onCopyExhibit={copyExhibitNow}
        onRestart={handleRestart}
        onHelpOpen={handleHelpOpen}
        onFitToWindow={handleFitToWindow}
        onTracePerimeter={handleTracePerimeter}
        onDrawExterior={() => handleDrawMode()}
        onOutlineByVertex={handleDrawExterior}
        onFindRoomSize={handleFindRoomSize}
        onAddFloor={addPerimeterTrace}
        showSideLengths={showSideLengths}
        onShowSideLengthsChange={handleShowSideLengthsChange}
        autoSnapEnabled={autoSnapEnabled}
        onAutoSnapChange={handleAutoSnapChange}
        saveOnExit={saveOnExit}
        onSaveOnExitChange={handleSaveOnExitChangeWithToast}
        enhancedOcr={enhancedOcr}
        onEnhancedOcrChange={handleEnhancedOcrChange}
        theme={theme}
        onCycleTheme={cycleTheme}
        dockOpen={dockOpen}
        onDockToggle={handleDockToggle}
      />

      <CommandBar
        image={image}
        isProcessing={isProcessing}
        onFileOpen={handleFileOpen}
        onExport={openExport}
        hasArea={area > 0}
        onTracePerimeter={handleTracePerimeter}
        onFitToWindow={handleFitToWindow}
        onDrawExterior={() => handleDrawMode()}
        drawModeActive={drawModeActive}
        onFinishDrawMode={handleFinishDrawMode}
        perimeterOverlay={perimeterOverlay}
        onFindRoomSize={handleFindRoomSize}
        onAddFloor={addPerimeterTrace}
        floorCount={perimeterTraces.length}
        dockOpen={dockOpen}
        onDockToggle={handleDockToggle}
      />

      <ContextBar
        active={activeTool === 'select' ? null : activeTool}
        count={contextCount}
        brushSize={contextBrush}
        onBrushSizeChange={onContextBrushChange}
        onCancel={handleCancelTool}
        onDone={contextDone}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {dockOpen && (
          <MeasurementDock
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
            canSwitchWallFace={canSwitchWallFace}
            onDimensionFocus={handleDimensionFocus}
            onDimensionBlur={handleDimensionBlur}
            onScaleTool={handleScaleToolToggle}
            onExport={openExport}
          />
        )}

        {/* The plan owns everything between the two docks. Nothing floats over
            it any more - the old panels sat on its top-left corner. */}
        <div className="relative flex-1 min-w-0 canvas-grid-bg">
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
            drawModeActive={drawModeActive}
            drawBrushSize={drawBrushSize}
            drawStrokes={drawStrokes}
            onDrawModeToggle={handleDrawModeToggle}
            onFinishDrawMode={handleFinishDrawMode}
            voidToolActive={voidToolActive}
            onVoidToolToggle={handleVoidToolToggle}
          />
        </div>

        {image && (
          <ToolRail
            activeTool={activeTool}
            hasArea={area > 0}
            hasToolData={hasToolData}
            onSelect={handleToolSelect}
            onRotate={handleRotateCanvas}
            onClearTools={handleClearTools}
          />
        )}
      </div>

      <StatusBar
        mode={MODE_LABEL[activeTool] ?? 'Select'}
        hint={MODE_HINT[activeTool] ?? null}
        hasImage={!!image}
        onZoomIn={() => handleZoom(1)}
        onZoomOut={() => handleZoom(-1)}
        onExport={openExport}
      />

      {showHelpModal && <HelpModal onClose={handleHelpClose} />}

      {showExportDialog && (
        <ExportDialog
          onClose={closeExport}
          onSaveProject={handleSaveProjectNormal}
          notify={notify}
        />
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,.floorplan"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Only real notifications now - every "you are in X mode" message moved
          to the context bar, and every low-stakes confirmation to the status
          bar. What is left is what actually deserves to interrupt. */}
      <Toaster
        position="top-center"
        closeButton
        style={{ top: '86px' }}
        toastOptions={{
          classNames: {
            toast: 'group !bg-raised !border-line !text-fg rounded-lg shadow-xl font-medium text-[12.5px] font-sans select-none flex items-center gap-2 p-3 !w-fit !max-w-md',
            title: '!text-fg',
            description: '!text-fg-3',
            success: '!text-ok',
            error: '!text-crit',
            info: '!text-accent',
            warning: '!text-warn',
            actionButton: '!bg-accent !text-accent-ink !font-semibold',
            cancelButton: '!bg-sunken !text-fg',
            closeButton: '!bg-raised !border-line !text-fg',
          }
        }}
      />
    </div>
  );
}

export default App;
