import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

/**
 * The mobile equivalent of the desktop side docks.
 *
 * A phone has no room for a 320 px panel beside the plan, and hiding the plan
 * behind a full-screen page to read a number off it is the wrong trade — the
 * outline and the area it produced have to be legible together, because
 * checking one against the other is the whole job. A sheet at 58 % leaves the
 * top of the plan visible; a drag up to 94 % is there for the warnings list,
 * which is prose and needs the room.
 *
 * Two detents, not three. A "peek" rung would put a third meaning on the same
 * gesture for a strip of content the action bar already carries.
 */

const HALF = 0.58;
const FULL = 0.94;
// Below this fraction of the half detent, a release dismisses rather than
// snapping back — the gesture was a throw-away, not an adjustment.
const DISMISS_RATIO = 0.55;
const FLICK_VELOCITY = 0.5; // px per ms

const BottomSheet = ({ open, onClose, title, subtitle, action, children, detent = 'half' }) => {
  const [height, setHeight] = useState(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef(null);
  const sheetRef = useRef(null);

  const detents = useCallback(() => {
    const vh = window.innerHeight || 800;
    return { half: Math.round(vh * HALF), full: Math.round(vh * FULL) };
  }, []);

  // Re-seat on open and on rotate. Not a layout effect: the transition from 0
  // is what makes the sheet read as arriving rather than blinking into place.
  useEffect(() => {
    if (!open) return undefined;
    const seat = () => setHeight(detents()[detent] ?? detents().half);
    seat();
    window.addEventListener('resize', seat);
    window.addEventListener('orientationchange', seat);
    return () => {
      window.removeEventListener('resize', seat);
      window.removeEventListener('orientationchange', seat);
    };
  }, [open, detent, detents]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  const onPointerDown = (e) => {
    // Only the grip area drags. The body owns its own scroll, and a sheet that
    // closes when you flick a long warnings list is a sheet you cannot read.
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = {
      startY: e.clientY,
      startHeight: height ?? detents().half,
      lastY: e.clientY,
      lastT: e.timeStamp,
      velocity: 0,
    };
    setDragging(true);
  };

  const onPointerMove = (e) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dt = e.timeStamp - drag.lastT;
    if (dt > 0) drag.velocity = (e.clientY - drag.lastY) / dt;
    drag.lastY = e.clientY;
    drag.lastT = e.timeStamp;
    const { full } = detents();
    setHeight(Math.max(0, Math.min(full, drag.startHeight - (e.clientY - drag.startY))));
  };

  const onPointerUp = () => {
    const drag = dragRef.current;
    dragRef.current = null;
    setDragging(false);
    if (!drag) return;

    const { half, full } = detents();
    const current = height ?? half;

    // A deliberate flick beats proximity: throwing the sheet down should close
    // it even from near the top, which is the whole point of throwing it.
    if (drag.velocity > FLICK_VELOCITY) {
      if (current < half * 1.05) { onClose(); return; }
      setHeight(half);
      return;
    }
    if (drag.velocity < -FLICK_VELOCITY) { setHeight(full); return; }

    if (current < half * DISMISS_RATIO) { onClose(); return; }
    setHeight(current > (half + full) / 2 ? full : half);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[65]" role="presentation">
      {/* The plan stays visible and lit through the scrim: the sheet is a panel
          over the work, not a page instead of it. */}
      <div
        className="absolute inset-0 bg-black/35 animate-fade-in"
        onPointerDown={onClose}
        aria-hidden="true"
      />

      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{ height: height ?? 0 }}
        className={`absolute inset-x-0 bottom-0 flex flex-col rounded-t-2xl bg-panel
                    border-t border-line shadow-sheet overflow-hidden
                    ${dragging ? '' : 'transition-[height] duration-200 ease-out'}`}
      >
        <div
          className="shrink-0 pt-2 pb-1 cursor-grab touch-none active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <span className="sheet-grip block" aria-hidden="true" />
        </div>

        <header className="flex items-center gap-2 px-4 pb-2.5 shrink-0 border-b border-line-soft">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold text-fg leading-tight truncate">{title}</h2>
            {subtitle && (
              <p className="text-[12.5px] text-fg-3 leading-tight truncate mt-px">{subtitle}</p>
            )}
          </div>
          {action}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="tap-target -mr-2 rounded-full text-fg-3 active:bg-sunken active:text-fg"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </header>

        {/* `overscroll-contain` stops a flick that reaches the end of this list
            from rubber-banding the page behind the sheet. */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain pb-safe touch-dense">
          {children}
        </div>
      </div>
    </div>
  );
};

export default BottomSheet;
