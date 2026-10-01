import { useState } from 'react';
import { ArrowUpRight } from 'lucide-react';
import { useIsTouch } from '../hooks/useViewport';
import { TOOL_GROUPS } from './toolCatalog';
import { MOD as mod, ALT as alt } from '../utils/keySymbols';
import { openTracingTutorial } from '../utils/tracingTutorial';
import Dialog from './Dialog';

/**
 * Help, in two pages: how to use the app, and the keyboard shortcuts.
 *
 * The guide walks the job in the order it happens and names every control
 * exactly as the screen does — the action bar's menus by their titles, the
 * panel's sections by theirs. It is the one place a renamed control goes stale
 * silently, so the names are worth checking whenever one changes.
 */

// ── the guide ────────────────────────────────────────────────────────────
// Names here must match the screen: the menu titles and rows in
// `toolCatalog.js`, the panel's sections and buttons in `ResultsPanel.jsx`, and
// the header's Menu in `AppHeader.jsx`.
const GUIDE = [
  {
    title: 'The basics',
    ordered: true,
    items: [
      'Open your floor plan: drop the file onto this window, choose it with Menu ▸ Open a floor plan, or paste a picture. Pictures and PDFs both work.',
      'FloorTrace reads the room sizes printed on the plan, works out the scale from them, and outlines the outside walls. It takes a few seconds.',
      'Compare the outline with the plan. If a corner is off, drag it into place.',
      'Click Save image, at the bottom of the panel on the left, for a picture of the plan with its measurements — ready for your report or workfile.',
    ],
  },
  {
    title: 'If the outline is wrong',
    items: [
      'Drag any corner to move it. Right-click a corner to delete it.',
      'Open Outline, above the plan, and choose “Paint over the walls”. Paint roughly over the outside walls, then click “Draw the outline”. It only needs to be close — FloorTrace follows the walls.',
      'Or choose “Click the corners” and click each outside corner of the house in turn.',
      'Notes or a legend drawn inside the house can confuse FloorTrace. Open Edit plan and choose “Erase marks on the plan” to white them out, or “Crop the plan” to keep just the house. Then choose Outline ▸ Find the outline again.',
    ],
  },
  {
    title: 'If the area looks wrong',
    items: [
      'The area depends on the scale. Open Scale, in the panel on the left, to see where it came from.',
      'To change it, choose “Use a different room” and click a room whose printed size you trust, or choose “Measure a length you know” and type in the length.',
      'If the room sizes on the plan disagree with each other, Scale opens by itself with a note saying so and what to do about it.',
    ],
  },
  {
    title: 'Garages, porches and other levels',
    items: [
      'Choose Outline ▸ Add another outline and click its corners. Then open Outline in the panel and set what it counts as — living area (GLA), garage, porch and so on. Only living area counts toward GLA.',
      'A level drawn on a separate sheet: click “Add plan”, beside the plan’s name at the top. The panel adds the plans together for the whole property.',
    ],
  },
  {
    title: 'Measuring something else',
    items: [
      'Open Measure, above the plan, to measure a distance, an area such as a deck, or an angle. What you measure is drawn on the plan and can be included on the saved image.',
    ],
  },
  {
    title: 'Saving your work',
    items: [
      'Your plans are kept in this browser as you work, so they are still here if you close the tab.',
      'Save image gives you a picture for your report. To keep a copy you can open again and change later, choose Menu ▸ Save project file.',
      'To switch between feet, feet and inches and meters, or between light and dark, choose Menu ▸ Settings.',
    ],
  },
];

