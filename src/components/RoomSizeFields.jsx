import { useState, useEffect } from 'react';
import { formatDimensionInput, metersToFeet } from '../utils/unitConverter';
import InchesInput from './InchesInput';

// "Length", not "Height": to anyone who measures houses, a room's height is
// its ceiling.
const FIELDS = [['width', 'Width'], ['height', 'Length']];

/**
 * The size of the room the scale is taken from, typed or corrected by hand.
 * The two fields and their edit bookkeeping are one piece: decimal and metric
 * are edited as text and committed on blur, feet-inches through its own field.
 */
const RoomSizeFields = ({ roomDimensions, unit, onDimensionsChange, onDimensionFocus, onDimensionBlur }) => {
  const [localDimensions, setLocalDimensions] = useState(roomDimensions);
  const [displayValues, setDisplayValues] = useState({ width: '', height: '' });
  const [editingField, setEditingField] = useState(null);
  const [originalValues, setOriginalValues] = useState({ width: '', height: '' });

  useEffect(() => {
    setLocalDimensions(roomDimensions);
    if (!editingField) {
      const fw = formatDimensionInput(roomDimensions.width, unit);
      const fh = formatDimensionInput(roomDimensions.height, unit);
      const suffix = unit === 'metric' ? ' m' : unit === 'decimal' ? ' ft' : '';
      setDisplayValues({
        width: (unit === 'decimal' || unit === 'metric') && fw ? `${fw}${suffix}` : fw,
        height: (unit === 'decimal' || unit === 'metric') && fh ? `${fh}${suffix}` : fh,
      });
    }
  }, [roomDimensions, unit, editingField]);

  const handleChange = (field, value) => {
    if (unit === 'decimal' || unit === 'metric') {
      if (/^[\d.]*$/.test(value)) {
        setDisplayValues((p) => ({ ...p, [field]: value }));
      }
    } else {
      const next = { ...localDimensions, [field]: value };
      setLocalDimensions(next);
      onDimensionsChange?.(next);
    }
  };

  const handleFocus = (field) => {
    onDimensionFocus?.();
    setEditingField(field);
    if (unit === 'decimal' || unit === 'metric') {
      setOriginalValues((p) => ({ ...p, [field]: displayValues[field] }));
      setDisplayValues((p) => ({ ...p, [field]: '' }));
    }
  };

  const handleBlur = (field) => {
    onDimensionBlur?.();
    if (unit === 'decimal' || unit === 'metric') {
      const value = displayValues[field].trim();
      if (!value) {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
        setEditingField(null);
        return;
      }
      const num = parseFloat(value);
      if (!isNaN(num) && num > 0) {
        // Metres are converted to feet for storage; feet are kept to a tenth.
        const storedValue = unit === 'metric'
          ? metersToFeet(Math.round(num * 100) / 100)
          : Math.round(num * 10) / 10;
        const next = { ...localDimensions, [field]: storedValue.toString() };
        setLocalDimensions(next);
        onDimensionsChange?.(next);
        const formatted = formatDimensionInput(storedValue, unit);
        const suffix = unit === 'metric' ? ' m' : ' ft';
        setDisplayValues((p) => ({ ...p, [field]: `${formatted}${suffix}` }));
      } else {
        setDisplayValues((p) => ({ ...p, [field]: originalValues[field] }));
      }
    }
    setEditingField(null);
  };

  return (
    <div className="grid grid-cols-2 gap-2.5">
      {FIELDS.map(([field, label]) => (
        <div key={field}>
          <label htmlFor={`dim-${field}`} className="label-sm block mb-1">
            {label}
          </label>
          {unit === 'inches' ? (
            <InchesInput
              id={`dim-${field}`}
              large
              value={localDimensions[field]}
              onChange={(v) => handleChange(field, v)}
              onFocus={() => handleFocus(field)}
              onBlur={() => handleBlur(field)}
            />
          ) : (
            <input
              id={`dim-${field}`}
              type="text"
              value={displayValues[field]}
              onChange={(e) => handleChange(field, e.target.value)}
              onFocus={() => handleFocus(field)}
              onBlur={() => handleBlur(field)}
              className="field-input field-input-lg"
              placeholder={unit === 'metric' ? '0.00 m' : '0.0 ft'}
            />
          )}
        </div>
      ))}
    </div>
  );
};

export default RoomSizeFields;
