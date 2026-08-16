import { X } from 'lucide-react';
import { useEffect } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
  { keys: 'O', description: 'Show or hide the measurement panel' },
  { keys: 'L', description: 'Toggle show lengths' },
  { keys: 'F', description: 'Fit plan to window' },
  { keys: '[ / ]', description: 'Resize the active brush' },
  { keys: 'R', description: 'Rotate canvas 45° clockwise' },
  { keys: 'Shift + R', description: 'Rotate canvas 45° counter-clockwise' },
  { keys: '1 – 9', description: 'Measure, Area, Angle, Place corners, Crop, Erase, Paint outline, Cut out, Scale' },
  { keys: 'Alt / Shift + 1 – 7', description: 'Switch perimeter trace' },
  { keys: 'Enter', description: 'Finish drawing the exterior, or close a void' },
  { keys: 'Esc', description: 'Cancel the current stroke or tool' },
  { keys: 'Delete', description: 'Delete the selected line, shape, void or vertex' },
  { keys: 'Right-click', description: 'Delete a vertex' },
  { keys: `${mod} + O`, description: 'Open image' },
  { keys: `${mod} + V`, description: 'Paste image from clipboard' },
  { keys: `${mod} + Z`, description: 'Undo' },
  { keys: `${mod} + Shift + Z`, description: 'Redo' },
  { keys: `${mod} + Y`, description: 'Redo' },
  { keys: 'Mouse Back / Forward', description: 'Undo / Redo' },
  { keys: 'Scroll Wheel', description: 'Zoom in / out' },
  { keys: 'Click + Drag', description: 'Pan canvas' },
];

// Names here must match the command bar and the tool rail. They drifted once
// already: the shell renamed every command and this list kept describing the
// old one.
const tips = [
  'Click on a room to auto-detect its boundary.',
  'Use "Find outline" to detect the exterior walls automatically.',
  'If that fails, "Paint outline" lets you paint roughly over the walls — FloorTrace snaps the outline to them.',
  'Drag outline corners to adjust what the detector found.',
  'Click a corner to select it, then press Delete to remove it.',
  'Measure draws a measurement line; Draw an area makes a custom polygon.',
  'No printed dimensions? Use Scale — drag a line along a wall whose length you know and type it in.',
  'Use Cut out to punch a courtyard or light well out of an outline; it is subtracted from the area and survives a re-trace.',
  'The Outlines list shows how confident the detector was, and why.',
  'Drag & drop an image file onto the canvas to open it.',
];

const HelpModal = ({ onClose }) => {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 pointer-events-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-panel border border-line rounded-xl shadow-2xl w-[360px] max-h-[80vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-line">
          <h2 className="text-sm font-semibold text-fg">Help</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-fg-3 hover:text-white hover:bg-line/70 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Keyboard Shortcuts */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-2">
            Keyboard Shortcuts
          </h3>
          <div className="space-y-1.5">
            {shortcuts.map((s) => (
              <div key={s.keys} className="flex items-center justify-between">
                <span className="text-[11px] text-fg-3">{s.description}</span>
                <kbd className="text-[10px] font-mono text-fg-2 bg-panel-2/80 border border-line rounded px-1.5 py-0.5">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        <div className="panel-divider mx-4" />

        {/* Tips */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-2">
            Tips
          </h3>
          <ul className="space-y-1.5">
            {tips.map((tip) => (
              <li key={tip} className="text-[11px] text-fg-3 leading-relaxed flex gap-1.5">
                <span className="text-accent shrink-0">•</span>
                {tip}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
};

export default HelpModal;
