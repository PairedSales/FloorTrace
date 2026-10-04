import { useEffect, useState } from 'react';
import { ArrowDownToLine, ArrowRight, FolderOpen, Scissors } from 'lucide-react';
import { MOD, SNIP } from '../utils/keySymbols';
import { STEP_TITLES } from '../utils/progressSteps';

/**
 * The start screen: what the app is for, and the one thing to do next.
 *
 * It is the whole window until a plan is open — no panel, no bar, nothing
 * greyed out waiting for one.
 *
 * ## The ways in, as one row
 *
 * A plan reaches this app three ways, and the row at the top names all three
 * so that none has to be discovered: choose a file, drop one, or paste a
 * screenshot. The third is the one most plans actually arrive by — the sketch
 * is a page of a PDF or a listing, and the quickest route is to snip it and
 * paste — so its two keys are printed rather than left to "you can also paste".
 * The row is still the place a dropped file lands, and lights up while one is
 * dragged over the window. The sample is a line under it, for someone with no
 * plan to hand.
 *
 * ## The four steps, shown and said
 *
 * The screen also shows the job instead of describing it: a
 * small floor plan draws itself, its printed room sizes are read one by one,
 * the scale is set from them, the outline sweeps round, and the area lands.
 * Beside it are the same four steps in words — the ones the results panel will
 * list while it measures and keep when it is done (`progressSteps.js`) — and
 * each number fills while the picture is doing that step. A new user who
 * watches it once knows what this app does, and has met the panel before they
 * see it. Steps on the left and the plan on the right, as they will be once a
 * plan is open.
 *
 * It is there every time this screen is. It used to be a first-run thing that
 * stood down once a plan had been opened, on the theory that it is charming
 * once and tiresome the fifth time; the owner likes it and wants it kept
 * (October 2026). The ways in lead the page, so it never stands between a
 * returning user and the button.
 *
 * The same screen is what a second plan's empty tab shows (`adding`), where
 * the title says what adding a plan is for.
 *
 * The demo is inline SVG and CSS keyframes, deliberately. This module is
 * reached by the eager shell through `Canvas.jsx`, and anything it imports
 * lands in the entry chunk — an animation library here would cost first paint
 * exactly what lazy-loading the Konva stage was meant to buy back.
 */

