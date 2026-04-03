import {
  FolderOpen,
  Download,
  ScanSearch,
  Maximize,
  Trash2,
  SlidersHorizontal,
} from 'lucide-react';
import FloorTraceLogo from '../assets/logo.svg';

const Toolbar = ({
  image,
  isProcessing,
  measurementLines,
  customShapes,
  currentMeasurementLine,
  currentCustomShape,
  onFileOpen,
  onSaveImage,
  onTracePerimeter,
  onFitToWindow,
  onClearTools,
  onRestart,
  showPanelOptions,
  onOptionsToggle,
}) => {
  const hasToolData =
    measurementLines?.length > 0 ||
    customShapes?.length > 0 ||
    currentMeasurementLine ||
    currentCustomShape;

  return (
    <header className="flex items-center h-12 px-3 bg-chrome-800 border-b border-chrome-700 select-none shrink-0">
      {/* Logo */}
      <div
        className="flex items-center gap-2 mr-4 cursor-pointer hover:opacity-80 transition-opacity"
        onClick={onRestart}
        title="Restart FloorTrace"
      >
        <img src={FloorTraceLogo} alt="" className="w-6 h-6" />
        <span className="text-sm font-semibold text-slate-100 tracking-tight">
          FloorTrace
        </span>
      </div>

      <div className="w-px h-5 bg-chrome-700 mr-3" />

      {/* Primary actions */}
      <div className="flex items-center gap-1">
        <button
          onClick={onFileOpen}
          disabled={isProcessing}
          className="toolbar-btn"
          title="Open image (Ctrl+O)"
        >
          <FolderOpen className="w-3.5 h-3.5" />
          <span>Open</span>
        </button>

        <button
          onClick={onSaveImage}
          disabled={!image}
          className="toolbar-btn"
          title="Save screenshot"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Save</span>
        </button>
      </div>

      <div className="w-px h-5 bg-chrome-700 mx-2" />

      {/* Canvas tools */}
      <div className="flex items-center gap-1">
        <button
          onClick={onTracePerimeter}
          disabled={!image || isProcessing}
          className="toolbar-btn"
          title="Auto-detect perimeter"
        >
          <ScanSearch className="w-3.5 h-3.5" />
          <span>Find Perimeter</span>
        </button>

        <button
          onClick={onFitToWindow}
          disabled={!image}
          className="toolbar-btn"
          title="Fit image to viewport"
        >
          <Maximize className="w-3.5 h-3.5" />
          <span>Fit</span>
        </button>

        <button
          onClick={onOptionsToggle}
          className={`toolbar-btn ${showPanelOptions ? 'text-accent hover:text-accent hover:bg-accent/10' : ''}`}
          title="Toggle panel options"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>Options</span>
        </button>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Conditional clear */}
      {hasToolData && (
        <button
          onClick={onClearTools}
          className="toolbar-btn text-red-400 hover:text-red-300 hover:bg-red-500/10"
          title="Clear all measurements and shapes"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Clear</span>
        </button>
      )}
    </header>
  );
};

export default Toolbar;
