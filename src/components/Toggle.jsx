const Toggle = ({ checked, onChange, label }) => {
  return (
    <div className="flex items-center justify-between pointer-events-auto">
      <span className="text-[11px] font-medium text-slate-400">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full cursor-pointer
          transition-colors duration-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${
          checked ? 'bg-accent' : 'bg-chrome-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm
            transition-transform duration-200 ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  );
};

export default Toggle;
