import { useRef, useEffect, useCallback } from 'react';
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
import { askConfirm } from './utils/askConfirm';
import { notify, flash } from './utils/notify';
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
import { useAutoScale } from './hooks/useAutoScale';
import { qualitySummary } from './utils/boundaryQuality';
import { loadExamplePlan } from './utils/examplePlan';
import { PROGRESS } from './utils/progressSteps';
import { perfMark, perfReportRun, perfResetRun, MARKS } from './utils/perfMarks';
import useAppStore, {
  selectCombinedArea, selectActivePerimeterOverlay, selectCanSwitchWallFace, selectPickingRoom,
  otherRoomScaleSamples,
} from './store/appStore';
import useWorkspaceStore from './store/workspaceStore';
import * as undoManager from './store/undoManager';
import { beginWork, settleWork, deliver, isCurrent } from './store/documentRequests';
import { useAutosave } from './hooks/useAutosave';
import { useEnhancedOcr } from './hooks/useEnhancedOcr';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useScaleTool } from './hooks/useScaleLine';
import { useProjectIO } from './hooks/useProjectIO';
import { useExhibitExport } from './hooks/useExhibitExport';
import { useDragAndDrop } from './hooks/useDragAndDrop';
import { useOcrWarmup } from './hooks/useOcrWarmup';
import { useTheme } from './hooks/useTheme';
import { useIsMobile } from './hooks/useViewport';
import { usePlanManager } from './hooks/usePlanManager';
import { usePlanAreaIndex } from './hooks/usePlanAreaIndex';
import Notice from './components/Notice';
import useUnitPreference from './hooks/useUnitPreference';

// The desktop chrome a notice has to clear: the header's 52, the action bar's
// 48 when there is a plan for it to act on, and 10 px of air. A function of
// what is actually on screen, because the bar comes and goes.
const desktopChromePx = (hasPlan) => 52 + (hasPlan ? 48 : 0) + 10;
// The results panel's width (`ResultsPanel.jsx`, `w-[360px]`), which is what a
// notice has to clear to sit over the plan rather than half over the panel.
const RESULTS_PANEL_PX = 360;

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

// What the trace left out of the outline on purpose, as the second half of
// the one line a trace ends in. Said because an outline that stops short of the
// garage otherwise reads as a mistake — and said in few words, because the bar
// is one line and the sample plan's own ending was being cut off in a window
// 1024 px wide.
const excludedAreasNote = (traced) => {
  const garages = traced.excludedGarages ?? 0;
  const others = (traced.excludedRegions ?? 0) - garages;
  if (garages && others > 0) return 'garage and porch or patio left out';
  if (garages) return 'garage left out';
  if (others > 0) return 'porch or patio left out';
  return null;
};

