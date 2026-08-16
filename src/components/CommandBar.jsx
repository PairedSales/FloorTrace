import {
  FolderOpen,
  Share,
  ScanSearch,
  Maximize,
  ScanText,
  Layers,
  Undo2,
  Redo2,
  PanelLeft,
  Check,
  Brush,
} from 'lucide-react';
import useUndoHistory from '../hooks/useUndoHistory';
import * as undoManager from '../store/undoManager';

/**
 * The stage verbs, plus history and view. Everything here also has a home in
 * the menu bar — this row is the shortcut, not the only route, which is what
 * lets it stay short enough to read.
 *
 * Commands disable rather than disappear: the old toolbar hid Add Floor,
 * Draw Exterior and Find Room Size behind state, so buttons moved under the
 * cursor between one trace and the next.
 */
const CommandBar = ({
  image,
  isProcessing,
  onFileOpen,
  onExport,
  hasArea,
  onTracePerimeter,
  onFitToWindow,
  onDrawExterior,
  drawModeActive,
  onFinishDrawMode,
  perimeterOverlay,
  onFindRoomSize,
  onAddFloor,
  floorCount,
  dockOpen,
  onDockToggle,
}) => {
  const { canUndo, canRedo } = useUndoHistory();
  const hasOutline = !!perimeterOverlay?.vertices?.length;

  return (
    <div className="flex items-center gap-1 h-10 px-2 bg-panel-2 border-b border-line select-none shrink-0 overflow-x-auto">
      <button
        onClick={onFileOpen}
        disabled={isProcessing}
        className="toolbar-btn"
        title="Open a plan or project (Ctrl+O)"
      >
        <FolderOpen className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>Open</span>
      </button>

      <div className="w-px h-5 bg-line mx-1.5 shrink-0" />

      <button
        onClick={undoManager.undo}
        disabled={!canUndo}
        className="toolbar-btn px-2"
        title="Undo (Ctrl+Z)"
        aria-label="Undo"
      >
        <Undo2 className="w-4 h-4" aria-hidden="true" />
      </button>
      <button
        onClick={undoManager.redo}
        disabled={!canRedo}
        className="toolbar-btn px-2"
        title="Redo (Ctrl+Shift+Z)"
        aria-label="Redo"
      >
        <Redo2 className="w-4 h-4" aria-hidden="true" />
      </button>

      <div className="w-px h-5 bg-line mx-1.5 shrink-0" />

      <button
        onClick={onFindRoomSize}
        disabled={!image || isProcessing}
        className="toolbar-btn"
        title="Read the printed dimension labels on this plan"
      >
        <ScanText className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>Read dimensions</span>
      </button>

      {/* Draw mode doubles as its own commit: while painting, the same slot
          becomes the way to finish, so the gesture that started the outline
          is where the user looks to end it. */}
      {drawModeActive ? (
        <button
          onClick={onFinishDrawMode}
          className="toolbar-btn toolbar-btn-primary"
          title="Trace the exterior from your outline (Enter)"
        >
          <Check className="w-[15px] h-[15px]" aria-hidden="true" />
          <span>Trace my outline</span>
        </button>
      ) : (
        <button
          onClick={onTracePerimeter}
          disabled={!image || isProcessing}
          className="toolbar-btn toolbar-btn-primary"
          title="Find the exterior outline automatically"
        >
          <ScanSearch className="w-[15px] h-[15px]" aria-hidden="true" />
          <span>Find outline</span>
        </button>
      )}

      <button
        onClick={onDrawExterior}
        disabled={!image || isProcessing || drawModeActive}
        className="toolbar-btn"
        title="Paint roughly over the exterior walls and let FloorTrace read them (7)"
      >
        <Brush className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>Paint outline</span>
      </button>

      <button
        onClick={onAddFloor}
        disabled={!hasOutline || floorCount >= 7}
        className="toolbar-btn"
        title={floorCount >= 7 ? 'Seven outlines is the maximum' : 'Add another level'}
      >
        <Layers className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>Add level</span>
      </button>

      <div className="w-px h-5 bg-line mx-1.5 shrink-0" />

      {/* The last step of the job, and the only one most sessions ever need to
          reach twice. It stays put and stays enabled from the moment a plan is
          open — it earns emphasis once there is an area to export, rather than
          appearing at that moment and moving everything beside it. */}
      <button
        onClick={onExport}
        disabled={!image || isProcessing}
        className={`toolbar-btn ${hasArea ? 'toolbar-btn-ready' : ''}`}
        title="Export an image of the plan and its measurements (Ctrl+E)"
      >
        <Share className="w-[15px] h-[15px]" aria-hidden="true" />
        <span>Export</span>
      </button>

      <div className="flex-1 min-w-[12px]" />

      <button
        onClick={onFitToWindow}
        disabled={!image}
        className="toolbar-btn px-2"
        title="Fit the plan to the window (F)"
        aria-label="Fit the plan to the window"
      >
        <Maximize className="w-4 h-4" aria-hidden="true" />
      </button>

      <button
        onClick={onDockToggle}
        className={`toolbar-btn px-2 ${dockOpen ? 'toolbar-btn-active' : ''}`}
        title="Show or hide the measurement panel"
        aria-label="Show or hide the measurement panel"
        aria-pressed={dockOpen}
      >
        <PanelLeft className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

export default CommandBar;
