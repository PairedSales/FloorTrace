import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { X, Plus, ChevronDown, Loader2, AlertTriangle } from 'lucide-react';
import useAppStore from '../store/appStore';
import { documentLabel, MAX_OPEN_DOCUMENTS } from '../store/documentManager';
import { Menu, MenuItem } from './Menu';

/**
 * The open plans, in the header.
 *
 * **In the header, because everything below it belongs to one plan.** The
 * strip used to sit over the canvas only, inset between the panel and the tool
 * rail — but the panel changes with the plan as well, so the tabs were
 * addressing half of what they switched. Here the hierarchy is the one the
 * screen draws: pick a plan, and the results on the left and the drawing on the
 * right are both that plan's. It also costs the plan no height.
 *
 * **It shows from the first plan.** One tab is the plan's name — which is what
 * the saved image is filed under, so it is worth seeing — and beside it the way
 * to add another. A house drawn on two sheets is two plans, and FloorTrace adds
 * them up; hidden behind a menu, nobody found that.
 *
 * **A tab is as wide as its own name**, up to a ceiling, and the strip ends
 * where the last tab does — "Add plan" sits directly after it.
 *
 * **The strip must not scroll.** Tabs truncate, with a floor below which they
 * stop shrinking; whatever no longer fits moves into a menu at the end. A strip
 * that scrolls hides plans behind a gesture, which is the thing a tab strip
 * exists to prevent.
 *
 * Its width is re-measured three ways, none redundant: on a window `resize`,
 * on a `ResizeObserver` callback, and when the number of plans or the presence
 * of an image changes (Undo and Redo arrive in the header with the image, and
 * take width from this strip). The observer alone is not enough: it never
 * fires while `document.hidden` is true, which is the state of every preview
 * pane and every background tab.
 *
 * **It imports nothing from `./canvas/` or `./CanvasStage`.** This component
 * lives in the eager shell, and one such import would pull konva back into the
 * entry's static module graph and put a `modulepreload` for 320 kB back into
 * `index.html` — the exact regression the lazy canvas chunk exists to avoid.
 */

// Below this a tab is a truncated word and a close button, which is the least
// that still reads as a tab. Above the ceiling they stop growing.
const TAB_MIN = 120;
const TAB_MAX = 230;

// The two controls that share the strip with the tabs, reserved out of the
// width before the tabs are counted.
const ADD_BUTTON_PX = 112;
const OVERFLOW_PX = 56;

const PlanTab = ({
  docId, label, index, isActive, isBusy, needsRescale, isDragging,
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
    // Renaming a plan you are not looking at would edit a name with no way to
    // see what it belongs to, so the tab comes forward first.
    if (!isActive) onSelect(docId);
    setDraft(label);
    setRenaming(true);
  };

  return (
    <div
      data-tab-id={docId}
      className={`group relative flex items-center gap-1 h-9 pl-3 pr-1.5 rounded-lg
                  text-[14px] select-none transition-colors
                  ${isActive
        ? 'bg-sunken text-fg font-medium'
        : 'text-fg-3 hover:text-fg-2 hover:bg-sunken/60'}`}
      // `0 1 auto`, not `1 1`: a tab is as wide as its own name and no wider.
      style={{ flex: '0 1 auto', minWidth: TAB_MIN, maxWidth: TAB_MAX, opacity: isDragging ? 0.4 : 1 }}
      // Pointer events, never HTML5 drag. The app root owns `onDragOver` and
      // `onDrop` with an unconditional `preventDefault`, so a native tab drag
      // would bubble straight into the file-drop path and try to open the tab
      // as a floor plan.
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
        title={`${label} — double-click to rename`}
        className="flex items-center gap-1.5 flex-1 min-w-0 h-full text-left cursor-pointer"
      >
        {isBusy && <Loader2 className="w-4 h-4 shrink-0 animate-spin text-accent" aria-hidden="true" />}
        {/* A scale this plan's own work would have set was refused because the
            plan was not live at the time — see documentRequests. Shown here
            because a plan that is silently un-scaled reports an area from a
            scale nobody chose. */}
        {needsRescale && !isBusy && (
          <AlertTriangle className="w-4 h-4 shrink-0 text-warn" aria-hidden="true" />
        )}
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            aria-label="Plan name"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') setRenaming(false);
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            className="w-full min-w-0 bg-transparent border-none outline-none
                       text-[14px] text-fg p-0 m-0 select-text"
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
        onClick={(e) => { e.stopPropagation(); onClose(docId); }}
        className={`w-6 h-6 shrink-0 grid place-items-center rounded-md
                    text-fg-dim hover:text-fg hover:bg-line cursor-pointer
                    ${isActive ? '' : 'opacity-0 group-hover:opacity-100 focus:opacity-100'}`}
      >
        <X className="w-4 h-4" aria-hidden="true" />
      </button>
    </div>
  );
};

