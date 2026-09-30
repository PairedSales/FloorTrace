import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { formatDimensionInput, metersToFeet } from '../utils/unitConverter';
import { useScaleLine } from '../hooks/useScaleLine';
import InchesInput from './InchesInput';

// Decimal feet from whatever the unit toggle is currently showing. Storage is
// always decimal feet, matching `roomDimensions`; the unit is a display concern
// and is resolved here, at the input.
const toFeet = (raw, unit) => {
  const num = parseFloat(raw);
  if (!(num > 0)) return null;
  return unit === 'metric' ? metersToFeet(Math.round(num * 100) / 100) : Math.round(num * 100) / 100;
};

const ScaleLineRow = ({ line, number, unit, onCommit, onRemove }) => {
  const [draft, setDraft] = useState('');

  const commit = (value) => {
    const feet = toFeet(value, unit);
    if (feet) onCommit(line.id, feet);
    setDraft('');
  };

  const shown = line.feet > 0
    ? `${formatDimensionInput(line.feet, unit)}${unit === 'metric' ? ' m' : unit === 'decimal' ? ' ft' : ''}`
    : '';

  return (
    <div className="flex items-center gap-2">
      <span className="text-[13px] text-fg-3 w-12 shrink-0">Line {number}</span>
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
          placeholder={unit === 'metric' ? 'Its length in m' : 'Its length in ft'}
          aria-label={`Length of line ${number}`}
        />
      )}
      <button
        type="button"
        onClick={() => onRemove(line.id)}
        className="grid place-items-center w-7 h-7 rounded text-fg-3 hover:text-crit hover:bg-crit/12
                   transition-colors shrink-0 cursor-pointer"
        title="Remove this line"
        aria-label={`Remove line ${number}`}
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

/**
 * The lengths the user drew to set the scale by hand, inside the Scale card.
 * Only while the scale tool is on or there are lines to show: a scale taken
 * from the plan's own room sizes has nothing to list here.
 */
const ScaleSection = ({ unit }) => {
  const scaleLines = useAppStore((s) => s.scaleLines) || [];
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const calibration = useAppStore((s) => s.calibration);
  const { setLength, removeLine, clearAll } = useScaleLine();

  if (!scaleToolActive && !scaleLines.length && calibration?.source !== 'line-calibration') {
    return null;
  }

  return (
    <section className="mt-3 pt-3 border-t border-line-soft">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[13px] font-semibold text-fg-2">Lengths you measured</p>
        {(scaleLines.length > 0 || calibration?.source === 'line-calibration') && (
          <button
            type="button"
            onClick={clearAll}
            className="text-[13px] font-medium text-crit hover:underline cursor-pointer"
            title="Remove these lines and the scale they set"
          >
            Remove all
          </button>
        )}
      </div>

      {scaleLines.length === 0 ? (
        <p className="text-[13px] leading-snug text-fg-3">
          On the plan, click both ends of something whose length you know — a wall with a
          printed length is ideal. Then type the length here.
        </p>
      ) : (
        <div className="space-y-2">
          {scaleLines.map((line, i) => (
            <ScaleLineRow
              key={line.id}
              line={line}
              number={i + 1}
              unit={unit}
              onCommit={setLength}
              onRemove={removeLine}
            />
          ))}
        </div>
      )}
    </section>
  );
};

export default ScaleSection;
