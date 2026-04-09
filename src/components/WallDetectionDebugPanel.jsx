import React from 'react';

/**
 * Layer definitions with labels and default colors.
 */
const LAYERS = [
  { id: 'ocrRegions',       label: 'OCR Masked Regions',   color: '#FF5555' },
  { id: 'wallCandidates',   label: 'Wall Candidates',      color: '#8BE9FD' },
  { id: 'mergedSegments',   label: 'Merged Segments',      color: '#50FA7B' },
  { id: 'junctions',        label: 'Junctions',            color: '#FFB86C' },
  { id: 'graphNodes',       label: 'Graph Nodes',          color: '#BD93F9' },
  { id: 'roomRegions',      label: 'All Room Regions',     color: '#6272A4' },
  { id: 'roomPolygon',      label: 'Matched Room',         color: '#50FA7B' },
  { id: 'exteriorPerimeter', label: 'Exterior Perimeter',  color: '#BD93F9' },
  { id: 'scores',           label: 'Scores',               color: '#F8F8F2' },
];

/**
 * Floating panel that controls which debug layers are visible.
 *
 * Props:
 *   enabledLayers  — Set<string> of currently visible layer ids
 *   onToggleLayer  — (layerId: string) => void
 *   onClose        — () => void (exit debug mode)
 *   isRunning      — boolean (pipeline is executing)
 */
const WallDetectionDebugPanel = ({ enabledLayers, onToggleLayer, onClose, isRunning }) => {
  return (
    <div className="absolute top-2 right-2 z-50 w-56 bg-chrome-800/95 border border-chrome-600 rounded-lg shadow-xl backdrop-blur-sm pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-chrome-700">
        <span className="text-[11px] font-semibold text-accent uppercase tracking-wider">
          Wall Detection Debug
        </span>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-white text-xs font-bold leading-none"
          title="Close debug mode"
        >
          ✕
        </button>
      </div>

      {/* Status */}
      {isRunning && (
        <div className="px-3 py-1.5 text-[10px] text-amber-400 bg-amber-500/10 border-b border-chrome-700">
          ⏳ Processing…
        </div>
      )}

      {/* Layer toggles */}
      <div className="px-3 py-2 flex flex-col gap-1.5 max-h-[320px] overflow-y-auto">
        {LAYERS.map(({ id, label, color }) => (
          <label
            key={id}
            className="flex items-center gap-2 cursor-pointer group"
          >
            <input
              type="checkbox"
              checked={enabledLayers.has(id)}
              onChange={() => onToggleLayer(id)}
              className="accent-accent w-3.5 h-3.5 rounded"
            />
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: color }}
            />
            <span className="text-[11px] text-slate-300 group-hover:text-white select-none">
              {label}
            </span>
          </label>
        ))}
      </div>

      {/* Toggle all */}
      <div className="px-3 py-1.5 border-t border-chrome-700 flex gap-2">
        <button
          onClick={() => LAYERS.forEach(l => { if (!enabledLayers.has(l.id)) onToggleLayer(l.id); })}
          className="text-[10px] text-accent hover:underline"
        >
          Show all
        </button>
        <button
          onClick={() => LAYERS.forEach(l => { if (enabledLayers.has(l.id)) onToggleLayer(l.id); })}
          className="text-[10px] text-slate-400 hover:underline"
        >
          Hide all
        </button>
      </div>
    </div>
  );
};

export { LAYERS };
export default WallDetectionDebugPanel;