// One 12 s timeline, shared. Every element animates for the whole 12 s and
// encodes its own window as keyframe percentages, so the beats cannot drift
// apart the way independent `animation-delay`s do.
//
//   0.0–2.8 s   the plan      walls stroke themselves in, with their printed sizes
//   2.9–5.2 s   step 1        the three room sizes are read, one at a time
//   5.3–6.2 s   step 2        the room the scale came from, and "Scale set"
//   6.4–8.6 s   step 3        the outline sweeps round, its corners land, it fills
//   8.6–9.8 s   step 4        the area counts up and lands
//   9.8–11.3 s  hold, then fade for the loop
//
// The room sizes are part of the plan: they are drawn with the walls, because
// they are printed on it. What step 1 adds is the box that reads each one, and
// the tint it leaves behind. An earlier version faded the numbers in as they
// were read, which showed FloorTrace writing them.
//
// The hold is the longest single beat on purpose. It is the only one that
// shows the *answer*.
//
// Colours are set here rather than as `fill=`/`stroke=` presentation
// attributes: `var()` inside a presentation attribute is not reliably
// supported (WebKit has shipped it broken more than once), and the failure is
// a black drawing rather than a missing one. In a stylesheet it is ordinary
// CSS everywhere. The outline and the green box are the plan's own colours
// (`traceTypes.js`, the scale room), the same in both themes.
const DEMO_CSS = `
.ft-demo .ft-plan svg { display: block; width: 100%; height: auto; }

/* The iteration count has to stay infinite. The last frame of ft-cycle is the
   blank page the next pass draws onto, so a finite count would settle the demo
   on nothing at all — give it a resting frame first if that ever changes. */
.ft-demo .ft-a {
  animation-duration: 12s;
  animation-iteration-count: infinite;
  animation-timing-function: ease-in-out;
  animation-fill-mode: both;
}
.ft-demo .ft-draw { stroke-dasharray: 100; }

.ft-demo .ft-wall    { stroke: rgb(var(--fg)); }
.ft-demo .ft-label   { fill: rgb(var(--fg)); }
.ft-demo .ft-scan    { fill: rgb(var(--accent) / .14); stroke: rgb(var(--accent) / .65); }
.ft-demo .ft-chip    { fill: rgb(var(--panel-2)); stroke: rgb(var(--line-strong)); }
.ft-demo .ft-area    { fill: rgb(var(--fg)); }
.ft-demo .ft-trace   { stroke: rgb(var(--accent)); }
.ft-demo .ft-fill    { fill: rgb(var(--accent) / .16); }
.ft-demo .ft-corners { fill: rgb(var(--panel-2)); stroke: rgb(var(--accent)); }
.ft-demo .ft-room    { fill: rgb(var(--ok) / .14); stroke: rgb(var(--ok)); }
.ft-demo .ft-arealabel { fill: rgb(var(--fg-3)); }

.ft-demo .ft-cycle { animation-name: ft-cycle; }
.ft-demo .ft-shell { animation-name: ft-shell; }
.ft-demo .ft-inner { animation-name: ft-inner; }
.ft-demo .ft-print { animation-name: ft-print; }
.ft-demo .ft-scan-1 { animation-name: ft-scan-1; }
.ft-demo .ft-scan-2 { animation-name: ft-scan-2; }
.ft-demo .ft-scan-3 { animation-name: ft-scan-3; }
.ft-demo .ft-room { animation-name: ft-room; }
.ft-demo .ft-ruler { animation-name: ft-ruler; }
.ft-demo .ft-trace { animation-name: ft-trace; }
.ft-demo .ft-fill { animation-name: ft-fill; }
.ft-demo .ft-corners { animation-name: ft-corners; }
.ft-demo .ft-arealabel { animation-name: ft-arealabel; }
.ft-demo .ft-tick-1 { animation-name: ft-tick-1; }
.ft-demo .ft-tick-2 { animation-name: ft-tick-2; }
.ft-demo .ft-tick-3 { animation-name: ft-tick-3; }
.ft-demo .ft-total { animation-name: ft-total; }
.ft-demo .ft-step-1 { animation-name: ft-step-1; }
.ft-demo .ft-step-2 { animation-name: ft-step-2; }
.ft-demo .ft-step-3 { animation-name: ft-step-3; }
.ft-demo .ft-step-4 { animation-name: ft-step-4; }

@keyframes ft-cycle   { 0%, 94% { opacity: 1; }   98%, 100% { opacity: 0; } }
@keyframes ft-shell   { 0%, 3%  { stroke-dashoffset: 100; } 17%, 100% { stroke-dashoffset: 0; } }
@keyframes ft-inner   { 0%, 13% { stroke-dashoffset: 100; } 22%, 100% { stroke-dashoffset: 0; } }
@keyframes ft-print   { 0%, 17% { opacity: 0; } 23%, 100% { opacity: 1; } }

/* Each box reads its size, then stays as a tint: read, and still read. */
@keyframes ft-scan-1  { 0%, 24% { opacity: 0; } 27%, 30% { opacity: 1; } 33%, 52% { opacity: .4; } 56%, 100% { opacity: 0; } }
@keyframes ft-scan-2  { 0%, 30% { opacity: 0; } 33%, 36% { opacity: 1; } 39%, 52% { opacity: .4; } 56%, 100% { opacity: 0; } }
@keyframes ft-scan-3  { 0%, 36% { opacity: 0; } 39%, 42% { opacity: 1; } 45%, 52% { opacity: .4; } 56%, 100% { opacity: 0; } }

@keyframes ft-room    { 0%, 44% { opacity: 0; } 48%, 52% { opacity: 1; } 57%, 100% { opacity: 0; } }
@keyframes ft-ruler   { 0%, 47% { opacity: 0; } 51%, 100% { opacity: 1; } }

@keyframes ft-trace {
  0%, 53% { stroke-dashoffset: 100; opacity: 0; }
  54%     { stroke-dashoffset: 97;  opacity: 1; }
  69%, 100% { stroke-dashoffset: 0; opacity: 1; }
}
@keyframes ft-fill      { 0%, 64% { opacity: 0; } 72%, 100% { opacity: 1; } }
@keyframes ft-corners   { 0%, 68% { opacity: 0; } 71%, 100% { opacity: 1; } }
@keyframes ft-arealabel { 0%, 70% { opacity: 0; } 73%, 100% { opacity: 1; } }

@keyframes ft-tick-1  { 0%, 71.5% { opacity: 0; } 72%,   74.5% { opacity: 1; } 75%, 100% { opacity: 0; } }
@keyframes ft-tick-2  { 0%, 75%   { opacity: 0; } 75.5%, 77.5% { opacity: 1; } 78%, 100% { opacity: 0; } }
@keyframes ft-tick-3  { 0%, 78%   { opacity: 0; } 78.5%, 80.5% { opacity: 1; } 81%, 100% { opacity: 0; } }
@keyframes ft-total   { 0%, 81%   { opacity: 0; } 83%,   100%  { opacity: 1; } }

/* The numbers beside the picture, in time with it: each fills while the
   picture is doing that step, then stays tinted as done until the loop. */
@keyframes ft-step-1 {
  0%, 23%   { background-color: rgb(var(--panel-2)); border-color: rgb(var(--line-strong)); color: rgb(var(--fg-2)); }
  25%, 42%  { background-color: rgb(var(--accent)); border-color: rgb(var(--accent)); color: rgb(var(--accent-ink)); }
  45%, 100% { background-color: rgb(var(--accent) / .15); border-color: transparent; color: rgb(var(--accent-strong)); }
}
@keyframes ft-step-2 {
  0%, 43%   { background-color: rgb(var(--panel-2)); border-color: rgb(var(--line-strong)); color: rgb(var(--fg-2)); }
  45%, 51%  { background-color: rgb(var(--accent)); border-color: rgb(var(--accent)); color: rgb(var(--accent-ink)); }
  54%, 100% { background-color: rgb(var(--accent) / .15); border-color: transparent; color: rgb(var(--accent-strong)); }
}
@keyframes ft-step-3 {
  0%, 52%   { background-color: rgb(var(--panel-2)); border-color: rgb(var(--line-strong)); color: rgb(var(--fg-2)); }
  54%, 70%  { background-color: rgb(var(--accent)); border-color: rgb(var(--accent)); color: rgb(var(--accent-ink)); }
  73%, 100% { background-color: rgb(var(--accent) / .15); border-color: transparent; color: rgb(var(--accent-strong)); }
}
@keyframes ft-step-4 {
  0%, 71%   { background-color: rgb(var(--panel-2)); border-color: rgb(var(--line-strong)); color: rgb(var(--fg-2)); }
  73%, 81%  { background-color: rgb(var(--accent)); border-color: rgb(var(--accent)); color: rgb(var(--accent-ink)); }
  84%, 100% { background-color: rgb(var(--accent) / .15); border-color: transparent; color: rgb(var(--accent-strong)); }
}

/* Not a paused first frame — the finished picture. The scan boxes, the green
   box and the counting numbers never existed as a resting state, so they are
   the only things withheld; the step numbers rest as plain numbers. Higher
   specificity than index.css's blanket
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

/* Stacked, on the phone, the picture is the least load-bearing thing on this
   screen, so it is what gives way: it shrinks and then goes, rather than
   pushing the steps and the caveat further down a short screen. Beside the
   steps, on the desktop, it costs no height and stays. */
@media (max-width: 1023.98px) { .ft-demo .ft-plan svg { max-width: 420px; } }
@media (max-width: 819.98px) and (max-height: 780px) { .ft-demo .ft-plan svg { max-width: 300px; } }
@media (max-width: 819.98px) and (max-height: 640px) { .ft-demo .ft-plan { display: none; } }
`;

