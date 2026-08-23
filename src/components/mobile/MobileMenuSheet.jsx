import {
  Camera, Check, Copy, FileJson, FolderOpen, HelpCircle, Layers, Maximize,
  Moon, Brush, ScanSearch, ScanText, Share, Waypoints, Sun, Trash2, MonitorSmartphone,
} from 'lucide-react';
import BottomSheet from './BottomSheet';

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
 * Grouped by the desktop menu bar's own titles, so a user who knows one knows
 * the other — but the *contents* differ where the platform does. There is no
 * keybinding column (there is no keyboard), the checkmarks are on the right
 * where a touch list puts them, and "Take a photo" exists here and nowhere on
 * the desktop: on a phone the plan is usually a sheet of paper on the table in
 * front of you, and making the user photograph it in another app first is a
 * detour the device does not need.
 */
const MobileMenuSheet = ({
  open, onClose, image, hasArea,
  onFileOpen, onTakePhoto, onExport, onCopyExhibit, onSaveProject, onRestart,
  onFindRoomSize, onTracePerimeter, onDrawExterior, onOutlineByVertex, onAddFloor, canAddOutline,
  onFitToWindow, showSideLengths, onShowSideLengthsChange,
  autoSnapEnabled, onAutoSnapChange,
  saveOnExit, onSaveOnExitChange, enhancedOcr, onEnhancedOcrChange,
  theme, onCycleTheme, onHelpOpen,
}) => {
  const ThemeIcon = THEME_ICON[theme] ?? MonitorSmartphone;

  return (
    <BottomSheet open={open} onClose={onClose} title="FloorTrace" subtitle="Menu" detent="full">
      <div className="pb-6">
        <Section title="Plan">
          <Row icon={Camera} label="Take a photo of a plan" onSelect={onTakePhoto} close={onClose} />
          <Row icon={FolderOpen} label="Open plan or project…" onSelect={onFileOpen} close={onClose} />
          <Row
            icon={Maximize}
            label="Fit plan to screen"
            disabled={!image}
            onSelect={onFitToWindow}
            close={onClose}
          />
        </Section>

        <Section title="Trace">
          <Row
            icon={ScanText}
            label="Read dimensions"
            detail="Find the printed room sizes and set the scale"
            disabled={!image}
            onSelect={onFindRoomSize}
            close={onClose}
          />
          <Row
            icon={ScanSearch}
            label="Find outline"
            disabled={!image}
            onSelect={onTracePerimeter}
            close={onClose}
          />
          <Row
            icon={Brush}
            label="Paint outline"
            detail="Best when auto-detection cannot read the plan"
            disabled={!image}
            onSelect={onDrawExterior}
            close={onClose}
          />
          <Row
            icon={Waypoints}
            label="Place corners"
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

        <Section title="Export">
          <Row
            icon={Share}
            label="Export for workfile…"
            detail="One image with the plan and every number on it"
            disabled={!image}
            onSelect={onExport}
            close={onClose}
          />
          <Row
            icon={Copy}
            label="Copy measurement image"
            disabled={!image || !hasArea}
            onSelect={onCopyExhibit}
            close={onClose}
          />
          <Row
            icon={FileJson}
            label="Save editable project"
            detail="Only needed if you mean to come back and edit"
            disabled={!image}
            onSelect={() => onSaveProject(false)}
            close={onClose}
          />
        </Section>

        <Section title="View">
          <Toggle
            label="Show side lengths"
            checked={showSideLengths}
            onToggle={() => onShowSideLengthsChange(!showSideLengths)}
          />
          <Toggle
            label="Snap to walls"
            checked={autoSnapEnabled}
            onToggle={() => onAutoSnapChange(!autoSnapEnabled)}
          />
          <Row
            icon={ThemeIcon}
            label="Theme"
            detail={THEME_LABEL[theme]}
            onSelect={onCycleTheme}
          />
        </Section>

        <Section title="Settings">
          <Toggle
            label="Save work on exit"
            detail="Keeps a draft in this browser"
            checked={saveOnExit}
            onToggle={() => onSaveOnExitChange(!saveOnExit)}
          />
          <Toggle
            label="Enhanced dimension reading"
            detail="Slower, better on faint or small print"
            checked={enhancedOcr}
            onToggle={() => onEnhancedOcrChange(!enhancedOcr)}
          />
          <Row icon={HelpCircle} label="How it works" onSelect={onHelpOpen} close={onClose} />
        </Section>

        <div className="mt-4 pt-2 border-t border-line-soft">
          <Row
            icon={Trash2}
            label="Close project"
            danger
            disabled={!image}
            onSelect={onRestart}
            close={onClose}
          />
        </div>
      </div>
    </BottomSheet>
  );
};

export default MobileMenuSheet;
