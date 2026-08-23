import { FolderOpen } from 'lucide-react';
import { useWelcome } from '../hooks/useWelcome';

/**
 * The empty canvas, in two sizes.
 *
 * On a first run it shows the pipeline instead of describing it: a floorplan
 * miniature draws itself, its printed room dimensions are read one by one, a
 * scale resolves, and the exterior outline sweeps round to an area. That loop
 * *is* the product — a new user who watches it once knows what this app does
 * without reading a word.
 *
 * Every run after that it is the compact state it has always been. The demo is
 * charming once and tiresome the fifth time a plan is closed.
 *
 * The demo is inline SVG and CSS keyframes, deliberately. This module is
 * reached by the eager shell through `Canvas.jsx`, and anything it imports
 * lands in the entry chunk — an animation library here would cost first paint
 * exactly what lazy-loading the Konva stage was meant to buy back.
 */

// One 11 s timeline, shared. Every element animates for the whole 11 s and
// encodes its own window as keyframe percentages, so the four beats cannot
// drift apart the way four independent `animation-delay`s do.
//
//   0.0–2.6 s  plan      walls stroke themselves in
//   2.6–4.4 s  scale     three printed room dimensions are read, one at a time
//   4.8–5.4 s  scale     feet-per-pixel resolves
//   5.7–7.7 s  outline   the exterior sweeps round, the interior fills
//   7.7–8.9 s  report    the area counts up and lands
//   8.9–10.3 s hold, then fade for the loop
//
// The hold is the longest single beat on purpose. It is the only one that
// shows the *answer*, and at three-quarters of a second — which is where this
// first landed — a glance at the screen catches nothing but process.
//
// Colours are set here rather than as `fill=`/`stroke=` presentation
// attributes: `var()` inside a presentation attribute is not reliably
// supported (WebKit has shipped it broken more than once), and the failure is
// a black drawing rather than a missing one. In a stylesheet it is ordinary
// CSS everywhere.
const DEMO_CSS = `
.ft-demo { width: 100%; max-width: 360px; margin-inline: auto; }
.ft-demo svg { display: block; width: 100%; height: auto; }

.ft-demo .ft-a {
  animation-duration: 11s;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
.ft-demo .ft-draw { stroke-dasharray: 100; }

.ft-demo .ft-wall    { stroke: rgb(var(--fg-3)); }
.ft-demo .ft-outline { stroke: rgb(var(--accent)); }
.ft-demo .ft-fill    { fill: rgb(var(--accent) / .10); }
.ft-demo .ft-label   { fill: rgb(var(--fg-2)); }
.ft-demo .ft-scan    { fill: rgb(var(--accent) / .16); stroke: rgb(var(--accent) / .55); }
.ft-demo .ft-chip    { fill: rgb(var(--panel-2)); stroke: rgb(var(--line)); }
.ft-demo .ft-area    { fill: rgb(var(--accent-strong)); }

.ft-demo .ft-cycle { animation-name: ft-cycle; }
.ft-demo .ft-shell { animation-name: ft-shell; }
.ft-demo .ft-inner { animation-name: ft-inner; }
.ft-demo .ft-label-1 { animation-name: ft-label-1; }
.ft-demo .ft-label-2 { animation-name: ft-label-2; }
.ft-demo .ft-label-3 { animation-name: ft-label-3; }
.ft-demo .ft-scan-1 { animation-name: ft-scan-1; }
.ft-demo .ft-scan-2 { animation-name: ft-scan-2; }
.ft-demo .ft-scan-3 { animation-name: ft-scan-3; }
.ft-demo .ft-ruler { animation-name: ft-ruler; }
.ft-demo .ft-outline { animation-name: ft-outline; }
.ft-demo .ft-fill { animation-name: ft-fill; }
.ft-demo .ft-tick-1 { animation-name: ft-tick-1; }
.ft-demo .ft-tick-2 { animation-name: ft-tick-2; }
.ft-demo .ft-tick-3 { animation-name: ft-tick-3; }
.ft-demo .ft-total { animation-name: ft-total; }

@keyframes ft-cycle   { 0%, 94% { opacity: 1; }   98%, 100% { opacity: 0; } }
@keyframes ft-shell   { 0%, 2%  { stroke-dashoffset: 100; } 16%, 100% { stroke-dashoffset: 0; } }
@keyframes ft-inner   { 0%, 14% { stroke-dashoffset: 100; } 24%, 100% { stroke-dashoffset: 0; } }

@keyframes ft-label-1 { 0%, 24% { opacity: 0; } 28%, 100% { opacity: 1; } }
@keyframes ft-label-2 { 0%, 30% { opacity: 0; } 34%, 100% { opacity: 1; } }
@keyframes ft-label-3 { 0%, 36% { opacity: 0; } 40%, 100% { opacity: 1; } }
@keyframes ft-scan-1  { 0%, 23% { opacity: 0; } 26% { opacity: 1; } 31%, 100% { opacity: 0; } }
@keyframes ft-scan-2  { 0%, 29% { opacity: 0; } 32% { opacity: 1; } 37%, 100% { opacity: 0; } }
@keyframes ft-scan-3  { 0%, 35% { opacity: 0; } 38% { opacity: 1; } 43%, 100% { opacity: 0; } }

@keyframes ft-ruler   { 0%, 44% { opacity: 0; } 49%, 100% { opacity: 1; } }

@keyframes ft-outline {
  0%, 52% { stroke-dashoffset: 100; opacity: 0; }
  54%     { stroke-dashoffset: 96;  opacity: 1; }
  70%, 100% { stroke-dashoffset: 0; opacity: 1; }
}
@keyframes ft-fill    { 0%, 62% { opacity: 0; } 72%, 100% { opacity: 1; } }

@keyframes ft-tick-1  { 0%, 69.5% { opacity: 0; } 70%,   72.5% { opacity: 1; } 73%, 100% { opacity: 0; } }
@keyframes ft-tick-2  { 0%, 73%   { opacity: 0; } 73.5%, 75.5% { opacity: 1; } 76%, 100% { opacity: 0; } }
@keyframes ft-tick-3  { 0%, 76%   { opacity: 0; } 76.5%, 78.5% { opacity: 1; } 79%, 100% { opacity: 0; } }
@keyframes ft-total   { 0%, 79%   { opacity: 0; } 81%,   100%  { opacity: 1; } }

/* Not a paused first frame — the finished picture. The scan boxes and the
   counting numbers never existed as a resting state, so they are the only
   things withheld. Higher specificity than index.css's blanket
   \`*{animation-duration:.01ms!important}\`, which would otherwise leave this
   on whatever the 0% keyframe says: an empty page.
   Specificity is what decides it only because tailwind 3 strips @layer at build
   time. Under a real cascade layer an !important layered declaration outranks an
   unlayered one whatever the specificity — this still holds there, but only
   because the blanket rule never sets animation-name and this one does. */
@media (prefers-reduced-motion: reduce) {
  .ft-demo .ft-a {
    animation: none !important;
    opacity: 1;
    stroke-dashoffset: 0;
  }
  .ft-demo .ft-transient { opacity: 0 !important; }
}

/* The demo is the least load-bearing thing on this screen, so it is what gives
   way: it shrinks twice and then goes entirely, rather than pushing the two
   buttons past the bottom of the plan column.
   The rungs are viewport height standing in for the column's height, and they
   are split on the shell's own 819.98 px breakpoint because the two shells take
   very different bites out of it — 66-96 px for the desktop bands, ~110 plus
   safe insets for the phone's two bars. One ladder for both either shrank the
   demo on a 768 px desktop that had 190 px to spare, or left it full size on a
   667 px phone that was 30 px short. Measured at 375x667, 360x640 and 820x768;
   the container's own overflow-y-auto is the net for the sizes that were not. */
@media (min-width: 820px) and (max-height: 700px) { .ft-demo { max-width: 300px; } }
@media (min-width: 820px) and (max-height: 640px) { .ft-demo { max-width: 240px; } }
@media (min-width: 820px) and (max-height: 580px) { .ft-demo { display: none; } }

@media (max-width: 819.98px) and (max-height: 780px) { .ft-demo { max-width: 300px; } }
@media (max-width: 819.98px) and (max-height: 700px) { .ft-demo { max-width: 240px; } }
@media (max-width: 819.98px) and (max-height: 640px) { .ft-demo { display: none; } }
`;