function App() {
  // ── Pull everything from the Zustand store ──────────────────────────────
  const image = useAppStore((s) => s.image);
  const roomOverlay = useAppStore((s) => s.roomOverlay);
  const perimeterOverlay = useAppStore(selectActivePerimeterOverlay);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const roomDimensions = useAppStore((s) => s.roomDimensions);
  const area = useAppStore(selectCombinedArea);
  const mode = useAppStore((s) => s.mode);
  const pickingRoom = useAppStore(selectPickingRoom);
  const calibration = useAppStore((s) => s.calibration);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const detectedDimensions = useAppStore((s) => s.detectedDimensions);
  const showSideLengths = useAppStore((s) => s.showSideLengths);
  const useInteriorWalls = useAppStore((s) => s.useInteriorWalls);
  const ocrFailed = useAppStore((s) => s.ocrFailed);
  const unit = useAppStore((s) => s.unit);
  const tracedBoundaries = useAppStore((s) => s.tracedBoundaries);
  const canSwitchWallFace = useAppStore(selectCanSwitchWallFace);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const documentOrder = useAppStore((s) => s.documentOrder);
  const showHelpModal = useWorkspaceStore((s) => s.showHelpModal);
  const showExportDialog = useWorkspaceStore((s) => s.showExportDialog);
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);

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
  const setTracedBoundaries = useAppStore((s) => s.setTracedBoundaries);
  const setLastTraceOutcome = useAppStore((s) => s.setLastTraceOutcome);
  const setShowHelpModal = useWorkspaceStore((s) => s.setShowHelpModal);
  const setShowSideLengths = useAppStore((s) => s.setShowSideLengths);
  const setUseInteriorWalls = useAppStore((s) => s.setUseInteriorWalls);

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

  const { toggleScaleTool, leaveScaleTool } = useScaleTool();

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

  // What the action bar is showing an instruction for. There are two modes
  // left: setting the scale from a known length, and choosing the room to take
  // it from. Room sizes on the plan as buttons is a mode even though no tool
  // flag says so (`selectPickingRoom`).
  const activeTool = scaleToolActive ? 'scale' : pickingRoom ? 'pick' : 'select';

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
        const confirmed = await askConfirm(
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
      
      // Nothing to read. Every control that leads here is absent or greyed
      // out without a plan, and the start screen already says what to do.
      if (!imgSrc) return;
      
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
          // No message of its own. The panel says it for as long as it is
          // true — the figure reads "couldn't read any room sizes" and Scale
          // opens on the way to set one — and the run still ends in one line
          // in the bar, from the trace below.
          setMode('normal');
          // The outline does not wait for a scale. Finding the walls needs
          // nothing the scan failed to read, so a plan with no room sizes
          // printed on it still gets its outline — and is left one thing short
          // of an area, not two. It used to stop here with nothing drawn and
          // two jobs for the user, the first of which the app could do itself.
          //
          // Only when there is no outline yet. Reading the sizes again on a
          // plan that already has one must not re-trace over it: the user asked
          // about the scale.
          const outlined = useAppStore.getState().perimeterTraces
            ?.some((t) => t.vertices?.length >= 3);
          if (outlined) flash('Couldn’t read any room sizes on this plan', 'warn');
          else await traceAfterScanRef.current?.();
        } else {
          // Auto-switch unit based on detected format. The parser's vocabulary
          // is {inches, decimal, meters} and the UI's is {inches, decimal,
          // metric}; without the mapping a metric plan set a unit no formatter
          // recognised.
          const uiUnit = detectedFormat === 'meters' ? 'metric' : detectedFormat;
          // Only when the user has not said which unit they want. A pinned
          // preference is a standing instruction, and the drawing does not get
          // to overrule it — that is the whole point of pinning one.
          if (uiUnit && unit !== uiUnit && useWorkspaceStore.getState().unitPreference === 'auto') {
            setUnit(uiUnit);
          }
          // Nothing is announced here. The scan is the first of three steps the
          // panel is ticking off as they finish, and a "found 7 room sizes"
          // beside the next step's "Measuring the rooms…" was two things said
          // at once about a job that was not over.
          // Everything from here is automatic: every label is measured, the
          // rooms that agree set the scale, the room the scale came from is
          // placed as the overlay, and the exterior is traced. The pills stay
          // lit only when that fails.
          await afterScanRef.current?.(dimensions);
        }
      } catch (error) {
        console.error('Error detecting dimensions:', error);
        // Same rule as the success path: a failure to read an image the user
        // has already moved on from is not news about the plan on screen.
        deliver(work, () => {
          // The panel carries it from here: the figure says the sizes could
          // not be read, and Scale opens on the way to set one by hand.
          setOcrFailed(true);
          setMode('normal');
          flash('Couldn’t read the room sizes on this plan', 'warn');
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
  }, [image, mode, roomOverlay, perimeterOverlay, unit, setDetectedDimensions, setExteriorLabels, setAreaLabels, setIsProcessing, setMode, setOcrFailed, setPerimeterOverlay, setRoomOverlay, setUnit]);

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
      const confirmed = await askConfirm(
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
      notify(error?.message || 'The sample plan could not be opened.');
    } finally {
      setIsProcessing(false);
    }
  }, [makeRoomForIncoming, resetOverlays, setImage, setImageMimeType, setIsProcessing, handleManualMode]);

  /**
   * Adopt the search's next-best footprint for the active outline.
   *
   * The commonest correctable failure is a tie-break: two candidates within
   * `SCORE_EPSILON` (0.015) of each other and the wrong one won. The right
   * geometry has already been computed and scored — this hands it over. The rejected one goes
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
          // costs a click. Geometry only.
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
      setPerimeterOverlay(shaped[0]);
    } else {
      useAppStore.getState().applyDetectedTraces(shaped);
    }
    return shaped.length;
  }, [setPerimeterOverlay]);

  /**
   * The one line a trace ends in.
   *
   * This used to be five different toasts and a flash — found, found but check
   * it, found but probably wrong, traced again, set to count as a garage — each
   * decided from the detector's verdict on its own outline, and each said a
   * second time by the panel. Measured on the sample plans, eight in nine
   * raised at least one and two raised a pair at once.
   *
   * The outline is on the plan now, and the user is looking at it: whether it
   * is right is theirs to see. So this says what happened and stops. The two things it
   * still has to say in words are the two that leave nothing to look at — no
   * outline was found, or one was and there is no scale to measure it with —
   * and both are also what the panel is showing, for as long as they are true.
   */
  const reportTrace = useCallback((traced, floorCount) => {
    if (!floorCount) {
      flash('Couldn’t find the outline on this plan', 'warn');
      return;
    }
    const what = floorCount > 1 ? `Found ${floorCount} outlines` : 'Outline found';
    if (!useAppStore.getState().calibration?.calibrated) {
      flash(`${what} — set the scale to see the area`, 'warn');
      return;
    }
    const leftOut = excludedAreasNote(traced ?? {});
    flash(leftOut ? `${what} — ${leftOut}` : what);
  }, []);

  // Returns the quality level of the applied trace.
  const runTrace = useCallback(async (message) => {
    if (!image) return null;
    setIsProcessing(true, message);
    const work = beginWork('trace');
    try {
      const traced = await traceFloorplanBoundary(image, {
        excludeRegions: nonGlaExcludeRegions(useAppStore.getState()),
        constraints: boundaryConstraints(useAppStore.getState()),
      });

      perfMark(MARKS.traceEnd);

      // One closure, whichever plan it turns out to belong to. Run now if this
      // plan is live; held and replayed on adopt if the user switched tabs
      // while the trace ran. Held rather than dropped is the whole point: a
      // trace is seconds of work, and losing it silently because you looked at
      // another plan is the kind of nothing-happened that is hard to even
      // report as a bug.
      // Captured from the apply, never re-derived: `applyTracedBoundary`
      // returns the floors it could actually use — which is not the same as
      // the floors the detector reported.
      let applied = 0;
      const applyTrace = () => {
        setTracedBoundaries(traced);
        const floors = traced ? applyTracedBoundary(traced, useInteriorWalls) : 0;
        // Inside the apply and not beside it: the classification reads this
        // plan's `areaLabels` and retypes the outlines this closure has just
        // placed, so on the held-and-replayed path both have to be the
        // adopting plan's, not whichever plan was live when the trace started.
        // Not announced: a type set from the plan's own words is on the
        // outline's row, with the words it was read from.
        if (floors) useAppStore.getState().classifyTraceTypes();
        // Every trace, not only the one the automatic scan ran: the footprint is
        // the one check on the scale that survives a majority of bad rooms, and a
        // re-trace changes it. It re-runs a pure
        // selection over rooms already measured, and no-ops unless the scale in
        // force is still the automatic one.
        applied = floors;
        if (floors) reviewAgainstFootprint(tracedAreaPx(traced));
        // Written before the report, and on the no-floor branch too. This is
        // the only durable record that a trace ran at all: without it a trace
        // that produced nothing wrote no field, so the panel read exactly as
        // it does on a plan nobody has tried, and offered the automatic trace
        // that had just failed as the next thing to do.
        const level = floors ? qualitySummary(traced?.quality).level : 'failed';
        setLastTraceOutcome({
          at: Date.now(),
          level,
          reason: qualitySummary(traced?.quality).reason ?? null,
          floors,
          source: 'auto',
        });
        reportTrace(traced, floors);
      };

      const verdict = deliver(work, applyTrace);
      // 'routed' is held and replayed on adopt, so it is not a failure and must
      // not be recorded as one. 'stale' and 'dropped' are the user's own doing
      // — they replaced the image or closed the plan — but the spinner simply
      // stopping with no message is indistinguishable from a trace that hung.
      if (verdict === 'stale' || verdict === 'dropped') {
        flash(verdict === 'stale'
          ? 'The plan changed while the outline was being found — find it again'
          : 'That outline finished after its plan was closed', 'warn');
      }
      if (verdict !== 'applied') return null;

      perfMark(MARKS.areaReady);
      perfReportRun();
      return applied ? qualitySummary(traced?.quality).level : 'failed';
    } catch (error) {
      // Logged outside the delivery: a crash on a plan the user has since
      // replaced is still a crash, and inside the closure it was swallowed
      // along with the message.
      console.error('Perimeter detection failed:', error);
      // A claim about the plan on screen, so it is raised only by work that
      // still owns what it was tracing.
      deliver(work, () => {
        // One dead end used to cover a timeout, a killed worker and a bug in
        // applying a *successful* trace. They need different things from the
        // user, so they say different things: the line in the bar now, and the
        // rest under Outline for as long as there is no outline.
        const text = String(error?.message ?? '');
        const timedOut = /timed out|timeout/i.test(text);
        const interrupted = !timedOut && /terminated|worker/i.test(text);
        setLastTraceOutcome({
          at: Date.now(),
          level: 'failed',
          reason: timedOut
            ? 'Finding it took too long and was stopped.'
            : interrupted ? 'Finding it was interrupted, so it is worth trying again.' : null,
          floors: 0,
        });
        flash(timedOut ? 'Finding the outline took too long and was stopped'
          : interrupted ? 'Finding the outline was interrupted — try again'
            : 'Couldn’t find the outline on this plan', 'warn');
      });
      return 'failed';
    } finally {
      settleWork(work);
      // Unconditional, unlike the result writes above. Gated on the image, a
      // trace the user interrupted by replacing the image left `isProcessing` true with
      // nothing left to turn it off: a spinner that never stops and every
      // command that starts work disabled for the rest of the session. Clearing a
      // spinner a newer operation had just set is a flicker; this was a wedge.
      // Exact ownership needs a request token, which is what the document
      // request layer will carry — this is the honest stopgap until then.
      setIsProcessing(false);
    }
  }, [image, useInteriorWalls, setTracedBoundaries, applyTracedBoundary, setIsProcessing,
    reportTrace, reviewAgainstFootprint, setLastTraceOutcome]);

  // Find the outline, from the menu or the panel. The undo point is this
  // function's: the automatic run after a scan has already saved its own.
  const handleTracePerimeter = useCallback(async () => {
    if (!image) return;
    undoManager.save();
    await runTrace(FIND_OUTLINE_MESSAGE);
  }, [image, runTrace]);

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

  // Set the project scale from one room. The decision — which rooms get a
  // vote, what the verdict is, whether anything moved — is resolveScaleUpdate's
  // and is unit-tested there; what is left here is the store write, the one
  // thing a pure function cannot do.
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

    // Deliberately silent. The panel's Scale section carries this verdict for
    // as long as the scale is in force, which is where the question is
    // actually asked — a message said it once and then left the doubt invisible.

    if (resolved.changed) {
      applyRoomCalibration(resolved.scale, null, 'room-calibration', resolved.quality);
    }
  }, [applyRoomCalibration]);

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
  // that room and switch the footprint cross-check off, which is what picking
  // a room is *supposed* to do and must stay the user's choice.
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

    // The last word of the run, when the user's own scale stood against the
    // rooms just measured: the scale is what they asked about by reading the
    // sizes again, so it outranks "Outline found".
    if (decision.keptByHand) {
      if (decision.keptByHand.agrees) {
        flash('Kept the scale you set by hand — the rooms on this plan agree with it');
      } else {
        flash('Kept the scale you set by hand — the rooms on this plan disagree with it', 'warn');
      }
    }
  }, [measureAndCalibrate, autoTraceExterior, setIsProcessing, showAutoScaleRoom, setMode]);

  useEffect(() => {
    afterScanRef.current = runAutoScale;
    traceAfterScanRef.current = autoTraceExterior;
  }, [runAutoScale, autoTraceExterior]);

  /**
   * Place a room: run the detector, record the result as reusable evidence,
   * calibrate from it, then trace the exterior.
   */
  const placeRoom = useCallback(async ({ point, dims, labelBbox, labelId }) => {
    let overlay = null;
    let detected = null;

    // Every other parsed label on the page, as a place this room is not: a
    // rectangle holding another room's dimensions grew through a wall. The
    // scan's batch gives each room it measures the same evidence, and this is
    // the same rooms by another route, so the two must not be able to disagree.
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

    // A room whose walls were not found sets nothing. It used to fall through
    // to a hardcoded 200x200 box and calibrate the whole project from it; with
    // no way to drag that box onto the room, the only honest answer is to leave
    // the scale alone and the room sizes up to pick another from.
    if (!detected || !overlay) {
      flash('Couldn’t find that room’s walls — pick a different room, or set the scale using a known length', 'warn');
      return;
    }

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
    // The detector already knows when it could not confirm this room's walls,
    // and the very next statement calibrates the whole project from the
    // rectangle. Held until the trace below has run, because the bar keeps
    // only the latest line and "Outline found" would replace it.
    const roomDoubt = detected.confidence < 0.5
      ? 'Not sure of that room’s walls — check the green box fits the room, or pick another'
      : null;

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

    setMode('normal');

    // The labels are kept, not cleared. `setMode('normal')` above is what puts
    // the pills away; clearing the array as well made "Select room" a one-shot
    // — the second wrong guess had nothing left to pick from — and threw away
    // the tracer's interior points and the exhibit's unit style along with it.
    await autoTraceExterior();
    // The last word, because it is the one about the scale: Scale is open with
    // the green box on the plan, which is where the user is being sent.
    if (roomDoubt && isCurrent(work)) flash(roomDoubt, 'warn');
  }, [image, setIsProcessing, setRoomDimensions, setRoomOverlay, updateScale,
    setMode, autoTraceExterior]);

  // A room size on the plan was clicked: take the scale from that room.
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
    onRotateCanvas: handleRotateCanvas,
    onFitToWindow: handleFitToWindow,
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

  // Setting the scale from a known length ends with typing the length into the
  // panel's Scale section, so the panel comes back with the tool.
  useEffect(() => {
    if (scaleToolActive) setPanelOpen(true);
  }, [scaleToolActive, setPanelOpen]);

  // Leaving a mode: put the length tool down, and put the room sizes away if
  // choosing a room is the mode being shown.
  const handleCancelTool = useCallback(() => {
    leaveScaleTool();
    if (activeTool === 'pick') setMode('normal');
  }, [activeTool, leaveScaleTool, setMode]);

  // One or the other: entering the length tool puts the room sizes away.
  const handleScaleToolToggle = useCallback(() => {
    if (activeTool === 'pick') setMode('normal');
    toggleScaleTool();
  }, [activeTool, setMode, toggleScaleTool]);

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
    leaveScaleTool();
    setMode('manual');
  }, [activeTool, leaveScaleTool, setMode]);

  const handleZoom = useCallback((direction) => {
    canvasRef.current?.zoomByStep(direction);
  }, []);

  // ── mobile shell ──────────────────────────────────────────────────────────
  // Which chrome the app wears. Everything above this line is shared: the two
  // shells are two arrangements of the same workflow, not two applications.
  const isMobile = useIsMobile();

  const handleTakePhoto = useCallback(() => cameraInputRef.current?.click(), []);

  // The room the scale was taken from — the green box — is on the plan only
  // while it is the subject: the panel's Scale section is open, there is no
  // scale yet and the box is how one is set, or a room is being picked. At
  // rest it was an unexplained rectangle on one room of the house.
  //
  // The phone always draws it. Its measurement sheet has to be closed to reach
  // the plan, so "while Scale is open" would mean never while it can be seen.
  //
  // Nor while a drawn line is the scale: the box would then be evidence for
  // nothing.
  const scaleRoomOnPlan = isMobile || (
    calibration.source !== 'line-calibration'
    && (scaleRoomShown || !calibration.calibrated || activeTool === 'pick')
  );

  // The plan view, built once and handed to whichever shell is on. Same
  // element, same props: nothing about tracing depends on the chrome around it,
  // and a second copy of this list is a second place for them to diverge.
  // `key` is the entire correctness argument for in-progress gestures across a
  // plan switch. The canvas hooks hold real state outside the store — the
  // length being drawn, a selected scale line — and none of it is parked,
  // because none of it is a fact about the plan. Keying the subtree on the plan
  // means all of it dies with the tree instead of being reinterpreted against a
  // different drawing.
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
      isProcessing={isProcessing}
      processingMessage={processingMessage}
      detectedDimensions={detectedDimensions}
      onDimensionSelect={handleDimensionSelect}
      showSideLengths={showSideLengths}
      feetPerPixel={calibration.feetPerPixel}
      unit={unit}
    />
  );

  // Two shells over one workflow. Desktop reads in three parts: the header says
  // which plan is open, the results panel on the left says what was measured
  // and how far to trust it, and the plan takes the rest — under one bar that
  // says what FloorTrace is doing and, while the scale is being set by hand,
  // what to do next. Before a plan is open there is
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
          onMenuFileOpen={handleFileOpen}
          onTakePhoto={handleTakePhoto}
          onExport={openExport}
          onCopyExhibit={copyExhibitNow}
          onSaveProject={handleSaveProject}
          onCloseActivePlan={handleClosePlan}
          onHelpOpen={handleHelpOpen}
          onFindRoomSize={handleFindRoomSize}
          onTracePerimeter={handleTracePerimeter}
          onFitToWindow={handleFitToWindow}
          onRotate={handleRotateCanvas}
          onCancelTool={handleCancelTool}
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
          saveOnExit={saveOnExit}
          onSaveOnExitChange={handleSaveOnExitChange}
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
          {/* Only with a plan: everything it says is about one. */}
          {image && (
            <ActionBar
              tool={activeTool}
              onCancel={handleCancelTool}
              onUseAlternative={handleUseAlternative}
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
                onRotate={handleRotateCanvas}
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
          onSaveOnExitChange={handleSaveOnExitChange}
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

      {/* The one notice, for what went wrong outside the plan — a file, a
          save, storage. Everything about the plan itself is the bar's or the
          panel's (`utils/notify.js`). Below whichever chrome is above it: the
          desktop header and action bar, or one mobile bar plus the notch. */}
      <Notice
        top={isMobile
          ? 'calc(env(safe-area-inset-top, 0px) + 60px)'
          : `${desktopChromePx(!!image)}px`}
        left={!isMobile && panelOpen && image ? RESULTS_PANEL_PX : 0}
      />
    </div>
  );
}

export default App;
