import { useState, useEffect, useRef } from 'react';

const InchesInput = ({ value, onChange, onBlur, onFocus }) => {
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const feetRef = useRef(null);
  const inchesRef = useRef(null);
  const prevFeetRef = useRef('');
  const prevInchesRef = useRef('');

  useEffect(() => {
    if (value) {
      const totalInches = parseFloat(value) * 12;
      const f = Math.floor(totalInches / 12);
      const i = Math.round(totalInches % 12);
      setFeet(f.toString());
      setInches(i.toString());
    } else {
      setFeet('');
      setInches('');
    }
  }, [value]);

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
      className="flex items-center justify-center w-full px-2.5 py-1.5 rounded-md bg-chrome-900/80 border border-chrome-700 text-sm font-mono
                 focus-within:ring-1 focus-within:ring-accent focus-within:border-accent transition-colors duration-150 cursor-text pointer-events-auto"
      onClick={(e) => { if (e.target === e.currentTarget) feetRef.current?.focus(); }}
    >
      <div className="flex items-center text-slate-500 gap-0.5">
        <input
          ref={feetRef}
          type="text"
          value={feet}
          onChange={handleFeetChange}
          onFocus={handleFieldFocus('feet')}
          onBlur={handleFieldBlur('feet')}
          onKeyDown={(e) => handleKeyDown(e, 'feet')}
          className="w-7 text-center outline-none bg-transparent text-slate-100 placeholder-slate-600"
          placeholder="0"
        />
        <span className="text-slate-500">&prime;</span>
        <input
          ref={inchesRef}
          type="text"
          value={inches}
          onChange={handleInchesChange}
          onFocus={handleFieldFocus('inches')}
          onBlur={handleFieldBlur('inches')}
          onKeyDown={(e) => handleKeyDown(e, 'inches')}
          className="w-5 text-center outline-none bg-transparent text-slate-100 placeholder-slate-600"
          placeholder="0"
        />
        <span className="text-slate-500">&Prime;</span>
      </div>
    </div>
  );
};

export default InchesInput;
