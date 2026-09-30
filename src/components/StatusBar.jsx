import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Minus, Plus, CloudOff, RefreshCw, AlertTriangle, Maximize } from 'lucide-react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { cancelActiveWork, hasStoppableWork } from '../store/documentRequests';
import { TOOL_MODES } from './toolModes';

// How long a job may run before this band admits how long it has been running.
// A trace is usually under a second and a scan is usually a few, and a counter
// that flickers up and vanishes on every one of them is noise; past this it is
// the only thing on screen that distinguishes "working" from "wedged".
const ELAPSED_AFTER_MS = 5000;

// What the draft store is actually doing, said in the user's terms. The cell
// used to render a hardcoded "Saved" — the one claim in the shell that was
// never checked against anything, and the wrong one to get wrong in an app
// whose work exists only in this browser.
const DRAFT_CELL = {
  // "Saved" rather than a sentence: it shares a band with the zoom and the
  // standing tip, and the reassurance is the word. Where it is saved is the
  // tooltip's job, and Help's.
  saved: {
    Icon: Check, tone: 'text-ok', label: 'Saved', ok: true,
    title: 'Your work is saved in this browser as you go. Export an image, or save a project file, to keep it anywhere else.',
  },
  pending: {
    Icon: RefreshCw, tone: 'text-fg-3', label: 'Saving…', ok: true,
    title: 'Saving your latest changes in this browser.',
  },
  error: {
    Icon: AlertTriangle, tone: 'text-crit', label: 'Not saved', ok: false,
    title: 'This browser would not store your work. Export an image, or save a project file, before you close the tab.',
  },
  off: {
    Icon: CloudOff, tone: 'text-warn', label: 'Autosave is off', ok: false,
    title: 'Autosave is turned off in Settings, so nothing is kept. Export an image, or save a project file, before you close the tab.',
  },
};

// The resting state. Every other mode is a `TOOL_MODES` entry; this one is not
// a tool, has nothing to cancel, and needs no name — the band says nothing about
// a mode when you are not in one. What it does say is the one thing a newcomer
// cannot find out by looking: that the outline's corners move. Short enough to
// fit beside the zoom at a 1024 px window; deleting a corner is taught on the
// Outline card and in Help.
const IDLE_HINT = 'Drag any corner to reshape the outline.';

// `grow` marks a cell whose text is expendable, and only two ever are: the mode
// name and the instruction beside it. **Everything to their right is `shrink-0`**,
// so a band under pressure gives up words and never a control — the Cancel and
// the Done are the last things that may go missing.
//
// The instruction is one slot with several claimants rather than a cell each.
// Two competing instruction cells would both truncate and neither would be
// readable, which is why the hover hint takes this cell over rather than
// claiming another. Nothing here scrolls.
const Cell = ({ children, grow = false, className = '', ...rest }) => (
  <span
    className={`inline-flex items-center gap-2 h-9 px-3 whitespace-nowrap
                border-l border-line-soft first:border-l-0
                ${grow ? 'min-w-0 shrink' : 'shrink-0'} ${className}`}
    {...rest}
  >
    {children}
  </span>
);

