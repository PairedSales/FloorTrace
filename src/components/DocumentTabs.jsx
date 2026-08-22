import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';
import { documentLabel, MAX_OPEN_DOCUMENTS } from '../store/documentManager';

/**
 * The open plans, as the top row of the plan's own column — under the command
 * bar, over the status bar, and inset between the measurement dock and the tool
 * rail so the strip is measured against exactly the plan it addresses.
 *
 * **Two plans or it does not render.** A strip with one tab in it is 30 px of
 * chrome answering a question nobody asked, and it took that height from the
 * plan on every ordinary single-plan session. `File ▸ New plan` (Ctrl+Alt+N)
 * is how a second plan arrives, and the strip arrives with it.
 *
 * **A tab is as wide as its own name**, up to a ceiling, and the strip ends
 * where the last tab does — the new-plan button sits directly after it rather
 * than pinned to the far corner. Tabs that stretched to share the width put the
 * only two controls in this band at opposite ends of an empty panel.
 *
 * **This band must not scroll.** Tabs truncate, with a floor below which they
 * stop shrinking; whatever no longer fits moves into a chevron menu at the end.
 * A tab strip that scrolls hides plans behind a gesture, which is the thing a
 * tab strip exists to prevent.
 *
 * **The chevron is reachable**, which it was not while this band spanned the
 * window: inset, the strip is the window less a 320 px dock and a 48 px rail, so
 * at the 819.98 px breakpoint it has ~452 px and fits four tabs at the floor —
 * five or six open plans overflow. It is a real path with real users in it, not
 * the dead-code guard it used to be.
 *
 * That is also why the width is re-measured three ways, none of them redundant:
 * on a window `resize`, on a `ResizeObserver` callback, and on the two pieces of
 * app state that decide the inset — `dockOpen` and whether there is an image
 * (the tool rail mounts with it). The window listener alone was complete while
 * this band spanned the window and is not any more. The observer alone is not
 * enough either: it never fires while `document.hidden` is true, which is the
 * state of every preview pane and every background tab — so the state deps are
 * the ones that make the common case deterministic, and the observer is what
 * catches a width change nothing in this component was told about.
 *
 * **It imports nothing from `./canvas/` or `./CanvasStage`.** This component
 * lives in the eager shell, and one such import would pull konva back into the
 * entry's static module graph and put a `modulepreload` for 320 kB back into
 * `index.html` — the exact regression the lazy canvas chunk exists to avoid.
 */

// Below this a tab is a truncated word and a close button, which is the least
// that still reads as a tab. Above the ceiling they stop growing, so two plans
// do not each take half the window.
const TAB_MIN = 96;
const TAB_MAX = 200;

// The two controls that share the strip with the tabs, reserved out of the
// width before the tabs are counted.
const NEW_BUTTON_PX = 30;
const CHEVRON_PX = 34;

const PlanTab = ({
  docId, label, index, isActive, isBusy, needsRescale, canClose, isDragging,
  onSelect, onClose, onRename, onDragStart,
}) => {
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(label);
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming) inputRef.current?.select();
  }, [renaming]);

  const commit = useCallback(() => {
    setRenaming(false);
    const next = draft.trim();
    if (next && next !== label) onRename(docId, next);
  }, [draft, label, docId, onRename]);

  const startRename = () => {
    // Renaming a plan you are not looking at would edit a subject line with no
    // way to see what it belongs to, so the tab comes forward first.
    if (!isActive) onSelect(docId);
    setDraft(label);
    setRenaming(true);
  };

  return (
    <div
      data-tab-id={docId}
      className={`group relative flex items-center gap-1.5 h-[26px] pl-2.5 pr-1
                  border-r border-line-soft text-[12px] select-none
                  ${isActive
        ? 'bg-panel-2 text-fg font-medium'
        : 'bg-panel text-fg-3 hover:text-fg-2 hover:bg-sunken'}`}
      // `0 1 auto`, not `1 1`: a tab is as wide as its own name and no wider.
      // Growing them to share the strip made two plans take half the window
      // each, which is the space this band was spending on nothing.
      style={{ flex: '0 1 auto', minWidth: TAB_MIN, maxWidth: TAB_MAX, opacity: isDragging ? 0.4 : 1 }}
      // Pointer events, never HTML5 drag. The app root owns `onDragOver` and
      // `onDrop` with an unconditional `preventDefault`, so a native tab drag
      // would bubble straight into the file-drop path and try to open the tab
      // as a floorplan.
      onPointerDown={(e) => onDragStart(e, docId, index)}
    >
      {/* The tab itself is the tab; the close control is a sibling, never a
          child. A focusable control inside `role="tab"` breaks the pattern a
          screen reader is following. */}
      <button
        type="button"
        role="tab"
        aria-selected={isActive}
        tabIndex={isActive ? 0 : -1}
        onClick={() => onSelect(docId)}
        onDoubleClick={startRename}
        title={label}
        className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left cursor-pointer"
      >
        {isBusy && <Loader2 className="w-3 h-3 shrink-0 animate-spin text-accent" aria-hidden="true" />}
        {/* A scale this plan's own work would have set was refused because the
            plan was not live at the time — see documentRequests. Shown here
            because a plan that is silently un-scaled reports an area from a
            scale nobody chose. */}
        {needsRescale && !isBusy && (
          <AlertTriangle className="w-3 h-3 shrink-0 text-warn" aria-hidden="true" />
        )}
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setRenaming(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 bg-transparent border-none outline-none
                       text-[12px] text-fg p-0 m-0"
          />
        ) : (
          <span className="truncate">{label}</span>
        )}
      </button>

      <button
        type="button"
        // Not in the tab order: arrows move between tabs, and a close button
        // between each one would double the number of stops to cross the strip.
        tabIndex={-1}
        aria-label={`Close ${label}`}
        title={`Close ${label}`}
        disabled={!canClose}
        onClick={(e) => { e.stopPropagation(); onClose(docId); }}
        className={`w-[18px] h-[18px] shrink-0 grid place-items-center rounded
                    text-fg-dim hover:text-fg hover:bg-line-soft cursor-pointer
                    ${isActive ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}
                    disabled:opacity-0 disabled:cursor-default`}
      >
        <X className="w-3 h-3" aria-hidden="true" />
      </button>
    </div>
  );
};

