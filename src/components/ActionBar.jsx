import { useState, useEffect, useCallback } from 'react';
import { Loader2, PanelLeftOpen, X } from 'lucide-react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { cancelActiveWork, hasStoppableWork } from '../store/documentRequests';
import { MAX_TRACES, alternativeCount as countAlternatives } from '../utils/planStage';
import { TOOL_MODES } from './toolModes';
import { TOOL_GROUPS } from './toolCatalog';
import { Menu, MenuItem, MenuSep } from './Menu';

/**
 * The one strip above the plan: what you can do to it, and — while you are
 * doing something — what to do next.
 *
 *   at rest   [ Outline ▾ ][ Measure ▾ ][ Edit plan ▾ ]   tip
 *   in a tool   Painting the outline — paint roughly over…   brush  Cancel  Done
 *
 * ## What it replaces
 *
 * Two bands. A **tool rail** down the right of the plan — ten icons with a word
 * under each, whose meaning lived in a tooltip — and a **status band** that
 * turned into the instruction bar when a tool ran. The same corrections were
 * also buttons on the panel, under different names. A first-time user met
 * "Paint", "Corners", "Cut out", "Scale", "Measure", "Area", "Crop", "Erase"
 * and "More" before they had been told what any of them was for.
 *
 * Now the bar says three things, in the order a person runs into them: the
 * *outline* is wrong, I want to *measure* something, the *plan* needs tidying.
 * Each is a menu whose rows have a name and a sentence (`toolCatalog.js`), so
 * nothing has to be learned from an icon and nothing is on screen until it is
 * asked for. The fourth thing — the *scale* is wrong — is not here: the scale
 * is a number rather than a drawing, and it is corrected on the panel, beside
 * where it is stated.
 *
 * ## One bar, two states
 *
 * Picking a tool turns the whole bar into that tool's instruction: its name,
 * what to do, its brush, and its way out. The menus stand down — a tool is a
 * mode, and the only two things that matter in one are what it wants and how to
 * leave. That instruction is the most important text in any correction the
 * user makes, so it is set at reading size in a 48 px bar.
 *
 * ## What gives way when the bar is narrow
 *
 * Words, never controls. Everything in `.action-lead` truncates and the lead
 * clips; Stop, Cancel and Done live outside it, so a long message can never
 * paint over the button that ends it. Under 640 px (a container query — the
 * bar's width is the window less a panel that may be open) a running tool's
 * instruction takes a row of its own and wraps, and the brush's word label and
 * the key hints drop. At rest the tip stands down before the menus do.
 *
 * ## The one line the app speaks in
 *
 * Whatever just happened to the plan is said here, as a flash, and nowhere
 * else: green when it was done ("Outline found", "Area copied"), amber when it
 * was not and why ("An outline needs at least three corners"). There is no
 * pop-up for any of it. A whole automatic run — read the sizes, work out the
 * scale, find the outline — ends in exactly one such line, where it used to
 * end in up to three toasts over the plan (`utils/notify.js`).
 *
 * This is the one place a screen reader hears it. The corner count and the
 * elapsed seconds are deliberately **outside** the live region: it is
 * `aria-atomic`, so a number changing on every click, or once a second, would
 * re-announce the whole bar each time.
 *
 * A flash is shown only for what is left of its window, so one raised while
 * the bar was off screen is not replayed when it returns. An amber one stays
 * longer than a green one: it has to be read, not just noticed.
 *
 * ## The offer
 *
 * After the plan's image has been edited — marks erased, or cropped to the
 * house — the bar at rest offers to find the outline again, because that is
 * nearly always why the image was edited. It is an offer and not an action:
 * the outline on the plan may have been adjusted by hand, and re-tracing over
 * it unasked would throw that away. It stands until it is taken, dismissed, or
 * a trace runs for any other reason.
 *
 * Commands that start work (find the outline, the next-best outline) wait for a
 * running job; tools do not — entering a mode changes nothing the job was
 * computed from. The scale is never stated in pixels here.
 */

// How long a flash stays in the bar. A refusal has to be read; a confirmation
// only has to be noticed.
const FLASH_MS = { ok: 3200, warn: 6000 };