// The job as the results panel will list it, in the user's words. The titles
// are the panel's own (`progressSteps.js`); the lines under them are said only
// here, once, to someone who has not seen it happen yet.
const STEPS = [
  { title: STEP_TITLES.read.doing, line: 'The sizes printed on the plan, room by room.' },
  { title: STEP_TITLES.scale.doing, line: 'From the rooms it read, so the plan can be measured.' },
  { title: STEP_TITLES.outline.doing, line: 'It outlines the house for you, in purple, on the plan.' },
  { title: STEP_TITLES.area.doing, line: 'The gross living area, with the sum behind it.' },
];

// One building, drawn twice: ink as walls while it is being read, purple as the
// traced outline afterwards. An L, not a box — a plain rectangle reads as a
// placeholder rather than as a floorplan.
const SHELL = 'M30 34H250V140H174V197H30Z';
const PARTITIONS = 'M116 34V140M116 92H250M30 140H174M107 140V197';
const CORNERS = [[30, 34], [250, 34], [250, 140], [174, 140], [174, 197], [30, 197]];

/* The printed numbers agree with each other, which is not decoration: this is
   an appraisal tool and the one thing it must never do is show arithmetic that
   does not add up. At 4.8 units per foot the building is 46 ft across and 22 ft
   deep with a 30 × 12 ft wing — 1,012 + 360 = 1,372 ft², the figure the count
   lands on — and the three labelled rooms measure 18 × 20, 14 × 12 and 16 × 12.
   The chip says where the scale came from, as the panel will: a "1 ft = 15 px"
   here described the source image rather than this schematic, and pixels are
   the one unit no user of this app ever needs to read. */
