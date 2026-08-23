import { useState, useEffect, useCallback } from 'react';
import { Check, Loader2, Minus, Plus, CloudOff, RefreshCw, AlertTriangle } from 'lucide-react';
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
  saved: {
    Icon: Check, tone: 'text-ok', label: 'Draft saved', ok: true,
    title: 'Your work is kept in this browser. Export an image, or save a project file, to keep it anywhere else.',
  },
  pending: {
    Icon: RefreshCw, tone: 'text-fg-3', label: 'Saving draft…', ok: true,
    title: 'Writing the latest changes to this browser’s storage.',
  },
  error: {
    Icon: AlertTriangle, tone: 'text-crit', label: 'Draft not saved', ok: false,
    title: 'This browser refused to store the draft. Export an image, or save a project file, before you close the tab.',
  },
  off: {
    Icon: CloudOff, tone: 'text-warn', label: 'Not kept', ok: false,
    title: '“Save work on exit” is off, so nothing is stored. Export an image, or save a project file, before you close the tab.',
  },
};

// The resting state. Every other mode is a `TOOL_MODES` entry; this one is not
// a tool, has nothing to cancel and no instruction beyond "you can drag things",
// so it is deliberately not in that table — `MobileToolContext` reads the same
// table and treats a miss as "no mode is running".
const IDLE = { name: 'Select', hint: 'Drag a corner to adjust an outline' };

// `grow` marks a cell whose text is expendable, and only two ever are: the mode
// name and the instruction beside it. **Everything to their right is `shrink-0`**,
// so a band under pressure gives up words and never a control — the Cancel and
// the Done are the last things that may go missing.
//
// The instruction is one slot with several claimants rather than a cell each.
// Two competing instruction cells would both truncate and neither would be
// readable, which is why the hover hint takes this cell over rather than
// claiming another.
//
// Nothing here scrolls. The band is 26 px and a horizontal scrollbar would eat
// it — and inset between the dock and the tool rail it has *less* room than it
// did in the menu bar, not more.
const Cell = ({ children, grow = false, className = '', ...rest }) => (
  <span
    className={`inline-flex items-center gap-1.5 h-[26px] px-2.5 whitespace-nowrap
                border-l border-line-soft first:border-l-0
                ${grow ? 'min-w-0 shrink' : 'shrink-0'} ${className}`}
    {...rest}
  >
    {children}
  </span>
);

