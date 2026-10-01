import { createContext, useContext, useRef } from 'react';
import { ArrowUpRight, Check, ChevronDown } from 'lucide-react';
import useWorkspaceStore from '../store/workspaceStore';
import { useMenu } from '../hooks/useMenu';

/**
 * The one dropdown in the app.
 *
 * The header's Menu, the action bar's four task menus and the plan tabs'
 * overflow are all this component, so they open, close, look and read the same
 * way. Before it there were three hand-built dropdowns — the top band's, the
 * tool rail's and the tab strip's — each with its own copy of the dismissal
 * logic and its own idea of what a row looked like.
 *
 * ## One open at a time, and the keyboard knows
 *
 * The open menu's id lives in `workspaceStore.menuOpen` rather than in local
 * state. Two reasons, both load-bearing:
 *
 *  - the menus live in different components, and every trigger swallows its
 *    own `mousedown` (see below), so neither would otherwise hear the other
 *    open;
 *  - `keyboardGuard.shortcutsBlocked` reads it. With a menu open, `1` used to
 *    start painting behind it — and the menu *prints* the keys it is
 *    swallowing.
 *
 * ## Why triggers and panels stop `mousedown`
 *
 * A menu closes on a window `mousedown`, which lands before the `click` that
 * would have chosen an item — so without the swallow the panel unmounts out
 * from under the pointer and nothing is picked. The swallow is on the trigger
 * and on the panel, never on a wrapper: `useKeyboardShortcuts` reads mouse
 * buttons 3/4 (undo/redo) off that same window event, and a wrapper-wide
 * swallow killed them for every plain button beside a menu.
 *
 * ## A row can say what it is for
 *
 * `description` puts a sentence under the label. It is what lets the action
 * bar offer a tool by a plain phrase and still explain it, where the old rail
 * had an icon, one word and a tooltip. A row that cannot be used right now
 * stays where it is, greyed, and its `description` becomes the reason — a row
 * never moves out from under the pointer.
 */

const MenuContext = createContext({ close: () => {} });