const STEPS = [
  { label: 'Plan', line: 'Open, drop, or paste a floorplan image.' },
  { label: 'Scale', line: 'Reads the printed room sizes to get feet per pixel.' },
  { label: 'Outline', line: 'Traces the exterior walls around the building.' },
  { label: 'Report', line: 'Totals the area and exports a workfile exhibit.' },
];

// One building, drawn twice: grey as walls while it is being read, accent as
// the traced perimeter afterwards. An L with a wing, not a box — a plain
// rectangle reads as a placeholder rather than as a floorplan.
const SHELL = 'M36 44 H204 V104 H256 V156 H36 Z';
const PARTITIONS = 'M118 44 V104 M36 104 H204 M204 104 V156';

/* The printed numbers agree with each other, which is not decoration: this is
   an appraisal tool and the one thing it must never do is show arithmetic that
   does not add up. At 4.17 units per foot the labelled rooms measure 19'6",
   14'6" and 12'6" to within an inch, and the enclosed 21,520 units² come to
   1,238 ft² — the figure the count lands on.
   The scale chip is the exception and is not checkable against this drawing:
   it reports px per foot of the *source image*, which is a photograph of a
   plan several thousand pixels across, not this schematic's unit grid. */
const PipelineDemo = () => (
  <div className="ft-demo" aria-hidden="true">
    <style>{DEMO_CSS}</style>
    <svg viewBox="0 0 320 172" xmlns="http://www.w3.org/2000/svg" focusable="false">
      <g className="ft-a ft-cycle">
        <path className="ft-a ft-fill" d={SHELL} />

        <g className="ft-wall" fill="none" strokeLinecap="square">
          <path className="ft-a ft-draw ft-shell" d={SHELL} pathLength="100" strokeWidth="2.4" />
          <path className="ft-a ft-draw ft-inner" d={PARTITIONS} pathLength="100" strokeWidth="1.6" />
        </g>

        <path
          className="ft-a ft-draw ft-outline"
          d={SHELL}
          pathLength="100"
          fill="none"
          strokeWidth="4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Inside the rooms, which is where this app's OCR actually finds them
            — a printed room size, not an architect's dimension string run
            around the outside of the sheet. */}
        <g className="ft-label" fontSize="10" fontWeight="600" textAnchor="middle">
          <g className="ft-a ft-label-1">
            <rect className="ft-a ft-scan ft-scan-1 ft-transient"
              x="55" y="66" width="44" height="15" rx="2.5" strokeWidth="1" />
            <text x="77" y="78">19&#39; 6&quot;</text>
          </g>
          <g className="ft-a ft-label-2" transform="rotate(-90 161 74)">
            <rect className="ft-a ft-scan ft-scan-2 ft-transient"
              x="139" y="66" width="44" height="15" rx="2.5" strokeWidth="1" />
            <text x="161" y="78">14&#39; 6&quot;</text>
          </g>
          <g className="ft-a ft-label-3">
            {/* 40 wide, not 44 like the other two: the wing is 48 units clear
                between its wall faces and a 44 leaves 2 on each side, which at
                the smallest rung is a label touching a wall. */}
            <rect className="ft-a ft-scan ft-scan-3 ft-transient"
              x="210" y="122" width="40" height="15" rx="2.5" strokeWidth="1" />
            <text x="230" y="134">12&#39; 6&quot;</text>
          </g>
        </g>

        <g className="ft-a ft-ruler">
          <rect className="ft-chip" x="218" y="12" width="90" height="21" rx="4" strokeWidth="1" />
          <text className="ft-label" x="263" y="27" fontSize="10.5"
            fontFamily="Fira Code, ui-monospace, monospace" textAnchor="middle">1 ft = 15 px</text>
        </g>

        <g className="ft-area" textAnchor="middle" fontWeight="700" fontSize="18">
          <text className="ft-a ft-tick-1 ft-transient" x="120" y="138">480 ft&#178;</text>
          <text className="ft-a ft-tick-2 ft-transient" x="120" y="138">910 ft&#178;</text>
          <text className="ft-a ft-tick-3 ft-transient" x="120" y="138">1,180 ft&#178;</text>
          <text className="ft-a ft-total" x="120" y="138">1,240 ft&#178;</text>
        </g>
      </g>
    </svg>
  </div>
);

