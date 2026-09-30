import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useIsTouch, useIsMobile } from '../hooks/useViewport';
import { TOOL_GROUPS } from './toolCatalog';

import { MOD as mod, ALT as alt } from '../utils/keySymbols';

/**
 * Help, in two pages: how to use the app, and the keyboard shortcuts.
 *
 * It used to open on twenty-six shortcuts, with the advice a stuck user came
 * for behind them, and its tips had drifted from the app: "Click on a room to
 * auto-detect its boundary" described a mode that no longer exists, and two
 * more named panels that had been renamed. The guide now walks the job in the
 * order it happens and names every control exactly as the screen does — the
 * rail's tools by their labels, the panel's actions by their buttons.
 */

// ── the guide ────────────────────────────────────────────────────────────
// Names here must match the screen: the rail labels in `toolCatalog.js`, the
// dock's button text in `MeasurementDock.jsx` and the menu items in `TopBar.jsx`.
const GUIDE = [
  {
    title: 'The basics',
    ordered: true,
    items: [
      'Open your floor plan: click Open, drag the file onto this window, or paste an image. Pictures and PDFs both work.',
      'FloorTrace reads the room sizes printed on the plan, works out the scale from them, and outlines the outside walls. It takes a few seconds.',
      'Compare the outline with the plan. If a corner is off, drag it into place.',
      'Click Export to save an image of the plan with its measurements, ready for your report or workfile.',
    ],
  },
  {
    title: 'If the outline is wrong',
    items: [
      'Drag any corner to move it. Right-click a corner to delete it.',
      'Choose Paint in the tools on the right, paint roughly over the outside walls, then click “Draw the outline”. It only needs to be close — FloorTrace follows the walls.',
      'Or choose Corners and click each outside corner of the house in turn.',
      'Notes or a legend drawn inside the house can confuse FloorTrace. Use Erase to white them out, or Crop to just the house, then choose “Find the outline again” in the Outline section.',
    ],
  },
  {
    title: 'If the area looks wrong',
    items: [
      'The area depends on the scale, and the Scale section says where it came from.',
      'To change it, choose “Use a different room” and click a room whose printed size you trust, or choose “Measure a length you know” and type in the length.',
      'Anything FloorTrace is unsure about is listed under “Things to check”. Click Show to see where it is on the plan.',
    ],
  },
  {
    title: 'Garages, porches and other levels',
    items: [
      'Choose “Add another outline” in the Outline section, then set what it counts as — living area (GLA), garage, porch and so on. Only living area counts toward GLA.',
      'A level drawn on a separate sheet: open it with File ▸ New plan tab. The panel adds the levels together for the whole property.',
    ],
  },
  {
    title: 'Saving your work',
    items: [
      'Your plans are kept in this browser as you work, so they are still here if you close the tab.',
      'Export saves an image for your report. To keep a copy you can open again and change later, choose File ▸ Save project file.',
    ],
  },
];

