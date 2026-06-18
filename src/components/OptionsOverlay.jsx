import Toggle from './Toggle';

const OptionsOverlay = ({
  showSideLengths,
  onShowSideLengthsChange,
  autoSnapEnabled,
  onAutoSnapChange,
  perimeterOverlay,
  saveOnExit,
  onSaveOnExitChange,
  debugDetection,
  onDebugDetectionChange,
}) => {
  return (
    <div className="absolute top-2 right-2 z-50 w-56 rounded-lg bg-chrome-800 border border-chrome-700 p-3 shadow-2xl flex flex-col gap-3 pointer-events-auto select-none">
      {perimeterOverlay && (
        <>
          <div className="flex flex-col gap-2.5">
            <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-0.5">
              Options
            </h3>
            <Toggle
              label="Show Lengths"
              checked={showSideLengths}
              onChange={onShowSideLengthsChange}
            />
            <Toggle
              label="Auto Snap"
              checked={autoSnapEnabled}
              onChange={onAutoSnapChange}
            />
          </div>
          <div className="border-t border-chrome-700/60 my-0.5" />
        </>
      )}

      <div className="flex flex-col gap-2.5">
        <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-0.5">
          Settings
        </h3>
        <Toggle
          label="Save on Exit"
          checked={saveOnExit}
          onChange={onSaveOnExitChange}
        />
        <Toggle
          label="Enable Wall Detection Debugging"
          checked={debugDetection}
          onChange={onDebugDetectionChange}
        />
      </div>
    </div>
  );
};

export default OptionsOverlay;