const PipelineDemo = () => (
  <svg viewBox="0 0 300 208" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <g className="ft-a ft-cycle">
      <path className="ft-a ft-fill" d={SHELL} />

      <g className="ft-wall" fill="none" strokeLinecap="square">
        <path className="ft-a ft-draw ft-shell" d={SHELL} pathLength="100" strokeWidth="2.4" />
        <path className="ft-a ft-draw ft-inner" d={PARTITIONS} pathLength="100" strokeWidth="1.5" />
      </g>

      {/* Inside the rooms, which is where this app actually finds them — a
          printed room size, not an architect's dimension string run around the
          outside of the sheet. The boxes are under the numbers they read. */}
      <g className="ft-scan" strokeWidth="1">
        <rect className="ft-a ft-scan-1 ft-transient" x="44" y="79.5" width="58" height="16" rx="3.5" />
        <rect className="ft-a ft-scan-2 ft-transient" x="154" y="55.5" width="58" height="16" rx="3.5" />
        <rect className="ft-a ft-scan-3 ft-transient" x="39.5" y="161.5" width="58" height="16" rx="3.5" />
      </g>
      <g className="ft-a ft-print ft-label" fontSize="9.5" fontWeight="700" textAnchor="middle">
        <text x="73" y="91">18&#39; × 20&#39;</text>
        <text x="183" y="67">14&#39; × 12&#39;</text>
        <text x="68.5" y="173">16&#39; × 12&#39;</text>
      </g>

      {/* The room the scale came from: the green box the panel will explain. */}
      <rect className="ft-a ft-room ft-transient" x="33.5" y="37.5" width="79" height="99" rx="2" strokeWidth="2.2" />
      <g className="ft-a ft-ruler">
        <rect className="ft-chip" x="168" y="6" width="122" height="20" rx="5" strokeWidth="1" />
        <text className="ft-label" x="229" y="19.5" fontSize="9.5" fontWeight="700"
          textAnchor="middle">Scale from one room</text>
      </g>

      <path
        className="ft-a ft-draw ft-trace"
        d={SHELL}
        pathLength="100"
        fill="none"
        strokeWidth="3.2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <g className="ft-a ft-corners" strokeWidth="1.5">
        {CORNERS.map(([x, y]) => <circle key={`${x},${y}`} cx={x} cy={y} r="3" />)}
      </g>

      {/* In the notch of the L, beside the building rather than over its
          rooms, where it cannot sit on a label. */}
      <text className="ft-a ft-arealabel" x="236" y="166" fontSize="8.5" textAnchor="middle">
        Gross living area
      </text>
      <g className="ft-area" textAnchor="middle" fontWeight="700" fontSize="19">
        <text className="ft-a ft-tick-1 ft-transient" x="236" y="188">410 ft&#178;</text>
        <text className="ft-a ft-tick-2 ft-transient" x="236" y="188">880 ft&#178;</text>
        <text className="ft-a ft-tick-3 ft-transient" x="236" y="188">1,190 ft&#178;</text>
        <text className="ft-a ft-total" x="236" y="188">1,372 ft&#178;</text>
      </g>
    </g>
  </svg>
);

