import { useCallback, useMemo, useState } from 'react';
import { AlertTriangle, Brush, FolderOpen, ScanSearch, ScanText, Share } from 'lucide-react';
import useAppStore, { selectActiveAreaByType } from '../../store/appStore';
import { areaDisplayValue, formatAreaValue } from '../../utils/unitConverter';
import { displayedBreakdownTotal } from '../../utils/areaCalculator';
import { scaleQualitySummary } from '../../utils/boundaryQuality';
import { summariseIssues } from '../../utils/traceIssues';
import { planStage } from '../../utils/planStage';
import MeasurementDock from '../MeasurementDock';
import BottomSheet from './BottomSheet';
import MobilePlansSheet from './MobilePlansSheet';
import MobileActionBar from './MobileActionBar';
import MobileCanvasOverlay from './MobileCanvasOverlay';
import MobileMenuSheet from './MobileMenuSheet';
import MobileToolContext from './MobileToolContext';
import MobileToolSheet from './MobileToolSheet';
import MobileTopBar from './MobileTopBar';

/**
 * The mobile shell: top bar, bottom bar, and the four sheets between them
 * — menu, tools, measurement, and the plans sheet the tab strip stands in for.
 *
 * `App` still owns every workflow decision — this component owns only where
 * those decisions appear on a phone. It reads the store directly for the state
 * it *displays* (the same thing `MeasurementDock` does) and takes handlers as
 * props for everything it *does*, so no behaviour forks between the two shells.
 */