const PlanTabs = ({ onSelect, onClose, onNew, isProcessing }) => {
  const documentOrder = useAppStore((s) => s.documentOrder);
  const documents = useAppStore((s) => s.documents);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const projectName = useAppStore((s) => s.projectName);
  const setProjectName = useAppStore((s) => s.setProjectName);
  const hasImage = useAppStore((s) => !!s.image);
  const moveDocument = useAppStore((s) => s.moveDocument);

  const [stripWidth, setStripWidth] = useState(0);
  const [draggingId, setDraggingId] = useState(null);
  const stripRef = useRef(null);
  const dragRef = useRef(null);

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
  }, [documentOrder.length, hasImage]);

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

  // Arrows move between plans. Each press switches: the tab is the plan.
  const handleKeyDown = useCallback((e) => {
    const index = documentOrder.indexOf(activeDocumentId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const next = documentOrder[(index + delta + documentOrder.length) % documentOrder.length];
      onSelect(next);
    }
  }, [documentOrder, activeDocumentId, onSelect]);

  // Before the first plan is open there is nothing to name and nothing to add
  // to: the start screen is the whole page. The spacer keeps the header's
  // right-hand cluster where it is.
  const showStrip = documentOrder.length > 1 || hasImage;

  // How many tabs fit before they would go below their floor.
  //
  // `stripWidth` is state fed by the layout effect above, not a layout read in
  // the render body: `offsetWidth` is 0 on the first render, and nothing
  // re-renders this component when its width changes.
  //
  // "Add plan" is always in the strip, so it always costs width; the overflow
  // menu costs it only when there is going to be one.
  const fitting = (reserve) => Math.max(1, Math.floor((stripWidth - reserve) / TAB_MIN));
  const bare = stripWidth > 0 ? fitting(ADD_BUTTON_PX) : documentOrder.length;
  const room = bare >= documentOrder.length ? bare : fitting(ADD_BUTTON_PX + OVERFLOW_PX);
  const visible = documentOrder.slice(0, room);
  const hidden = documentOrder.slice(room);
  const atLimit = documentOrder.length >= MAX_OPEN_DOCUMENTS;

  return (
    <div ref={stripRef} className="flex items-center flex-1 min-w-0 gap-1">
      {showStrip && (
        <>
          <div
            role="tablist"
            aria-label="Open plans"
            onKeyDown={handleKeyDown}
            className="flex items-center min-w-0 gap-1"
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
                onSelect={onSelect}
                onClose={onClose}
                onRename={handleRename}
              />
            ))}
          </div>

          {hidden.length > 0 && (
            <Menu
              id="tabs-overflow"
              ariaLabel={`${hidden.length} more plans`}
              title={`${hidden.length} more`}
              label={String(hidden.length)}
              icon={ChevronDown}
              caret={false}
              align="right"
              width="w-[240px]"
            >
              {hidden.map((docId) => (
                <MenuItem
                  key={docId}
                  label={labelFor(docId, documentOrder.indexOf(docId))}
                  onSelect={() => onSelect(docId)}
                />
              ))}
            </Menu>
          )}

          <button
            type="button"
            onClick={onNew}
            disabled={atLimit}
            title={atLimit
              ? `${MAX_OPEN_DOCUMENTS} plans is the most that can be open at once`
              : 'Add another plan — another level or another sheet of the same property'}
            className="btn btn-quiet btn-sm shrink-0"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            Add plan
          </button>
        </>
      )}
    </div>
  );
};

export default PlanTabs;