// ── keyboard shortcuts ───────────────────────────────────────────────────
const SHORTCUTS = [
  {
    title: 'Opening and saving',
    rows: [
      [`${mod} + O`, 'Open a floor plan'],
      [`${mod} + V`, 'Paste a floor plan picture'],
      [`${mod} + E`, 'Save an image for your report'],
      [`${mod} + ${alt} + C`, 'Copy that image'],
      [`${mod} + S`, 'Save a project file'],
      [`${mod} + Z`, 'Undo'],
      [`${mod} + Shift + Z`, 'Redo'],
    ],
  },
  {
    title: 'Looking at the plan',
    rows: [
      ['Scroll wheel', 'Zoom in and out'],
      ['Drag the plan', 'Move around'],
      ['F', 'Fit the whole plan in the window'],
      ['R / Shift + R', 'Turn the plan right / left'],
      ['O', 'Show or hide the results panel'],
      ['L', 'Show or hide wall lengths'],
      [`${mod} + Scroll wheel`, 'Larger or smaller labels and corners'],
    ],
  },
  {
    title: 'Tools',
    rows: [
      // Read off the catalogue rather than retyped, in the order the menus
      // show them, which is the order the digits follow.
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
      [`${mod} + ${alt} + N`, 'Add another plan'],
      [`${mod} + ${alt} + 1 – 6`, 'Go to a plan by number'],
      [`${mod} + ${alt} + ← / →`, 'Previous or next plan'],
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

const PageTab = ({ active, onClick, children }) => (
  <button
    type="button"
    role="tab"
    aria-selected={active}
    onClick={onClick}
    className={`h-10 px-1 text-[14.5px] font-medium border-b-2 -mb-px transition-colors cursor-pointer
      ${active ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
  >
    {children}
  </button>
);

const KeyRow = ({ keys, description }) => (
  <div className="flex items-center justify-between gap-4">
    <span className="text-[14.5px] text-fg-2">{description}</span>
    <kbd className="shrink-0">{keys}</kbd>
  </div>
);

const HelpModal = ({ onClose, initialTab = 'guide' }) => {
  const isTouch = useIsTouch();
  // Keyed on the page it was opened at (see App), so this only seeds it.
  const [tab, setTab] = useState(initialTab === 'shortcuts' ? 'shortcuts' : 'guide');

  return (
    <Dialog
      id="help"
      title="Help"
      onClose={onClose}
      mobile="sheet"
      headerExtra={(
        <div role="tablist" aria-label="Help pages" className="flex gap-5 px-6">
          <PageTab active={tab === 'guide'} onClick={() => setTab('guide')}>How to use FloorTrace</PageTab>
          <PageTab active={tab === 'shortcuts'} onClick={() => setTab('shortcuts')}>
            {isTouch ? 'Gestures' : 'Keyboard shortcuts'}
          </PageTab>
        </div>
      )}
    >
      <div role="tabpanel">
        {tab === 'guide' ? (
          <>
            {GUIDE.map((section) => {
              const List = section.ordered ? 'ol' : 'ul';
              return (
                <section key={section.title} className="mb-6">
                  <h3 className="text-[15.5px] font-semibold text-fg mb-2.5">{section.title}</h3>
                  <List className="space-y-2.5">
                    {section.items.map((item, i) => (
                      <li key={item} className="flex gap-3 text-[14.5px] leading-relaxed text-fg-2">
                        <span className={`shrink-0 ${section.ordered
                          ? 'grid place-items-center w-6 h-6 mt-px rounded-full bg-accent/12 text-accent-strong text-[13px] font-semibold'
                          : 'text-accent mt-px'}`}>
                          {section.ordered ? i + 1 : '•'}
                        </span>
                        <span className="min-w-0">{item}</span>
                      </li>
                    ))}
                  </List>
                </section>
              );
            })}

            {/* The one thing here that leaves the app: a walkthrough of the
                tracer, built from the real pipeline against the same drawing
                the start screen offers as its sample. */}
            <button
              type="button"
              onClick={openTracingTutorial}
              aria-label="How FloorTrace finds the outline — opens in a new tab"
              className="link-btn mb-1"
            >
              How FloorTrace finds the outline
              <ArrowUpRight className="w-4 h-4" aria-hidden="true" />
            </button>
          </>
        ) : isTouch ? (
          <div className="space-y-2.5">
            {GESTURES.map(([keys, description]) => (
              <KeyRow key={keys} keys={keys} description={description} />
            ))}
          </div>
        ) : (
          SHORTCUTS.map((group) => (
            <section key={group.title} className="mb-6 last:mb-1">
              <h3 className="text-[15.5px] font-semibold text-fg mb-2.5">{group.title}</h3>
              <div className="space-y-2">
                {group.rows.map(([keys, description]) => (
                  <KeyRow key={`${keys}-${description}`} keys={keys} description={description} />
                ))}
              </div>
            </section>
          ))
        )}
      </div>
    </Dialog>
  );
};

export default HelpModal;
