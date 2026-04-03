import { Ruler, Pentagon } from 'lucide-react';

const ToolsPanel = ({
  lineToolActive,
  onLineToolToggle,
  drawAreaActive,
  onDrawAreaToggle,
}) => {
  return (
    <div className="relative z-10 flex shrink-0 flex-col self-start animate-slide-in-left border-r border-chrome-700 bg-chrome-800 pointer-events-none">
      <section className="px-3 py-3 pointer-events-auto">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-1.5">
          Tools
        </h3>
        <div className="flex gap-1.5">
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
            Measure
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
            Draw
          </button>
        </div>
      </section>
    </div>
  );
};

export default ToolsPanel;