// The introduction: the four steps, and the small plan that acts them out. One card, steps on the left and the plan on the right, as the
// results and the plan will be.
const Introduction = () => (
  <section
    aria-label="How FloorTrace measures a plan"
    className="ft-demo flex flex-col lg:flex-row overflow-hidden rounded-2xl border border-line bg-panel-2 text-left"
  >
    <style>{DEMO_CSS}</style>
    <div className="lg:flex-[1_1_380px] min-w-0 flex flex-col justify-center px-7 py-6">
      <h2 className="mb-4 text-[16px] font-bold text-fg">How FloorTrace measures it</h2>
      <ol className="flex flex-col">
        {STEPS.map((step, i) => (
          <li key={step.title} className="relative flex gap-3.5 pb-5 last:pb-0">
            {i < STEPS.length - 1 && (
              <span className="absolute left-[13px] top-8 bottom-1 w-0.5 bg-line" aria-hidden="true" />
            )}
            <span
              className={`ft-a ft-step-${i + 1} grid place-items-center w-7 h-7 shrink-0 rounded-full
                          border-[1.5px] border-line-strong bg-panel-2 text-[15px] font-bold text-fg-2`}
              aria-hidden="true"
            >
              {i + 1}
            </span>
            <span className="min-w-0 pt-0.5">
              <span className="block text-[16.5px] font-bold text-fg leading-snug">{step.title}</span>
              <span className="block mt-0.5 text-[15.5px] text-fg-2 leading-snug">{step.line}</span>
            </span>
          </li>
        ))}
      </ol>
      {/* The one step that is the user's, said apart from the four that are not. */}
      <div className="mt-5 pt-4 border-t border-line">
        <p className="text-[16.5px] font-bold text-fg leading-snug">Check it and save the image</p>
        <p className="mt-0.5 text-[15.5px] text-fg-2 leading-snug">
          The plan with its square footage on it, ready for your report.
        </p>
      </div>
    </div>
    <div
      className="ft-plan lg:flex-[1.5_1_440px] min-w-0 flex items-center justify-center px-7 py-5
                 border-t border-line lg:border-t-0 lg:border-l"
      aria-hidden="true"
    >
      <PipelineDemo />
    </div>
  </section>
);

// Whether a file is being dragged over the window right now. The drop itself
// is the app root's — it accepts a file anywhere — so this only lights the
// row up, to say "yes, here".
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

// One of the ways in that is not a button: what it is, and how.
const Way = ({ icon: Icon, title, children, lit = false }) => (
  <div className="flex items-center gap-3 text-left">
    <span
      className={`grid place-items-center w-9 h-9 shrink-0 rounded-full
                  ${lit ? 'bg-accent text-accent-ink' : 'bg-accent/15 text-accent-strong'}`}
      aria-hidden="true"
    >
      {Icon && <Icon className="w-[19px] h-[19px]" strokeWidth={2.25} />}
    </span>
    <span className="min-w-0">
      <span className="block text-[16.5px] font-bold text-fg leading-snug whitespace-nowrap">{title}</span>
      <span className="flex items-center gap-1.5 text-[15px] text-fg-3 leading-snug whitespace-nowrap">
        {children}
      </span>
    </span>
  </div>
);

const Rule = () => <span className="hidden md:block w-px h-10 bg-line shrink-0" aria-hidden="true" />;

