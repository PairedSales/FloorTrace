import { useCallback, useEffect, useRef, useState } from 'react';
import { X, Plus, ChevronDown, Loader2 } from 'lucide-react';
import useAppStore from '../store/appStore';
import { documentLabel, MAX_OPEN_DOCUMENTS } from '../store/documentManager';

/**
 * The open plans, as a band of its own between the menu bar and the command bar.
 *
 * It cannot ride inside the menu bar row. That 30 px row is fully spent by the
 * wordmark, five menu titles and a status bar whose cells are deliberately
 * `shrink-0` and explicitly forbidden from scrolling — a horizontal scrollbar
 * in a 30 px row eats the row.
 *
 * **This band must not scroll either.** Tabs share the width and truncate, with
 * a floor below which they stop shrinking; whatever no longer fits moves into a
 * chevron menu at the end. A tab strip that scrolls hides plans behind a
 * gesture, which is the thing a tab strip exists to prevent.
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

const PlanTab = ({
  docId, label, isActive, isBusy, canClose,
  onSelect, onClose, onRename,
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
      className={`group relative flex items-center gap-1.5 h-[26px] pl-2.5 pr-1
                  border-r border-line-soft text-[12px] select-none
                  ${isActive
        ? 'bg-panel-2 text-fg font-medium'
        : 'bg-panel text-fg-3 hover:text-fg-2 hover:bg-sunken'}`}
      style={{ flex: `1 1 ${TAB_MIN}px`, minWidth: 0, maxWidth: TAB_MAX }}
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

  const [overflowOpen, setOverflowOpen] = useState(false);
  const stripRef = useRef(null);

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

  if (documentOrder.length === 0) return null;

  // How many tabs fit before they would go below their floor. Computed rather
  // than measured: the alternative is a ResizeObserver, and this band must
  // render identically in the preview pane, where observers do not fire.
  const width = stripRef.current?.offsetWidth ?? 0;
  const room = width > 0 ? Math.max(1, Math.floor((width - 30) / TAB_MIN)) : documentOrder.length;
  const visible = documentOrder.slice(0, room);
  const hidden = documentOrder.slice(room);

  return (
    <div className="flex items-stretch h-[30px] bg-panel border-b border-line-soft shrink-0">
      <div
        ref={stripRef}
        role="tablist"
        aria-label="Open plans"
        onKeyDown={handleKeyDown}
        className="flex items-stretch flex-1 min-w-0 border-r border-line-soft"
      >
        {visible.map((docId, i) => (
          <PlanTab
            key={docId}
            docId={docId}
            label={labelFor(docId, i)}
            isActive={docId === activeDocumentId}
            isBusy={docId === activeDocumentId && isProcessing}
            // The last plan cannot be closed away — there is no "no document"
            // state in this app — so it is emptied from the File menu instead.
            canClose={documentOrder.length > 1}
            onSelect={onSelect}
            onClose={onClose}
            onRename={handleRename}
          />
        ))}

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
      </div>

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
  );
};

export default DocumentTabs;
