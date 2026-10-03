import {
  ArrowUpRight, Camera, Check, Copy, FileJson, FolderOpen, HelpCircle, Layers, Maximize,
  Moon, Brush, Route, ScanSearch, ScanText, Share, Waypoints, Sun, Trash2, MonitorSmartphone,
} from 'lucide-react';
import BottomSheet from './BottomSheet';
import { openTracingTutorial } from '../../utils/tracingTutorial';
import useWorkspaceStore, { UNIT_PREFERENCES, UNIT_PREFERENCE_LABEL } from '../../store/workspaceStore';

const THEME_ICON = { system: MonitorSmartphone, light: Sun, dark: Moon };
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

const Section = ({ title, children }) => (
  <>
    <h3 className="card-heading px-4 pt-4 pb-1.5">{title}</h3>
    {children}
  </>
);

const Row = ({ icon: Icon, label, detail, onSelect, disabled, danger, close, trailing }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={() => { close?.(); onSelect?.(); }}
    className={`sheet-row ${danger ? 'sheet-row-danger' : ''}`}
  >
    {Icon && <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />}
    <span className="flex-1 min-w-0">
      <span className={`block truncate ${danger ? '' : 'text-fg'}`}>{label}</span>
      {detail && <span className="block text-[12px] text-fg-3 truncate">{detail}</span>}
    </span>
    {trailing}
  </button>
);

const Check_ = () => <Check className="w-[18px] h-[18px] text-accent shrink-0" aria-hidden="true" />;

const Toggle = ({ icon, label, detail, checked, onToggle }) => (
  <Row
    icon={icon}
    label={label}
    detail={detail}
    onSelect={onToggle}
    trailing={checked ? <Check_ /> : <span className="w-[18px] shrink-0" aria-hidden="true" />}
  />
);

/**
 * Everything the phone screen has no room to show at once.
 *
 * Grouped by what the user is doing — the plan, tracing it, taking the result
 * away, how it is shown. The desktop spreads the same commands over its header
 * Menu, its action bar and its panel; a phone has one list. There is no
 * keybinding column (there is no keyboard), the checkmarks are on the right
 * where a touch list puts them, and "Take a photo" exists here and nowhere on
 * the desktop: on a phone the plan is usually a sheet of paper on the table in
 * front of you, and making the user photograph it in another app first is a
 * detour the device does not need.
 */