// How long a job may run before the bar admits how long it has been running.
// A trace is usually under a second and a scan is usually a few, and a counter
// that flickers up and vanishes on every one of them is noise; past this it is
// the only thing on screen that distinguishes "working" from "wedged".
const ELAPSED_AFTER_MS = 5000;

// What the bar says at rest: the two things a newcomer cannot find out by
// looking — that the outline's corners move, and where redrawing it lives. It
// is the standing answer to "the outline is not right", said once and calmly
// rather than as a warning about each trace.
const IDLE_TIP = 'Outline not right? Drag any corner, or redraw it from the Outline menu.';

const BUSY_REASON = 'Wait until FloorTrace has finished what it is doing.';

// A leading, trailing or doubled rule is what a menu looks like after one of
// its rows has stood down.
const tidy = (rows) => {
  const out = [];
  for (const row of rows) {
    if (row === '-' && (out.length === 0 || out[out.length - 1] === '-')) continue;
    out.push(row);
  }
  while (out[out.length - 1] === '-') out.pop();
  return out;
};

const TaskMenu = ({ group, rowState, onSelect }) => {
  const byId = new Map([...group.tools, ...(group.commands ?? [])].map((entry) => [entry.id, entry]));
  const rows = tidy(group.menu
    .map((id) => (id === '-' ? '-' : { entry: byId.get(id), state: rowState(byId.get(id)) }))
    .filter((row) => row === '-' || (row.entry && row.state)));

  return (
    <Menu id={group.id} group="bar" label={group.title} icon={group.icon} title={group.hint}>
      {rows.map((row, i) => (row === '-'
        ? <MenuSep key={`rule-${i}`} />
        : (
          <MenuItem
            key={row.entry.id}
            icon={row.entry.icon}
            label={row.state.label ?? row.entry.label}
            description={row.state.disabled ? (row.state.reason ?? row.entry.hint) : row.entry.hint}
            keys={row.entry.digit ?? row.entry.keys}
            disabled={row.state.disabled}
            danger={row.entry.danger}
            onSelect={() => onSelect(row.entry.id)}
          />
        )))}
    </Menu>
  );
};