const MobileChrome = ({
  onSelectPlan,
  onClosePlan,
  onNewPlan,
  // The canvas, handed in rather than rendered here: it is the same element
  // the desktop shell mounts, and it must stay one subtree so a re-render of
  // the chrome never rebuilds the Konva stage underneath it.
  children,
  activeTool,
  hasToolData,
  // plan / project
  onMenuFileOpen,
  onTakePhoto,
  onExport,
  onCopyExhibit,
  onSaveProject,
  // Not `onClosePlan` above: that one closes a *named* plan from the plans
  // sheet and takes its id. This is the menu command, which closes whichever
  // plan you are looking at and takes nothing. Both print "Close plan"; only
  // one of them needs to be told which.
  onCloseActivePlan,
  onHelpOpen,
  // trace
  onFindRoomSize,
  onTracePerimeter,
  onDrawExterior,
  onOutlineByVertex,
  onAddFloor,
  // canvas
  onFitToWindow,
  onRotate,
  // tools
  onToolSelect,
  onCancelTool,
  onClearTools,
  onFinishDrawMode,
  onClosePerimeter,
  onCloseCustomShape,
  onCloseVoid,
  // measurement panel
  roomDimensions,
  onDimensionsChange,
  onDimensionFocus,
  onDimensionBlur,
  onUnitChange,
  onInteriorWallToggle,
  canSwitchWallFace,
  onScaleTool,
  onSelectRoom,
  onRestoreAutoScale,
  // preferences
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
  saveOnExit,
  onSaveOnExitChange,
  enhancedOcr,
  onEnhancedOcrChange,
  theme,
  onCycleTheme,
}) => {
  const [sheet, setSheet] = useState(null); // 'menu' | 'tools' | 'panel' | 'plans'

  const image = useAppStore((s) => s.image);
  const unit = useAppStore((s) => s.unit);
  const ocrFailed = useAppStore((s) => s.ocrFailed);
  const lastTraceOutcome = useAppStore((s) => s.lastTraceOutcome);
  const projectName = useAppStore((s) => s.projectName);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const calibrated = useAppStore((s) => s.calibration?.calibrated);
  const scaleQuality = useAppStore((s) => s.calibration?.quality);
  const useInteriorWalls = useAppStore((s) => s.useInteriorWalls);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const perimeterVertices = useAppStore((s) => s.perimeterVertices);
  const currentCustomShape = useAppStore((s) => s.currentCustomShape);
  const drawBrushSize = useAppStore((s) => s.drawBrushSize);
  const eraserBrushSize = useAppStore((s) => s.eraserBrushSize);
  const setDrawBrushSize = useAppStore((s) => s.setDrawBrushSize);
  const setEraserBrushSize = useAppStore((s) => s.setEraserBrushSize);
  const areas = useAppStore(selectActiveAreaByType);
  const documentOrder = useAppStore((s) => s.documentOrder);

  // Read from `planStage`, not re-derived. This shell is the third surface to
  // ask "is this plan outlined", and the first two answering it differently is
  // the reason that helper exists — the seven-outline ceiling it also owns was
  // missing here, so the menu offered an eighth that nothing else would.
  const issues = summariseIssues(
    perimeterTraces,
    scaleQualitySummary(scaleQuality),
    areas.doubleCounted,
    lastTraceOutcome,
  );
  const stage = planStage({
    image, calibrated, perimeterTraces, area: areas.total,
    doubleCounted: areas.doubleCounted?.length ?? 0,
    issues, lastTraceOutcome, ocrFailed,
  });
  const { canAddOutline } = stage;
  const noGla = areas.gla === 0 && areas.total > 0;
  // The same arithmetic the dock and the exhibit do, because the thumb bar and
  // the measurement sheet are on screen together: a total summed from the raw
  // areas here and from the printed rows there put two different square
  // footages a few pixels apart on one phone screen.
  const totalDisplay = displayedBreakdownTotal(areas.byType, unit);
  const { value: areaText, suffix: areaSuffix } = noGla
    ? formatAreaValue(totalDisplay, unit)
    : formatAreaValue(areaDisplayValue(areas.gla, unit), unit);

  // The same count the dock's chip and the exhibit's flags read, not a fourth
  // hand-rolled derivation. The three-term boolean this replaces missed stale
  // voids entirely — on the shell with the least room to qualify a number.
  const areaWarn = issues.count > 0;

  // ── the one verb ─────────────────────────────────────────────────────────
  // `planStage` decides, so the bar always offers the step the user is actually
  // on and cannot disagree with the desktop's primary or with the spine inside
  // its own measurement sheet. Its `failed` states are what stop it offering
  // the action that has just failed.
  const primaryAction = useMemo(() => {
    if (!image) return { label: 'Open a plan', icon: FolderOpen, onPress: onMenuFileOpen };
    switch (stage.primary) {
      case 'scale':
        return { label: 'Read dimensions', icon: ScanText, onPress: onFindRoomSize };
      // The scan came back empty and is memoised, so offering it again is a
      // guaranteed no-op. The brush and the ruler are the routes that work.
      case 'scale-manual':
        return { label: 'Set the scale by hand', icon: ScanText, onPress: onScaleTool };
      case 'outline':
        return { label: 'Find outline', icon: ScanSearch, onPress: onTracePerimeter };
      case 'outline-paint':
        return { label: 'Paint the outline', icon: Brush, onPress: onDrawExterior };
      default:
        break;
    }
    // An outline exists. If the panel is counting something against it, the
    // next thing to do is read that — not export it.
    if (issues.count > 0) {
      return {
        label: `Check ${issues.count} ${issues.count === 1 ? 'thing' : 'things'}`,
        icon: AlertTriangle,
        onPress: () => setSheet('panel'),
      };
    }
    return { label: 'Export for workfile', icon: Share, onPress: onExport };
  }, [image, stage.primary, issues.count, onMenuFileOpen, onFindRoomSize,
    onScaleTool, onTracePerimeter, onDrawExterior, onExport]);

  const closeSheet = useCallback(() => setSheet(null), []);

  // ── active-tool bar ──────────────────────────────────────────────────────
  const toolCount = activeTool === 'vertex'
    ? (perimeterVertices?.length ?? 0)
    : activeTool === 'area'
      ? (currentCustomShape?.vertices?.length ?? 0)
      : 0;
  const brushSize = activeTool === 'draw' ? drawBrushSize
    : activeTool === 'eraser' ? eraserBrushSize : 0;
  const onBrushSizeChange = activeTool === 'draw' ? setDrawBrushSize : setEraserBrushSize;

  // Void and area gain a commit button they do not have on the desktop, where
  // Enter closes them. There is no Enter here, and "tap the first corner again"
  // is a 22 px target at the far end of a gesture.
  const toolDone = activeTool === 'draw' ? onFinishDrawMode
    : activeTool === 'vertex' ? onClosePerimeter
      : activeTool === 'area' ? onCloseCustomShape
        : activeTool === 'void' ? onCloseVoid : null;

  const toolActive = activeTool !== 'select';

  return (
    <>
      <MobileTopBar
        image={image}
        subject={projectName}
        planCount={documentOrder.length}
        onPlans={() => setSheet('plans')}
        isProcessing={isProcessing}
        ready={areas.total > 0 && !areaWarn}
        onMenu={() => setSheet('menu')}
        onExport={onExport}
      />

      {/* The plan gets everything between the two bars, and `canvas-touch`
          is what stops the browser from treating a pan as a page scroll or a
          pinch as a page zoom before Konva ever sees the gesture. */}
      <div className="relative flex-1 min-h-0 canvas-grid-bg canvas-touch">
        {children}
        <MobileCanvasOverlay hasImage={!!image} onFitToWindow={onFitToWindow} />
      </div>

      {toolActive ? (
        <MobileToolContext
          active={activeTool}
          count={toolCount}
          brushSize={brushSize}
          onBrushSizeChange={onBrushSizeChange}
          onCancel={onCancelTool}
          onDone={toolDone}
        />
      ) : (
        <MobileActionBar
          primary={primaryAction}
          isProcessing={isProcessing}
          onTools={() => setSheet('tools')}
          toolsActive={sheet === 'tools'}
          onPanel={() => setSheet('panel')}
          panelOpen={sheet === 'panel'}
          areaText={areas.total > 0 ? areaText : '—'}
          areaSuffix={areas.total > 0 ? areaSuffix : 'no area'}
          areaWarn={areaWarn}
        />
      )}

      <MobilePlansSheet
        open={sheet === 'plans'}
        onClose={closeSheet}
        onSelect={onSelectPlan}
        onClosePlan={onClosePlan}
        onNew={onNewPlan}
      />

      <MobileMenuSheet
        open={sheet === 'menu'}
        onClose={closeSheet}
        image={image}
        hasArea={areas.total > 0}
        onFileOpen={onMenuFileOpen}
        onTakePhoto={onTakePhoto}
        onExport={onExport}
        onCopyExhibit={onCopyExhibit}
        onSaveProject={onSaveProject}
        onCloseActivePlan={onCloseActivePlan}
        onFindRoomSize={onFindRoomSize}
        onTracePerimeter={onTracePerimeter}
        onDrawExterior={onDrawExterior}
        onOutlineByVertex={onOutlineByVertex}
        onAddFloor={onAddFloor}
        canAddOutline={canAddOutline}
        onFitToWindow={onFitToWindow}
        showSideLengths={showSideLengths}
        onShowSideLengthsChange={onShowSideLengthsChange}
        autoSnapEnabled={autoSnapEnabled}
        onAutoSnapChange={onAutoSnapChange}
        onUnitChange={onUnitChange}
        saveOnExit={saveOnExit}
        onSaveOnExitChange={onSaveOnExitChange}
        enhancedOcr={enhancedOcr}
        onEnhancedOcrChange={onEnhancedOcrChange}
        theme={theme}
        onCycleTheme={onCycleTheme}
        onHelpOpen={onHelpOpen}
      />

      <MobileToolSheet
        open={sheet === 'tools'}
        onClose={closeSheet}
        activeTool={activeTool}
        hasArea={areas.total > 0}
        hasToolData={hasToolData}
        onSelect={onToolSelect}
        onRotate={onRotate}
        onClearTools={onClearTools}
      />

      <BottomSheet
        open={sheet === 'panel'}
        onClose={closeSheet}
        title="Measurement"
        subtitle={calibrated ? 'Area, scale and every outline' : 'No scale set yet'}
      >
        <MeasurementDock
          mobile
          roomDimensions={roomDimensions}
          onDimensionsChange={onDimensionsChange}
          area={areas.total}
          unit={unit}
          onUnitChange={onUnitChange}
          isProcessing={isProcessing}
          ocrFailed={ocrFailed}
          useInteriorWalls={useInteriorWalls}
          onInteriorWallToggle={onInteriorWallToggle}
          canSwitchWallFace={canSwitchWallFace}
          onDimensionFocus={onDimensionFocus}
          onDimensionBlur={onDimensionBlur}
          onScaleTool={() => { closeSheet(); onScaleTool(); }}
          onSelectRoom={() => { closeSheet(); onSelectRoom?.(); }}
          onRestoreAutoScale={onRestoreAutoScale}
          onExport={() => { closeSheet(); onExport(); }}
        />
      </BottomSheet>
    </>
  );
};

export default MobileChrome;
