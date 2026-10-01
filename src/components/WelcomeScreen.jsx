import { useEffect, useState } from 'react';
import { ImageUp } from 'lucide-react';
import { useWelcome } from '../hooks/useWelcome';
import { MOD } from '../utils/keySymbols';

/**
 * The start screen: what the app is for, and the one thing to do next.
 *
 * It is the whole window until a plan is open — no panel, no bar, nothing
 * greyed out waiting for one. The way in is a drop zone, because "put your file
 * here" is the one upload pattern nobody has to be taught, with a button for
 * the people who would rather browse and a sample for the people who have no
 * plan to hand.
 *
 * On a first run it also shows the job instead of describing it: a floor plan
 * miniature draws itself, its printed room sizes are read one by one, a scale
 * resolves, and the outline sweeps round to an area. That loop *is* the product
 * — a new user who watches it once knows what this app does without reading a
 * word. Every run after that the demo and the three steps stand down; they are
 * charming once and tiresome the fifth time a plan is closed.
 *
 * The same screen is what a second plan's empty tab shows (`adding`), where it
 * says what adding a plan is for.
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

/* The iteration count has to stay infinite. The last frame of ft-cycle is the
   blank page the next pass draws onto, so a finite count would settle the demo
   on nothing at all — give it a resting frame first if that ever changes. */
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
   the container's own overflow-y-auto is the net for the sizes that were not.
   The last rung drops it rather than shrinking a third time: below ~240 px the
   dimension labels are under 7 px and the demo stops showing the pipeline. */
@media (min-width: 820px) and (max-height: 700px) { .ft-demo { max-width: 300px; } }
@media (min-width: 820px) and (max-height: 640px) { .ft-demo { max-width: 240px; } }
@media (min-width: 820px) and (max-height: 580px) { .ft-demo { display: none; } }

