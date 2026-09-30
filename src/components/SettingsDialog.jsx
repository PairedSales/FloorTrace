import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * The workspace's preferences, each with a sentence saying what it does.
 *
 * They used to be scattered: "Save work on exit" and "Enhanced dimension
 * reading" were bare checkmarks at the foot of File, under the close commands,
 * and units and the theme were cycling rows in View ("Theme: System" became
 * "Theme: Light" when clicked). One of them freezes the app for about ten
 * seconds when switched on, which nothing said before it happened.
 *
 * Only settings that belong to the *workspace* live here. "Wall lengths on the
 * plan" and "Snap corners to walls" are stored per plan, so they stay in View
 * where they read as switches on what is in front of you.
 */

const UNITS = [
  { id: 'auto', label: 'Same as the plan', hint: 'Use whichever units the plan’s room sizes are written in.' },
  { id: 'decimal', label: 'Feet', hint: 'For example 12.5 ft' },
  { id: 'inches', label: 'Feet and inches', hint: 'For example 12′ 6″' },
  { id: 'metric', label: 'Meters', hint: 'For example 3.81 m' },
];

const THEMES = [
  { id: 'system', label: 'Match my computer' },
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
];

const Section = ({ title, children }) => (
  <fieldset className="px-5 py-4 border-t border-line-soft first-of-type:border-t-0">
    <legend className="sr-only">{title}</legend>
    <p className="text-[14px] font-semibold text-fg mb-2" aria-hidden="true">{title}</p>
    <div className="flex flex-col gap-1">{children}</div>
  </fieldset>
);

const Choice = ({ type, name, checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 px-2 py-2 -mx-2 rounded-md cursor-pointer hover:bg-sunken">
    <input
      type={type}
      name={name}
      checked={checked}
      onChange={onChange}
      className="mt-[3px] w-4 h-4 accent-accent shrink-0 cursor-pointer"
    />
    <span className="min-w-0">
      <span className="block text-[14px] text-fg leading-snug">{label}</span>
      {hint && <span className="block text-[13px] text-fg-3 leading-snug mt-0.5">{hint}</span>}
    </span>
  </label>
);

const SettingsDialog = ({
  onClose,
  onUnitChange,
  theme,
  onThemeChange,
  saveOnExit,
  onSaveOnExitChange,
  enhancedOcr,
  onEnhancedOcrChange,
}) => {
  const unitPreference = useWorkspaceStore((s) => s.unitPreference);
  const setUnitPreference = useWorkspaceStore((s) => s.setUnitPreference);
  const dialogRef = useRef(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    dialogRef.current?.focus();
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      // Capture, and stopped: Escape here closes the dialog and must not also
      // cancel whatever tool is running behind it.
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      previouslyFocused?.focus?.();
    };
  }, [onClose]);

  // "Same as the plan" hands the choice back to the drawing; any other answer
  // is the same gesture as picking a unit in the panel, which also pins it.
  const chooseUnit = (id) => (id === 'auto' ? setUnitPreference('auto') : onUnitChange(id));

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center p-6 bg-black/50"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        tabIndex={-1}
        className="w-[480px] max-w-full max-h-[90vh] flex flex-col bg-panel border border-line
                   rounded-xl shadow-2xl animate-fade-in outline-none"
      >
        <header className="flex items-center gap-3 px-5 py-3.5 border-b border-line shrink-0">
          <h2 id="settings-title" className="flex-1 text-[16px] font-semibold text-fg">Settings</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close"
            className="grid place-items-center w-8 h-8 rounded-md text-fg-3 hover:bg-sunken hover:text-fg
                       transition-colors cursor-pointer"
          >
            <X className="w-[18px] h-[18px]" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto overscroll-contain">
          <Section title="Units">
            {UNITS.map((u) => (
              <Choice
                key={u.id}
                type="radio"
                name="units"
                checked={unitPreference === u.id}
                onChange={() => chooseUnit(u.id)}
                label={u.label}
                hint={u.hint}
              />
            ))}
          </Section>

          <Section title="Appearance">
            {THEMES.map((t) => (
              <Choice
                key={t.id}
                type="radio"
                name="theme"
                checked={theme === t.id}
                onChange={() => onThemeChange(t.id)}
                label={t.label}
              />
            ))}
          </Section>

          <Section title="Saving and reading plans">
            <Choice
              type="checkbox"
              checked={!!saveOnExit}
              onChange={() => onSaveOnExitChange(!saveOnExit)}
              label="Keep my work in this browser"
              hint="Your plans are saved as you work, so they are still here if you close the tab. Turn this off on a shared computer."
            />
            <Choice
              type="checkbox"
              checked={!!enhancedOcr}
              onChange={() => onEnhancedOcrChange(!enhancedOcr)}
              label="Try harder to read room sizes"
              hint="Adds a second, slower reader for small or blurry text. Turning it on can pause the app for about 10 seconds while it gets ready."
            />
          </Section>
        </div>

        <footer className="flex justify-end px-5 py-3 border-t border-line bg-panel-2 rounded-b-xl shrink-0">
          <button type="button" onClick={onClose} className="btn btn-primary px-5">
            Done
          </button>
        </footer>
      </div>
    </div>
  );
};

export default SettingsDialog;
