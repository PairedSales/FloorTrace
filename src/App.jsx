import { useRef, useEffect, useCallback, useMemo } from 'react';
import { Toaster } from 'sonner';
import Canvas from './components/Canvas';
import AppHeader from './components/AppHeader';
import ActionBar from './components/ActionBar';
import ResultsPanel from './components/ResultsPanel';
import ViewControls from './components/ViewControls';
import MobileChrome from './components/mobile/MobileChrome';
import HelpModal from './components/HelpModal';
import ExportDialog from './components/ExportDialog';
import SettingsDialog from './components/SettingsDialog';
import ConfirmDialog from './components/ConfirmDialog';
import { confirmToast } from './utils/confirmToast';
import { notify, flash, DURATION } from './utils/notify';
import {
  detectRoomFromClick,
  getFloorBoundaryFaces,
  traceFloorplanBoundary,
  terminateDetectionWorker,
  prewarmDetection,
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
import { boundaryConstraints, nonGlaExcludeRegions } from './utils/traceInputs';
import { DEFAULT_TRACE_TYPE, traceTypeLabel } from './utils/traceTypes';
import { useAutoScale } from './hooks/useAutoScale';
import { qualitySummary } from './utils/boundaryQuality';
import { loadExamplePlan } from './utils/examplePlan';
import { PROGRESS } from './utils/progressSteps';
import { perfMark, perfReportRun, perfResetRun, MARKS } from './utils/perfMarks';
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
import { usePlanAreaIndex } from './hooks/usePlanAreaIndex';
import { useCornerPlacement } from './hooks/useCornerPlacement';
import useUnitPreference from './hooks/useUnitPreference';

// The desktop chrome a top-centre toast has to clear: the header's 52, the
// action bar's 48 when there is a plan for it to act on, and 10 px of air. A
// function of what is actually on screen, because the bar comes and goes.
const desktopChromePx = (hasPlan) => 52 + (hasPlan ? 48 : 0) + 10;

// One string for both trace entry points, matching the command that starts it.
// The toolbar said "Detecting exterior boundary…" and the post-scan path said
// "Tracing exterior walls…", so a user who watched one of them fail had no way
// to tell it was the same operation as the one labelled Find the outline.
const FIND_OUTLINE_MESSAGE = PROGRESS.findingOutline;

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
  const cornerEraserActive = useAppStore((s) => s.cornerEraserActive);
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
  const clearWallFaces = useAppStore((s) => s.clearWallFaces);

  // Store actions (stable references — never cause re-renders)
  const setImage = useAppStore((s) => s.setImage);
  const setImageMimeType = useAppStore((s) => s.setImageMimeType);
  const resetOverlays = useAppStore((s) => s.resetOverlays);
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
  const setLastTraceOutcome = useAppStore((s) => s.setLastTraceOutcome);
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
  // Workspace-level, and the reason the pinned unit survives a scan, a new
  // plan and a project someone else saved in metres.
  const { chooseUnit } = useUnitPreference();
  const { measureAndCalibrate, reviewAgainstFootprint, restoreAutoScale } = useAutoScale();
  // The scan runs before the exterior trace is even defined in this file, and
  // the automatic path needs both. Refs rather than a reordering: moving
  // handleManualMode below the tracer would drag handleFindRoomSize and its
  // call sites with it.
  const afterScanRef = useRef(null);
  const traceAfterScanRef = useRef(null);

  const {
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCornerEraserToggle,
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

  // Mode is shown by the action bar, which carries the running tool's name,
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
                  : cornerEraserActive ? 'cornerEraser'
                  : eraserToolActive ? 'eraser'
                      // Pills on screen is a mode, even though no tool flag
                      // says so: `mode` is what renders them and what a click
                      // on one acts through.
                      : (mode === 'manual' && detectedDimensions.length > 0) ? 'pick'
                        : 'select';

  // The old "Close project" split in two once more than one plan could be
  // open: closing the one you are looking at is a different act from closing
  // everything, and the single command silently meant the second. Both shells
  // now print "Close plan" for this one and "Close all plans" for the other —
  // the desktop said "Close this plan" and the phone still said "Close
  // project", for the same handler.
  //
  // Both the last plan and any other go through one path. The last-plan
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
      // Deliberately no `setPerimeterVertices([])`. That resolved `activeTool`
      // to `'vertex'`, so the action bar answered a failed *scan* with "Click
      // each corner of the exterior" — a third instruction, for a different
      // stage, on top of the toast and the box this drops on the plan. The
      // failure path has no business entering a modal outline tool.
      setMode('normal');
    };
    img.onerror = () => settleWork(work);
    img.src = imgSrc;
  }, [setRoomOverlay, setMode]);

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
      
      setIsProcessing(true, PROGRESS.readingSizes);
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

        const dimensions = result.dimensions || result || [];
        const detectedFormat = result.detectedFormat;

        // Held and replayed on adopt, exactly like a trace — not dropped.
        // This path used to bail on `!isCurrent(work)` while the failure path
        // twenty lines below correctly went through `deliver`, so a scan that
        // finished while the user glanced at another plan threw away seconds
        // of OCR and left the plan looking unscanned.
        const applyScan = () => {
          // Garage/porch/patio/deck/balcony labels: kept for perimeter tracing
          // so non-GLA features get carved out of the footprint.
          setExteriorLabels(result.exteriorLabels || []);
          // Level names ("BASEMENT", "2ND FLOOR"): kept so each traced outline
          // can be typed from what the plan calls it.
          setAreaLabels(result.areaLabels || []);
          setDetectedDimensions(dimensions);
          setOcrFailed(dimensions.length === 0);
        };
        const verdict = deliver(work, applyScan);
        // The automatic measure → calibrate → trace pipeline below only makes
        // sense for the plan on screen. A routed scan keeps its labels and its
        // dimensions — the expensive part — and the user traces when they
        // return; running the pipeline into a plan they are not looking at is
        // how one drawing's numbers land on another.
        if (verdict !== 'applied') return;

        if (dimensions.length === 0) {
          notify('Couldn’t read any room sizes on this plan. Set the scale under Scale, in the panel on the left.', { type: 'warning', id: 'scan' });
          placeCentredOverlay(imgSrc);
          // The outline does not wait for a scale. Finding the walls needs
          // nothing the scan failed to read, so a plan with no room sizes
          // printed on it still gets its outline — and is left one thing short
          // of an area, not two. It used to stop here with nothing drawn and
          // two jobs for the user, the first of which the app could do itself.
          await traceAfterScanRef.current?.();
        } else {
          const count = dimensions.length;
          // Auto-switch unit based on detected format. The parser's vocabulary
          // is {inches, decimal, meters} and the UI's is {inches, decimal,
          // metric}; without the mapping a metric plan set a unit no formatter
          // recognised.
          const uiUnit = detectedFormat === 'meters' ? 'metric' : detectedFormat;
          let unitNote = '';
          // Only when the user has not said which unit they want. A pinned
          // preference is a standing instruction, and the drawing does not get
          // to overrule it — that is the whole point of pinning one.
          if (uiUnit && unit !== uiUnit && useWorkspaceStore.getState().unitPreference === 'auto') {
            setUnit(uiUnit);
            const label = uiUnit === 'inches' ? 'feet and inches'
              : uiUnit === 'metric' ? 'meters' : 'decimal feet';
            unitNote = ` Showing ${label}, like the plan.`;
          }
          // One message, not two: the unit change is a consequence of the scan,
          // not a separate event the user needs to weigh.
          flash(`Found ${count} room size${count === 1 ? '' : 's'}.${unitNote}`);
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
          notify('Couldn’t read this plan. Set the scale under Scale, in the panel on the left.', { type: 'error', id: 'scan' });
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
      state.rooms?.length && 'the rooms measured so far',
      state.detectedDimensions?.length && 'the room sizes already read',
      (roomOverlay || perimeterOverlay) && 'the current outline',
    ].filter(Boolean);

    const asking = beginWork('confirm');
    if (losing.length) {
      const confirmed = await confirmToast(
        'Read the room sizes again?',
        {
          detail: 'This starts the plan’s measurement over and replaces '
            + `${losing.length > 1 ? `${losing.slice(0, -1).join(', ')} and ${losing.at(-1)}` : losing[0]}. `
            + 'You can undo it.',
          confirmLabel: 'Read again',
        }
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

  /**
   * The bundled plan, opened in one click. A first-run user usually has no
   * drawing to hand and cannot judge the app without one.
   *
   * The sequence is `handlePasteImage`'s, and every step of it is load-bearing:
   * `makeRoomForIncoming` first (a refusal must leave the current plan alone),
   * then the overlays and the undo stack cleared *before* the image lands — an
   * image set over a live plan keeps that plan's calibration and its history,
   * and undo then walks back into a drawing that is no longer on screen.
   */
  const handleOpenExample = useCallback(async () => {
    if (!makeRoomForIncoming()) return;

    setIsProcessing(true, 'Opening the sample plan…');
    try {
      const { dataUrl, mimeType } = await loadExamplePlan();
      perfResetRun();
      perfMark(MARKS.imageSet);
      resetOverlays();
      undoManager.clear();
      setImage(dataUrl);
      setImageMimeType(mimeType);
      // Named rather than left null: this plan does have a source, and an
      // unnamed one reads as "Untitled 1" in the tab and on the exhibit.
      useAppStore.getState().setActiveDocumentMeta({ sourceFileName: 'Example plan.png' });
      prewarmDetection(dataUrl);
      await handleManualMode(dataUrl, true);
    } catch (error) {
      console.error('Error loading example plan:', error);
      notify(error?.message || 'Could not load the example plan.', {
        type: 'error', id: 'example-plan',
      });
    } finally {
      setIsProcessing(false);
    }
  }, [makeRoomForIncoming, resetOverlays, setImage, setImageMimeType, setIsProcessing, handleManualMode]);

  // Corner-by-corner outline placement — the right tool when the plan is clean
  // and the user knows precisely where the wall goes. The hook is what gives
  // the old outline back, or takes an added one out again, if they change their
  // mind part-way.
  const {
    startPlacing: handleDrawExterior,
    addOutline: handleAddOutline,
  } = useCornerPlacement();

  /**
   * Draw mode: paint roughly over the exterior walls and let the tracer read
   * the strokes as a corridor. The fallback whenever auto-detection fails, so
   * it is entered from the failure path as well as from the Outline menu.
   *
   * **The outline being replaced stays on the plan**, locked, as the thing to
   * paint over, and is only replaced when the painting has been turned into a
   * new one. Entering the brush used to delete it on the spot unless the caller
   * asked otherwise — so Cancel left the plan with no outline and no area, and
   * the failure path's toast pointed at an outline that was already gone.
   *
   * `keepStrokes` defaults to "whatever is already painted", because the only
   * routes back into the brush all ran `setDrawStrokes([])` and destroyed the
   * work the user was coming back to add to.
   *
   * `reason` is raised through `notify` with the trace-result id, so it
   * *replaces* the "check it" toast rather than sitting under a message about
   * an outline that no longer exists. It was previously passed as `{ message }`
   * to a function that never had that parameter, and has never been rendered.
   */
  const handleDrawMode = useCallback(({ keepStrokes, reason = null } = {}) => {
    undoManager.save();
    setPerimeterVertices(null);
    const painted = useAppStore.getState().drawStrokes?.length > 0;
    if (keepStrokes === false || (keepStrokes === undefined && !painted)) setDrawStrokes([]);
    // Always enters; the toggle would turn it back off when already on.
    if (!useAppStore.getState().drawModeActive) handleDrawModeToggle();
    if (reason) {
      notify(reason, { type: 'warning', id: 'trace-result', duration: DURATION.LONG });
    }
  }, [setPerimeterVertices, setDrawStrokes, handleDrawModeToggle]);

  // The two outline *methods*, named for what they do rather than for the
  // handlers behind them: `handleDrawMode` paints, `handleDrawExterior` places
  // corners, which reads backwards and has been mis-wired once. Wrapped rather
  // than passed bare, because `handleDrawMode({ keepStrokes } = {})` would take
  // a click event as its options object.
  const handlePaintOutline = useCallback(() => handleDrawMode(), [handleDrawMode]);

  /**
   * Adopt the search's next-best footprint for the active outline.
   *
   * The commonest correctable failure is a tie-break: two candidates within
   * `SCORE_EPSILON` (0.015) of each other and the wrong one won. The right
   * geometry has already been computed and scored — this hands it over instead
   * of asking the user to paint the whole outline again. The rejected one goes
   * onto the trace's attempt history, so it is one undo away either direction.
   */
  const handleUseAlternative = useCallback(() => {
    const state = useAppStore.getState();
    const trace = state.perimeterTraces?.find((t) => t.id === state.activeTraceId);
    const next = trace?.quality?.alternatives?.[0];
    if (!next?.polygon?.length) return;
    undoManager.save();
    const rest = trace.quality.alternatives.slice(1);
    setPerimeterOverlay({
      vertices: next.polygon.map((p) => ({ x: p.x, y: p.y })),
      // The score it was ranked on is the detector's, so it stays the
      // detector's answer — but the warnings belonged to the outline this
      // replaces, and describing the new geometry with the old one's reasons
      // would be worse than saying nothing. Re-tracing is what re-earns them.
      quality: {
        ...trace.quality,
        confidence: null,
        edited: false,
        warnings: [],
        alternatives: rest,
        adoptedAlternative: true,
      },
    });
    flash(rest.length
      ? `Using the next-best outline — ${rest.length} more to try`
      : 'Using the next-best outline');
  }, [setPerimeterOverlay]);

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
          // The runner-up footprints the search already scored. Kept on the
          // trace so the commonest correctable failure — a tie-break inside
          // SCORE_EPSILON picking the wrong one of two near-equal candidates —
          // costs a click rather than repainting the whole outline. Geometry
          // only; they are not offered once the user has edited the outline.
          alternatives: floor.alternatives ?? [],
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
    const excludedNote = excludedAreasNote(traced ?? {});
    const drawn = traced?.quality?.source === 'drawn';
    // A drawn trace that went wrong is corrected by painting again, not by
    // switching to a different tool, so the offer differs from the auto path's.
    // `keepStrokes` on both: the strokes are the work, and the button offering
    // to fix the outline used to delete them on the way in.
    const drawAction = drawn
      ? { label: 'Paint again', onClick: () => handleDrawMode({ keepStrokes: true }) }
      : { label: 'Paint it instead', onClick: () => handleDrawMode({ keepStrokes: true }) };

    if (!floorCount) {
      notify(quality.reason
        ? `FloorTrace couldn’t find the outline — ${quality.reason}. Paint over the outside walls instead.`
        : 'FloorTrace couldn’t find the outline. Paint over the outside walls instead.',
      { type: 'error', id: 'trace-result', duration: DURATION.LONG, action: drawAction });
      return;
    }

    // No wall-face parenthetical and no percentage. "Outline found (outer wall
    // face) (71% confidence): check it" was two parentheticals and an
    // imperative with no object; the wall face is a setting with its own
    // switch under Outline, and the percentage read as an accuracy score it
    // is not (see the note below).
    const what = floorCount > 1
      ? `${drawn ? 'Drew' : 'Found'} ${floorCount} levels`
      : (drawn ? 'Outline drawn from your painting' : 'Outline found');
    // The outline on screen is not the one the first search produced, and the
    // area moved with it. By the routing rule that is a toast and not a flash
    // even when the result is clean: the user must know it, and cannot see it —
    // a re-traced outline looks exactly like a first-time one.
    const retry = traced?.quality?.remediation;
    const recovered = retry?.accepted ? retry.after.held - retry.before.held : 0;
    const retryNote = recovered > 0
      ? ` The first try left ${recovered} room${recovered === 1 ? '' : 's'} outside, so it was traced again.`
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
    // No percentage. The detector's score is the share of this outline that
    // sits on wall the plan actually draws — evidence about the tracing, blind
    // to whether the enclosed area is the right area. Read as "71% accurate" it
    // is worse than no number: measured across the results the app presents,
    // its correlation with area error is +0.117, and the single worst
    // over-count in the fixture set carries the joint-highest value. What the
    // user can act on is the reason, so that is what is said.
    const reason = quality.reason ? `: ${quality.reason}` : '';

    // A result the detector rates poor is not handed over as an answer, but it
    // is no longer taken away either. The outline stays on the canvas with its
    // reasons intact, as the thing to paint over; the brush is the toast's
    // primary action and is entered only when the user takes it. Deleting it
    // here left the toast pointing at geometry that no longer existed, offering
    // a mode the app had already entered, behind a button that wiped whatever
    // had been painted since.
    if (quality.level === 'poor' || quality.level === 'failed') {
      notify(
        `${what}, but it is probably wrong${reason}.${retryNote} `
        + 'It is left on the plan so you can see it — paint over the outside walls to replace it.',
        {
          type: 'error',
          id: 'trace-result',
          duration: DURATION.LONG,
          action: {
            label: drawn ? 'Paint again' : 'Paint it instead',
            onClick: () => handleDrawMode({ keepStrokes: true }),
          },
        },
      );
      return;
    }

    notify(`${what} — please check it against the plan${reason}.${retryNote}`, {
      type: 'warning',
      id: 'trace-result',
      duration: DURATION.LONG,
      action: drawAction,
    });
  }, [handleDrawMode]);

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
      parts.push(`${names} set to count as ${kinds.join(' / ')}, from the words on the plan.`);
    }
    if (reverted) {
      parts.push(`${reverted} outline${reverted === 1 ? '' : 's'} back to counting as GLA — `
        + 'the words it was read from are gone.');
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
        excludeRegions: nonGlaExcludeRegions(useAppStore.getState()),
        constraints: boundaryConstraints(useAppStore.getState()),
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
        // re-trace from the menu or a draw-mode pass changes it. It re-runs a pure
        // selection over rooms already measured, and no-ops unless the scale in
        // force is still the automatic one.
        applied = floors;
        if (floors) reviewAgainstFootprint(tracedAreaPx(traced));
        // Written before the report, and on the no-floor branch too. This is
        // the only durable record that a trace ran at all: without it a trace
        // that produced nothing wrote no field, so once the toast expired the
        // panel said "every outline came back clean" about zero outlines and
        // the spine read exactly as it does on a plan nobody has tried.
        const level = floors ? qualitySummary(traced?.quality).level : 'failed';
        setLastTraceOutcome({
          at: Date.now(),
          level,
          reason: qualitySummary(traced?.quality).reason ?? null,
          floors,
          source: brush ? 'drawn' : 'auto',
        });
        reportTrace(traced, floors);
        reportTraceTypes(typeChanges);
      };

      const verdict = deliver(work, applyTrace);
      // 'routed' is held and replayed on adopt, so it is not a failure and must
      // not be recorded as one. 'stale' and 'dropped' are the user's own doing
      // — they cropped the image or closed the plan — but the spinner simply
      // stopping with no message is indistinguishable from a trace that hung.
      if (verdict === 'stale' || verdict === 'dropped') {
        flash(verdict === 'stale'
          ? 'The plan changed while the outline was being found — find it again.'
          : 'That outline finished after its plan was closed.');
      }
      if (verdict !== 'applied') return null;

      perfMark(MARKS.areaReady);
      perfReportRun();
      return applied ? qualitySummary(traced?.quality).level : 'failed';
    } catch (error) {
      // Logged outside the delivery: a crash on a plan the user has since
      // cropped is still a crash, and inside the closure it was swallowed
      // along with the toast.
      console.error('Perimeter detection failed:', error);
      // The toast is a claim about the plan on screen — `id: 'trace-result'`
      // means it replaces whatever that plan's own trace had to say — so it is
      // raised only by work that still owns what it was tracing.
      deliver(work, () => {
        // One dead end used to cover a timeout, a killed worker and a bug in
        // applying a *successful* trace. They need different things from the
        // user, so they say different things.
        const text = String(error?.message ?? '');
        const message = /timed out|timeout/i.test(text)
          ? 'Finding the outline took too long and was stopped. Crop the plan to the house, or paint the outline instead.'
          : /terminated|worker/i.test(text)
            ? 'Finding the outline was interrupted. Try again, or paint the outline instead.'
            : 'FloorTrace couldn’t find the outline on this plan. Paint over the outside walls instead.';
        setLastTraceOutcome({ at: Date.now(), level: 'failed', reason: message, floors: 0 });
        notify(message, {
          type: 'error',
          id: 'trace-result',
          duration: DURATION.LONG,
          action: { label: 'Paint it instead', onClick: () => handleDrawMode({ keepStrokes: true }) },
        });
      });
      return 'failed';
    } finally {
      settleWork(work);
      // Unconditional, unlike the result writes above. Gated on the image, a
      // trace the user interrupted by cropping left `isProcessing` true with
      // nothing left to turn it off: a spinner that never stops and every
      // command that starts work disabled for the rest of the session. Clearing a
      // spinner a newer operation had just set is a flicker; this was a wedge.
      // Exact ownership needs a request token, which is what the document
      // request layer will carry — this is the honest stopgap until then.
      setIsProcessing(false);
    }
  }, [image, useInteriorWalls, setTracedBoundaries, applyTracedBoundary, setIsProcessing,
    reportTrace, reportTraceTypes, handleDrawMode, reviewAgainstFootprint,
    setLastTraceOutcome]);

  // Auto-detection, with draw mode as its fallback. A result the detector
  // itself rates poor or worse is not something to hand over as an answer, so
  // the brush is put in the user's hand rather than merely offered.
  const handleTracePerimeter = useCallback(async () => {
    if (!image) return;
    undoManager.save();
    await runTrace(FIND_OUTLINE_MESSAGE);
  }, [image, runTrace]);

  // Draw mode's commit: hand the painted strokes to the tracer as a corridor.
  const handleFinishDrawMode = useCallback(async () => {
    const state = useAppStore.getState();
    const strokes = state.drawStrokes;
    if (!strokes.length) {
      setDrawModeActive(false);
      flash('Nothing painted — drag over the outside walls first');
      return;
    }
    undoManager.save();
    setDrawModeActive(false);
    const level = await runTrace('Drawing the outline from your painting…', {
      strokes,
      radius: state.drawBrushSize / 2,
    });
    // The strokes are kept unless the result is clean: re-entering draw mode to
    // add one more pass is the natural correction, and discarding them would
    // make the user paint the whole outline again. `fair` used to clear them,
    // which is precisely the case whose own toast says to check it.
    if (level === 'good') setDrawStrokes([]);
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

    // Deliberately silent. The panel's Things to check carries this verdict
    // for as long as the scale is in force, which is where the question is
    // actually asked — a toast said it once and then left the doubt invisible.

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
      // An outline drawn corner by corner answers a failed automatic trace.
      // Only a trace writes this record, so without clearing it "The last
      // trace found no outline" stood beside the user's finished outline,
      // counted as a thing to check, for as long as the plan was open.
      setLastTraceOutcome(null);
    }
  }, [setPerimeterOverlay, setPerimeterVertices, setLastTraceOutcome]);

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
    () => runTrace(FIND_OUTLINE_MESSAGE),
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

    setIsProcessing(true, PROGRESS.measuringRooms);
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
    traceAfterScanRef.current = autoTraceExterior;
  }, [runAutoScale, autoTraceExterior]);

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

    setIsProcessing(true, 'Measuring that room…');
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
        'Couldn’t find that room’s walls — drag the green box to fit the room, '
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
          'FloorTrace isn’t sure it found this room’s walls, and the scale comes from it — '
          + 'check the green box matches the room before you trust the area.',
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

  // The desktop Help button names a page; the phone menu toggles the guide.
  const handleHelpOpen = useCallback((page) => {
    const w = useWorkspaceStore.getState();
    if (page === 'guide' || page === 'shortcuts') w.setShowHelpModal(page);
    else w.setShowHelpModal(w.showHelpModal ? false : 'guide');
  }, []);
  const handleOpenSettings = useCallback(() => useWorkspaceStore.getState().setShowSettings(true), []);
  const handleCloseSettings = useCallback(() => useWorkspaceStore.getState().setShowSettings(false), []);
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
  // Settings is the only place a unit is picked by hand, so picking one there
  // is what "my preferred unit" means — there is no second gesture that says
  // "and keep it". "Same as the plan", beside it, hands the choice back.
  const handleUnitChange = useCallback((u) => {
    undoManager.save();
    chooseUnit(u);
  }, [chooseUnit]);

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
    onDrawExterior: handlePaintOutline,
    onVoidToolToggle: handleVoidToolToggle,
    onScaleToolToggle: handleScaleToolToggle,
  });

  // ── Shell wiring ──────────────────────────────────────────────────────────
  usePlanAreaIndex();
  const { theme, cycleTheme, setTheme } = useTheme();
  const showSettings = useWorkspaceStore((s) => s.showSettings);
  const scaleRoomShown = useWorkspaceStore((s) => s.scaleRoomShown);
  const panelOpen = useWorkspaceStore((s) => s.panelOpen);
  const setPanelOpen = useWorkspaceStore((s) => s.setPanelOpen);
  const handlePanelToggle = useCallback(
    () => setPanelOpen(!useWorkspaceStore.getState().panelOpen),
    [setPanelOpen],
  );
  const handleShowPanel = useCallback(() => setPanelOpen(true), [setPanelOpen]);

  // Measuring a known length ends with typing it into the panel's Scale
  // section. Started from the keyboard with the panel put away, the tool would
  // draw a line and then have nowhere to take its length — so the panel comes
  // back with it.
  useEffect(() => {
    if (scaleToolActive) setPanelOpen(true);
  }, [scaleToolActive, setPanelOpen]);

  // Leaving a tool: drop every flag, and drop vertex-placement, room placement
  // and the room picker too — none is a tool-manager flag, but all three are
  // modes, and Cancel means "no mode" rather than "no flag".
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

  // Erasing marks and cropping are done *because* the outline came out wrong —
  // a legend or a note inside the house is a documented way to lose a trace —
  // so the next step is nearly always to find the outline again. The edit
  // offers it, rather than leaving the user to know to go and ask, and rather
  // than re-tracing unasked over an outline they may have adjusted by hand.
  const handleImageEdited = useCallback((newImageDataUrl) => {
    handleImageUpdate(newImageDataUrl);
    notify('Plan updated. When you have finished, find the outline again so it uses the cleaned-up plan.', {
      type: 'info',
      id: 'image-edited',
      duration: DURATION.LONG,
      action: {
        label: 'Find the outline',
        onClick: () => {
          if (useAppStore.getState().isProcessing) return;
          handleCancelTool();
          handleTracePerimeter();
        },
      },
    });
  }, [handleImageUpdate, handleCancelTool, handleTracePerimeter]);

  // Everything `toolCatalog.js` lists, by id. The menus speak the same tool
  // ids as `TOOL_MODES`, and each maps to the very toggle the keyboard already
  // binds — so the two routes into a tool cannot drift apart. The commands
  // (things that happen once, rather than modes) are below them.
  const handleToolSelect = useCallback((id) => {
    switch (id) {
      case 'select': return handleCancelTool();
      case 'draw': return handlePaintOutline();
      case 'vertex': return handleDrawExterior();
      case 'void': return handleVoidToolToggle();
      case 'scale': return handleScaleToolToggle();
      case 'line': return handleLineToolToggle();
      case 'angle': return handleAngleToolToggle();
      case 'area': return handleDrawAreaToggle();
      case 'crop': return handleCropToolToggle();
      case 'eraser': return handleEraserToolToggle();
      case 'cornerEraser': return handleCornerEraserToggle();
      case 'alternative': return handleUseAlternative();
      case 'findOutline': return handleTracePerimeter();
      case 'addOutline': return handleAddOutline();
      case 'clearMeasurements': return handleClearTools();
      case 'rotateRight': return handleRotateCanvas('clockwise');
      case 'rotateLeft': return handleRotateCanvas('counterclockwise');
      default: return undefined;
    }
  }, [handleCancelTool, handlePaintOutline, handleDrawExterior, handleVoidToolToggle,
    handleScaleToolToggle, handleLineToolToggle, handleAngleToolToggle,
    handleDrawAreaToggle, handleCropToolToggle, handleEraserToolToggle,
    handleCornerEraserToggle, handleUseAlternative, handleTracePerimeter,
    handleAddOutline, handleClearTools, handleRotateCanvas]);

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

  // The room the scale was taken from — the green box — is on the plan only
  // while it is the subject: the panel's Scale section is open, there is no
  // scale yet and the box is how one is set, or a room is being picked. At
  // rest it was an unexplained rectangle on one room of the house, and it is
  // draggable: moving it re-sets the scale every area is worked out from, which
  // is easy to do by accident while trying to move the plan.
  //
  // The phone always draws it. Its measurement sheet has to be closed to reach
  // the plan, so "while Scale is open" would mean never while it can be dragged.
  //
  // Nor while a drawn line is the scale: the box would then be evidence for
  // nothing, and dragging it would throw the line's scale away.
  const scaleRoomOnPlan = isMobile || (
    calibration.source !== 'line-calibration'
    && (scaleRoomShown || !calibration.calibrated || activeTool === 'pick')
  );

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
      onTryExample={handleOpenExample}
      addingPlan={documentOrder.length > 1}
      image={image}
      roomOverlay={scaleRoomOnPlan ? roomOverlay : null}
      perimeterOverlay={perimeterOverlay}
      perimeterTraces={perimeterTraces}
      activeTraceId={activeTraceId}
      traceInteractionMode={traceInteractionMode}
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
      cornerEraserActive={cornerEraserActive}
      eraserBrushSize={eraserBrushSize}
      cropToolActive={cropToolActive}
      onCropToolToggle={handleCropToolToggle}
      onImageUpdate={handleImageEdited}
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

  // Two shells over one workflow. Desktop reads in three parts: the header says
  // which plan is open, the results panel on the left says what was measured
  // and how far to trust it, and the plan takes the rest — under one action
  // bar that offers what can be done to it and, while a tool runs, turns into
  // that tool's instruction and its way out. Before a plan is open there is
  // only the header and the start screen.
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
          onCloseActivePlan={handleClosePlan}
          onHelpOpen={handleHelpOpen}
          onFindRoomSize={handleFindRoomSize}
          onTracePerimeter={handleTracePerimeter}
          onDrawExterior={handlePaintOutline}
          onOutlineByVertex={handleDrawExterior}
          onAddFloor={handleAddOutline}
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
          onRestoreAutoScale={restoreAutoScale}
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
      <AppHeader
        image={image}
        isProcessing={isProcessing}
        planCount={documentOrder.length}
        onSelectPlan={switchPlan}
        onClosePlan={closePlan}
        onNewPlan={openPlan}
        onFileOpen={handleFileOpen}
        onPasteImage={handlePasteImage}
        onExport={openExport}
        onCopyExhibit={copyExhibitNow}
        onSaveProject={handleSaveProject}
        onSaveProjectAs={handleSaveProjectAs}
        onSaveAllProjects={handleSaveAllProjects}
        onCloseActivePlan={handleClosePlan}
        onCloseAllPlans={handleCloseAllPlans}
        onOpenSettings={handleOpenSettings}
        onHelpOpen={handleHelpOpen}
        panelOpen={panelOpen}
        onPanelToggle={handlePanelToggle}
        showSideLengths={showSideLengths}
        onShowSideLengthsChange={handleShowSideLengthsChange}
        autoSnapEnabled={autoSnapEnabled}
        onAutoSnapChange={handleAutoSnapChange}
      />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Only once there is a plan to measure. Before that the start screen
            is the whole job, and a column of "no area yet" beside it says
            nothing but "not yet". */}
        {panelOpen && image && (
          <ResultsPanel
            roomDimensions={roomDimensions}
            onDimensionsChange={handleDimensionsChange}
            area={area}
            unit={unit}
            isProcessing={isProcessing}
            ocrFailed={ocrFailed}
            useInteriorWalls={useInteriorWalls}
            onInteriorWallToggle={handleInteriorWallToggle}
            canSwitchWallFace={canSwitchWallFace}
            onDimensionFocus={handleDimensionFocus}
            onDimensionBlur={handleDimensionBlur}
            onScaleTool={handleScaleToolToggle}
            onSelectRoom={handleSelectRoom}
            onRestoreAutoScale={restoreAutoScale}
            onExport={openExport}
            onFindOutline={handleTracePerimeter}
            onPaintOutline={handlePaintOutline}
            onPlaceCorners={handleDrawExterior}
            onAddOutline={handleAddOutline}
            onRescan={handleFindRoomSize}
          />
        )}

        {/* The plan's own column: what can be done to it, and the plan.
            `min-w-0` so the action bar's unshrinkable controls cannot hold the
            column — and so the canvas — wider than the window leaves it.
            `min-h-0` for the same reason vertically, or the canvas cannot
            shrink to the leftover and the bottom of the plan is clipped with no
            scrollbar.

            The bar must be a *sibling* of the canvas box, never inside it:
            Canvas' root is `absolute inset-0`, so it would paint over the bar
            and the Konva stage would swallow its clicks. */}
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          {/* Only with a plan: every row of it acts on one. */}
          {image && (
            <ActionBar
              tool={activeTool}
              count={contextCount}
              brushSize={contextBrush}
              onBrushSizeChange={onContextBrushChange}
              onCancel={handleCancelTool}
              onDone={contextDone}
              hasArea={area > 0}
              hasToolData={hasToolData}
              onSelect={handleToolSelect}
              panelOpen={panelOpen}
              onShowPanel={handleShowPanel}
            />
          )}

          {/* `relative` is what makes this box the canvas's offsetParent,
              which is to say its measured size. The paper is white in every
              theme; the start screen is not paper, so it wears the theme. */}
          <div className={`relative flex-1 min-h-0 ${image || isProcessing ? 'canvas-grid-bg' : ''}`}>
            {canvasElement}
            {image && (
              <ViewControls
                onZoomIn={() => handleZoom(1)}
                onZoomOut={() => handleZoom(-1)}
                onFitToWindow={handleFitToWindow}
              />
            )}
          </div>
        </div>
      </div>
      </>
      )}

      {/* Keyed on the page, so choosing Keyboard shortcuts while the guide
          is open lands on the shortcuts rather than keeping the old tab. */}
      {showHelpModal && (
        <HelpModal
          key={String(showHelpModal)}
          initialTab={showHelpModal === 'shortcuts' ? 'shortcuts' : 'guide'}
          onClose={handleHelpClose}
        />
      )}

      {showSettings && (
        <SettingsDialog
          onClose={handleCloseSettings}
          onUnitChange={handleUnitChange}
          theme={theme}
          onThemeChange={setTheme}
          saveOnExit={saveOnExit}
          onSaveOnExitChange={handleSaveOnExitChangeWithToast}
          enhancedOcr={enhancedOcr}
          onEnhancedOcrChange={handleEnhancedOcrChange}
        />
      )}

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

      {/* Only real notifications - every "you are in X mode" message is the
          action bar's, which carries the running mode, and every low-stakes
          confirmation is a flash in the same bar. What is left is what
          actually deserves to interrupt. */}
      {/* Two slots, not sonner's default three. A burst that cannot be read is
          worse than a burst that is truncated, and with every toast carrying
          a stable id the same condition updates in place instead of stacking. */}
      <Toaster
        position="top-center"
        visibleToasts={2}
        closeButton
        // Clears whichever chrome is above it: the desktop header and action
        // bar, or one mobile bar plus whatever the notch takes. Named rather
        // than written inline, because it was a hard-coded `116px` for a stack
        // that had already changed twice.
        style={{
          top: isMobile
            ? 'calc(env(safe-area-inset-top, 0px) + 60px)'
            : `${desktopChromePx(!!image)}px`,
        }}
        toastOptions={{
          classNames: {
            toast: 'group !bg-raised !border-line !text-fg !rounded-xl !shadow-float font-medium text-[14.5px] leading-snug font-sans select-none flex items-center gap-2.5 p-4 !w-fit !max-w-lg',
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