@media (max-width: 819.98px) and (max-height: 780px) { .ft-demo { max-width: 300px; } }
@media (max-width: 819.98px) and (max-height: 700px) { .ft-demo { max-width: 240px; } }
@media (max-width: 819.98px) and (max-height: 640px) { .ft-demo { display: none; } }
`;

// The job in the user's words, not the pipeline's: three things, one of which
// is not theirs to do.
const STEPS = [
  { title: 'Open a floor plan', line: 'A picture or a PDF of the sketch.' },
  { title: 'FloorTrace measures it', line: 'It reads the room sizes and outlines the house for you.' },
  { title: 'Check it and save the image', line: 'The plan with its square footage on it, ready for your report.' },
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
   The chip says only that the scale is set: a "1 ft = 15 px" here described
   the source image rather than this schematic, and pixels are the one unit no
   user of this app ever needs to read. */
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
          <text className="ft-label" x="263" y="27" fontSize="11" fontWeight="600"
            textAnchor="middle">Scale set &#10003;</text>
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

// Whether a file is being dragged over the window right now. The drop itself
// is the app root's — it accepts a file anywhere — so this only lights the
// zone up, to say "yes, here".
const useFileDragging = () => {
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    let depth = 0;
    const hasFiles = (e) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e) => { if (hasFiles(e)) { depth += 1; setDragging(true); } };
    const leave = () => { depth = Math.max(0, depth - 1); if (depth === 0) setDragging(false); };
    const end = () => { depth = 0; setDragging(false); };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', end);
    window.addEventListener('dragend', end);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', end);
      window.removeEventListener('dragend', end);
    };
  }, []);
  return dragging;
};

// The way in. On touch the route in is the action bar at the bottom of the
// screen, which already carries Open and the camera, so only the sample is
// offered and there is nothing to drop onto.
const WayIn = ({ isTouch, onFileOpen, onTryExample }) => {
  const dragging = useFileDragging();

  if (isTouch) {
    return (
      <div className="mt-6">
        {onTryExample && (
          <button type="button" onClick={onTryExample} className="btn btn-secondary btn-lg">
            Try the sample plan
          </button>
        )}
        <p className="mt-3 text-[14px] text-fg-2 leading-relaxed">
          Photograph a plan, or open an image, with the buttons below.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`mt-7 rounded-2xl border-2 border-dashed px-6 py-8 transition-colors
        ${dragging ? 'border-accent bg-accent/10' : 'border-line bg-panel-2'}`}
    >
      <ImageUp className={`mx-auto w-9 h-9 ${dragging ? 'text-accent' : 'text-fg-dim'}`} aria-hidden="true" />
      <p className="mt-3 text-[17px] font-semibold text-fg">
        {dragging ? 'Drop it to open it' : 'Drop a floor plan here'}
      </p>
      <p className="mt-1 text-[14px] text-fg-3">A picture or a PDF of the sketch</p>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
        <button type="button" onClick={onFileOpen} className="btn btn-primary btn-lg">
          Choose a file…
        </button>
        {onTryExample && (
          <button type="button" onClick={onTryExample} className="btn btn-secondary btn-lg">
            Try the sample plan
          </button>
        )}
      </div>

      <p className="mt-4 text-[13.5px] text-fg-3">
        You can also paste a picture with <kbd>{MOD}+V</kbd>
      </p>
    </div>
  );
};

// Said before the first plan is open, not after a trace disappoints. The
// failure this app is most prone to is a wrong answer that looks confident,
// and a user who was promised "automatic" is the one least equipped to catch
// it — so "automatic" is never offered unqualified.
const Caveat = () => (
  <p className="mt-6 text-[13.5px] text-fg-3 leading-relaxed">
    Works best on a clean plan with the room sizes printed on it. Always compare
    the outline with the plan before you use the area.
  </p>
);

const WelcomeScreen = ({ isTouch, onFileOpen, onTryExample, adding = false }) => {
  const firstRun = useWelcome();
  // The demo and the steps introduce the app; a second plan's empty tab is
  // shown to someone who has already met it.
  const introduce = firstRun && !adding;

  const title = adding ? 'Add another plan'
    : introduce ? 'Measure a floor plan' : 'Open a floor plan';
  const lead = adding
    ? 'Another level, or another sheet of the same property. FloorTrace measures each plan and adds them up.'
    : introduce
      ? 'Open a floor plan sketch and FloorTrace works out its gross living area for you.'
      : 'FloorTrace works out its gross living area for you.';

  // What it is and what to do: the same block on a first run and every run
  // after it.
  const wayIn = (
    <div className="w-full max-w-[34rem] text-center">
      <h1 className="text-[26px] font-semibold text-fg">{title}</h1>
      <p className="mt-2 text-[16px] text-fg-2 leading-relaxed">{lead}</p>
      {/* The sample is for someone with no plan to hand. Offered as a second
          plan it would be added to the property's total. */}
      <WayIn isTouch={isTouch} onFileOpen={onFileOpen} onTryExample={adding ? undefined : onTryExample} />
      <Caveat />
    </div>
  );

  return (
    // Scrolls rather than clips. The demo stands down twice and then goes on a
    // short viewport, but those rungs are measured against the window and the
    // plan column is the window less its bands — so on the shortest screens the
    // estimate can still come up short, and `overflow-hidden` would take the
    // buttons away with nothing on screen saying so. `touch-pan-y` is what
    // makes that reachable at all: the canvas wrapper above this sets
    // `touch-action: none` so a drag never becomes a page scroll.
    <div className="absolute inset-0 overflow-y-auto overscroll-contain touch-pan-y">
      <div className="min-h-full flex items-center justify-center p-6 lg:p-10">
        {!introduce ? wayIn : (
          // On a first run the way in sits beside how it works, where the
          // window has the width; stacked, the way in still comes first in the
          // reading order — the introduction never stands between a user and
          // the button.
          <div className="flex w-full max-w-[66rem] flex-col items-center gap-10
                          lg:flex-row lg:justify-center lg:gap-16">
            {wayIn}
            <div className="w-full max-w-[24rem]">
              <PipelineDemo />
              <ol className="mt-6 flex flex-col gap-3 text-left">
                {STEPS.map((s, i) => (
                  <li key={s.title} className="flex items-start gap-3">
                    <span className="grid place-items-center w-7 h-7 shrink-0 rounded-full
                                     bg-accent/12 text-accent-strong text-[14px] font-semibold">
                      {i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[15px] font-semibold text-fg leading-snug">{s.title}</span>
                      <span className="block text-[14px] text-fg-3 leading-snug">{s.line}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default WelcomeScreen;
