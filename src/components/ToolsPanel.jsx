import { Ruler, Pentagon, Eraser, Crop, RotateCw, Compass } from 'lucide-react';

const ToolsPanel = ({
  lineToolActive,
  onLineToolToggle,
  drawAreaActive,
  onDrawAreaToggle,
  eraserToolActive,
  onEraserToolToggle,
  cropToolActive,
  onCropToolToggle,
  angleToolActive,
  onAngleToolToggle,
  onRotateCanvas,
  measurementLines,
  customShapes,
  currentMeasurementLine,
  currentCustomShape,
  onClearTools,
  hasArea,
}) => {
  const hasToolData =
    measurementLines?.length > 0 ||
    customShapes?.length > 0 ||
    currentMeasurementLine ||
    currentCustomShape;

  return (
    <div className="flex shrink-0 flex-col animate-slide-in-left border-r border-chrome-700 bg-chrome-800 pointer-events-none select-none">
      <section className="px-3 py-3 pointer-events-auto">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
            Tools
          </h3>
          {hasToolData && (
            <button
              onClick={onClearTools}
              className="text-[11px] font-semibold text-red-400 uppercase tracking-wider hover:text-red-300 cursor-pointer transition-colors duration-200"
              title="Clear all measurements and shapes"
            >
              CLEAR
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {hasArea && (
            <>
              <button
                onClick={onLineToolToggle}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
                  lineToolActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title="Measure Line"
              >
                <Ruler className="w-4 h-4" />
                Line
              </button>
              <button
                onClick={onDrawAreaToggle}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
                  drawAreaActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title="Draw Area"
              >
                <Pentagon className="w-4 h-4" />
                Area
              </button>
              <button
                onClick={onAngleToolToggle}
                className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
                  angleToolActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title="Measure Angle"
              >
                <Compass className="w-4 h-4" />
                Angle
              </button>
            </>
          )}
          <button
            onClick={onEraserToolToggle}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
              eraserToolActive
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
            }`}
            title="Eraser"
          >
            <Eraser className="w-4 h-4" />
            Eraser
          </button>
          <button
            onClick={onCropToolToggle}
            className={`flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer ${
              cropToolActive
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
            }`}
            title="Crop"
          >
            <Crop className="w-4 h-4" />
            Crop
          </button>

          <button
            onClick={() => onRotateCanvas?.('clockwise')}
            onContextMenu={(e) => {
              e.preventDefault();
              onRotateCanvas?.('counterclockwise');
            }}
            className="flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600"
            title="Rotate canvas 45° clockwise (right-click for counterclockwise)"
          >
            <RotateCw className="w-4 h-4" />
            Rotate
          </button>
        </div>
      </section>
    </div>
  );
};

export default ToolsPanel;
