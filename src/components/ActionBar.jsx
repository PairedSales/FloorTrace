import { useState, useEffect, useCallback } from 'react';
import { Loader2, PanelLeftOpen, Shuffle } from 'lucide-react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { cancelActiveWork, hasStoppableWork } from '../store/documentRequests';
import { alternativeCount as countAlternatives } from '../utils/planStage';
import { TOOL_MODES } from './toolModes';

/**
 * The one strip above the plan: what FloorTrace is doing, what it just did,
 * and — while the scale is being set by hand — what to do next.
 *
 *   at rest       Outline found — garage left out            [ Try another outline ]
 *   working       ◌ Finding the outline…                                 12s  Stop
 *   in a mode     Setting the scale — click both ends of…                    Done
 *
 * ## What it replaces
 *
 * Three menus of tools — Outline, Measure, Edit plan — for drawing and
 * correcting the outline by hand, measuring on the plan and editing its image.
 * FloorTrace traces the plan itself, and the tools went so that there is
 * nothing to learn before the answer: the bar now says things and offers one.
 *
 * ## The one thing it offers
 *
 * **Try another outline**, listed only while the search left a runner-up for
 * the outline on the plan. The commonest wrong outline is a tie-break between
 * two near-equal candidates, and the other one is already computed.
 *
 * ## Modes
 *
 * Two are left, both about the scale and both started from the panel's Scale
 * section: setting it from a known length, and choosing the room to take it
 * from. While one is on the bar is its instruction and its way out
 * (`toolModes.js`).
 *
 * ## What gives way when the bar is narrow
 *
 * Words, never controls. Everything in `.action-lead` truncates and the lead
 * clips; Stop and Done live outside it, so a long message can never paint over
 * the button that ends it. Under 640 px (a container query — the bar's width
 * is the window less a panel that may be open) a mode's instruction takes a row
 * of its own and wraps, and the key hints drop.
 *
 * ## The one line the app speaks in
 *
 * Whatever just happened to the plan is said here, as a flash, and nowhere
 * else: green when it was done ("Outline found", "Area copied"), amber when it
 * was not and why. There is no pop-up for any of it. A whole automatic run —
 * read the sizes, work out the scale, find the outline — ends in exactly one
 * such line (`utils/notify.js`).
 *
 * This is the one place a screen reader hears it. The elapsed seconds are
 * deliberately **outside** the live region: it is `aria-atomic`, so a number
 * changing once a second would re-announce the whole bar each time.
 *
 * A flash is shown only for what is left of its window, so one raised while
 * the bar was off screen is not replayed when it returns. An amber one stays
 * longer than a green one: it has to be read, not just noticed.
 *
 * The scale is never stated in pixels here.
 */

// How long a flash stays in the bar. A refusal has to be read; a confirmation
// only has to be noticed.
const FLASH_MS = { ok: 3200, warn: 6000 };

// How long a job may run before the bar admits how long it has been running.
// A trace is usually under a second and a scan is usually a few, and a counter
// that flickers up and vanishes on every one of them is noise; past this it is
// the only thing on screen that distinguishes "working" from "wedged".
const ELAPSED_AFTER_MS = 5000;

