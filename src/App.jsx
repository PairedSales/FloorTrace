import { useRef, useEffect, useCallback, useMemo } from 'react';
import { Toaster } from 'sonner';
import Canvas from './components/Canvas';
import TopBar from './components/TopBar';
import DocumentTabs from './components/DocumentTabs';
import ToolRail from './components/ToolRail';
import MeasurementDock from './components/MeasurementDock';
import StatusBar from './components/StatusBar';
import MobileChrome from './components/mobile/MobileChrome';
import HelpModal from './components/HelpModal';
import ExportDialog from './components/ExportDialog';
import ConfirmDialog from './components/ConfirmDialog';
import { confirmToast } from './utils/confirmToast';
import { notify, flash, DURATION } from './utils/notify';
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
} from './utils/ocrLazy';
import {
  robustScale, orientDimsToBox, resolveScaleUpdate,
} from './utils/detection/validate';
import { representativeRoom } from './utils/detection/scale';
import { ringSetArea } from './utils/detection/polygon';
import { roomIsNonGla } from './utils/dimensions/exteriorLabels';
import { DEFAULT_TRACE_TYPE, traceTypeLabel } from './utils/traceTypes';
import { useAutoScale } from './hooks/useAutoScale';
import { qualitySummary } from './utils/boundaryQuality';
import { perfMark, perfReportRun, MARKS } from './utils/perfMarks';
import useAppStore, {
  selectCombinedArea, selectActivePerimeterOverlay, selectCanSwitchWallFace, otherRoomScaleSamples,
} from './store/appStore';
import useWorkspaceStore from './store/workspaceStore';
import * as undoManager from './store/undoManager';
import { beginWork, settleWork, deliver, isCurrent } from './store/documentRequests';
import { useAutosave } from './hooks/useAutosave';
import { useEnhancedOcr } from './hooks/useEnhancedOcr';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useToolManager } from './hooks/useToolManager';
import { useProjectIO } from './hooks/useProjectIO';
import { useExhibitExport } from './hooks/useExhibitExport';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useOcrWarmup } from './hooks/useOcrWarmup';
import { useTheme } from './hooks/useTheme';
import { useIsMobile } from './hooks/useViewport';
import { usePlanManager } from './hooks/usePlanManager';
import { MAX_OPEN_DOCUMENTS } from './store/documentManager';
import { usePlanAreaIndex } from './hooks/usePlanAreaIndex';

// The desktop chrome a top-centre toast has to clear: one top band of 40 (the
// menu titles and the command bar share it) + the status band's 26 + 10 px of
// air, and the tab strip's 30 only when there is a strip. One plan does not get
// one, and one plan is the common case — so this went back to a function of
// what is actually on screen rather than the constant it was while every band
// was permanent.
const desktopChromePx = (planCount) => 40 + (planCount > 1 ? 30 : 0) + 26 + 10;

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

