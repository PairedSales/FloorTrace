const StatusBar = ({ area, unit, lineToolActive, drawAreaActive }) => {
  const activeTool = lineToolActive
    ? 'Measure Line'
    : drawAreaActive
    ? 'Draw Area'
    : null;

  const areaText =
    area > 0 ? `${Math.round(area).toLocaleString()} ft\u00B2` : '\u2014';

  return (
    <div className="flex items-center h-6 px-3 bg-chrome-800 border-t border-chrome-700 text-[11px] font-mono text-slate-500 select-none shrink-0 gap-4">
      <span>
        Area: <span className="text-slate-300">{areaText}</span>
      </span>

      {activeTool && (
        <>
          <span className="text-chrome-700">|</span>
          <span>
            Tool:{' '}
            <span className="text-accent">{activeTool}</span>
          </span>
        </>
      )}

      <div className="flex-1" />

      <span className="text-slate-600">
        {unit === 'inches' ? 'ft\u2032 in\u2033' : 'decimal ft'}
      </span>
    </div>
  );
};

export default StatusBar;