/* The compact state, unchanged: what every run after the first one shows. */
const CompactEmpty = ({ isTouch, onFileOpen }) => (
  <div className="text-center max-w-sm">
    <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-panel-2 border border-line flex items-center justify-center">
      <svg className="w-7 h-7 text-fg-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <path d="M9 3v18" />
        <path d="M15 3v18" />
        <path d="M3 9h18" />
        <path d="M3 15h18" />
      </svg>
    </div>
    <p className="text-base font-semibold text-fg mb-1">
      No floor plan loaded
    </p>
    {/* Two keybindings are the whole instruction on a desktop and a dead
        end on a phone, where the route in is the button at the bottom of
        the screen — or the camera, which is the fastest way to get a
        paper plan into this app and does not exist on the desktop. */}
    {isTouch ? (
      <p className="text-[13.5px] text-fg-2 leading-relaxed">
        Photograph a plan, or open an image, with the buttons below.
      </p>
    ) : (
      <>
        {/* A button, not two keybindings. This is the whole screen at
            the one moment the app has nothing else to say, and it used
            to answer with a pair of chords — which is a dead end for
            anyone who does not read them, and the reason Open had to
            keep a label up in the top row. It has one here instead. */}
        <button
          type="button"
          onClick={onFileOpen}
          className="mt-1 inline-flex items-center gap-2 h-9 px-3.5 rounded-md
                     bg-accent text-accent-ink text-[12.5px] font-semibold
                     hover:brightness-110 transition-[filter] cursor-pointer"
        >
          <FolderOpen className="w-4 h-4" aria-hidden="true" />
          Open a plan
        </button>
        <p className="mt-3 text-[13px] text-fg-3">
          or drop one here, or paste with <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-panel-2 border border-line rounded text-fg-2">Ctrl+V</kbd>
        </p>
      </>
    )}
    {/* What the app is about to attempt, and the honest caveat. Three
        spinners used to run in sequence with nothing having said what
        they were for or that the last of them can be wrong — so a bad
        trace arrived as a surprise rather than as the expected case it
        is. Both shells, because the surprise is the same on a phone. */}
    <p className="mt-5 pt-4 border-t border-line text-[12.5px] text-fg-3 leading-relaxed">
      FloorTrace reads the printed room sizes, works out the scale from them, and
      traces the exterior walls to get the area. Automatic tracing works best on a
      clean plan with space around the drawing — when it struggles, you paint
      roughly over the walls instead and it snaps to them.
    </p>
  </div>
);

