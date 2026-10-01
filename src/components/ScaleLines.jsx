import { useEffect, useRef, useState } from 'react';
import { Trash2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { formatDimensionInput, metersToFeet } from '../utils/unitConverter';
import { useScaleLine } from '../hooks/useScaleLine';
import InchesInput from './InchesInput';

// Decimal feet from whatever unit the plan is being shown in. Storage is
// always decimal feet, matching `roomDimensions`; the unit is a display concern
// and is resolved here, at the input.
const toFeet = (raw, unit) => {
  const num = parseFloat(raw);
  if (!(num > 0)) return null;
  return unit === 'metric' ? metersToFeet(Math.round(num * 100) / 100) : Math.round(num * 100) / 100;
};

const ScaleLineRow = ({ line, number, unit, onCommit, onRemove }) => {
  const [draft, setDraft] = useState('');
  const inputRef = useRef(null);

  // A line just drawn is waiting for its length, and the user's hands are on
  // the mouse over the plan: the box takes the focus so the next thing they
  // do — type the number — lands in it rather than nowhere.
  useEffect(() => {
    if (!(line.feet > 0)) inputRef.current?.focus();
    // Once, when the row arrives. Re-focusing on every change of `feet` would
    // pull the cursor back while a second line is being typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (value) => {
    const feet = toFeet(value, unit);
    if (feet) onCommit(line.id, feet);
    setDraft('');
  };

  const shown = line.feet > 0
    ? `${formatDimensionInput(line.feet, unit)}${unit === 'metric' ? ' m' : unit === 'decimal' ? ' ft' : ''}`
    : '';

  return (
    <div className="flex items-center gap-2.5">
      <span className="label-sm w-12 shrink-0">Line {number}</span>
      {unit === 'inches' ? (
        <InchesInput
          ref={inputRef}
          value={line.feet ? String(line.feet) : ''}
          onChange={(v) => setDraft(v)}
          onBlur={() => draft && commit(draft)}
        />
      ) : (
        <input
          ref={inputRef}
          type="text"
          value={draft || shown}
          onChange={(e) => /^[\d.]*$/.test(e.target.value) && setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { commit(draft); e.currentTarget.blur(); } }}
          onBlur={() => draft && commit(draft)}
          className="field-input flex-1 min-w-0"
          placeholder={unit === 'metric' ? 'Its length in m' : 'Its length in ft'}
          aria-label={`Length of line ${number}`}
        />
      )}
      <button
        type="button"
        onClick={() => onRemove(line.id)}
        className="icon-btn w-8 h-8 hover:bg-crit/12 hover:text-crit"
        title="Remove this line"
        aria-label={`Remove line ${number}`}
      >
        <Trash2 className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

/**
 * The lengths the user drew to set the scale by hand, at the head of the Scale
 * section. Only while the scale tool is on or there are lines to show: a scale
 * taken from the plan's own room sizes has nothing to list here.
 *
 * At the head, because typing the length is the second half of the tool: it
 * used to sit at the foot of the section, under two fields for a different
 * way of setting the scale, where a length could be typed into the wrong box.
 */
const ScaleLines = ({ unit }) => {
  const scaleLines = useAppStore((s) => s.scaleLines) || [];
  const scaleToolActive = useAppStore((s) => s.scaleToolActive);
  const calibration = useAppStore((s) => s.calibration);
  const { setLength, removeLine, clearAll } = useScaleLine();

  if (!scaleToolActive && !scaleLines.length && calibration?.source !== 'line-calibration') {
    return null;
  }

  return (
    <div className="mt-3.5">
      <div className="flex items-center justify-between gap-2 mb-2">
        <p className="text-[14px] font-semibold text-fg">Lengths you know</p>
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
        <p className="note">
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
    </div>
  );
};

export default ScaleLines;
