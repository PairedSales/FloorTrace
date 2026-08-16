import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { formatDimensionInput, metersToFeet } from '../utils/unitConverter';
import { useScaleLine } from '../hooks/useScaleLine';
import InchesInput from './InchesInput';

// Decimal feet from whatever the Room Size fields' unit toggle is currently
// showing. Storage is always decimal feet, matching `roomDimensions`; the unit
// is a display concern and is resolved here, at the input.
const toFeet = (raw, unit) => {
  const num = parseFloat(raw);
  if (!(num > 0)) return null;
  return unit === 'metric' ? metersToFeet(Math.round(num * 100) / 100) : Math.round(num * 100) / 100;
};

const lengthPx = (line) => Math.hypot(line.end.x - line.start.x, line.end.y - line.start.y);

const ScaleLineRow = ({ line, unit, onCommit, onRemove }) => {
  const [draft, setDraft] = useState('');
  const px = Math.round(lengthPx(line));

  const commit = (value) => {
    const feet = toFeet(value, unit);
    if (feet) onCommit(line.id, feet);
    setDraft('');
  };

  const shown = line.feet > 0
    ? `${formatDimensionInput(line.feet, unit)}${unit === 'metric' ? ' m' : unit === 'decimal' ? ' ft' : ''}`
    : '';

  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[9px] font-mono text-fg-3 w-12 shrink-0">{px} px</span>
      {unit === 'inches' ? (
        <InchesInput
          value={line.feet ? String(line.feet) : ''}
          onChange={(v) => setDraft(v)}
          onBlur={() => draft && commit(draft)}
        />
      ) : (
        <input
          type="text"
          value={draft || shown}
          onChange={(e) => /^[\d.]*$/.test(e.target.value) && setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(draft); e.currentTarget.blur(); } }}
          onBlur={() => draft && commit(draft)}
          className="panel-input select-text flex-1 min-w-0"
          placeholder={unit === 'metric' ? 'true length (m)' : 'true length (ft)'}
        />
      )}
      <button
        type="button"
        onClick={() => onRemove(line.id)}
        className="p-0.5 rounded text-fg-3 hover:text-crit hover:bg-panel transition-colors shrink-0"
        title="Remove this scale line"
      >
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

const ScaleSection = ({ unit }) => {
  const scaleLines = useAppStore((s) => s.scaleLines) || [];
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const calibration = useAppStore((s) => s.calibration);
  const { setLength, removeLine, clearAll } = useScaleLine();

  if (!scaleToolActive && !scaleLines.length && calibration?.source !== 'line-calibration') {
    return null;
  }

  const fpp = calibration?.feetPerPixel;
  const pxPerFoot = calibration?.calibrated && fpp?.x > 0 && fpp?.y > 0
    ? { x: 1 / fpp.x, y: 1 / fpp.y }
    : null;
  const anisotropic = pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6;

  return (
    <>
      <div className="panel-divider mx-3" />
      <section className="px-3 py-3 pointer-events-auto">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider">
            Scale
          </h3>
          {(scaleLines.length > 0 || calibration?.source === 'line-calibration') && (
            <button
              onClick={clearAll}
              className="text-[11px] font-semibold text-crit uppercase tracking-wider hover:text-crit cursor-pointer transition-colors duration-200"
              title="Remove the scale lines and the scale they set"
            >
              CLEAR
            </button>
          )}
        </div>

        {scaleLines.length === 0 ? (
          <p className="text-[11px] text-fg-3 italic py-1">
            Click both ends of a length you know on the canvas.
          </p>
        ) : (
          <div className="space-y-1.5">
            {scaleLines.map((line) => (
              <ScaleLineRow
                key={line.id}
                line={line}
                unit={unit}
                onCommit={setLength}
                onRemove={removeLine}
              />
            ))}
          </div>
        )}

        {pxPerFoot && (
          <p className="mt-2 text-[10px] font-mono text-fg-3 text-center">
            {anisotropic
              ? `${pxPerFoot.x.toFixed(2)} × ${pxPerFoot.y.toFixed(2)} px/ft`
              : `${pxPerFoot.x.toFixed(2)} px/ft`}
          </p>
        )}
      </section>
    </>
  );
};

export default ScaleSection;