const ActionBar = ({
  tool,
  onCancel,
  onUseAlternative,
  // The results panel can be put away; while it is, the way back sits here.
  panelOpen = true,
  onShowPanel,
}) => {
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const activeTraceId = useAppStore((s) => s.activeTraceId);

  const alternatives = countAlternatives(perimeterTraces ?? [], activeTraceId);

  // What just happened to the plan lands here rather than over it.
  const flash = useWorkspaceStore((s) => s.statusFlash);
  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return undefined;
    // Only for what is left of its window. The bar is not always on screen —
    // closing the last plan takes it away, and that close is itself a flash —
    // so on mount the store can hold a message from before the bar existed,
    // which would otherwise be shown and announced over the next plan.
    const left = (FLASH_MS[flash.tone] ?? FLASH_MS.ok) - (Date.now() - (flash.at ?? 0));
    if (left <= 0) {
      setShownFlash(null);
      return undefined;
    }
    setShownFlash(flash);
    const t = setTimeout(() => setShownFlash(null), left);
    return () => clearTimeout(t);
  }, [flash]);

  // A job starting ends whatever the last one ended on: "Finding the outline…"
  // beside "Outline found" is two answers to one question. For good, not only
  // while the job runs — a run is several jobs back to back, and the old line
  // came back in the gap between two of them. Anything said once a job is
  // under way ("Still working, try that again") is a new flash and still shows.
  //
  // Done while rendering rather than in an effect: an effect runs after the
  // paint, and the live region would have announced the stale line first.
  const [wasProcessing, setWasProcessing] = useState(isProcessing);
  if (isProcessing !== wasProcessing) {
    setWasProcessing(isProcessing);
    if (isProcessing && shownFlash) setShownFlash(null);
  }

  // How long the running job has been running, and whether anything owns it.
  //
  // Both are polled on the same one-second tick rather than subscribed to:
  // elapsed time is not state anyone stores, and the work registry lives outside
  // the store. The tick only exists while `isProcessing` is true, so an idle app
  // pays nothing.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [cancellable, setCancellable] = useState(false);
  useEffect(() => {
    if (!isProcessing) {
      setElapsedMs(0);
      setCancellable(false);
      return undefined;
    }
    const startedAt = Date.now();
    const tick = () => {
      setElapsedMs(Date.now() - startedAt);
      // Only work that can really be stopped gets a Stop. A project save, a
      // PDF render and an OCR scan cannot be, and a button that leaves the
      // spinner turning is a worse answer than no button.
      setCancellable(hasStoppableWork());
    };
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [isProcessing]);

  const handleStop = useCallback(() => {
    const { count: stopped } = cancelActiveWork();
    if (stopped) useWorkspaceStore.getState().flashStatus('Stopped — nothing was changed');
  }, []);

  const showElapsed = isProcessing && elapsedMs >= ELAPSED_AFTER_MS;

  const mode = TOOL_MODES[tool];
  const running = !!mode;
  const tinted = running || isProcessing;

  return (
    // `action-bar` is the query container; the row inside it wraps onto a
    // second line only while a mode is on in a narrow bar (see index.css).
    <div className="action-bar w-full min-w-0 shrink-0">
      <div className={`flex items-center gap-1 w-full min-w-0 min-h-[48px] px-2 py-1.5
                       text-[14px] select-none border-b
                       ${running ? 'action-row-running' : 'action-row-idle'}
                       ${tinted ? 'bg-accent/10 border-accent/40' : 'bg-panel border-line-soft'}`}>
        {!running && !panelOpen && onShowPanel && (
          <button
            type="button"
            onClick={onShowPanel}
            className="btn btn-quiet btn-sm shrink-0"
            title="Show the area and its details again (O)"
          >
            <PanelLeftOpen className="w-[18px] h-[18px]" aria-hidden="true" />
            Show results
          </button>
        )}

        {/* The lead: what is happening and what to do about it. It takes the
            room the controls leave, and its words give way before any control
            does: every cell in it truncates, and it clips rather than painting
            over the buttons beside it. */}
        <div className="action-lead flex items-center gap-3 flex-1 min-w-0 overflow-hidden px-2">
          {/* The one live region on the desktop. `polite` so it waits its turn
              rather than cutting across whatever is being read. */}
          <div role="status" aria-live="polite" aria-atomic="true" className="contents">
            {isProcessing ? (
              <span className="inline-flex items-center gap-2 min-w-0 font-semibold text-accent-strong">
                <Loader2 className="w-[18px] h-[18px] animate-spin shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{processingMessage || 'Working…'}</span>
              </span>
            ) : running && (
              // The name gives way only after the instruction beside it has
              // (see `shrink-[99]` below), and before anything on the right of
              // the bar does; the icon and the tint still say which mode this
              // is when the words run out.
              <span className="inline-flex items-center gap-2 min-w-0 font-semibold text-accent-strong">
                <mode.icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{mode.name}</span>
              </span>
            )}

            {shownFlash && (
              // The whole sentence is in `title` too: the bar is one line, and
              // a refusal that ran out of room must still be readable.
              <span
                title={shownFlash.text}
                className={`min-w-0 truncate font-semibold
                            ${shownFlash.tone === 'warn' ? 'text-warn' : 'text-ok'}`}
              >
                {shownFlash.text}
              </span>
            )}
          </div>

          {!isProcessing && !shownFlash && running && (
            <span className="action-hint inline-flex min-w-0 shrink-[99] whitespace-nowrap text-fg">
              <span className="min-w-0 truncate">{mode.hint}</span>
            </span>
          )}
        </div>

        {/* How long this has been going, and the way out of it. Both appear
            only after five seconds: a trace that returns in 300 ms would
            otherwise flash a counter and a button through the bar. Past five
            seconds it is the opposite — with no elapsed time and no control, a
            30 s trace and a hung one are the same screen. */}
        {showElapsed && (
          <span className="inline-flex items-center gap-2 shrink-0 px-1 text-fg-3">
            <span className="tabular-nums" aria-live="off">
              {Math.round(elapsedMs / 1000)}s
            </span>
            {cancellable && (
              <button
                type="button"
                onClick={handleStop}
                title="Stop this and leave the plan as it is"
                className="btn btn-secondary btn-sm"
              >
                Stop
              </button>
            )}
          </span>
        )}

        {/* The runner-up outlines the search already scored. Not while a job
            runs: swapping the outline under a trace in flight would be undone
            by the trace landing. */}
        {!running && !isProcessing && alternatives > 0 && onUseAlternative && (
          <button
            type="button"
            onClick={onUseAlternative}
            title="FloorTrace found more than one possible outline; this swaps in the next one"
            className="btn btn-secondary btn-sm shrink-0 ml-auto"
          >
            <Shuffle className="w-4 h-4" aria-hidden="true" />
            {alternatives > 1 ? `Try another outline (${alternatives} more)` : 'Try another outline'}
          </button>
        )}

        {/* The way out of a mode, last, where the eye ends up. Neither mode has
            anything to commit — a length lands when it is typed, a room when it
            is clicked — so there is one button, and it is called Done. */}
        {running && (
          <span className="inline-flex items-center gap-2 shrink-0 ml-auto pl-1">
            <button type="button" onClick={onCancel} className="btn btn-primary btn-sm">
              Done
              <kbd className="action-optional border-accent-ink/30 bg-transparent text-accent-ink">Esc</kbd>
            </button>
          </span>
        )}
      </div>
    </div>
  );
};

export default ActionBar;
