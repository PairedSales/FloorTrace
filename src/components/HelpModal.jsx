import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useIsTouch, useIsMobile } from '../hooks/useViewport';
import { TOOL_GROUPS } from './toolCatalog';

import { MOD as mod, ALT as alt } from '../utils/keySymbols';

const shortcuts = [
  { keys: 'O', description: 'Show or hide the measurement panel' },
  { keys: 'L', description: 'Toggle show lengths' },
  { keys: 'F', description: 'Fit plan to window' },
  { keys: '[ / ]', description: 'Resize the active brush' },
  { keys: 'R', description: 'Rotate canvas 45° clockwise' },
  { keys: 'Shift + R', description: 'Rotate canvas 45° counter-clockwise' },
  // Read off the catalogue rather than retyped. Same order as the tool rail
  // reads, top to bottom — that is what the digits follow, so the two can be
  // learned as one thing — and one fewer hand-maintained printing of a map that
  // is already written down twice.
  { keys: '1 – 9', description: TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t.digit).map((t) => t.short).join(', ') },
  { keys: 'Alt / Shift + 1 – 7', description: 'Switch outline within this plan' },
  // Ctrl+Alt rather than the obvious chords: Ctrl+Tab, Ctrl+W and Ctrl+1–9 all
  // belong to the browser's own tab strip and cannot be taken from a page.
  { keys: `${mod} + ${alt} + 1 – 6`, description: 'Switch to a plan by number' },
  { keys: `${mod} + ${alt} + ← / →`, description: 'Previous or next plan' },
  { keys: `${mod} + ${alt} + N`, description: 'New plan' },
  { keys: 'Enter', description: 'Finish drawing the exterior, or close a void' },
  { keys: 'Esc', description: 'Cancel the current stroke or tool' },
  { keys: 'Delete', description: 'Delete the selected line, shape, void or vertex' },
  { keys: 'Right-click', description: 'Delete a vertex' },
  { keys: `${mod} + E`, description: 'Export an image for your workfile' },
  { keys: `${mod} + ${alt} + C`, description: 'Copy that image straight to the clipboard' },
  { keys: `${mod} + S`, description: 'Save an editable project file' },
  { keys: `${mod} + O`, description: 'Open image' },
  { keys: `${mod} + V`, description: 'Paste image from clipboard' },
  { keys: `${mod} + Z`, description: 'Undo' },
  { keys: `${mod} + Shift + Z`, description: 'Redo' },
  { keys: `${mod} + Y`, description: 'Redo' },
  { keys: 'Mouse Back / Forward', description: 'Undo / Redo' },
  { keys: 'Scroll Wheel', description: 'Zoom in / out' },
  { keys: 'Click + Drag', description: 'Pan canvas' },
];

// The same section, for a device with no keyboard. Not a translation of the
// list above — most of those rows have no touch equivalent at all, and the
// three gestures that matter are ones the desktop never has to teach.
const gestures = [
  { keys: 'Drag', description: 'Pan the plan' },
  { keys: 'Pinch', description: 'Zoom in and out' },
  { keys: 'Tap', description: 'Place a corner, a measure point or a room' },
  { keys: 'Double-tap', description: 'Add a corner to an outline you have traced' },
  { keys: 'Press & hold', description: 'Delete an outline corner' },
  { keys: 'Two fingers', description: 'Zoom while a brush tool is active' },
];

// Names here must match the command bar and the tool rail. They drifted once
// already: the shell renamed every command and this list kept describing the
// old one.
// What to do when automatic tracing disappoints you, in the order worth
// trying. Written against the causes the detector actually reports — a legend
// or dimension string it read as wall, a plan too small for its strokes to
// survive, an opening it had to bridge — rather than as general advice.
const recovery = [
  'Automatic tracing works best on a clean plan with white space around the drawing. '
    + 'It struggles with legends and notes inside the building, low-resolution scans, '
    + 'and plans photographed at an angle.',
  '"Paint outline" is the answer to most failures: drag roughly over the exterior walls '
    + 'and FloorTrace snaps to them. It only needs to be close.',
  'Painted the outline and it still came back wrong? Paint again — your strokes are kept, '
    + 'so you can add one more pass rather than starting over.',
  'A legend, title block or note inside the building confuses the tracer. Erase it from the '
    + 'plan image, or crop to the building, then trace again.',
  'Read the dimensions before tracing. The rooms it finds are evidence the tracer uses, and '
    + 'on some plans they are the difference between an outline and nothing.',
  'The area looks wrong but the outline looks right? Check the scale — it is a separate step, '
    + 'and area changes with the square of it.',
  'Stats & warnings at the foot of the measurement panel lists everything the app doubts, '
    + 'with a "Show" button that points at the spot on the plan.',
];

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
  'Export gives you one image with the plan, the outlines and every number on '
    + 'it — that is the thing to put in a workfile. The .floorplan file is only '
    + 'needed if you mean to come back and edit the trace.',
];

