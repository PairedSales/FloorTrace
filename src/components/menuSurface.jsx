import { ArrowUpRight, Check } from 'lucide-react';

/**
 * The one menu surface in the top band.
 *
 * Four dropdowns hang off that band — the File and View titles, and the caret
 * on each of the two stage verbs — and they have to look and behave like one
 * thing, or the row is a collection of controls again. A shared module is also
 * what stops the keybinding column, the danger tone and the disabled treatment
 * from drifting apart, which is how the old Trace menu came to call the same
 * command by a different name from the button standing next to it.
 *
 * `checked` is a reserved slot rather than a `✓ ` prefix on the label. The
 * prefix shifted the word ~12 px every time the preference was toggled, in a
 * list whose other rows did not move — so the one item you had just acted on
 * was the one that jumped.
 *
 * `external` marks an item that leaves the app, and it borrows the trailing
 * slot the keybinding hint uses — every item that goes somewhere else has no
 * shortcut, so the two never compete. It is on the shared surface rather than
 * spelled into a label because a `↗` typed into one menu's copy is exactly the
 * drift this module exists to prevent.
 */
export const MenuItem = ({ label, keys, checked, disabled, danger, external, onSelect, close }) => (
  <button
    type="button"
    role="menuitem"
    disabled={disabled}
    aria-label={external ? `${label} — opens in a new tab` : undefined}
    onClick={() => { close(); onSelect?.(); }}
    className={`flex w-full items-center justify-between gap-6 px-2.5 py-1.5 rounded text-[12.5px]
      text-left transition-colors disabled:opacity-40 disabled:cursor-default cursor-pointer
      ${danger ? 'text-crit hover:bg-crit/10' : 'text-fg-2 hover:bg-accent/12 hover:text-fg'}
      disabled:hover:bg-transparent`}
  >
    <span className="flex items-center gap-1.5 min-w-0">
      {checked !== undefined && (
        <Check
          className={`w-3.5 h-3.5 shrink-0 text-accent ${checked ? '' : 'invisible'}`}
          aria-hidden="true"
        />
      )}
      <span className="truncate">{label}</span>
    </span>
    {keys && <span className="font-mono text-[11px] text-fg-dim shrink-0">{keys}</span>}
    {!keys && external && <ArrowUpRight className="w-3.5 h-3.5 text-fg-dim shrink-0" aria-hidden="true" />}
  </button>
);

export const Sep = () => <div className="h-px bg-line-soft my-1 mx-1.5" />;

/**
 * `top-[calc(100%+3px)]` drops the panel clear of a trigger that is 32 px tall
 * in a 40 px band, rather than 4 px up inside it.
 */
export const Popover = ({ open, labelledBy, children }) => (
  open ? (
    <div
      role="menu"
      aria-labelledby={labelledBy}
      // The band closes every dropdown on a window `mousedown`, which lands
      // before the `click` that would have chosen an item — so without this the
      // panel unmounts out from under the pointer and the item is never picked.
      onMouseDown={(e) => e.stopPropagation()}
      className="absolute left-0 top-[calc(100%+3px)] z-[60] min-w-[248px] p-1
                 bg-panel-2 border border-line rounded-md shadow-xl animate-fade-in"
    >
      {children}
    </div>
  ) : null
);