const WelcomeScreen = ({ isTouch, onFileOpen, onTryExample }) => {
  const showWelcome = useWelcome();

  return (
    // Scrolls rather than clips. The demo stands down twice and then goes on a
    // short viewport, but those rungs are measured against the window and the
    // plan column is the window less two bands — so on the shortest phones the
    // estimate can still come up short, and `overflow-hidden` would take the
    // buttons away with nothing on screen saying so. `touch-pan-y` is what
    // makes that reachable at all: the canvas wrapper above this sets
    // `touch-action: none` so a drag never becomes a page scroll.
    <div className="absolute inset-0 overflow-y-auto overscroll-contain touch-pan-y">
      <div className="min-h-full flex items-center justify-center p-4">
        {!showWelcome ? (
          <CompactEmpty isTouch={isTouch} onFileOpen={onFileOpen} />
        ) : (
          <div className="w-full max-w-[26rem] text-center">
            <PipelineDemo />

            <p className="mt-3 text-[15px] font-semibold text-fg">
              Measure a floorplan
            </p>

            {/* The same four stages the dock's StageSpine prints, in the same
                words and the same marks — the first thing a user sees names
                the pipeline they will be reading for the rest of the session. */}
            <ol className="mt-3 grid grid-cols-2 gap-x-3.5 gap-y-2.5 text-left">
              {STEPS.map((s) => (
                <li key={s.label} className="flex flex-col gap-1">
                  <span className="h-[3px] rounded-full bg-accent/45" />
                  <span className="text-[10.5px] font-semibold uppercase tracking-[.05em] text-fg-2">
                    {s.label}
                  </span>
                  <span className="text-[12px] leading-snug text-fg-3">{s.line}</span>
                </li>
              ))}
            </ol>

            {/* Said before the first plan is open, not after a trace disappoints.
                The failure this app is most prone to is a wrong answer that looks
                confident, and a user who was promised "automatic" is the one
                least equipped to catch it. */}
            <p className="mt-4 pt-3.5 border-t border-line text-[12.5px] text-fg-3 leading-relaxed">
              Automatic tracing works best on a clean plan with space around the drawing —
              when it struggles, you paint roughly over the walls and it snaps to them.
            </p>

            {/* On touch the route in is the action bar at the bottom of the
                screen, which already carries Open and the camera. A second large
                Open button here would compete with it and win, from the wrong
                side of the reach. */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {!isTouch && (
                <button
                  type="button"
                  onClick={onFileOpen}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-md
                             bg-accent text-accent-ink text-[12.5px] font-semibold
                             hover:brightness-110 transition-[filter] cursor-pointer"
                >
                  <FolderOpen className="w-4 h-4" aria-hidden="true" />
                  Open a plan
                </button>
              )}
              {onTryExample && (
                <button
                  type="button"
                  onClick={onTryExample}
                  className="inline-flex items-center h-9 px-3.5 rounded-md border border-line
                             bg-panel-2 text-fg-2 text-[12.5px] font-semibold
                             hover:text-fg hover:border-accent/55 transition-colors cursor-pointer"
                >
                  Try an example plan
                </button>
              )}
            </div>

            {isTouch ? (
              <p className="mt-3 text-[13.5px] text-fg-2 leading-relaxed">
                Photograph a plan, or open an image, with the buttons below.
              </p>
            ) : (
              <p className="mt-3 text-[13px] text-fg-3">
                or drop one here, or paste with <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-panel-2 border border-line rounded text-fg-2">Ctrl+V</kbd>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
