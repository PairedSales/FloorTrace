import { useState, useEffect, useRef } from 'react';
import { decimalToFeetInches } from '../utils/unitConverter';
import { useIsTouch } from '../hooks/useViewport';

const InchesInput = ({ value, onChange, onBlur, onFocus, id }) => {
  const isTouch = useIsTouch();
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [inchesPrompt, setInchesPrompt] = useState(false);
  const feetRef = useRef(null);
  const inchesRef = useRef(null);
  const prevFeetRef = useRef('');
  const prevInchesRef = useRef('');
  const inchesPromptTimerRef = useRef(null);

  useEffect(() => {
    if (value) {
      // Shared formatter: the inline version omitted the 12-inch carry, so
      // 11.99 ft displayed as 11' 12" — a value this component's own
      // validation refuses as input.
      const { feet: f, inches: i } = decimalToFeetInches(parseFloat(value));
      setFeet(f.toString());
      setInches(i.toString());
    } else {
      setFeet('');
      setInches('');
    }
  }, [value]);

  useEffect(() => {
    return () => clearTimeout(inchesPromptTimerRef.current);
  }, []);

  const handleFeetChange = (e) => {
    const val = e.target.value;
    if (/^\d*$/.test(val)) {
      setFeet(val);
      const newTotalFeet = (parseInt(val, 10) || 0) + ((parseInt(inches, 10) || 0) / 12);
      onChange(newTotalFeet.toString());
    }
  };

  const handleInchesChange = (e) => {
    const val = e.target.value;
    if (/^\d*$/.test(val)) {
      const numVal = parseInt(val, 10);
      if (!isNaN(numVal) && numVal > 11) {
        setInches('');
        clearTimeout(inchesPromptTimerRef.current);
        setInchesPrompt(true);
        inchesPromptTimerRef.current = setTimeout(() => setInchesPrompt(false), 2000);
        return;
      }
      setInches(val);
      const newTotalFeet = (parseInt(feet, 10) || 0) + ((parseInt(val, 10) || 0) / 12);
      onChange(newTotalFeet.toString());
    }
  };

  const handleKeyDown = (e, field) => {
    if (e.key === 'Tab' && !e.shiftKey && field === 'feet') {
      e.preventDefault();
      inchesRef.current.focus();
    } else if (e.key === 'Tab' && e.shiftKey && field === 'inches') {
      e.preventDefault();
      feetRef.current.focus();
    }
  };

  const handleFieldFocus = (field) => (e) => {
    if (field === 'feet') { prevFeetRef.current = feet; setFeet(''); }
    else { prevInchesRef.current = inches; setInches(''); }
    if (onFocus) onFocus(e);
  };

  const handleFieldBlur = (field) => (e) => {
    if (field === 'feet' && feet === '') setFeet(prevFeetRef.current);
    else if (field === 'inches' && inches === '') setInches(prevInchesRef.current);
    if (onBlur) onBlur(e);
  };

  return (
    <div
      className={`relative flex items-center justify-center w-full px-2.5 py-1.5 rounded-md bg-panel-2 border border-line font-mono
                 focus-within:ring-2 focus-within:ring-accent focus-within:border-accent transition-colors duration-150 cursor-text pointer-events-auto select-text
                 ${isTouch ? 'min-h-[44px] text-[15px]' : 'text-[13px]'}`}
      // The whole box is the target, not just the two number fields. Each is
      // `1ch` wide when empty — 9 px, which a fingertip cannot land on — and the
      // guard used to be `e.target === e.currentTarget`, so a tap that hit the
      // inner row or the ′ / ″ glyphs (most of the box) focused nothing at all.
      // Taps that land on an input are left alone so the caret still goes where
      // it was put.
      onClick={(e) => {
        if (e.target === feetRef.current || e.target === inchesRef.current) return;
        const rect = e.currentTarget.getBoundingClientRect();
        if (e.clientX < rect.left + rect.width / 2) {
          feetRef.current?.focus();
        } else {
          inchesRef.current?.focus();
        }
      }}
    >
      <div className="flex items-center text-fg-3">
        <input
          ref={feetRef}
          id={id}
          type="text"
          value={feet}
          onChange={handleFeetChange}
          onFocus={handleFieldFocus('feet')}
          onBlur={handleFieldBlur('feet')}
          onKeyDown={(e) => handleKeyDown(e, 'feet')}
          className="text-center outline-none bg-transparent text-fg placeholder-fg-dim select-text"
          // Two characters minimum on touch. The field grows with its content
          // either way; this only stops an empty one collapsing to a slit.
          style={{ width: `${Math.max((feet || '0').length, isTouch ? 2 : 1)}ch` }}
          placeholder="0"
        />
        <span className="text-fg-3 mr-1">&prime;</span>
        <input
          ref={inchesRef}
          type="text"
          value={inches}
          onChange={handleInchesChange}
          onFocus={handleFieldFocus('inches')}
          onBlur={handleFieldBlur('inches')}
          onKeyDown={(e) => handleKeyDown(e, 'inches')}
          className="text-center outline-none bg-transparent text-fg placeholder-fg-dim select-text"
          style={{ width: `${Math.max((inches || '0').length, isTouch ? 2 : 1)}ch` }}
          placeholder="0"
        />
        <span className="text-fg-3">&Prime;</span>
      </div>
      {inchesPrompt && (
        <span className="absolute -bottom-5 right-0 text-xs text-warn whitespace-nowrap pointer-events-none">
          Inches: 0–11 only
        </span>
      )}
    </div>
  );
};

export default InchesInput;
