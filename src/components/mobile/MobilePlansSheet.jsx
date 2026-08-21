import { Check, Plus, X } from 'lucide-react';
import BottomSheet from './BottomSheet';
import useAppStore from '../../store/appStore';
import { documentLabel, MAX_OPEN_DOCUMENTS } from '../../store/documentManager';

/**
 * The open plans, on a phone.
 *
 * A tab strip is the wrong shape here and gets no permanent chrome at all. The
 * thumb bar is contractually one verb, the canvas claims every touch, and a
 * strip under the top bar would cost ~40 px of the only space the plan has —
 * on the screen where the plan has least of it.
 *
 * So the switcher is the subject line in the top bar, which already names the
 * plan: tapping it opens this sheet. That is the same move the tool sheet
 * makes — the same list the desktop shows, in the shape a phone wants, rather
 * than a second implementation of the idea.
 */
const MobilePlansSheet = ({ open, onClose, onSelect, onClosePlan, onNew }) => {
  const documentOrder = useAppStore((s) => s.documentOrder);
  const documents = useAppStore((s) => s.documents);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const projectName = useAppStore((s) => s.projectName);

  const labelFor = (docId, index) => {
    const meta = documents[docId] ?? {};
    return documentLabel({
      projectName: docId === activeDocumentId ? projectName : meta.title,
      sourceFileName: meta.sourceFileName,
      index,
    });
  };

  const atCap = documentOrder.length >= MAX_OPEN_DOCUMENTS;

  return (
    <BottomSheet open={open} onClose={onClose} title="Plans">
      <div className="flex flex-col">
        {documentOrder.map((docId, i) => {
          const isActive = docId === activeDocumentId;
          const label = labelFor(docId, i);
          return (
            <div
              key={docId}
              className={`flex items-center gap-2 border-b border-line-soft
                          ${isActive ? 'bg-accent/8' : ''}`}
            >
              <button
                type="button"
                onClick={() => { onClose(); onSelect(docId); }}
                className="tap-target flex items-center gap-2.5 flex-1 min-w-0
                           px-3 text-left text-[15px] text-fg cursor-pointer"
              >
                <span className="w-4 shrink-0">
                  {isActive && <Check className="w-4 h-4 text-accent" aria-hidden="true" />}
                </span>
                <span className="truncate">{label}</span>
              </button>
              {documentOrder.length > 1 && (
                <button
                  type="button"
                  aria-label={`Close ${label}`}
                  onClick={() => onClosePlan(docId)}
                  className="tap-target grid place-items-center px-3 text-fg-3 cursor-pointer"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          disabled={atCap}
          onClick={() => { onClose(); onNew(); }}
          className="tap-target flex items-center gap-2.5 px-3 text-left text-[15px]
                     text-accent disabled:text-fg-dim cursor-pointer disabled:cursor-default"
        >
          <span className="w-4 shrink-0"><Plus className="w-4 h-4" aria-hidden="true" /></span>
          {atCap ? `${MAX_OPEN_DOCUMENTS} plans is the maximum` : 'New plan'}
        </button>
      </div>
    </BottomSheet>
  );
};

export default MobilePlansSheet;
