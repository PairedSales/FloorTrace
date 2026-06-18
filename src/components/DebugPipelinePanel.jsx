import React, { useState, useEffect, useRef } from 'react';
import { EyeOff, ChevronLeft, ChevronRight, Terminal, Box, Compass, Activity, AlertCircle } from 'lucide-react';
import useAppStore from '../store/appStore';

const DebugPipelinePanel = ({ debugData }) => {
  const [isCollapsed, setIsCollapsed] = useState(false); // Expanded by default
  const [panelWidth, setPanelWidth] = useState(340);
  const isResizingRef = useRef(false);

  const activeStageIndex = useAppStore((s) => s.detectionDebugData?.activeStageIndex ?? 0);
  const selectedGeometryId = useAppStore((s) => s.detectionDebugData?.selectedGeometryId);
  const setActiveStageIndex = useAppStore((s) => s.setActiveStageIndex);
  const setSelectedGeometryId = useAppStore((s) => s.setSelectedGeometryId);

  // Keyboard shortcut listener
  useEffect(() => {
    if (isCollapsed || !debugData?.stages) return;
    
    const handleKeyDown = (e) => {
      if (e.key === 'ArrowRight') {
        const nextIdx = Math.min(debugData.stages.length - 1, activeStageIndex + 1);
        setActiveStageIndex(nextIdx);
      } else if (e.key === 'ArrowLeft') {
        const prevIdx = Math.max(0, activeStageIndex - 1);
        setActiveStageIndex(prevIdx);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isCollapsed, debugData, activeStageIndex, setActiveStageIndex]);

  if (!debugData || !debugData.stages || debugData.stages.length === 0) return null;

  const stages = debugData.stages;
  const currentStage = stages[activeStageIndex] || stages[0];
  const geometry = currentStage.geometry || { polygons: [], lines: [], points: [] };
  const metadata = currentStage.metadata || {};

  // Resize handler
  const handleMouseDown = (e) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleMouseMove = (e) => {
    if (!isResizingRef.current) return;
    const computedWidth = window.innerWidth - e.clientX;
    if (computedWidth >= 280 && computedWidth <= 600) {
      setPanelWidth(computedWidth);
    }
  };

  const handleMouseUp = () => {
    isResizingRef.current = false;
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleMouseUp);
  };

  // Find selected geometry details
  let selectedElement = null;
  if (selectedGeometryId) {
    selectedElement = 
      geometry.polygons?.find((p) => p.id === selectedGeometryId) ||
      geometry.lines?.find((l) => l.id === selectedGeometryId) ||
      geometry.points?.find((pt) => pt.id === selectedGeometryId);
  }

  // Next / Prev navigators
  const handlePrevStage = () => {
    const prevIdx = Math.max(0, activeStageIndex - 1);
    setActiveStageIndex(prevIdx);
  };

  const handleNextStage = () => {
    const nextIdx = Math.min(stages.length - 1, activeStageIndex + 1);
    setActiveStageIndex(nextIdx);
  };

  return (
    <>
      {/* Collapse/Expand toggle handle sticking out when collapsed */}
      {isCollapsed && (
        <button
          onClick={() => setIsCollapsed(false)}
          className="fixed right-0 top-16 z-50 flex items-center gap-1.5 rounded-l-lg border-y border-l border-chrome-700 bg-chrome-800 px-3 py-2 text-xs font-semibold text-slate-200 shadow-2xl hover:bg-chrome-750 transition-colors pointer-events-auto select-none"
        >
          <Activity className="h-4 w-4 text-cyan-400 animate-pulse" />
          <span>Show Wall Debugger</span>
        </button>
      )}

      {!isCollapsed && (
        <div
          style={{ width: `${panelWidth}px` }}
          className="fixed top-12 bottom-0 right-0 z-40 flex bg-chrome-900 border-l border-chrome-700 text-slate-200 shadow-2xl transition-all duration-100 ease-out select-none pointer-events-auto"
        >
          {/* Resize Handle Drag Bar */}
          <div
            onMouseDown={handleMouseDown}
            className="absolute left-0 top-0 bottom-0 w-1.5 cursor-col-resize bg-transparent hover:bg-cyan-500/40 transition-colors z-50"
            title="Drag to resize panel"
          />

          <div className="flex flex-col flex-1 min-w-0 h-full">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-chrome-700/80 px-4 py-3 bg-chrome-950/40">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-cyan-400" />
                <h3 className="text-xs font-bold text-slate-100 uppercase tracking-wider">
                  Pipeline Debugger
                </h3>
              </div>
              <button
                onClick={() => setIsCollapsed(true)}
                className="rounded p-1 hover:bg-chrome-800/80 text-slate-400 hover:text-slate-200 transition-colors"
                title="Hide Panel"
              >
                <EyeOff className="h-4 w-4" />
              </button>
            </div>

            {/* Content Container (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">
              {/* Stage Navigation Controller */}
              <div className="flex flex-col gap-2 bg-chrome-950/20 border border-chrome-800/50 rounded-xl p-3">
                <div className="flex items-center justify-between gap-1.5">
                  <button
                    onClick={handlePrevStage}
                    disabled={activeStageIndex === 0}
                    className="p-1.5 rounded-lg border border-chrome-700 bg-chrome-800/60 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:text-slate-300 hover:bg-chrome-700/50 transition-colors"
                    title="Previous Stage (Left Arrow)"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  
                  <span className="text-xs font-semibold text-slate-300">
                    Stage {activeStageIndex + 1} of {stages.length}
                  </span>

                  <button
                    onClick={handleNextStage}
                    disabled={activeStageIndex === stages.length - 1}
                    className="p-1.5 rounded-lg border border-chrome-700 bg-chrome-800/60 text-slate-300 hover:text-white disabled:opacity-30 disabled:hover:text-slate-300 hover:bg-chrome-700/50 transition-colors"
                    title="Next Stage (Right Arrow)"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex flex-col gap-1.5 mt-1">
                  <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">
                    Select Stage
                  </label>
                  <select
                    value={activeStageIndex}
                    onChange={(e) => setActiveStageIndex(parseInt(e.target.value))}
                    className="w-full rounded-lg border border-chrome-700 bg-chrome-950 p-2 text-xs text-slate-200 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/20 transition-all cursor-pointer"
                  >
                    {stages.map((st, i) => (
                      <option key={st.id} value={i}>
                        {st.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Stage Metadata diagnostics */}
              <div className="flex flex-col gap-2">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Stage Details & Parameters
                </h4>
                <div className="grid grid-cols-1 gap-1.5 rounded-xl border border-chrome-800 bg-chrome-950/30 p-3 text-xs leading-normal">
                  {Object.entries(metadata).map(([key, val]) => (
                    <div key={key} className="flex justify-between border-b border-chrome-800/40 pb-1 last:border-0 last:pb-0">
                      <span className="text-slate-400 font-medium">{key}:</span>
                      <span className="font-mono text-slate-200 font-semibold">{String(val)}</span>
                    </div>
                  ))}
                  {Object.keys(metadata).length === 0 && (
                    <span className="text-slate-500 italic">No diagnostics registered for this stage.</span>
                  )}
                </div>
              </div>

              {/* Warnings/Anomalies */}
              {metadata['Leak Detected'] === 'Yes' && (
                <div className="flex gap-2 rounded-xl bg-rose-950/20 border border-rose-800/30 p-3 text-xs text-rose-300/90">
                  <AlertCircle className="h-4 w-4 text-rose-400 shrink-0 mt-0.5" />
                  <div>
                    <span className="font-semibold block mb-0.5">Leakage Corrected</span>
                    An open boundary was encountered. The pipeline automatically widened the morphological radius to enclose the room.
                  </div>
                </div>
              )}

              {/* Data Inspector tree */}
              <div className="flex flex-col gap-2 flex-1 min-h-[200px]">
                <h4 className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                  Geometry Inspector
                </h4>
                <div className="flex-1 overflow-y-auto rounded-xl border border-chrome-800 bg-chrome-950/40 p-2 text-xs">
                  {/* Polygons list */}
                  {geometry.polygons?.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] font-bold text-cyan-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                        <Box className="h-3 w-3" /> Polygons ({geometry.polygons.length})
                      </div>
                      <div className="flex flex-col">
                        {geometry.polygons.map((poly) => (
                          <button
                            key={poly.id}
                            onClick={() => setSelectedGeometryId(poly.id === selectedGeometryId ? null : poly.id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-between ${poly.id === selectedGeometryId ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'hover:bg-chrome-800/40 text-slate-300'}`}
                          >
                            <span className="truncate text-slate-300 font-medium">{poly.label || poly.id}</span>
                            <span className="font-mono text-[10px] text-slate-400">{poly.points.length} pts</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Lines list */}
                  {geometry.lines?.length > 0 && (
                    <div className="mb-3">
                      <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                        <Compass className="h-3 w-3" /> Lines / Segments ({geometry.lines.length})
                      </div>
                      <div className="flex flex-col">
                        {geometry.lines.map((line) => (
                          <button
                            key={line.id}
                            onClick={() => setSelectedGeometryId(line.id === selectedGeometryId ? null : line.id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-between ${line.id === selectedGeometryId ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'hover:bg-chrome-800/40 text-slate-300'}`}
                          >
                            <span className="truncate text-slate-300 font-medium">{line.label || line.id}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Points list */}
                  {geometry.points?.length > 0 && (
                    <div>
                      <div className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider px-2 mb-1 flex items-center gap-1">
                        <Terminal className="h-3 w-3 text-emerald-400" /> Vertices / Points ({geometry.points.length})
                      </div>
                      <div className="flex flex-col">
                        {geometry.points.map((pt) => (
                          <button
                            key={pt.id}
                            onClick={() => setSelectedGeometryId(pt.id === selectedGeometryId ? null : pt.id)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-lg transition-colors flex items-center justify-between ${pt.id === selectedGeometryId ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'hover:bg-chrome-800/40 text-slate-300'}`}
                          >
                            <span className="truncate text-slate-300 font-medium">{pt.label || pt.id}</span>
                            <span className="font-mono text-[10px] text-slate-400">({Math.round(pt.x)}, {Math.round(pt.y)})</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(!geometry.polygons || geometry.polygons.length === 0) && 
                   (!geometry.lines || geometry.lines.length === 0) && 
                   (!geometry.points || geometry.points.length === 0) && (
                    <div className="text-slate-500 italic p-3 text-center">
                      No vector geometry generated in this stage.
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Element Detailed Inspection */}
              {selectedElement && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-xs flex flex-col gap-2 mt-auto">
                  <div className="flex items-center justify-between border-b border-amber-500/20 pb-1.5">
                    <span className="font-bold text-amber-400">Geometry Inspector</span>
                    <button
                      onClick={() => setSelectedGeometryId(null)}
                      className="text-[10px] text-amber-400/70 hover:text-amber-400 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="flex flex-col gap-1 font-sans">
                    <div className="flex justify-between">
                      <span className="text-slate-400 font-semibold">Element ID:</span>
                      <span className="font-mono text-amber-200">{selectedElement.id}</span>
                    </div>
                    {Object.entries(selectedElement.properties || {}).map(([propK, propV]) => (
                      <div key={propK} className="flex justify-between">
                        <span className="text-slate-400 font-semibold">{propK}:</span>
                        <span className="font-mono text-slate-200">{String(propV)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default DebugPipelinePanel;
