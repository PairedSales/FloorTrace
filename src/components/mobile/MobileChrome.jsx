import { useCallback, useMemo, useState } from 'react';
import { Brush, FolderOpen, ScanSearch, ScanText, Share } from 'lucide-react';
import useAppStore, { selectActiveAreaByType } from '../../store/appStore';
import { areaDisplayValue, formatAreaValue } from '../../utils/unitConverter';
import { displayedBreakdownTotal } from '../../utils/areaCalculator';
import { qualitySummary, scaleQualitySummary } from '../../utils/boundaryQuality';
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
  onRestart,
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
  const mode = useAppStore((s) => s.mode);
  const unit = useAppStore((s) => s.unit);
  const ocrFailed = useAppStore((s) => s.ocrFailed);
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

  const hasOutline = (perimeterTraces || []).some((t) => t.vertices?.length >= 3);
  const noGla = areas.gla === 0 && areas.total > 0;
  // The same arithmetic the dock and the exhibit do, because the thumb bar and
  // the measurement sheet are on screen together: a total summed from the raw
  // areas here and from the printed rows there put two different square
  // footages a few pixels apart on one phone screen.
  const totalDisplay = displayedBreakdownTotal(areas.byType, unit);
  const { value: areaText, suffix: areaSuffix } = noGla
    ? formatAreaValue(totalDisplay, unit)
    : formatAreaValue(areaDisplayValue(areas.gla, unit), unit);

  // The same three questions the desktop's outline chips and scale chip answer,
  // reduced to the one bit the action bar has room for: is this number worth
  // trusting as it stands.
  const areaWarn = areas.total > 0 && (
    areas.doubleCounted?.length > 0
    || scaleQualitySummary(scaleQuality)?.level === 'check'
    || (perimeterTraces || []).some((t) => t.quality
      && qualitySummary(t.quality).level !== 'good')
  );

  // ── the one verb ─────────────────────────────────────────────────────────
  // Derived from the pipeline the app already models, so the bar always offers
  // the step the user is actually on rather than seven steps at equal weight.
  const primary = useMemo(() => {
    if (!image) {
      return { label: 'Open a plan', icon: FolderOpen, onPress: onMenuFileOpen };
    }
    if (!calibrated) {
      return { label: 'Read dimensions', icon: ScanText, onPress: onFindRoomSize };
    }
    if (!hasOutline) {
      return { label: 'Find outline', icon: ScanSearch, onPress: onTracePerimeter };
    }
    return { label: 'Export for workfile', icon: Share, onPress: onExport };
  }, [image, calibrated, hasOutline, onMenuFileOpen, onFindRoomSize, onTracePerimeter, onExport]);

  // A plan the detector could not read leaves the user with nothing to press;
  // the brush is the answer and it should be the offer, not a menu item.
  const primaryAction = (image && calibrated && !hasOutline && ocrFailed)
    ? { label: 'Paint the outline', icon: Brush, onPress: onDrawExterior }
    : primary;

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
        hasArea={areas.total > 0}
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
        onRestart={onRestart}
        onFindRoomSize={onFindRoomSize}
        onTracePerimeter={onTracePerimeter}
        onDrawExterior={onDrawExterior}
        onOutlineByVertex={onOutlineByVertex}
        onAddFloor={onAddFloor}
        onFitToWindow={onFitToWindow}
        showSideLengths={showSideLengths}
        onShowSideLengthsChange={onShowSideLengthsChange}
        autoSnapEnabled={autoSnapEnabled}
        onAutoSnapChange={onAutoSnapChange}
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
          mode={mode}
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
          onExport={() => { closeSheet(); onExport(); }}
        />
      </BottomSheet>
    </>
  );
};

export default MobileChrome;