const MobileMenuSheet = ({
  open, onClose, image, hasArea,
  onFileOpen, onTakePhoto, onExport, onCopyExhibit, onSaveProject, onCloseActivePlan,
  onFindRoomSize, onTracePerimeter, onDrawExterior, onOutlineByVertex, onAddFloor, canAddOutline,
  onFitToWindow, showSideLengths, onShowSideLengthsChange,
  autoSnapEnabled, onAutoSnapChange, onUnitChange,
  saveOnExit, onSaveOnExitChange, enhancedOcr, onEnhancedOcrChange,
  theme, onCycleTheme, onHelpOpen,
}) => {
  const ThemeIcon = THEME_ICON[theme] ?? MonitorSmartphone;
  // Window state, read where it is used rather than threaded through
  // MobileChrome — the same two fields the panel and Settings read.
  const showWork = useWorkspaceStore((s) => s.showWork);
  const setShowWork = useWorkspaceStore((s) => s.setShowWork);
  const readerStatus = useWorkspaceStore((s) => s.enhancedOcrStatus);
  const unitPreference = useWorkspaceStore((s) => s.unitPreference);
  const setUnitPreference = useWorkspaceStore((s) => s.setUnitPreference);

  return (
    <BottomSheet open={open} onClose={onClose} title="FloorTrace" subtitle="Menu" detent="full">
      <div className="pb-6">
        <Section title="Plan">
          <Row icon={Camera} label="Take a photo of a plan" onSelect={onTakePhoto} close={onClose} />
          <Row icon={FolderOpen} label="Open a floor plan…" onSelect={onFileOpen} close={onClose} />
          <Row
            icon={Maximize}
            label="Fit plan to screen"
            disabled={!image}
            onSelect={onFitToWindow}
            close={onClose}
          />
        </Section>

        <Section title="Measure it again">
          <Row
            icon={ScanText}
            label="Read the room sizes again"
            detail="Find the printed room sizes and set the scale"
            disabled={!image}
            onSelect={onFindRoomSize}
            close={onClose}
          />
          <Row
            icon={ScanSearch}
            label="Find the outline"
            disabled={!image}
            onSelect={onTracePerimeter}
            close={onClose}
          />
          <Row
            icon={Brush}
            label="Paint over the walls"
            detail="Best when FloorTrace cannot find the outline itself"
            disabled={!image}
            onSelect={onDrawExterior}
            close={onClose}
          />
          <Row
            icon={Waypoints}
            label="Tap the corners"
            disabled={!image}
            onSelect={onOutlineByVertex}
            close={onClose}
          />
          {/* Gated on `canAddOutline`, not just `image`: `addPerimeterTrace`
              has no cap of its own, so the seven-outline ceiling lives entirely
              in the UI and every surface offering the verb has to carry it.
              This one did not, and outlines past the seventh are unreachable by
              the Alt/Shift+1–7 switcher. */}
          <Row
            icon={Layers}
            label="Add another outline"
            disabled={!image || !canAddOutline}
            onSelect={onAddFloor}
            close={onClose}
          />
        </Section>

        <Section title="Save">
          <Row
            icon={Share}
            label="Save image…"
            detail="One image with the plan and every number on it"
            disabled={!image}
            onSelect={onExport}
            close={onClose}
          />
          <Row
            icon={Copy}
            label="Copy image"
            disabled={!image || !hasArea}
            onSelect={onCopyExhibit}
            close={onClose}
          />
          <Row
            icon={FileJson}
            label="Save project file"
            detail="Only needed if you mean to come back and edit"
            disabled={!image}
            onSelect={() => onSaveProject(false)}
            close={onClose}
          />
        </Section>

        <Section title="On the plan">
          <Toggle
            label="Wall lengths on the plan"
            checked={showSideLengths}
            onToggle={() => onShowSideLengthsChange(!showSideLengths)}
          />
          <Toggle
            label="Snap corners to walls"
            checked={autoSnapEnabled}
            onToggle={() => onAutoSnapChange(!autoSnapEnabled)}
          />
          <Toggle
            label="Show the sum behind the area"
            detail="The sums behind the living area, in the measurement sheet"
            checked={showWork}
            onToggle={() => setShowWork(!showWork)}
          />
          {/* The measurement sheet's pill group switches the unit and pins it;
              this list is where the fourth answer lives — let the plan decide —
              and where the three two-letter pills get their names. */}
          {UNIT_PREFERENCES.map((id) => (
            <Toggle
              key={id}
              label={id === 'auto' ? 'Units: match the plan' : `Units: ${UNIT_PREFERENCE_LABEL[id].toLowerCase()}`}
              checked={unitPreference === id}
              onToggle={() => (id === 'auto' ? setUnitPreference(id) : onUnitChange(id))}
            />
          ))}
          <Row
            icon={ThemeIcon}
            label="Theme"
            detail={THEME_LABEL[theme]}
            onSelect={onCycleTheme}
          />
          {/* The same page desktop Help links to; a touch list has room to
              say what it is. */}
          <Row
            icon={Route}
            label="How the outline is traced"
            detail="A walkthrough of the tracer, in a new tab"
            onSelect={openTracingTutorial}
            close={onClose}
            trailing={<ArrowUpRight className="w-[18px] h-[18px] text-fg-3 shrink-0" aria-hidden="true" />}
          />
        </Section>

        <Section title="Settings">
          <Toggle
            label="Keep my work in this browser"
            detail="Still here if you close the tab"
            checked={saveOnExit}
            onToggle={() => onSaveOnExitChange(!saveOnExit)}
          />
          <Toggle
            label="Try harder to read room sizes"
            detail={!enhancedOcr ? 'Slower, better on faint or small print'
              : readerStatus === 'starting' ? 'Getting ready — about 10 seconds'
                : readerStatus === 'failed' ? 'Couldn’t start in this browser'
                  : 'Slower, better on faint or small print'}
            checked={enhancedOcr}
            onToggle={() => onEnhancedOcrChange(!enhancedOcr)}
          />
          <Row icon={HelpCircle} label="Help" onSelect={onHelpOpen} close={onClose} />
        </Section>

        <div className="mt-4 pt-2 border-t border-line-soft">
          <Row
            icon={Trash2}
            label="Close plan"
            danger
            disabled={!image}
            onSelect={onCloseActivePlan}
            close={onClose}
          />
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileMenuSheet;