const DocumentTabs = ({ onSelect, onClose, onNew, isProcessing }) => {
  const documentOrder = useAppStore((s) => s.documentOrder);
  const documents = useAppStore((s) => s.documents);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);

  // Not read, deliberately: they are what the strip's width is made of, so they
  // are the layout effect's dependencies. The dock is 320 px of the inset and
  // the tool rail is the other 48.
  const dockOpen = useWorkspaceStore((s) => s.dockOpen);
  const hasImage = useAppStore((s) => !!s.image);

  const [overflowOpen, setOverflowOpen] = useState(false);
  const [stripWidth, setStripWidth] = useState(0);
  const [draggingId, setDraggingId] = useState(null);
  const stripRef = useRef(null);
  const dragRef = useRef(null);
  const moveDocument = useAppStore((s) => s.moveDocument);

  /**
   * Drag a tab along the strip.
   *
   * A drag only begins once the pointer has travelled far enough to not be a
   * click — a tab is a button first, and a strip where selecting sometimes
   * reorders instead is worse than one that does not reorder at all.
   */
  const handleDragStart = useCallback((e, docId, index) => {
    if (e.button !== 0) return;
    dragRef.current = { docId, index, startX: e.clientX, started: false };

    const onMove = (ev) => {
      const drag = dragRef.current;
      if (!drag) return;
      if (!drag.started) {
        if (Math.abs(ev.clientX - drag.startX) < 6) return;
        drag.started = true;
        setDraggingId(drag.docId);
      }
      const strip = stripRef.current;
      if (!strip) return;
      // Which slot the pointer is over, from the tabs themselves rather than
      // from arithmetic on a nominal width: they truncate, so their real widths
      // are the only ones that place the pointer correctly.
      const rects = [...strip.querySelectorAll('[data-tab-id]')]
        .map((el) => ({ id: el.dataset.tabId, rect: el.getBoundingClientRect() }));
      const over = rects.findIndex(({ rect }) => ev.clientX < rect.left + rect.width / 2);
      const target = over === -1 ? rects.length - 1 : over;
      if (target >= 0 && rects[target] && rects[target].id !== drag.docId) {
        moveDocument(drag.docId, target);
      }
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      dragRef.current = null;
      setDraggingId(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, [moveDocument]);

  // Layout phase, so the first paint already knows how many tabs fit rather
  // than showing them all for a frame and then collapsing.
  useLayoutEffect(() => {
    const el = stripRef.current;
    const measure = () => setStripWidth(el?.offsetWidth ?? 0);
    measure();

    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    if (ro && el) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [documentOrder.length, dockOpen, hasImage]);

  useEffect(() => {
    if (!overflowOpen) return undefined;
    const dismiss = () => setOverflowOpen(false);
    window.addEventListener('mousedown', dismiss);
    return () => window.removeEventListener('mousedown', dismiss);
  }, [overflowOpen]);

  const labelFor = useCallback((docId, index) => {
    const meta = documents[docId] ?? {};
    return documentLabel({
      // The active plan's name lives on the store root; every other plan's was
      // recorded when it was parked.
      projectName: docId === activeDocumentId ? projectName : meta.title,
      sourceFileName: meta.sourceFileName,
      index,
    });
  }, [documents, activeDocumentId, projectName]);

  const handleRename = useCallback((docId, name) => {
    if (docId === activeDocumentId) setProjectName(name);
  }, [activeDocumentId, setProjectName]);

  // Arrows move focus and Enter commits — manual activation. Automatic
  // activation would remount a Konva stage on every arrow press, which is the
  // most expensive thing this app does.
  const handleKeyDown = useCallback((e) => {
    const index = documentOrder.indexOf(activeDocumentId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = documentOrder[(index + delta + documentOrder.length) % documentOrder.length];
      onSelect(next);
    }
  }, [documentOrder, activeDocumentId, onSelect]);

  // One plan is not a choice between plans, so the band and its 30 px go with
  // the second tab. File > New plan (Ctrl+Alt+N) is the way back to two, and
  // the strip returns with it.
  if (documentOrder.length <= 1) return null;

  // How many tabs fit before they would go below their floor.
  //
  // `stripWidth` is state fed by the layout effect above, not a layout read in
  // the render body. Reading `offsetWidth` here looked simpler and was wrong
  // twice over: it is 0 on the first render, when the ref is not attached yet,
  // and — worse — nothing re-renders this component when its width changes, so
  // the overflow menu was computed once and then never again. Narrowing the
  // strip left tabs squeezed below their floor with no chevron to reach the
  // rest.
  //
  // The new-plan button is always in the strip, so it always costs width; the
  // chevron costs it only when there is going to be one.
  const fitting = (reserve) => Math.max(1, Math.floor((stripWidth - reserve) / TAB_MIN));
  const bare = stripWidth > 0 ? fitting(NEW_BUTTON_PX) : documentOrder.length;
  const room = bare >= documentOrder.length ? bare : fitting(NEW_BUTTON_PX + CHEVRON_PX);
  const visible = documentOrder.slice(0, room);
  const hidden = documentOrder.slice(room);

  return (
    // The row spans the plan's column, because that width is what the tabs are
    // measured against — but the strip inside it is only as wide as the plans
    // it holds. Painting it to the far edge left several hundred px of empty
    // panel between the last tab and a new-plan button pinned to the corner,
    // and that button belongs beside the tabs it adds to.
    <div ref={stripRef} className="flex items-stretch h-[30px] shrink-0">
      <div className="flex items-stretch min-w-0 bg-panel border-b border-r border-line-soft">
        <div
          role="tablist"
          aria-label="Open plans"
          onKeyDown={handleKeyDown}
          className="flex items-stretch min-w-0"
        >
          {visible.map((docId, i) => (
            <PlanTab
              key={docId}
              docId={docId}
              label={labelFor(docId, i)}
              isActive={docId === activeDocumentId}
              index={i}
              isDragging={draggingId === docId}
              onDragStart={handleDragStart}
              isBusy={docId === activeDocumentId && isProcessing}
              needsRescale={Boolean(documents[docId]?.needsRescale)}
              // The last plan cannot be closed away — there is no "no document"
              // state in this app — so it is emptied from the File menu instead.
              // The strip is gone by then, but the rule outlives the strip.
              canClose={documentOrder.length > 1}
              onSelect={onSelect}
              onClose={onClose}
              onRename={handleRename}
            />
          ))}
        </div>

        {hidden.length > 0 && (
          <div className="relative flex items-center shrink-0">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={overflowOpen}
              aria-label={`${hidden.length} more plans`}
              title={`${hidden.length} more`}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setOverflowOpen((v) => !v)}
              className="flex items-center gap-0.5 h-[26px] px-1.5 text-[11px]
                         text-fg-3 hover:text-fg hover:bg-sunken cursor-pointer"
            >
              <ChevronDown className="w-3 h-3" aria-hidden="true" />
              {hidden.length}
            </button>
            {overflowOpen && (
              <div
                role="menu"
                className="absolute right-0 top-[calc(100%+2px)] z-[60] min-w-[200px] p-1
                           bg-panel-2 border border-line rounded-md shadow-xl"
              >
                {hidden.map((docId) => (
                  <button
                    key={docId}
                    type="button"
                    role="menuitem"
                    onClick={() => { setOverflowOpen(false); onSelect(docId); }}
                    className="flex w-full items-center px-2.5 py-1.5 rounded text-[12.5px]
                               text-left text-fg-2 hover:bg-accent/12 hover:text-fg"
                  >
                    <span className="truncate">
                      {labelFor(docId, documentOrder.indexOf(docId))}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <button
          type="button"
          onClick={onNew}
          disabled={documentOrder.length >= MAX_OPEN_DOCUMENTS}
          aria-label="New plan"
          title={documentOrder.length >= MAX_OPEN_DOCUMENTS
            ? `${MAX_OPEN_DOCUMENTS} plans is the maximum`
            : 'New plan'}
          className="w-[30px] shrink-0 grid place-items-center text-fg-3
                     hover:text-fg hover:bg-sunken cursor-pointer
                     disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
        >
          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default DocumentTabs;
