import React, { useState, useEffect } from 'react';
import { Eye, EyeOff, AlertTriangle, CheckCircle, Info } from 'lucide-react';

const DebugPipelinePanel = ({ debugData }) => {
  const [selectedStage, setSelectedStage] = useState('thresholded');
  const [isCollapsed, setIsCollapsed] = useState(false);

  useEffect(() => {
    if (debugData) {
      if (debugData.roomMask || debugData.floodFilled) {
        setSelectedStage('floodFilled');
      } else if (debugData.footprintMask || debugData.footprint) {
        setSelectedStage('footprint');
      }
    }
  }, [debugData]);

  if (!debugData) return null;

  const stages = [
    { id: 'thresholded', name: '1. Thresholded Walls', data: debugData.thresholded, desc: 'Binarized wall pixels based on global darkness threshold.' },
    { id: 'filtered', name: '2. Filtered Walls', data: debugData.filtered, desc: 'Text, dimensions, and noise components removed.' },
    { id: 'closed', name: '3. Closed Walls', data: debugData.closed, desc: 'Morphologically closed to seal doors and window gaps.' },
    { id: 'footprint', name: '4. Exterior Footprint', data: debugData.footprint, desc: 'Enclosed building boundary footprint (not reachable from borders).' },
    { id: 'floodFilled', name: '5. Flood-Filled Room', data: debugData.floodFilled, desc: 'Enclosed room chamber flooded from the click/seed point.' },
  ].filter(stage => stage.data);

  const currentStage = stages.find(s => s.id === selectedStage) || stages[0];

  return (
    <div className="fixed bottom-4 left-4 z-[100] w-80 rounded-xl border border-chrome-700/80 bg-chrome-900/95 p-4 shadow-2xl backdrop-blur-md text-slate-200 pointer-events-auto select-none transition-all duration-250 ease-out">
      <div className="flex items-center justify-between border-b border-chrome-700/60 pb-2.5 mb-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
          <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
            Pipeline Debug Visualizer
          </h3>
        </div>
        <button
          onClick={() => setIsCollapsed(!isCollapsed)}
          className="rounded p-1 hover:bg-chrome-700/50 text-slate-400 hover:text-slate-200 transition-colors"
          title={isCollapsed ? 'Show Preview' : 'Hide Preview'}
        >
          {isCollapsed ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
        </button>
      </div>

      {!isCollapsed && (
        <div className="flex flex-col gap-3">
          {/* Metadata Grid */}
          <div className="grid grid-cols-2 gap-2 rounded-lg bg-chrome-950/40 p-2.5 text-[11px] border border-chrome-800/40">
            <div>
              <span className="text-slate-500">Scale:</span>{' '}
              <span className="font-mono text-slate-300">
                {debugData.normalizedSize ? `${debugData.normalizedSize.width}x${debugData.normalizedSize.height}` : 'N/A'}
              </span>
            </div>
            <div>
              <span className="text-slate-500">Thickness:</span>{' '}
              <span className="font-mono text-slate-300">
                {debugData.wallThickness != null ? `${debugData.wallThickness}px` : 'N/A'}
              </span>
            </div>
            <div className="col-span-2">
              <span className="text-slate-500">Grid Angles:</span>{' '}
              <span className="font-mono text-slate-300">
                {debugData.dominantAngles ? debugData.dominantAngles.join('°, ') + '°' : 'N/A'}
              </span>
            </div>
            {debugData.leakDetected !== undefined && (
              <div className="col-span-2 flex items-center gap-1.5 mt-0.5">
                <span className="text-slate-500">Room Status:</span>
                {debugData.leakDetected ? (
                  <span className="flex items-center gap-1 font-semibold text-rose-400">
                    <AlertTriangle className="h-3 w-3" /> Leak Corrected / Adaptive Close
                  </span>
                ) : (
                  <span className="flex items-center gap-1 font-semibold text-emerald-400">
                    <CheckCircle className="h-3 w-3" /> Enclosed & Sealed
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Stage Dropdown */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              Pipeline Stage
            </label>
            <select
              value={selectedStage}
              onChange={(e) => setSelectedStage(e.target.value)}
              className="w-full rounded-lg border border-chrome-700 bg-chrome-950 p-2 text-xs text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-all cursor-pointer"
            >
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </select>
          </div>

          {/* Stage Description */}
          {currentStage && (
            <div className="flex gap-2 rounded-lg bg-cyan-950/20 border border-cyan-800/20 p-2.5 text-[11px] text-cyan-300/90 leading-normal">
              <Info className="h-3.5 w-3.5 text-cyan-400 shrink-0 mt-0.5" />
              <span>{currentStage.desc}</span>
            </div>
          )}

          {/* Image Canvas Preview */}
          {currentStage?.data ? (
            <div className="relative aspect-video w-full rounded-lg border border-chrome-700/60 bg-chrome-950 overflow-hidden flex items-center justify-center shadow-inner group">
              <img
                src={currentStage.data}
                alt={currentStage.name}
                className="max-h-full max-w-full object-contain transition-transform duration-300 group-hover:scale-105"
              />
              <div className="absolute bottom-1 right-1.5 rounded bg-chrome-900/80 px-1.5 py-0.5 text-[9px] font-mono text-slate-400">
                Preview Stage {selectedStage}
              </div>
            </div>
          ) : (
            <div className="h-28 w-full rounded-lg border border-chrome-800 border-dashed bg-chrome-950 flex items-center justify-center text-xs text-slate-500">
              No preview data for this stage
            </div>
          )}
        </div>
      )}

      {isCollapsed && (
        <div className="text-[11px] text-slate-400 mt-1 flex items-center justify-between">
          <span>Active stage: {currentStage?.name || 'None'}</span>
          {debugData.leakDetected && (
            <span className="text-rose-400 font-semibold flex items-center gap-0.5">
              <AlertTriangle className="h-3 w-3" /> Leak
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default DebugPipelinePanel;
