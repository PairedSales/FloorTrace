import React, { useState, useEffect, useRef } from 'react';

const InchesInput = ({ value, onChange, onBlur, onFocus }) => {
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const feetRef = useRef(null);
  const inchesRef = useRef(null);

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

  return (
    <div className="flex items-center gap-1 w-24 px-3 py-2 border border-slate-300 rounded-md bg-white text-sm focus-within:ring-2 focus-within:ring-slate-500 focus-within:border-transparent">
      <input
        ref={feetRef}
        type="text"
        value={feet}
        onChange={handleFeetChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => handleKeyDown(e, 'feet')}
        className="w-8 text-right outline-none bg-transparent"
        placeholder="0"
      />
      <span>'</span>
      <input
        ref={inchesRef}
        type="text"
        value={inches}
        onChange={handleInchesChange}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={(e) => handleKeyDown(e, 'inches')}
        className="w-8 text-right outline-none bg-transparent"
        placeholder="0"
      />
      <span>"</span>
    </div>
  );
};

export default InchesInput;
