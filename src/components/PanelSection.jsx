import { ChevronRight } from 'lucide-react';

/**
 * One fold of the results panel: a title, a few words saying what is inside,
 * and the detail behind it.
 *
 * The panel used to be four cards that were always open — Area, Things to
 * check, Outline, Scale — so a finished plan showed some forty controls at
 * rest, most of them answers to questions nobody had asked yet. Folded, each
 * section says its own conclusion in the `summary` ("From 3 rooms on the
 * plan") and the panel reads top to bottom as a summary of the plan. A section
 * opens by itself when it has something that needs doing; opened or closed by
 * hand, it stays that way.
 *
 * Shared rather than copied, so a section added later cannot arrive with its
 * own heading weight and padding and read as a different app half a panel down.
 *
 * `summary` is expendable text and truncates; `badge` is a state (a chip) and
 * never does.
 */
const PanelSection = ({ id, title, summary, badge, open, onToggle, children }) => (
  <section id={id} className="border-t border-line-soft first:border-t-0">
    <h3>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-body`}
        onClick={onToggle}
        className="group flex w-full items-center gap-2 min-h-[48px] px-5 py-2 text-left
                   cursor-pointer transition-colors hover:bg-sunken/60"
      >
        <ChevronRight
          className={`w-4 h-4 shrink-0 text-fg-3 group-hover:text-fg-2 ${open ? 'rotate-90' : ''}`}
          aria-hidden="true"
        />
        <span className="shrink-0 text-[15px] font-semibold text-fg">{title}</span>
        <span className="flex-1 min-w-0 truncate text-right text-[13px] text-fg-3">
          {/* Said only while folded: open, the section says it in full. */}
          {!open && summary}
        </span>
        {badge}
      </button>
    </h3>
    {open && (
      <div id={`${id}-body`} className="px-5 pt-1 pb-5">
        {children}
      </div>
    )}
  </section>
);

export default PanelSection;