const itemsOf = (panel) => [...(panel?.querySelectorAll('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

/**
 * A trigger and the panel that hangs off it.
 *
 * `group` makes a row of menus behave like one menu bar: once any of them is
 * open, resting the pointer on a neighbour switches to it. `align="right"`
 * hangs the panel off the trigger's right edge, for a trigger near the right
 * of the window.
 */
export const Menu = ({
  id,
  group,
  label,
  icon: Icon,
  ariaLabel,
  title,
  align = 'left',
  caret = true,
  width = 'w-[330px]',
  triggerClassName = 'menu-trigger',
  children,
}) => {
  const menuId = group ? `${group}:${id}` : id;
  const { open, close, show, toggle } = useMenu(menuId);
  const triggerId = `menu-${menuId.replace(/[^a-z0-9]+/gi, '-')}`;
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  // Hover only switches between neighbours once one of them is already open.
  const onMouseEnter = () => {
    if (!group || open) return;
    const current = useWorkspaceStore.getState().menuOpen;
    if (typeof current === 'string' && current.startsWith(`${group}:`)) show();
  };

  const onTriggerKeyDown = (e) => {
    if (e.key !== 'ArrowDown') return;
    e.preventDefault();
    if (!open) show();
    // The panel mounts on the next render.
    setTimeout(() => itemsOf(panelRef.current)[0]?.focus(), 0);
  };

  const onPanelKeyDown = (e) => {
    const items = itemsOf(panelRef.current);
    if (!items.length) return;
    const at = items.indexOf(document.activeElement);
    const move = (to) => { e.preventDefault(); items[(to + items.length) % items.length].focus(); };
    if (e.key === 'ArrowDown') move(at + 1);
    else if (e.key === 'ArrowUp') move(at <= 0 ? items.length - 1 : at - 1);
    else if (e.key === 'Home') move(0);
    else if (e.key === 'End') move(items.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') {
      // Escape also reaches the window listener, which closes; this only puts
      // the focus back where it came from.
      close();
      triggerRef.current?.focus();
    }
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        id={triggerId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        title={title}
        onClick={toggle}
        onMouseDown={(e) => e.stopPropagation()}
        onMouseEnter={onMouseEnter}
        onKeyDown={onTriggerKeyDown}
        className={`${triggerClassName} ${open ? 'is-open' : ''}`}
      >
        {Icon && <Icon className="w-[18px] h-[18px] shrink-0" aria-hidden="true" />}
        {label && <span>{label}</span>}
        {caret && <ChevronDown className="w-4 h-4 shrink-0 opacity-70" aria-hidden="true" />}
      </button>

      {open && (
        <MenuContext.Provider value={{ close }}>
          <div
            ref={panelRef}
            role="menu"
            aria-labelledby={triggerId}
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={onPanelKeyDown}
            className={`absolute ${align === 'right' ? 'right-0' : 'left-0'} top-[calc(100%+6px)]
                        z-[60] ${width} max-w-[calc(100vw-16px)] p-1.5
                        bg-panel-2 border border-line rounded-xl shadow-float animate-fade-in`}
          >
            {children}
          </div>
        </MenuContext.Provider>
      )}
    </div>
  );
};

/**
 * One row.
 *
 * `checked` is a reserved slot rather than a `✓ ` prefix on the label: the
 * prefix shifted the word every time the preference was toggled, in a list
 * whose other rows did not move.
 *
 * `disabled` is `aria-disabled`, not the attribute. A `disabled` button
 * dispatches no pointer events in Chrome and is skipped by a screen reader's
 * arrow keys, so the one row whose reason a user most needs — "why can I not
 * measure yet" — would be the only one that could not say it.
 *
 * `external` marks a row that leaves the app.
 */
export const MenuItem = ({
  icon: Icon,
  label,
  description,
  keys,
  checked,
  disabled = false,
  danger = false,
  external = false,
  title,
  onSelect,
}) => {
  const { close } = useContext(MenuContext);
  return (
    <button
      type="button"
      role="menuitem"
      aria-disabled={disabled || undefined}
      aria-label={external ? `${label} — opens in a new tab` : undefined}
      title={title}
      onClick={() => {
        if (disabled) return;
        close();
        onSelect?.();
      }}
      className={`flex w-full gap-3 px-3 rounded-lg text-left transition-colors cursor-pointer
        aria-disabled:opacity-45 aria-disabled:cursor-default
        ${description ? 'items-start py-2.5' : 'items-center py-2'}
        ${danger
          ? 'text-crit hover:bg-crit/10'
          : 'text-fg-2 hover:bg-accent/12 hover:text-fg'}
        aria-disabled:hover:bg-transparent aria-disabled:hover:text-fg-2`}
    >
      {checked !== undefined && (
        <Check
          className={`w-4 h-4 shrink-0 text-accent ${checked ? '' : 'invisible'}`}
          aria-hidden="true"
        />
      )}
      {Icon && (
        <Icon className={`w-[18px] h-[18px] shrink-0 ${description ? 'mt-0.5' : ''}`} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-4">
          <span className="text-[14.5px] font-medium leading-snug">{label}</span>
          {keys && <kbd className="shrink-0">{keys}</kbd>}
          {!keys && external && <ArrowUpRight className="w-4 h-4 shrink-0 text-fg-dim" aria-hidden="true" />}
        </span>
        {description && (
          <span className="block mt-0.5 text-[13px] leading-snug text-fg-3">{description}</span>
        )}
      </span>
    </button>
  );
};

export const MenuSep = () => <div className="h-px bg-line-soft my-1.5 mx-1.5" role="separator" />;

export const MenuLabel = ({ children }) => (
  <p className="px-3 pt-2 pb-1 text-[12.5px] font-medium text-fg-3">{children}</p>
);