// A parsed label's identity, from what it says and where it says it. Used to
// tell the label a room was placed from apart from the rest of them, so the
// three places that name one cannot drift.
const labelKeyOf = (d) => `${d.text ?? ''}@${Math.round(d.bbox.x)},${Math.round(d.bbox.y)}`;

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
  const perimeterOverlay = useAppStore(selectActivePerimeterOverlay);
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
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const documentOrder = useAppStore((s) => s.documentOrder);
  const showHelpModal = useWorkspaceStore((s) => s.showHelpModal);
  const showExportDialog = useWorkspaceStore((s) => s.showExportDialog);
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
  const setAreaLabels = useAppStore((s) => s.setAreaLabels);
  const setRooms = useAppStore((s) => s.setRooms);
  const setOcrFailed = useAppStore((s) => s.setOcrFailed);
  const setUnit = useAppStore((s) => s.setUnit);
  const setCurrentMeasurementLine = useAppStore((s) => s.setCurrentMeasurementLine);
  const setMeasurementLines = useAppStore((s) => s.setMeasurementLines);
  const setCurrentCustomShape = useAppStore((s) => s.setCurrentCustomShape);
  const setCustomShapes = useAppStore((s) => s.setCustomShapes);
  const setPerimeterVertices = useAppStore((s) => s.setPerimeterVertices);
  const setTracedBoundaries = useAppStore((s) => s.setTracedBoundaries);
  const setAngleToolState = useAppStore((s) => s.setAngleToolState);
  const setShowHelpModal = useWorkspaceStore((s) => s.setShowHelpModal);
  const setShowSideLengths = useAppStore((s) => s.setShowSideLengths);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);
  const setAutoSnapEnabled = useAppStore((s) => s.setAutoSnapEnabled);
  const setEraserBrushSize = useAppStore((s) => s.setEraserBrushSize);
  const setDrawBrushSize = useAppStore((s) => s.setDrawBrushSize);
  const setDrawStrokes = useAppStore((s) => s.setDrawStrokes);
  const setDrawModeActive = useAppStore((s) => s.setDrawModeActive);

  const fileInputRef = useRef(null);
  // A second input, differing only in `capture`. It cannot be the same element
  // with a toggled attribute: the browser reads `capture` when the picker
  // opens, and setting it on the shared input would make "Open plan" launch
  // the camera for whoever tapped "Take a photo" first.
  const cameraInputRef = useRef(null);
  const canvasRef = useRef(null);
  const dimensionEditActiveRef = useRef(false); // Prevents duplicate undo saves when focus moves between InchesInput sub-fields
  const dimensionWarnTimerRef = useRef(null); // Holds the scale warning until typing settles
  const dimensionBlurTimerRef = useRef(null); // Survives focus moving between sub-fields

  // ── Custom hooks ─────────────────────────────────────────────────────────

  const { openPlan, closePlan, closeAllPlans, switchPlan, stepPlan } = usePlanManager();
  const { saveOnExit, handleSaveOnExitChange, clearAutosavedDraft } = useAutosave();
  const { enhancedOcr, handleEnhancedOcrChange } = useEnhancedOcr();
  const { measureAndCalibrate, reviewAgainstFootprint } = useAutoScale();
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

  // Mode is shown by the status bar, which carries the running tool's name,
  // its instruction, its brush and its way out. Before any of that it was eight
  // `duration: Infinity` toasts — the app's only persistent mode indicator,
  // rendered over the canvas, stacking with real notifications, and carrying
  // the sole documentation of Esc-to-cancel.
  const activeTool = drawModeActive ? 'draw'
    : perimeterVertices !== null ? 'vertex'
      : voidToolActive ? 'void'
        : scaleToolActive ? 'scale'
          : lineToolActive ? 'line'
            : angleToolActive ? 'angle'
              : drawAreaActive ? 'area'
                : cropToolActive ? 'crop'
                  : eraserToolActive ? 'eraser'
                      // Pills on screen is a mode, even though no tool flag
                      // says so: `mode` is what renders them and what a click
                      // on one acts through.
                      : (mode === 'manual' && detectedDimensions.length > 0) ? 'pick'
                        : 'select';

  // "Close project" split in two once more than one plan can be open: closing
  // the one you are looking at is a different act from closing everything, and
  // the old single command silently meant the second.
  // Both the last plan and any other now go through one path. The last-plan
  // branch used to live here, where it duplicated `closePlan`'s confirm copy
  // and — because `restart()` keeps the plan's id and so looks like nothing
  // closed — never released the plan's decoded page, detection memo, bitmap or
  // wall-snap engine.
  const handleClosePlan = useCallback(
    () => closePlan(useAppStore.getState().activeDocumentId),
    [closePlan],
  );

  const handleCloseAllPlans = useCallback(async () => {
    if (await closeAllPlans()) clearAutosavedDraft();
  }, [closeAllPlans, clearAutosavedDraft]);

  // OCR found nothing usable: drop a placeholder overlay in the middle of the
  // image for the user to size by hand.
  const placeCentredOverlay = useCallback((imgSrc) => {
    // A second async hop, and the one nobody guarded: reached from the scan's
    // two failure paths, it decodes the image *again* and then writes an
    // overlay, a perimeter and a mode. A guard where the scan resumes does not
    // cover this — by the time `onload` fires the user may have cropped, erased
    // or loaded a different plan, and the placeholder would land on it. It owns
    // its own hop rather than inheriting the scan's, because it outlives it.
    const work = beginWork('placeholder', { image: imgSrc });
    const img = new Image();
    img.onload = () => {
      settleWork(work);
      if (!isCurrent(work)) return;
      const centerX = img.width / 2;
      const centerY = img.height / 2;
      setRoomOverlay({
        x1: centerX - 100, y1: centerY - 100, x2: centerX + 100, y2: centerY + 100,
      });
      setPerimeterVertices([]);
      setMode('normal');
    };
    img.onerror = () => settleWork(work);
    img.src = imgSrc;
  }, [setRoomOverlay, setPerimeterVertices, setMode]);

  // Handle manual mode
  const handleManualMode = useCallback(async (imgSrc = image, forceEnter = false) => {
    if (!forceEnter && mode === 'manual') {
      // Exiting manual mode
      undoManager.save();
      setMode('normal');
      setDetectedDimensions([]);
      setOcrFailed(false);
    } else {
      // Entering manual mode - check if overlays exist (skip confirmation when force-entering from image load)
      if (!forceEnter && (roomOverlay || perimeterOverlay)) {
        // A dialog is an await like any other. The plan it is asking about must
        // still be the live one when the answer arrives, or the undo point and
        // the clearing below land on a different drawing.
        const asking = beginWork('confirm');
        const confirmed = await confirmToast(
          'Entering Manual Mode will clear existing overlays. Continue?',
          { confirmLabel: 'Continue' }
        );
        settleWork(asking);
        if (!confirmed || !isCurrent(asking)) {
          return;
        }
        // Save undo state before clearing overlays
        undoManager.save();
        // Clear overlays
        setRoomOverlay(null);
        setPerimeterOverlay(null);
      }
      
      if (!imgSrc) {
        notify('Open a floorplan first.', { type: 'error', id: 'no-image' });
        return;
      }
      
      setIsProcessing(true, 'Scanning for dimensions…');
      setMode('manual');
      setOcrFailed(false);
      
      // Owns `imgSrc`, not "whatever is loaded": this is handed an image and
      // must report on that one. The scan is the longest await in the app —
      // seconds, not milliseconds — and everything below writes the *reading of
      // this image*: labels, dimensions, the unit, and then the whole
      // measure→calibrate→trace pipeline. Landing any of it on a plan the user
      // has since cropped, erased or replaced attributes one drawing's numbers
      // to another, which is the exact shape of wrong answer this codebase is
      // least able to detect.
      const work = beginWork('scan', { image: imgSrc });
      try {
        perfMark(MARKS.scanStart);
        const result = await detectAllDimensions(imgSrc);
        perfMark(MARKS.scanEnd);

        if (!isCurrent(work)) return;

        const dimensions = result.dimensions || result || [];
        const detectedFormat = result.detectedFormat;

        // Garage/porch/patio/deck/balcony labels: kept for perimeter tracing
        // so non-GLA features get carved out of the footprint.
        setExteriorLabels(result.exteriorLabels || []);
        // Level names ("BASEMENT", "2ND FLOOR"): kept so each traced outline
        // can be typed from what the plan calls it.
        setAreaLabels(result.areaLabels || []);
        setDetectedDimensions(dimensions);

        if (dimensions.length === 0) {
          setOcrFailed(true);
          notify('No printed dimensions found — type a room size, or set the scale from a known length.', { type: 'warning', id: 'scan' });
          placeCentredOverlay(imgSrc);
        } else {
          setOcrFailed(false);
          const count = dimensions.length;
          // Auto-switch unit based on detected format. The parser's vocabulary
          // is {inches, decimal, meters} and the UI's is {inches, decimal,
          // metric}; without the mapping a metric plan set a unit no formatter
          // recognised.
          const uiUnit = detectedFormat === 'meters' ? 'metric' : detectedFormat;
          let unitNote = '';
          if (uiUnit && unit !== uiUnit) {
            setUnit(uiUnit);
            const label = uiUnit === 'inches' ? 'feet-inches'
              : uiUnit === 'metric' ? 'meters' : 'decimal feet';
            unitNote = ` Switched to ${label}.`;
          }
          // One message, not two: the unit change is a consequence of the scan,
          // not a separate event the user needs to weigh.
          flash(`Read ${count} dimension${count === 1 ? '' : 's'}.${unitNote}`);
          // Everything from here is automatic: every label is measured, the
          // rooms that agree set the scale, the room the scale came from is
          // placed as the overlay, and the exterior is traced. The pills stay
          // lit only when that fails — with an overlay on screen, dragging it
          // is how the user overrules a room the app chose badly.
          await afterScanRef.current?.(dimensions);
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        // Same rule as the success path: a failure to read an image the user
        // has already moved on from is not news about the plan on screen, and
        // `id: 'scan'` means this toast would replace whatever the current
        // plan's own scan had to say.
        deliver(work, () => {
          setOcrFailed(true);
          notify('Could not read this plan — type a room size, or set the scale from a known length.', { type: 'error', id: 'scan' });
          placeCentredOverlay(imgSrc);
        });
      } finally {
        settleWork(work);
        setIsProcessing(false);
        // Keep the warm worker pool around for a re-scan or a second image,
        // then release its WASM heaps once the user has clearly moved on.
        // Tearing down immediately made every scan after the first pay engine
        // bootstrap inside its own time budget.
        releaseOcrWorkersWhenIdle(60000);
      }
    }
  }, [image, mode, roomOverlay, perimeterOverlay, unit, placeCentredOverlay, setDetectedDimensions, setExteriorLabels, setAreaLabels, setIsProcessing, setMode, setOcrFailed, setPerimeterOverlay, setRoomOverlay, setUnit]);

  // Find room size: non-destructively re-scan dimensions from the image
  const handleFindRoomSize = useCallback(async () => {
    if (!image) return;

    // What the scan is about to discard, named rather than implied. The guard
    // used to ask only about the two overlays while the body below also cleared
    // `detectedDimensions` and `rooms` — and `rooms` is the accumulated
    // confirmed-room evidence the multi-room scale is pooled from, so a user who
    // had hand-picked three rooms to build a good scale lost all three without
    // being asked. This command carries the primary weight until a scale exists,
    // which is exactly when it is easiest to press by accident.
    const state = useAppStore.getState();
    const losing = [
      state.rooms?.length && `${state.rooms.length} room${state.rooms.length === 1 ? '' : 's'} you picked`,
      state.detectedDimensions?.length && 'the labels already read',
      (roomOverlay || perimeterOverlay) && 'the room and perimeter overlays',
    ].filter(Boolean);

    const asking = beginWork('confirm');
    if (losing.length) {
      const confirmed = await confirmToast(
        `Scanning again will discard ${losing.join(', ')}. Continue?`,
        { confirmLabel: 'Scan' }
      );
      if (!confirmed) {
        settleWork(asking);
        return;
      }
    }
    settleWork(asking);
    // Same rule as above: everything below clears and re-scans one plan.
    if (!isCurrent(asking)) return;

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
    makeRoomForIncoming,
    handleFileOpen,
    handleFileUpload,
    handleSaveProject,
    handleSaveAllProjects,
    handleSaveProjectNormal,
    handleSaveProjectAs,
  } = useProjectIO(handleManualMode, fileInputRef, openPlan);

  const { openExport, closeExport, copyExhibitNow } = useExhibitExport();

  const {
    handlePasteImage,
    handleDragOver,
    handleDrop,
  } = useDragAndDrop(handleManualMode, makeRoomForIncoming);

  // Vertex-by-vertex outline placement. Draw mode is the default fallback now,
  // but placing exact corners is still the right tool when the plan is clean
  // and the user knows precisely where the wall goes.
  const handleDrawExterior = useCallback(() => {
    undoManager.save();
    setDrawModeActive(false);
    setPerimeterOverlay(null);
    setPerimeterVertices([]); // activate manual vertex placement
  }, [setDrawModeActive, setPerimeterOverlay, setPerimeterVertices]);

  // Draw mode: paint roughly over the exterior walls and let the tracer read
  // the strokes as a corridor. This is the fallback whenever auto-detection
  // fails, so it is entered from the failure path as well as from the toolbar.
  const handleDrawMode = useCallback(({ keepStrokes = false } = {}) => {
    undoManager.save();
    setPerimeterVertices(null);
    setPerimeterOverlay(null);
    if (!keepStrokes) setDrawStrokes([]);
    // Always enters; the toggle would turn it back off when already on.
    if (!useAppStore.getState().drawModeActive) handleDrawModeToggle();
  }, [setPerimeterVertices, setPerimeterOverlay, setDrawStrokes, handleDrawModeToggle]);

  // The two outline *methods*, named for what they do rather than for the
  // handlers behind them: `handleDrawMode` paints, `handleDrawExterior` places
  // corners, which reads backwards and has been mis-wired once. Wrapped rather
  // than passed bare, because `handleDrawMode({ keepStrokes } = {})` would take
  // a click event as its options object.
  const handlePaintOutline = useCallback(() => handleDrawMode(), [handleDrawMode]);

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
          // Page-level, so every floor of a re-searched sheet carries the same
          // record — the same way the `remediated` warning is result-scoped.
          // Kept because it is the only durable answer to "why is this outline
          // not the one the first search produced", and a reopened project
          // otherwise shows the result with the reason gone.
          ...(boundaryResult?.quality?.remediation
            ? { remediation: boundaryResult.quality.remediation }
            : {}),
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
      ? { label: 'Redraw', onClick: () => handleDrawMode({ keepStrokes: true }) }
      : { label: 'Draw mode', onClick: () => handleDrawMode() };

    if (!floorCount) {
      notify(quality.reason
        ? `No usable outline — ${quality.reason}.`
        : 'No usable outline found.',
      { type: 'error', id: 'trace-result', action: drawAction });
      return;
    }

    const noun = drawn ? 'Outline traced from your painting' : 'Outline found';
    const what = floorCount > 1
      ? `${drawn ? 'Traced' : 'Found'} ${floorCount} levels (${mode} wall face)`
      : `${noun} (${mode} wall face)`;
    // The outline on screen is not the one the first search produced, and the
    // area moved with it. By the routing rule that is a toast and not a flash
    // even when the result is clean: the user must know it, and cannot see it —
    // a re-traced outline looks exactly like a first-time one.
    const retry = traced?.quality?.remediation;
    const recovered = retry?.accepted ? retry.after.held - retry.before.held : 0;
    const retryNote = recovered > 0
      ? ` First pass left ${recovered} known room${recovered === 1 ? '' : 's'} out, so it was traced again.`
      : '';

    // A clean trace is visible on the canvas the instant it lands, and its
    // confidence is on the outline row — so it acknowledges rather than
    // interrupts. Only a result worth checking earns the stack.
    if (quality.level === 'good') {
      if (retryNote) {
        notify(`${what}.${excludedNote}${retryNote}`,
          { type: 'success', id: 'trace-result', duration: DURATION.NORMAL });
      } else {
        flash(`${what}.${excludedNote}`);
      }
      return;
    }
    const confidenceNote = quality.percent === null ? '' : ` (${quality.percent}% confidence)`;
    const reason = quality.reason ? ` — ${quality.reason}` : '';
    notify(`${what}${confidenceNote}: check it${reason}.${retryNote}`, {
      type: quality.level === 'fair' ? 'warning' : 'error',
      id: 'trace-result',
      duration: DURATION.LONG,
      action: drawAction,
    });
  }, [useInteriorWalls, handleDrawMode]);

  // An outline typed from the plan's own words moves its area out of GLA and
  // into another subtotal. The user can see the new type on the outline row,
  // but only if they look — and the number they came for changed, so this is
  // a toast rather than a flash.
  const reportTraceTypes = useCallback((changes) => {
    if (!changes?.length) return;
    const named = changes.filter((c) => c.type !== DEFAULT_TRACE_TYPE);
    const reverted = changes.length - named.length;
    const parts = [];
    if (named.length) {
      const names = named.map((c) => c.name).join(', ');
      const kinds = [...new Set(named.map((c) => traceTypeLabel(c.type).toLowerCase()))];
      parts.push(`${names} read as ${kinds.join(' / ')} from the plan's labels.`);
    }
    if (reverted) {
      parts.push(`${reverted} outline${reverted === 1 ? '' : 's'} back to GLA — `
        + 'the label the type was read from is gone.');
    }
    notify(parts.join(' '), { type: 'info', id: 'trace-types', duration: DURATION.NORMAL });
  }, []);

  // Returns the quality level of the applied trace, so the caller can decide
  // whether to fall back. `brush` carries draw mode's strokes (original image
  // px) and turns the whole stage into a search inside those strokes.
  const runTrace = useCallback(async (message, brush = null) => {
    if (!image) return null;
    setIsProcessing(true, message);
    const work = beginWork('trace');
    try {
      const traced = await traceFloorplanBoundary(image, {
        excludeRegions: nonGlaExcludeRegions(),
        constraints: boundaryConstraints(),
        ...(brush ? { brush } : {}),
      });

      perfMark(MARKS.traceEnd);

      // One closure, whichever plan it turns out to belong to. Run now if this
      // plan is live; held and replayed on adopt if the user switched tabs
      // while the trace ran. Held rather than dropped is the whole point: a
      // trace is seconds of work, and losing it silently because you looked at
      // another plan is the kind of nothing-happened that is hard to even
      // report as a bug.
      // Captured from the apply, never re-derived. This count is what decides
      // whether `handleTracePerimeter` falls back to draw mode, and
      // `applyTracedBoundary` returns the floors it could actually use — which
      // is not the same as the floors the detector reported.
      let applied = 0;
      const applyTrace = () => {
        // Kept for brush results too: a drawn trace has the same inner/outer
        // pair, so toggling wall mode afterwards must still work.
        setTracedBoundaries(traced);
        const floors = traced ? applyTracedBoundary(traced, useInteriorWalls) : 0;
        // Inside the apply and not beside it: the classification reads this
        // plan's `areaLabels` and retypes the outlines this closure has just
        // placed, so on the held-and-replayed path both have to be the
        // adopting plan's, not whichever plan was live when the trace started.
        const typeChanges = floors ? useAppStore.getState().classifyTraceTypes() : [];
        // Every trace, not only the one the automatic scan ran: the footprint is
        // the one check on the scale that survives a majority of bad rooms, and a
        // toolbar re-trace or a draw-mode pass changes it. It re-runs a pure
        // selection over rooms already measured, and no-ops unless the scale in
        // force is still the automatic one.
        applied = floors;
        if (floors) reviewAgainstFootprint(tracedAreaPx(traced));
        reportTrace(traced, floors);
        reportTraceTypes(typeChanges);
      };

      const verdict = deliver(work, applyTrace);
      if (verdict !== 'applied') return null;

      perfMark(MARKS.areaReady);
      perfReportRun();
      return applied ? qualitySummary(traced?.quality).level : 'failed';
    } catch (error) {
      // The toast is a claim about the plan on screen — `id: 'trace-result'`
      // means it replaces whatever that plan's own trace had to say — so it is
      // raised only by work that still owns what it was tracing.
      deliver(work, () => {
        console.error('Perimeter detection failed:', error);
        notify('Could not trace this plan.', {
          type: 'error',
          id: 'trace-result',
          action: { label: 'Paint it instead', onClick: () => handleDrawMode() },
        });
      });
      return 'failed';
    } finally {
      settleWork(work);
      // Unconditional, unlike the result writes above. Gated on the image, a
      // trace the user interrupted by cropping left `isProcessing` true with
      // nothing left to turn it off: a spinner that never stops and five
      // CommandBar buttons disabled for the rest of the session. Clearing a
      // spinner a newer operation had just set is a flicker; this was a wedge.
      // Exact ownership needs a request token, which is what the document
      // request layer will carry — this is the honest stopgap until then.
      setIsProcessing(false);
    }
  }, [image, useInteriorWalls, setTracedBoundaries, applyTracedBoundary, setIsProcessing,
    reportTrace, reportTraceTypes, handleDrawMode, reviewAgainstFootprint]);

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
      flash('Nothing painted');
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
  }, [runTrace, setDrawModeActive, setDrawStrokes]);

  // One setting over every outline. Each traced outline carries the detector's
  // own inner/outer pair, so the switch reaches outlines from earlier detection
  // runs as well as the current one; re-applying `tracedBoundaries` is only the
  // fallback for drafts saved before the pair was stored, and it can move
  // nothing but the most recent run.
  const handleInteriorWallToggle = useCallback((value) => {
    undoManager.save();
    setUseInteriorWalls(value);
    const switched = useAppStore.getState().setWallFaceMode(value);
    if (!switched && tracedBoundaries) {
      applyTracedBoundary(tracedBoundaries, value);
    }
  }, [setUseInteriorWalls, tracedBoundaries, applyTracedBoundary]);

  // Memoised, like `activeBrush` below, because `useKeyboardShortcuts` lists
  // both in the dependency array of its window `keydown` effect. As bare
  // literals they were fresh on every App render, so the global listener was
  // torn down and re-registered on every state change in the app.
  const handleFitToWindow = useCallback(() => {
    canvasRef.current?.fitToWindow();
  }, []);

  const handleRotateCanvas = useCallback((direction) => {
    canvasRef.current?.rotateCanvas(direction);
  }, []);

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
    // Deliberately silent. The Scale card carries this verdict with its own
    // chip for as long as the scale is in force, which is where the question
    // is actually asked — a toast said it once and then left the doubt
    // invisible.

    if (resolved.changed) {
      applyRoomCalibration(resolved.scale, null, 'room-calibration', resolved.quality);
    }
  }, [applyRoomCalibration]);

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
    const overlay = selectActivePerimeterOverlay(useAppStore.getState());
    if (!overlay?.vertices) return;
    if (overlay.vertices.length <= 3) {
      notify('An outline needs at least three corners.', { type: 'warning', id: 'min-vertices' });
      return;
    }
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

  // Leave the automatic path in the state a placed room leaves behind: the
  // overlay on the room the scale came from, its label in the Room size fields,
  // and the pills gone. Without it a plan the app had already measured still
  // showed every pill lit and a Room size card reading 0.0 ft — the screen said
  // "pick a room" about a decision that had been made.
  //
  // Deliberately no updateScale call. The scale in force is the median over
  // every measured room; re-deriving it from this one rectangle would pin it to
  // that room and switch the footprint cross-check off, which is exactly what
  // dragging the overlay is *supposed* to do and must stay the user's choice.
  const showAutoScaleRoom = useCallback((decision) => {
    const room = representativeRoom(decision);
    if (!room || !(room.labelDims?.width > 0) || !(room.labelDims?.height > 0)) return false;
    const { left, right, top, bottom } = room.rect;
    if (!(right > left) || !(bottom > top)) return false;
    setRoomOverlay({
      x1: left,
      y1: top,
      x2: right,
      y2: bottom,
      polygon: [
        { x: left, y: top }, { x: right, y: top },
        { x: right, y: bottom }, { x: left, y: bottom },
      ],
      confidence: room.confidence ?? null,
    });
    const placed = orientDimsToBox(
      room.labelDims.width, room.labelDims.height, right - left, bottom - top,
    );
    setRoomDimensions({ width: String(placed.width), height: String(placed.height) });
    return true;
  }, [setRoomOverlay, setRoomDimensions]);

  /**
   * The automatic path, run once a scan has found labels: measure every one of
   * them, calibrate from the rooms that agree, trace the exterior with those
   * rooms as evidence, then judge the scale against the building it produced.
   */
  const runAutoScale = useCallback(async (dimensions) => {
    const labels = dimensions
      .filter((d) => d.bbox && d.width > 0 && d.height > 0)
      .map((d) => ({
        id: labelKeyOf(d),
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

    // Before the trace, not after: the tracer reads `detectedDimensions` for its
    // interior points, so the labels stay in the store either way, but the user
    // sees which room was chosen while the exterior is still being traced.
    if (showAutoScaleRoom(decision)) {
      setMode('normal');
    }

    // The footprint cross-check runs inside runTrace now, so it lands here too
    // — and equally on every later re-trace, which used to leave the verdict
    // this trace produced standing against a building that no longer existed.
    await autoTraceExterior();
  }, [measureAndCalibrate, autoTraceExterior, setIsProcessing, showAutoScaleRoom, setMode]);

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

    // Every other parsed label on the page, as a place this room is not: a
    // rectangle holding another room's dimensions grew through a wall. The
    // scan's batch gives each room it measures the same evidence, and this is
    // the same rooms by another route, so the two must not be able to disagree.
    // A canvas click in manual mode names no label, and needs to name none —
    // growRoomRect drops any of these that the room it settled on contains,
    // which is exactly the label of the room being clicked.
    const foreignPoints = useAppStore.getState().detectedDimensions
      .filter((d) => d.bbox && labelKeyOf(d) !== labelId)
      .map((d) => ({ x: d.bbox.x + d.bbox.width / 2, y: d.bbox.y + d.bbox.height / 2 }));

    setIsProcessing(true, 'Finding room…');
    const work = beginWork('room');
    try {
      detected = await detectRoomFromClick(image, point, {
        labelBbox, labelDims: dims, pixelsPerFoot: roomScaleHint(), foreignPoints,
      });
      if (detected?.overlay) {
        deliver(work, () => {
          overlay = {
            ...detected.overlay,
            polygon: detected.polygon,
            confidence: detected.confidence,
          };
        });
      }
    } catch (error) {
      deliver(work, () => console.error('Room detection failed:', error));
    } finally {
      // Unconditional — see the note in `runTrace`'s finally.
      setIsProcessing(false);
      settleWork(work);
    }

    if (!isCurrent(work)) return;

    if (!detected) {
      // A failed room detection used to fall through to a hardcoded 200x200
      // box and calibrate the whole project from it, without a word.
      notify(
        'Could not find that room’s outline — drag the overlay to match it, '
        + 'then check the area.',
        { type: 'warning', id: 'room-detect' },
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
          + 'check the overlay before trusting the area.',
          { type: 'warning', id: 'room-detect' },
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
    setMode('normal');

    // The labels are kept, not cleared. `setMode('normal')` above is what puts
    // the pills away; clearing the array as well made "Select room" a one-shot
    // — the second wrong guess had nothing left to pick from — and threw away
    // the tracer's interior points, the warning anchors and the exhibit's unit
    // style along with it.
    await autoTraceExterior();
  }, [image, setIsProcessing, setRoomDimensions, setRoomOverlay, updateScale,
    setPerimeterVertices, setMode, autoTraceExterior]);

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
      labelId: labelKeyOf(dimension),
    });
  }, [placeRoom]);

  // ── Stable callback wrappers for inline handlers ──────────────────────────

  const handleHelpOpen = useCallback(() => {
    const w = useWorkspaceStore.getState();
    w.setShowHelpModal(!w.showHelpModal);
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
  }, [setUnit]);

  const handleShowSideLengthsChange = useCallback((value) => {
    setShowSideLengths(value);
  }, [setShowSideLengths]);

  const handleAutoSnapChange = useCallback((value) => {
    setAutoSnapEnabled(value);
  }, [setAutoSnapEnabled]);

  const handleSaveOnExitChangeWithToast = useCallback((value) => {
    handleSaveOnExitChange(value);
  }, [handleSaveOnExitChange]);

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
  const activeBrush = useMemo(() => (drawModeActive
    ? { field: 'drawBrushSize', setSize: setDrawBrushSize, min: 8, max: 400, step: 6 }
    : eraserToolActive
      ? { field: 'eraserBrushSize', setSize: setEraserBrushSize, min: 4, max: 200, step: 4 }
      : null), [drawModeActive, eraserToolActive, setDrawBrushSize, setEraserBrushSize]);

  const handleSelectPlan = useCallback((index) => {
    const order = useAppStore.getState().documentOrder;
    if (order[index]) switchPlan(order[index]);
  }, [switchPlan]);

  useKeyboardShortcuts({
    onNewPlan: openPlan,
    onStepPlan: stepPlan,
    onSelectPlan: handleSelectPlan,
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
  usePlanAreaIndex();
  const { theme, cycleTheme } = useTheme();
  const dockOpen = useWorkspaceStore((s) => s.dockOpen);
  const setDockOpen = useWorkspaceStore((s) => s.setDockOpen);
  const handleDockToggle = useCallback(
    () => setDockOpen(!useWorkspaceStore.getState().dockOpen),
    [setDockOpen],
  );

  // Leaving a tool: drop every flag, and drop vertex-placement, room placement
  // and the room picker too — none is a tool-manager flag, but all three are
  // modes, and the rail's Select button means "no mode" rather than "no flag".
  const handleCancelTool = useCallback(() => {
    deactivateAll();
    setPerimeterVertices(null);
    // Only when the picker is the mode being shown: cancelling the eraser must
    // not also put away pills the user opened before reaching for it.
    if (activeTool === 'pick') setMode('normal');
  }, [activeTool, deactivateAll, setPerimeterVertices, setMode]);

  // Put the read labels back on screen so the user can pick the room the
  // automatic selection got wrong. Deliberately not a re-scan: OCR is the
  // expensive half of a scan and the labels are already in the store, so this
  // only changes `mode` — which is the single thing that renders the pills.
  // Re-scanning would also re-run the automatic choice, i.e. undo the correction
  // the user opened this to make.
  const handleSelectRoom = useCallback(() => {
    if (activeTool === 'pick') {
      setMode('normal');
      return;
    }
    if (!useAppStore.getState().detectedDimensions.length) return;
    handleCancelTool();
    setMode('manual');
  }, [activeTool, handleCancelTool, setMode]);

  // The rail speaks the same tool ids as `TOOL_MODES`, and each maps to the very
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

  // ── mobile shell ──────────────────────────────────────────────────────────
  // Which chrome the app wears. Everything above this line is shared: the two
  // shells are two arrangements of the same workflow, not two applications.
  const isMobile = useIsMobile();

  const handleTakePhoto = useCallback(() => cameraInputRef.current?.click(), []);

  // Enter closes a shape in progress; a phone has no Enter, so both closers get
  // a button. The area polygon is App's to close (it owns the shape list); the
  // void lives in the canvas hook and is reached through the same imperative
  // handle the camera controls use.
  const handleCloseCustomShape = useCallback(() => {
    const shape = useAppStore.getState().currentCustomShape;
    if (!shape || shape.closed || shape.vertices.length < 3) return;
    handleAddCustomShape({ ...shape, closed: true });
    setCurrentCustomShape(null);
  }, [handleAddCustomShape, setCurrentCustomShape]);

  const handleCloseVoid = useCallback(() => canvasRef.current?.closeVoid(), []);

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

  // The plan view, built once and handed to whichever shell is on. Same
  // element, same props: nothing about tracing depends on the chrome around it,
  // and a second copy of this list is a second place for them to diverge.
  // `key` is the entire correctness argument for in-progress gestures across a
  // plan switch. The canvas hooks hold real state outside the store — a crop
  // rectangle mid-drag, the eraser's starting vertices, the void tool's target
  // trace, a half-dragged vertex index, the protractor's live coordinates — and
  // none of it is parked, because none of it is a fact about the plan. Keying
  // the subtree on the plan means all of it dies with the tree instead of being
  // reinterpreted against a different drawing.
  const canvasElement = (
    <Canvas
      key={activeDocumentId}
      ref={canvasRef}
      onFileOpen={handleFileOpen}
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
  );

  // Two shells over one workflow. Desktop: one full-width band — the menu
  // titles and the command bar share it — over a row of dock, plan and tool
  // rail, with the tab strip and the status bar stacked inside the plan's own
  // column, so both describe the plan and stop where it does. The status bar is
  // also the context bar: a running tool's instruction, its brush and its way
  // out are cells in it.
  // Mobile: a top bar, the plan, and one bar under the thumb — see MobileChrome
  // for why that is a different arrangement rather than the same one scaled
  // down.
  //
  // `h-app` rather than `h-screen` on mobile: 100vh on a phone is the viewport
  // with the browser's own bars hidden, so the bottom bar would sit under the
  // URL bar until the page was scrolled — and this page never scrolls.
  return (
    <div
      id="app-container"
      className={`flex flex-col bg-shell ${isMobile ? 'h-app overflow-hidden' : 'h-screen'}`}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isMobile ? (
        <MobileChrome
          onSelectPlan={switchPlan}
          onClosePlan={closePlan}
          onNewPlan={openPlan}
          activeTool={activeTool}
          hasToolData={hasToolData}
          onMenuFileOpen={handleFileOpen}
          onTakePhoto={handleTakePhoto}
          onExport={openExport}
          onCopyExhibit={copyExhibitNow}
          onSaveProject={handleSaveProject}
          onRestart={handleClosePlan}
          onHelpOpen={handleHelpOpen}
          onFindRoomSize={handleFindRoomSize}
          onTracePerimeter={handleTracePerimeter}
          onDrawExterior={handlePaintOutline}
          onOutlineByVertex={handleDrawExterior}
          onAddFloor={addPerimeterTrace}
          onFitToWindow={handleFitToWindow}
          onRotate={handleRotateCanvas}
          onToolSelect={handleToolSelect}
          onCancelTool={handleCancelTool}
          onClearTools={handleClearTools}
          onFinishDrawMode={handleFinishDrawMode}
          onClosePerimeter={handleClosePerimeter}
          onCloseCustomShape={handleCloseCustomShape}
          onCloseVoid={handleCloseVoid}
          roomDimensions={roomDimensions}
          onDimensionsChange={handleDimensionsChange}
          onDimensionFocus={handleDimensionFocus}
          onDimensionBlur={handleDimensionBlur}
          onUnitChange={handleUnitChange}
          onInteriorWallToggle={handleInteriorWallToggle}
          canSwitchWallFace={canSwitchWallFace}
          onScaleTool={handleScaleToolToggle}
          onSelectRoom={handleSelectRoom}
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
        >
          {canvasElement}
        </MobileChrome>
      ) : (
      <>
      <TopBar
        image={image}
        isProcessing={isProcessing}
        hasArea={area > 0}
        calibrated={!!calibration?.calibrated}
        perimeterTraces={perimeterTraces}
        drawModeActive={drawModeActive}
        planCount={documentOrder.length}
        canOpenPlan={documentOrder.length < MAX_OPEN_DOCUMENTS}
        onFileOpen={handleFileOpen}
        onPasteImage={handlePasteImage}
        onExport={openExport}
        onCopyExhibit={copyExhibitNow}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onSaveAllProjects={handleSaveAllProjects}
        onNewPlan={openPlan}
        onNextPlan={() => stepPlan(1)}
        onPrevPlan={() => stepPlan(-1)}
        onRestart={handleClosePlan}
        onCloseAllPlans={handleCloseAllPlans}
        onHelpOpen={handleHelpOpen}
        onFindRoomSize={handleFindRoomSize}
        onSelectRoom={handleSelectRoom}
        canSelectRoom={detectedDimensions.length > 0}
        onScaleTool={handleScaleToolToggle}
        onTracePerimeter={handleTracePerimeter}
        onPaintOutline={handlePaintOutline}
        onPlaceCorners={handleDrawExterior}
        onAddOutline={addPerimeterTrace}
        onFitToWindow={handleFitToWindow}
        dockOpen={dockOpen}
        onDockToggle={handleDockToggle}
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
            onSelectRoom={handleSelectRoom}
            onExport={openExport}
          />
        )}

        {/* The plan's own column: which plan, what state it is in, and the
            plan itself — stacked, and stopping where the plan stops.
            `min-w-0` because the status bar's cells are `shrink-0`, so the
            column's content-based minimum would otherwise be ~400 px of
            unshrinkable text holding the canvas open. `min-h-0` for the same
            reason vertically, or the canvas cannot shrink to the leftover and
            the bottom of the plan is clipped with no scrollbar.

            Both bands must be *siblings* of the canvas box, never inside it:
            Canvas' root is `absolute inset-0`, so it would paint over them and
            the Konva stage would swallow their clicks. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <DocumentTabs
            onSelect={switchPlan}
            onClose={closePlan}
            onNew={openPlan}
            isProcessing={isProcessing}
          />

          <StatusBar
            tool={activeTool}
            count={contextCount}
            brushSize={contextBrush}
            onBrushSizeChange={onContextBrushChange}
            onCancel={handleCancelTool}
            onDone={contextDone}
            hasImage={!!image}
            onZoomIn={() => handleZoom(1)}
            onZoomOut={() => handleZoom(-1)}
            onExport={openExport}
          />

          {/* Nothing floats over the plan any more - the old panels sat on its
              top-left corner. `relative` is what makes this box the canvas's
              offsetParent, which is to say its measured size. */}
          <div className="relative flex-1 min-h-0 canvas-grid-bg">
            {canvasElement}
          </div>
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
      </>
      )}

      {showHelpModal && <HelpModal onClose={handleHelpClose} />}

      {showExportDialog && (
        <ExportDialog
          onClose={closeExport}
          onSaveProject={handleSaveProjectNormal}
        />
      )}

      <ConfirmDialog />

      {/* `multiple`, now that each file can become its own plan. The camera
          input below stays single — a photo is one plan by definition. */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,application/pdf,.pdf,.floorplan"
        multiple
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* `capture` goes straight to the rear camera. Mounted on every platform
          because the attribute is simply ignored where there is no camera —
          only the mobile menu offers it, so a desktop never reaches it. */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileUpload}
        className="hidden"
      />

      {/* Only real notifications now - every "you are in X mode" message moved
          to the status bar, which carries the running mode, and every
          low-stakes confirmation to the same band. What is left is what actually deserves to interrupt. */}
      {/* Two slots, not sonner's default three. A burst that cannot be read is
          worse than a burst that is truncated, and with every toast now carrying
          a stable id the same condition updates in place instead of stacking. */}
      <Toaster
        position="top-center"
        visibleToasts={2}
        closeButton
        // Clears whichever chrome is above it: the desktop stack down to the
        // status band, or one mobile bar plus whatever the notch takes. Named
        // rather than written inline, because it was a hard-coded `116px` for a
        // stack that had already changed twice.
        style={{
          top: isMobile
            ? 'calc(env(safe-area-inset-top, 0px) + 60px)'
            : `${desktopChromePx(documentOrder.length)}px`,
        }}
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
