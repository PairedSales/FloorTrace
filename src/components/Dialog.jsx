import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useIsMobile } from '../hooks/useViewport';

/**
 * The one dialog frame in the app.
 *
 * Help, Settings, Save image and the confirmations were four hand-built
 * overlays. They disagreed about the things a frame is for: one let Tab wander
 * into the plan behind it, one closed on Escape *and* cancelled the running
 * tool with the same press, three different header sizes, two corner radii.
 * They are one component now, so a dialog added later arrives with all of it.
 *
 * What the frame guarantees:
 *
 *  - **Escape closes this, and only this.** Capture phase and stopped, so the
 *    press does not also reach the tool-cancel listener behind the dialog.
 *  - **Tab stays inside.** A modal that lets focus into the canvas behind it is
 *    a modal only for the mouse.
 *  - **Focus goes somewhere on purpose, and comes back.** `initialFocus` names
 *    the control that should have it, or a child may take it with `autoFocus`;
 *    otherwise the panel itself takes it, so nothing is one accidental Enter
 *    away. Closing restores whatever had focus before the dialog opened.
 *  - **A press on the backdrop closes.** `mousedown`, not `click`: a drag that
 *    starts inside a text field and ends outside must not dismiss the dialog.
 *
 * `onClose` should be a stable reference (`useCallback`), or the key listener
 * is torn down and re-added on every render of the caller.
 *
 * On a phone the frame changes shape rather than shrinking: `mobile="sheet"`
 * rises from the bottom edge, `mobile="full"` takes the whole screen.
 */

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';

const WIDTH = {
  sm: 'w-[460px]',
  md: 'w-[580px]',
  lg: 'w-[1040px]',
};

const Dialog = ({
  title,
  subtitle,
  icon,
  onClose,
  children,
  footer,
  size = 'md',
  role = 'dialog',
  mobile = 'center',
  initialFocus,
  // The header's own content, under the title: Help's page tabs live here so
  // they share the title's rule.
  headerExtra,
  // A dialog that asks a question has no "none of the above": it is answered
  // with one of its buttons.
  hideClose = false,
  bodyClassName = 'px-6 py-5',
  footerClassName = 'flex items-center gap-2.5 px-6 py-3.5',
  layer = 'z-[70]',
  id = 'dialog',
}) => {
  const isMobile = useIsMobile();
  const panelRef = useRef(null);
  // Read during the first render, before a child's `autoFocus` has moved the
  // focus into the dialog: this is what had it when the dialog was opened.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));

  useEffect(() => {
    const panel = panelRef.current;
    // A child that asked for the focus with `autoFocus` keeps it.
    if (!panel?.contains(document.activeElement)) {
      (initialFocus?.current ?? panel)?.focus?.();
    }
    return () => opener?.focus?.();
  }, [initialFocus, opener]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const panel = panelRef.current;
      const focusable = [...(panel?.querySelectorAll(FOCUSABLE) ?? [])];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const sheet = isMobile && mobile === 'sheet';
  const full = isMobile && mobile === 'full';
  const titleId = `${id}-title`;
  const subtitleId = subtitle ? `${id}-subtitle` : undefined;

  return (
    <div
      className={`fixed inset-0 ${layer} flex bg-black/50
        ${sheet ? 'items-end' : 'items-center justify-center'}
        ${sheet || full ? '' : 'p-6'}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={panelRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        className={`flex flex-col bg-panel-2 border-line shadow-float animate-fade-in outline-none
          overflow-hidden
          ${sheet ? 'w-full max-h-[88%] rounded-t-2xl border-t pb-safe'
      : full ? 'w-full h-app pt-safe'
        : `${WIDTH[size] ?? WIDTH.md} max-w-full max-h-[90vh] border rounded-2xl`}`}
      >
        {/* With nothing between them the header's rule and the footer's would
            sit on top of each other. */}
        <header className={`shrink-0 ${children || headerExtra ? 'border-b border-line-soft' : ''}`}>
          <div className="flex items-start gap-3 px-6 pt-4 pb-3.5">
            {icon}
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-[17px] font-semibold leading-snug text-fg">{title}</h2>
              {subtitle && (
                <p id={subtitleId} className="mt-1 text-[14px] leading-snug text-fg-2">{subtitle}</p>
              )}
            </div>
            {!hideClose && (
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                title="Close"
                className={`icon-btn -mr-2 -mt-1 ${isMobile ? 'w-11 h-11' : ''}`}
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            )}
          </div>
          {headerExtra}
        </header>

        {children && (
          <div className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${bodyClassName}`}>
            {children}
          </div>
        )}

        {footer && (
          <footer className={`shrink-0 border-t border-line-soft bg-panel ${footerClassName}
                              ${full ? 'pb-safe' : ''}`}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
};

export default Dialog;