// ── keyboard shortcuts ───────────────────────────────────────────────────
const SHORTCUTS = [
  {
    title: 'Files',
    rows: [
      [`${mod} + O`, 'Open a floor plan'],
      [`${mod} + V`, 'Paste a floor plan image'],
      [`${mod} + E`, 'Export an image for your report'],
      [`${mod} + ${alt} + C`, 'Copy that image to the clipboard'],
      [`${mod} + S`, 'Save a project file'],
      [`${mod} + Z`, 'Undo'],
      [`${mod} + Shift + Z`, 'Redo'],
    ],
  },
  {
    title: 'Viewing the plan',
    rows: [
      ['Scroll wheel', 'Zoom in and out'],
      ['Drag the plan', 'Move around'],
      ['F', 'Fit the plan in the window'],
      ['R / Shift + R', 'Rotate right / left 45°'],
      ['O', 'Show or hide the measurement panel'],
      ['L', 'Show or hide wall lengths'],
      [`${mod} + Scroll wheel`, 'Larger or smaller labels and corners'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      // Read off the catalogue rather than retyped, in the order the rail
      // shows them, which is the order the digits follow.
      ...TOOL_GROUPS.flatMap((g) => g.tools)
        .filter((t) => t.digit)
        .map((t) => [t.digit, t.label]),
      ['[ / ]', 'Smaller / larger brush'],
      ['Enter', 'Finish what you are drawing'],
      ['Esc', 'Cancel the current tool'],
      ['Delete', 'Delete the selected corner, line or shape'],
      ['Right-click', 'Delete a corner'],
    ],
  },
  {
    title: 'Plans and outlines',
    rows: [
      // Ctrl+Alt rather than the obvious chords: Ctrl+Tab, Ctrl+W and Ctrl+1–9
      // all belong to the browser's own tab strip and cannot be taken from a page.
      [`${mod} + ${alt} + N`, 'Open a new plan tab'],
      [`${mod} + ${alt} + 1 – 6`, 'Go to a plan tab by number'],
      [`${mod} + ${alt} + ← / →`, 'Previous or next plan tab'],
      ['Alt + 1 – 7', 'Switch between outlines on this plan'],
    ],
  },
];

// The same page for a device with no keyboard. Not a translation of the list
// above — most of those rows have no touch equivalent at all.
const GESTURES = [
  ['Drag', 'Move around the plan'],
  ['Pinch', 'Zoom in and out'],
  ['Tap', 'Place a corner, a measure point or a room'],
  ['Double-tap', 'Add a corner to an outline'],
  ['Press & hold', 'Delete an outline corner'],
  ['Two fingers', 'Zoom while a brush tool is on'],
];

const Tab = ({ active, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`h-9 px-3 text-[14px] font-medium border-b-2 -mb-px transition-colors cursor-pointer
      ${active ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
  >
    {children}
  </button>
);

const HelpModal = ({ onClose, initialTab = 'guide' }) => {
  const isTouch = useIsTouch();
  const isMobile = useIsMobile();
  // Keyed on the page it was opened at (see App), so this only seeds it.
  const [tab, setTab] = useState(initialTab === 'shortcuts' ? 'shortcuts' : 'guide');

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
      // `fixed`, not `absolute`: the shell is a static flex column, so an
      // absolute child was already resolving against the viewport — this just
      // says so, and keeps the sheet out of the mobile shell's overflow clip.
      className={`fixed inset-0 z-50 flex bg-black/50 pointer-events-auto
                  ${isMobile ? 'items-end' : 'items-center justify-center p-6'}`}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
        className={`flex flex-col bg-panel border border-line shadow-2xl animate-fade-in
          ${isMobile
            ? 'w-full max-h-[88%] rounded-t-2xl pb-safe'
            : 'rounded-xl w-[560px] max-w-full max-h-[85vh]'}`}
      >
        <div className="shrink-0 border-b border-line">
          <div className="flex items-center justify-between px-5 pt-3.5">
            <h2 id="help-title" className="text-[16px] font-semibold text-fg">
              Help
            </h2>
            <button
              onClick={onClose}
              className={`rounded-md text-fg-3 hover:text-fg hover:bg-sunken transition-colors
                          cursor-pointer ${isMobile ? 'tap-target -mr-2' : 'grid place-items-center w-8 h-8'}`}
              title="Close"
              aria-label="Close"
            >
              <X className={isMobile ? 'w-5 h-5' : 'w-[18px] h-[18px]'} aria-hidden="true" />
            </button>
          </div>
          <div role="tablist" aria-label="Help pages" className="flex gap-2 px-4 mt-1.5">
            <Tab active={tab === 'guide'} onClick={() => setTab('guide')}>How to use FloorTrace</Tab>
            <Tab active={tab === 'shortcuts'} onClick={() => setTab('shortcuts')}>
              {isTouch ? 'Gestures' : 'Keyboard shortcuts'}
            </Tab>
          </div>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 py-4" role="tabpanel">
          {tab === 'guide' ? (
            GUIDE.map((section) => {
              const List = section.ordered ? 'ol' : 'ul';
              return (
                <section key={section.title} className="mb-5 last:mb-1">
                  <h3 className="text-[14.5px] font-semibold text-fg mb-2">{section.title}</h3>
                  <List className="space-y-2">
                    {section.items.map((item, i) => (
                      <li key={item} className={`flex gap-2.5 text-[14px] leading-relaxed text-fg-2`}>
                        <span className={`shrink-0 ${section.ordered
                          ? 'grid place-items-center w-6 h-6 mt-px rounded-full bg-accent/12 text-accent-strong text-[12.5px] font-semibold'
                          : 'text-accent mt-px'}`}>
                          {section.ordered ? i + 1 : '•'}
                        </span>
                        <span className="min-w-0">{item}</span>
                      </li>
                    ))}
                  </List>
                </section>
              );
            })
          ) : isTouch ? (
            <div className="space-y-2">
              {GESTURES.map(([keys, description]) => (
                <div key={keys} className="flex items-center justify-between gap-4">
                  <span className="text-[14px] text-fg-2">{description}</span>
                  <kbd className="shrink-0 text-[13px] text-fg-2 bg-panel-2 border border-line rounded px-2 py-0.5">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          ) : (
            SHORTCUTS.map((group) => (
              <section key={group.title} className="mb-5 last:mb-1">
                <h3 className="text-[14.5px] font-semibold text-fg mb-2">{group.title}</h3>
                <div className="space-y-1.5">
                  {group.rows.map(([keys, description]) => (
                    <div key={`${keys}-${description}`} className="flex items-center justify-between gap-4">
                      <span className="text-[14px] text-fg-2">{description}</span>
                      <kbd className="shrink-0 text-[12.5px] text-fg-2 bg-panel-2 border border-line rounded px-2 py-0.5 whitespace-nowrap">
                        {keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default HelpModal;
