import useWorkspaceStore from '../store/workspaceStore';
import { ENHANCED_OCR_HINT } from '../hooks/useEnhancedOcr';
import Dialog from './Dialog';

/**
 * The workspace's preferences, each with a sentence saying what it does.
 *
 * Everything here is set once and left: the units to read every plan in, the
 * look of the app, whether work is kept in this browser, and the slower reader
 * for hard-to-read plans. That is the test for what belongs in this dialog
 * rather than on screen — the units used to be three buttons at the head of
 * the panel, on show every minute of every job, for a choice made once a year.
 *
 * Only settings that belong to the *workspace* live here. "Wall lengths on the
 * plan" and "Snap corners to walls" are stored per plan, so they stay in the
 * Menu where they read as switches on what is in front of you.
 */

const UNITS = [
  { id: 'auto', label: 'Same as the plan', hint: 'Use whichever units the plan’s room sizes are written in.' },
  { id: 'decimal', label: 'Feet', hint: 'For example 12.5 ft' },
  { id: 'inches', label: 'Feet and inches', hint: 'For example 12′ 6″' },
  { id: 'metric', label: 'Meters', hint: 'For example 3.81 m' },
];


const Group = ({ title, children }) => (
  <fieldset className="py-5 border-t border-line-soft first:border-t-0 first:pt-0 last:pb-0">
    <legend className="sr-only">{title}</legend>
    <p className="card-heading mb-2" aria-hidden="true">{title}</p>
    <div className="flex flex-col gap-0.5">{children}</div>
  </fieldset>
);

const Choice = ({ type, name, checked, onChange, label, hint }) => (
  <label className="flex items-start gap-3 px-2.5 py-2 -mx-2.5 rounded-lg cursor-pointer hover:bg-sunken">
    <input
      type={type}
      name={name}
      checked={checked}
      onChange={onChange}
      className="mt-[3px] w-4 h-4 accent-accent shrink-0 cursor-pointer"
    />
    <span className="min-w-0">
      <span className="block text-[16px] text-fg leading-snug">{label}</span>
      {hint && <span className="block text-[15.5px] text-fg-3 leading-snug mt-0.5">{hint}</span>}
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
  // How the slower reader is getting on, said on its own switch: it takes ten
  // seconds to start and can fail, and this dialog is open while it does.
  const readerStatus = useWorkspaceStore((s) => s.enhancedOcrStatus);

  // "Same as the plan" hands the choice back to the drawing; any other answer
  // pins that unit for every plan.
  const chooseUnit = (id) => (id === 'auto' ? setUnitPreference('auto') : onUnitChange(id));

  return (
    <Dialog
      id="settings"
      title="Settings"
      size="sm"
      onClose={onClose}
      footer={(
        <button type="button" onClick={onClose} className="btn btn-primary px-6 ml-auto">
          Done
        </button>
      )}
    >
      <Group title="Units">
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
      </Group>

      {/* One switch, not a choice of three: the app is light, and this is
          the way to make it dark. */}
      <Group title="Appearance">
        <Choice
          type="checkbox"
          checked={theme === 'dark'}
          onChange={() => onThemeChange(theme === 'dark' ? 'light' : 'dark')}
          label="Night mode"
          hint="Dark colours around the plan. The plan itself stays on white paper."
        />
      </Group>

      <Group title="Saving and reading plans">
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
          hint={ENHANCED_OCR_HINT[enhancedOcr ? readerStatus : 'idle'] ?? ENHANCED_OCR_HINT.idle}
        />
      </Group>
    </Dialog>
  );
};

export default SettingsDialog;