const ActionBar = ({
  tool,
  count = 0,
  brushSize,
  onBrushSizeChange,
  onCancel,
  onDone,
  hasArea = false,
  hasToolData = false,
  onSelect,
  // The results panel can be put away; while it is, the way back sits here.
  panelOpen = true,
  onShowPanel,
}) => {
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const painting = useAppStore((s) => s.drawModeActive);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const retraceOfferFor = useWorkspaceStore((s) => s.retraceOfferFor);
  const setRetraceOfferFor = useWorkspaceStore((s) => s.setRetraceOfferFor);

  const traces = perimeterTraces ?? [];
  const tracedCount = traces.filter((t) => t.vertices?.length >= 3).length;
  const alternatives = countAlternatives(traces, activeTraceId);

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
  const hint = running ? mode.hint : (tracedCount > 0 ? IDLE_TIP : null);
  // Only at rest, and only for the plan it was raised on: a tool's instruction
  // and a running job both outrank it.
  const offerRetrace = !running && !isProcessing && tracedCount > 0
    && retraceOfferFor != null && retraceOfferFor === activeDocumentId;

  // What each row of the menus is allowed to do right now: `null` to stand
  // down, otherwise whether it is usable and, when it is not, why.
  const rowState = (entry) => {
    if (!entry) return null;
    switch (entry.id) {
      case 'alternative':
        if (!alternatives) return null;
        return {
          label: alternatives > 1 ? `Try another outline (${alternatives} more)` : entry.label,
          disabled: isProcessing || painting,
          reason: BUSY_REASON,
        };
      case 'findOutline':
        return {
          label: tracedCount > 0 ? entry.label : 'Find the outline',
          disabled: isProcessing || painting,
          reason: BUSY_REASON,
        };
      case 'addOutline':
        if (tracedCount === 0) {
          return { disabled: true, reason: 'Draw the first outline before adding another.' };
        }
        return traces.length >= MAX_TRACES
          ? { disabled: true, reason: `${MAX_TRACES} outlines is the most one plan can have.` }
          : { disabled: false };
      case 'clearMeasurements':
        return hasToolData ? { disabled: false } : null;
      default:
        return { disabled: !!entry.needsArea && !hasArea, reason: entry.needsArea };
    }
  };

  return (
    // `action-bar` is the query container; the row inside it wraps onto a
    // second line only while a tool runs in a narrow bar (see index.css).
    <div className="action-bar w-full min-w-0 shrink-0">
      <div className={`flex items-center gap-1 w-full min-w-0 min-h-[48px] px-2 py-1.5
                       text-[14px] select-none border-b
                       ${running ? 'action-row-running' : 'action-row-idle'}
                       ${tinted ? 'bg-accent/10 border-accent/40' : 'bg-panel border-line-soft'}`}>
        {!running && (
          <>
            {!panelOpen && onShowPanel && (
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
            <div role="toolbar" aria-label="Tools" className="flex items-center gap-0.5 shrink-0">
              {TOOL_GROUPS.filter((group) => group.menu).map((group) => (
                <TaskMenu key={group.id} group={group} rowState={rowState} onSelect={onSelect} />
              ))}
            </div>
          </>
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

          {/* One slot, in this order: Working… says what is happening, a flash
              the user just earned beats an offer, and an offer beats the
              standing instruction. */}
          {!isProcessing && !shownFlash && offerRetrace && (
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="action-tip min-w-0 truncate text-fg-2">The plan has changed.</span>
              <button
                type="button"
                onClick={() => onSelect('findOutline')}
                className="btn btn-secondary btn-sm shrink-0"
              >
                Find the outline again
              </button>
              <button
                type="button"
                onClick={() => setRetraceOfferFor(null)}
                aria-label="Keep the outline as it is"
                title="Keep the outline as it is"
                className="icon-btn h-8 w-8 shrink-0"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </span>
          )}
          {!isProcessing && !shownFlash && !offerRetrace && hint && (
            <span className={`action-hint inline-flex min-w-0 shrink-[99] whitespace-nowrap
                              ${running ? 'text-fg' : 'action-tip text-fg-3'}`}>
              <span className="min-w-0 truncate">{hint}</span>
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

        {running && count > 0 && (
          <span className="shrink-0 px-1 tabular-nums text-fg-2">
            {count} {count === 1 ? 'corner' : 'corners'}
          </span>
        )}

        {running && mode.brush && (
          <label className="inline-flex items-center gap-2 shrink-0 px-1 text-fg-2">
            <span className="action-optional">Brush size</span>
            <input
              type="range"
              aria-label="Brush size"
              min={mode.brush === 'draw' ? 8 : 4}
              max={mode.brush === 'draw' ? 400 : 200}
              step={mode.brush === 'draw' ? 6 : 4}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(Number(e.target.value))}
              className="w-28 h-4 accent-accent cursor-pointer"
            />
          </label>
        )}

        {/* The way out, last, where the eye ends up. A tool with nothing to
            commit is left with "Done" — its one button, so it is the filled
            one; every other tool is left with Cancel beside what it commits. */}
        {running && (
          <span className="inline-flex items-center gap-2 shrink-0 ml-auto pl-1">
            {mode.leaveLabel ? (
              <button type="button" onClick={onCancel} className="btn btn-primary btn-sm">
                {mode.leaveLabel}
                <kbd className="action-optional border-accent-ink/30 bg-transparent text-accent-ink">Esc</kbd>
              </button>
            ) : (
              <button type="button" onClick={onCancel} className="btn btn-secondary btn-sm">
                Cancel
                <kbd className="action-optional">Esc</kbd>
              </button>
            )}

            {onDone && mode.doneLabel && (
              <button type="button" onClick={onDone} className="btn btn-primary btn-sm">
                {mode.doneLabel}
                {mode.doneKey && (
                  <kbd className="action-optional border-accent-ink/30 bg-transparent text-accent-ink">
                    {mode.doneKey}
                  </kbd>
                )}
              </button>
            )}
          </span>
        )}
      </div>
    </div>
  );
};

export default ActionBar;
