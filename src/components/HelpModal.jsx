import { X } from 'lucide-react';
import { useEffect } from 'react';

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

const shortcuts = [
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

const tips = [
  'Click on a room to auto-detect its boundary.',
  'Use "Find Perimeter" to auto-detect exterior walls.',
  'Drag overlay vertices to adjust detected boundaries.',
  'Use the Measure tool to draw measurement lines.',
  'Use the Draw tool to create custom area polygons.',
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
      <div className="bg-chrome-800 border border-chrome-700 rounded-xl shadow-2xl w-[360px] max-h-[80vh] overflow-y-auto animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-chrome-700">
          <h2 className="text-sm font-semibold text-slate-100">Help</h2>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-chrome-700/70 transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Keyboard Shortcuts */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Keyboard Shortcuts
          </h3>
          <div className="space-y-1.5">
            {shortcuts.map((s) => (
              <div key={s.keys} className="flex items-center justify-between">
                <span className="text-[11px] text-slate-400">{s.description}</span>
                <kbd className="text-[10px] font-mono text-slate-300 bg-chrome-900/80 border border-chrome-700 rounded px-1.5 py-0.5">
                  {s.keys}
                </kbd>
              </div>
            ))}
          </div>
        </section>

        <div className="panel-divider mx-4" />

        {/* Tips */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider mb-2">
            Tips
          </h3>
          <ul className="space-y-1.5">
            {tips.map((tip) => (
              <li key={tip} className="text-[11px] text-slate-400 leading-relaxed flex gap-1.5">
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