const ZoomButton = ({ label, onClick, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    aria-label={label}
    title={label}
    className="w-7 h-7 grid place-items-center rounded text-fg-2
               hover:bg-sunken hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent
               cursor-pointer disabled:cursor-default"
  >
    {children}
  </button>
);

/**
 * One place that always answers "what is happening, how big is the view, is my
 * work saved" — directly above the plan it describes, inset between the
 * measurement panel and the tool rail so it spans the plan and nothing else.
 *
 * **It is also the instruction bar.** While a tool runs, the band tints and
 * carries the tool's name, what to do next, its brush size and its way out.
 * That is the most important text in any correction the user makes, so it is
 * set at reading size in a 36 px band — it was 11.5 px in a 26 px strip, which
 * is where the one instruction a stuck user needs was hardest to read.
 *
 * What it no longer shows: the scale as "px/ft" — a number that means nothing
 * to anyone measuring a house, stated in plain words on the panel's Scale
 * card — and the word "Select" at rest, a mode name for not being in a mode.
 *
 * The tool the pointer is resting on (`toolHint`, written by the rail) takes the
 * hint cell, and renders **outside** the live region below — `aria-atomic`
 * re-announces the whole region on any change, so a pointer crossing twelve rail
 * buttons would fire two dozen announcements. The rail's own `aria-describedby`
 * says the same thing to a screen reader, once, on focus. The corner count is
 * outside it for the same reason: it changes on every click.
 */
const StatusBar = ({
  tool,
  count = 0,
  brushSize,
  onBrushSizeChange,
  onCancel,
  onDone,
  onZoomIn,
  onZoomOut,
  onFitToWindow,
  hasImage,
  onExport,
}) => {
  const zoomScale = useAppStore((s) => s.zoomScale);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const draftState = useAppStore((s) => s.draftState);
  // The resting tip is about the outline's corners, so it waits for one.
  const hasOutline = useAppStore((s) => (s.perimeterTraces ?? []).some((t) => t.vertices?.length >= 3));
  const toolHint = useWorkspaceStore((s) => s.toolHint);

  // Low-stakes confirmations land here rather than as a toast over the plan.
  const flash = useWorkspaceStore((s) => s.statusFlash);
  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return;
    setShownFlash(flash.text);
    const t = setTimeout(() => setShownFlash(null), 3200);
    return () => clearTimeout(t);
  }, [flash]);

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
    const { count } = cancelActiveWork();
    if (count) useWorkspaceStore.getState().flashStatus('Stopped — nothing was changed');
  }, []);

  const showElapsed = isProcessing && elapsedMs >= ELAPSED_AFTER_MS;

  const mode = TOOL_MODES[tool];
  const running = !!mode;
  const hint = running ? mode.hint : (hasOutline ? IDLE_HINT : null);
  const zoomPct = zoomScale > 0 ? Math.round(zoomScale * 100) : 100;

  const draft = DRAFT_CELL[draftState] ?? DRAFT_CELL.off;
  const showDraft = hasImage && (!running || !draft.ok);
  const tinted = running || isProcessing;

  return (
    // `status-band` is the query container; the row inside it wraps onto a
    // second line only while a tool runs in a narrow band (see index.css).
    <div className="status-band w-full min-w-0 shrink-0">
    <div className={`status-row flex items-center w-full min-w-0 min-h-9
                     text-[13px] text-fg-3 select-none
                     ${running ? 'status-row-running' : 'h-9 overflow-hidden'}
                     ${tinted ? 'bg-accent/10 border-b border-accent/40' : 'bg-panel border-b border-line-soft'}`}>
      {/* The lead: what is happening and what to do about it. It takes the
          room left by the controls in one row, and a row of its own when the
          band is too narrow for both. */}
      <div className="status-lead flex items-center flex-1 min-w-0">
      {/* The one live region in the app. Acknowledgements moved off toasts and
          into `flash`, and sonner announces its own toasts but this channel had
          nothing — so confirmation of a user's own action was the one thing a
          screen-reader user could not hear. `polite` so it waits its turn
          rather than cutting across whatever is being read. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="contents">
        {isProcessing ? (
          <Cell className="text-accent-strong font-semibold">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
            {processingMessage || 'Working…'}
          </Cell>
        ) : running && (
          // The name shrinks before anything on the right of the band does;
          // the icon and the tint still say which mode this is when the words
          // run out.
          <Cell grow className="text-accent-strong font-semibold">
            <mode.icon className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 truncate">{mode.name}</span>
          </Cell>
        )}

        {shownFlash && <Cell className="text-ok font-semibold">{shownFlash}</Cell>}
      </div>

      {/* How long this has been going, and the way out of it — deliberately
          *outside* the live region above: that region is `aria-atomic`, so a
          number changing every second would re-announce the whole band once a
          second for as long as the job runs.

          Both appear only after five seconds. A trace that returns in 300 ms
          would otherwise flash a counter and a button through the band. Past
          five seconds it is the opposite: with no elapsed time and no control,
          a 30 s trace and a hung one are the same screen. */}
      {showElapsed && (
        <Cell className="text-fg-3">
          <span className="tabular-nums" aria-live="off">
            {Math.round(elapsedMs / 1000)}s
          </span>
          {cancellable && (
            <button
              type="button"
              onClick={handleStop}
              title="Stop this and leave the plan as it is"
              className="btn btn-secondary h-7 px-2.5 text-[13px]"
            >
              Stop
            </button>
          )}
        </Cell>
      )}

      {/* One cell, three claimants, in this order: a flash the user just earned
          beats a tool they are only pointing at, and both beat the standing
          instruction. Working… suppresses all three — the progress message is
          already saying what is happening. */}
      {!isProcessing && !shownFlash && (toolHint ? (
        <Cell grow aria-hidden="true">
          <b className="shrink-0 font-semibold text-fg-2">{toolHint.name}</b>
          {toolHint.detail && <span className="min-w-0 truncate">{toolHint.detail}</span>}
          {toolHint.digit && (
            <kbd className="shrink-0 px-1.5 text-[11.5px] border border-line rounded text-fg-3">
              {toolHint.digit}
            </kbd>
          )}
        </Cell>
      ) : hasImage && hint && (
        <Cell grow className={`status-hint ${running ? 'text-fg' : ''}`}>
          <span className="min-w-0 truncate">{hint}</span>
        </Cell>
      ))}
      </div>

      {running && count > 0 && (
        <Cell className="tabular-nums text-fg-2">
          {count} {count === 1 ? 'corner' : 'corners'}
        </Cell>
      )}

      {running && mode.brush && (
        <Cell>
          <label className="inline-flex items-center gap-2 text-fg-2">
            <span className="status-optional">Brush size</span>
            <input
              type="range"
              aria-label="Brush size"
              min={mode.brush === 'draw' ? 8 : 4}
              max={mode.brush === 'draw' ? 400 : 200}
              step={mode.brush === 'draw' ? 6 : 4}
              value={brushSize}
              onChange={(e) => onBrushSizeChange(Number(e.target.value))}
              className="w-24 h-4 accent-accent cursor-pointer"
            />
          </label>
        </Cell>
      )}

      {!running && hasImage && (
        <Cell className="gap-1">
          <ZoomButton label="Zoom out" onClick={onZoomOut} disabled={!hasImage}>
            <Minus className="w-3.5 h-3.5" aria-hidden="true" />
          </ZoomButton>
          <span className="tabular-nums text-fg-2 min-w-[44px] text-center">{zoomPct}%</span>
          <ZoomButton label="Zoom in" onClick={onZoomIn} disabled={!hasImage}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
          </ZoomButton>
          {onFitToWindow && (
            <button
              type="button"
              onClick={onFitToWindow}
              title="Fit the whole plan in the window (F)"
              className="ml-1 inline-flex items-center gap-1.5 h-7 px-2 rounded text-fg-2
                         hover:bg-sunken hover:text-fg cursor-pointer"
            >
              <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
              Fit
            </button>
          )}
        </Cell>
      )}

      {showDraft && (
        <Cell className="text-fg-3">
          {/* Clickable, because every one of these states resolves the same
              way: take the work out of the browser. */}
          <button
            type="button"
            onClick={onExport}
            title={`${draft.title} Click to export.`}
            className="inline-flex items-center gap-1.5 hover:text-fg
                       transition-colors cursor-pointer"
          >
            <draft.Icon
              className={`w-3.5 h-3.5 ${draft.tone} ${draftState === 'pending' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {draft.label}
          </button>
        </Cell>
      )}

      {/* The way out, last, where the eye ends up — and the only two controls
          in this band that are not always here, so they never move the rest. */}
      {running && (
        <Cell className="gap-2 ml-auto">
          <button
            type="button"
            onClick={onCancel}
            className="btn btn-secondary h-7 px-3 text-[13px]"
          >
            Cancel
            <kbd className="status-optional text-[11.5px] opacity-70">Esc</kbd>
          </button>

          {onDone && mode.doneLabel && (
            <button
              type="button"
              onClick={onDone}
              className="btn btn-primary h-7 px-3 text-[13px]"
            >
              {mode.doneLabel}
              {mode.doneKey && <kbd className="status-optional text-[11.5px] opacity-80">{mode.doneKey}</kbd>}
            </button>
          )}
        </Cell>
      )}
    </div>
    </div>
  );
};

export default StatusBar;