/**
 * The desktop convention the app was missing entirely: one place that always
 * answers "what mode am I in, how big is the view, what scale is in force,
 * is my work saved". Before this, mode lived only in eight `duration: Infinity`
 * toasts over the canvas and zoom was not displayed anywhere at all.
 *
 * It is a band of its own, directly under the tab strip and directly above the
 * plan it describes — inset between the measurement dock and the tool rail, so
 * it spans the plan and nothing else.
 *
 * **It is also the context bar.** A running tool used to get a second 36 px band
 * of its own under the command bar, which said the same thing twice in different
 * words: "Select room / Click a dimension label to use that room" sat two rows
 * above "Choosing a room / Click a dimension label to measure that room and take
 * the scale from it". One bar states the mode now, in the `TOOL_MODES` copy,
 * and carries that mode's brush size and its way out. Two consequences:
 *
 *  - **The standing cells stand down while a tool runs.** Scale, zoom and a
 *    healthy draft are facts you read between actions, and they cannot share
 *    452 px — the narrowest this band ever is — with an instruction, a brush
 *    slider and two buttons. A draft that is *not* being kept still shows,
 *    because that one is a warning rather than a fact.
 *  - **The band tints `accent` while a tool is running**, which is what the
 *    separate bar was really for: at a glance, the app is in a mode.
 *
 * The tool the pointer is resting on (`toolHint`, written by the rail) takes the
 * hint cell, and renders **outside** the live region below — `aria-atomic`
 * re-announces the whole region on any change, so a pointer crossing twelve rail
 * buttons would fire two dozen announcements. The rail's own `aria-describedby`
 * says the same thing to a screen reader, once, on focus. The vertex count is
 * outside it for the same reason: it changes on every click.
 *
 * Live cursor coordinates are deliberately absent. `currentMousePos` is local
 * state inside useToolRouter, and lifting it here would put a store write on
 * every mousemove — a 60 Hz re-render of the whole shell to display a number
 * nobody is reading while they drag.
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
  hasImage,
  onExport,
}) => {
  const zoomScale = useAppStore((s) => s.zoomScale);
  const calibration = useAppStore((s) => s.calibration);
  const isProcessing = useAppStore((s) => s.isProcessing);
  const processingMessage = useAppStore((s) => s.processingMessage);
  const draftState = useAppStore((s) => s.draftState);
  const toolHint = useWorkspaceStore((s) => s.toolHint);

  // Low-stakes confirmations land here rather than as a toast over the plan.
  const flash = useWorkspaceStore((s) => s.statusFlash);
  const [shownFlash, setShownFlash] = useState(null);
  useEffect(() => {
    if (!flash) return;
    setShownFlash(flash.text);
    const t = setTimeout(() => setShownFlash(null), 2600);
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
  const { Icon, name, hint } = running
    ? { Icon: mode.icon, name: mode.name, hint: mode.hint }
    : { Icon: null, name: IDLE.name, hint: IDLE.hint };

  const fpp = calibration?.feetPerPixel;
  const pxPerFoot = calibration?.calibrated && fpp?.x > 0 && fpp?.y > 0
    ? { x: 1 / fpp.x, y: 1 / fpp.y }
    : null;
  const anisotropic = pxPerFoot && Math.abs(pxPerFoot.x - pxPerFoot.y) > 1e-6;
  const zoomPct = zoomScale > 0 ? Math.round(zoomScale * 100) : 100;

  const draft = DRAFT_CELL[draftState] ?? DRAFT_CELL.off;
  const showDraft = hasImage && (!running || !draft.ok);

  return (
    <div className={`flex items-center w-full min-w-0 h-[26px] shrink-0 overflow-hidden
                     text-[11.5px] text-fg-3 select-none
                     ${running ? 'bg-accent/10 border-b border-accent/40' : 'bg-panel border-b border-line-soft'}`}>
      {/* The one live region in the app. Acknowledgements moved off toasts and
          into `flash`, and sonner announces its own toasts but this channel had
          nothing — so confirmation of a user's own action was the one thing a
          screen-reader user could not hear. `polite` so it waits its turn
          rather than cutting across whatever is being read. */}
      <div role="status" aria-live="polite" aria-atomic="true" className="contents">
        {isProcessing ? (
          <Cell className="text-accent-strong font-semibold">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
            {processingMessage || 'Working…'}
          </Cell>
        ) : (
          // The name shrinks before anything on the right of the band does. At
          // 452 px — the narrowest this band is — a brush mode wants a slider,
          // a Cancel and a Done, and something has to give; the icon and the
          // accent tint still say which mode this is when the words run out.
          <Cell grow className="text-accent-strong font-semibold">
            {Icon && <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{name}</span>
          </Cell>
        )}

        {shownFlash && <Cell className="text-ok font-semibold">{shownFlash}</Cell>}
      </div>

      {/* How long this has been going, and the way out of it — deliberately
          *outside* the live region above, for the reason the vertex count is:
          that region is `aria-atomic`, so a number changing every second would
          re-announce the whole band once a second for as long as the job runs.
          `aria-live="off"` on the seconds says the same thing again for a
          reader that reaches this cell some other way.

          Both appear only after five seconds. A trace that returns in 300 ms
          would otherwise flash a counter and a button through the band, and a
          Stop the user cannot hit is a Stop that only makes the app look
          twitchy. Past five seconds it is the opposite: with no elapsed time
          and no control, a 30 s trace and a hung one are the same screen. */}
      {showElapsed && (
        <Cell className="text-fg-3">
          <span className="font-mono tabular-nums" aria-live="off">
            {Math.round(elapsedMs / 1000)}s
          </span>
          {cancellable && (
            <button
              type="button"
              onClick={handleStop}
              title="Stop this and leave the plan as it is"
              className="inline-flex items-center h-[18px] px-1.5 rounded border border-line
                         bg-panel-2 text-[11px] text-fg-2 hover:text-fg hover:border-accent/50
                         transition-colors cursor-pointer"
            >
              Stop
            </button>
          )}
        </Cell>
      )}

      {/* One cell, three claimants, in this order: a flash the user just earned
          beats a tool they are only pointing at, and both beat the standing
          instruction for the mode. Working… suppresses all three — the progress
          message is already saying what is happening. */}
      {!isProcessing && !shownFlash && (toolHint ? (
        <Cell grow aria-hidden="true">
          <b className="shrink-0 font-semibold text-fg-2">{toolHint.name}</b>
          {toolHint.detail && <span className="min-w-0 truncate">{toolHint.detail}</span>}
          {toolHint.digit && (
            <span className="shrink-0 font-mono text-fg-dim">{toolHint.digit}</span>
          )}
        </Cell>
      ) : hint && (
        <Cell grow className={running ? 'text-fg-2' : ''}>
          <span className="min-w-0 truncate">{hint}</span>
        </Cell>
      ))}

      {running && count > 0 && (
        <Cell className="font-mono tabular-nums text-fg-2">
          {count} {count === 1 ? 'corner' : 'corners'}
        </Cell>
      )}

      {running && mode.brush && (
        <Cell>
          <input
            type="range"
            aria-label="Brush size"
            min={mode.brush === 'draw' ? 8 : 4}
            max={mode.brush === 'draw' ? 400 : 200}
            step={mode.brush === 'draw' ? 6 : 4}
            value={brushSize}
            onChange={(e) => onBrushSizeChange(Number(e.target.value))}
            className="w-20 h-[14px] accent-accent cursor-pointer"
          />
          <span className="font-mono tabular-nums text-fg-2 min-w-[42px]">{brushSize} px</span>
          <span className="text-fg-dim">
            <kbd className="font-mono border border-line rounded px-1">[</kbd>
            {' '}
            <kbd className="font-mono border border-line rounded px-1">]</kbd>
          </span>
        </Cell>
      )}

      <span className="flex-1 min-w-[10px]" />

      {!running && (
        <Cell>
          <b className="text-fg-2 font-semibold">Scale</b>
          <span className="font-mono tabular-nums text-fg-2">
            {pxPerFoot
              ? (anisotropic
                ? `${pxPerFoot.x.toFixed(2)} × ${pxPerFoot.y.toFixed(2)} px/ft`
                : `${pxPerFoot.x.toFixed(2)} px/ft`)
              : 'not set'}
          </span>
        </Cell>
      )}

      {!running && (
        <Cell>
          <button
            type="button"
            onClick={onZoomOut}
            disabled={!hasImage}
            aria-label="Zoom out"
            title="Zoom out"
            className="w-[18px] h-[18px] grid place-items-center rounded text-fg-3
                       hover:bg-sunken hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent
                       cursor-pointer disabled:cursor-default"
          >
            <Minus className="w-3 h-3" aria-hidden="true" />
          </button>
          <span className="font-mono tabular-nums text-fg-2 min-w-[38px] text-center">{zoomPct}%</span>
          <button
            type="button"
            onClick={onZoomIn}
            disabled={!hasImage}
            aria-label="Zoom in"
            title="Zoom in"
            className="w-[18px] h-[18px] grid place-items-center rounded text-fg-3
                       hover:bg-sunken hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent
                       cursor-pointer disabled:cursor-default"
          >
            <Plus className="w-3 h-3" aria-hidden="true" />
          </button>
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
              className={`w-3 h-3 ${draft.tone} ${draftState === 'pending' ? 'animate-spin' : ''}`}
              aria-hidden="true"
            />
            {draft.label}
          </button>
        </Cell>
      )}

      {/* The way out, last, where the eye ends up — and the only two controls
          in this band that are not always here, so they never move the rest. */}
      {running && (
        <Cell>
          <button
            type="button"
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 h-[20px] px-2 rounded border border-line
                       bg-panel-2 text-[11px] text-fg-2 hover:text-fg hover:border-accent/50
                       transition-colors cursor-pointer"
          >
            Cancel
            <kbd className="font-mono text-[10px] opacity-70">Esc</kbd>
          </button>

          {onDone && mode.doneLabel && (
            <button
              type="button"
              onClick={onDone}
              className="inline-flex items-center gap-1.5 h-[20px] px-2 rounded border border-accent
                         bg-accent text-accent-ink text-[11px] font-semibold hover:brightness-110
                         transition-[filter] cursor-pointer"
            >
              {mode.doneLabel}
              {mode.doneKey && <kbd className="font-mono text-[10px] opacity-80">{mode.doneKey}</kbd>}
            </button>
          )}
        </Cell>
      )}
    </div>
  );
};

export default StatusBar;