const touchTips = [
  'Photograph the plan straight from the menu — the whole sheet, square on, in good light.',
  'Tap “Read dimensions” first. It reads the printed room sizes and sets the scale from them.',
  'Tap a room on the plan to detect its walls and pin the scale to that room.',
  'If auto-detection cannot read the plan, use Paint outline: drag roughly over the exterior walls and FloorTrace snaps to them.',
  'Drag an outline corner to adjust it; press and hold one to delete it.',
  'Zoom in before adjusting corners — the whole plan on one screen is smaller than a fingertip.',
  'The number at the bottom right is the area. Tap it for the scale, the breakdown and anything the detector was unsure about.',
  'Export gives you one image with the plan and every number on it — that is what goes in a workfile.',
];

const HelpModal = ({ onClose }) => {
  const isTouch = useIsTouch();
  const isMobile = useIsMobile();

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const rows = isTouch ? gestures : shortcuts;
  const rowsTitle = isTouch ? 'Gestures' : 'Keyboard Shortcuts';
  const shownTips = isTouch ? touchTips : tips;

  return (
    <div
      // `fixed`, not `absolute`: the shell is a static flex column, so an
      // absolute child was already resolving against the viewport — this just
      // says so, and keeps the sheet out of the mobile shell's overflow clip.
      className={`fixed inset-0 z-50 flex bg-black/50 pointer-events-auto
                  ${isMobile ? 'items-end' : 'items-center justify-center'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`bg-panel border border-line shadow-2xl overflow-y-auto overscroll-contain
                    animate-fade-in
          ${isMobile
            ? 'w-full max-h-[88%] rounded-t-2xl pb-safe'
            : 'rounded-xl w-[360px] max-h-[80vh]'}`}
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between px-4 py-3 border-b border-line bg-panel">
          <h2 className={`font-semibold text-fg ${isMobile ? 'text-[15px]' : 'text-sm'}`}>
            How it works
          </h2>
          <button
            onClick={onClose}
            className={`rounded-md text-fg-3 hover:text-white hover:bg-line/70 transition-colors
                        cursor-pointer ${isMobile ? 'tap-target -mr-2' : 'p-1'}`}
            title="Close"
            aria-label="Close"
          >
            <X className={isMobile ? 'w-5 h-5' : 'w-4 h-4'} />
          </button>
        </div>

        {/* First, deliberately. This panel used to open with 24 keyboard
            shortcuts and bury the one thing a stuck user is looking for as the
            third of eleven tips — and automatic tracing failing is the single
            most likely reason anybody opens it. */}
        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-2">
            When tracing goes wrong
          </h3>
          <ul className="space-y-1.5">
            {recovery.map((item) => (
              <li
                key={item}
                className={`text-fg-3 leading-relaxed flex gap-1.5
                            ${isMobile ? 'text-[13px]' : 'text-[11px]'}`}
              >
                <span className="text-accent shrink-0">•</span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <div className="panel-divider mx-4" />

        <section className="px-4 py-3">
          <h3 className="text-[11px] font-semibold text-fg-2 uppercase tracking-wider mb-2">
            {rowsTitle}
          </h3>
          <div className="space-y-1.5">
            {rows.map((s) => (
              <div key={s.keys} className="flex items-center justify-between gap-3">
                <span className={`text-fg-3 ${isMobile ? 'text-[13px]' : 'text-[11px]'}`}>
                  {s.description}
                </span>
                <kbd className={`shrink-0 font-mono text-fg-2 bg-panel-2/80 border border-line
                                 rounded px-1.5 py-0.5 ${isMobile ? 'text-[12px]' : 'text-[10px]'}`}>
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
            {shownTips.map((tip) => (
              <li
                key={tip}
                className={`text-fg-3 leading-relaxed flex gap-1.5
                            ${isMobile ? 'text-[13px]' : 'text-[11px]'}`}
              >
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