// The ways in. On touch the route in is the action bar at the bottom of the
// screen, which already carries Open and the camera, so only the sample is
// offered and there is nothing to drop onto.
const WayIn = ({ isTouch, onFileOpen, onTryExample }) => {
  const dragging = useFileDragging();

  if (isTouch) {
    return (
      <div className="text-center">
        {onTryExample && (
          <button type="button" onClick={onTryExample} className="btn btn-secondary btn-lg">
            Try the sample plan
          </button>
        )}
        <p className="mt-3 text-[16px] text-fg-2 leading-relaxed">
          Photograph a plan, or open an image, with the buttons below.
        </p>
      </div>
    );
  }

  return (
    // Narrower than the introduction under it: it is three short things, and
    // stretched to the card's width they stop reading as one row.
    <div className="mx-auto flex w-full max-w-[55rem] flex-col items-center gap-2.5">
      <div
        className={`flex w-full flex-wrap items-center justify-center gap-x-[22px] gap-y-3.5 px-6 py-4
                    rounded-2xl border-2 border-dashed transition-colors
                    ${dragging ? 'border-accent bg-accent/10' : 'border-line-strong bg-panel-2'}`}
      >
        <button type="button" onClick={onFileOpen} className="btn btn-primary h-[52px] px-6 rounded-xl text-[18px]">
          <FolderOpen className="w-5 h-5" strokeWidth={2.25} aria-hidden="true" />
          Choose a file…
        </button>
        <Rule />
        <Way icon={ArrowDownToLine} title={dragging ? 'Drop it to open it' : 'Drop a file here'} lit={dragging}>
          A picture or a PDF
        </Way>
        <Rule />
        <Way icon={Scissors} title="Paste a screenshot">
          <kbd>{SNIP}</kbd>
          <span>to snip, then</span>
          <kbd>{MOD}+V</kbd>
        </Way>
      </div>
      {onTryExample && (
        <button type="button" onClick={onTryExample} className="link-btn">
          Try the sample plan
          <ArrowRight className="w-4 h-4" strokeWidth={2.25} aria-hidden="true" />
        </button>
      )}
    </div>
  );
};

// Said before the first plan is open, not after a trace disappoints. The
// failure this app is most prone to is a wrong answer that looks confident,
// and a user who was promised "automatic" is the one least equipped to catch
// it — so "automatic" is never offered unqualified, and the way out is named.
const Caveat = () => (
  <p className="mx-auto max-w-[45rem] text-center text-[15.5px] text-fg-3 leading-relaxed">
    Works best on a clean plan with the room sizes printed on it. If the outline
    isn’t quite right, drag its corners — or paint roughly over the walls and
    FloorTrace redraws it.
  </p>
);

const WelcomeScreen = ({ isTouch, onFileOpen, onTryExample, adding = false }) => {
  const title = adding ? 'Add another plan' : 'Measure a floor plan';
  const lead = adding
    ? 'Another level, or another sheet of the same property. FloorTrace measures each plan and adds them up.'
    : 'Open a floor plan sketch and FloorTrace works out its gross living area for you.';

  const heading = (
    <div className="text-center">
      <h1 className="text-[32px] font-bold text-fg leading-tight">{title}</h1>
      <p className="mt-1.5 text-[18px] text-fg-2 leading-snug">{lead}</p>
    </div>
  );
  // The sample is for someone with no plan to hand. Offered as a second plan
  // it would be added to the property's total.
  const wayIn = (
    <WayIn isTouch={isTouch} onFileOpen={onFileOpen} onTryExample={adding ? undefined : onTryExample} />
  );
  // At a desk the ways in lead the page, above its name: the introduction
  // below is tall, and it must never stand between a user and the button. On
  // touch the way in is the bar at the bottom, so the page reads title first.
  const waysFirst = !isTouch;

  return (
    // Scrolls rather than clips: on a short window the introduction runs past
    // the bottom, and `overflow-hidden` would take the caveat away with nothing
    // on screen saying so. `touch-pan-y` is what makes that reachable at all:
    // the canvas wrapper above this sets `touch-action: none` so a drag never
    // becomes a page scroll.
    <div className="absolute inset-0 overflow-y-auto overscroll-contain touch-pan-y">
      <div className="min-h-full flex items-center justify-center px-6 py-7 lg:px-10">
        <div className="flex w-full max-w-[65rem] flex-col gap-[18px]">
          {waysFirst ? <>{wayIn}{heading}</> : <>{heading}{wayIn}</>}
          <Introduction />
          <Caveat />
        </div>
      </div>
    </div>
  );
};

export default WelcomeScreen;
