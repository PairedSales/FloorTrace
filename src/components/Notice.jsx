import { useEffect, useState } from 'react';
import { AlertTriangle, CircleAlert, X } from 'lucide-react';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * The one notice: something outside the plan went wrong, and there is nowhere
 * on the plan or the panel to say it — a file that would not open, a save that
 * failed, storage that is full.
 *
 * It replaces a toast stack. The difference is not the look, it is the rule:
 *
 *  - **One at a time.** A second notice takes the first one's place. Two cards
 *    of different widths sliding over each other was the complaint that ended
 *    the stack, and a queue would only replay messages about things the user
 *    has already moved on from.
 *  - **Rare.** Nothing about the measurement is ever said here — that is the
 *    panel's, where it stays for as long as it is true — and nothing that
 *    merely happened to the plan, which is one line in the bar (`flash`). On a
 *    plan that opens and traces normally this component renders nothing at all.
 *
 * It waits to be read: it stays while the pointer or the keyboard is on it, and
 * a failure stays longer than a caution. It never takes the focus — the thing
 * that failed was started somewhere else, and that is where the user still is.
 */

// How long it stays if nobody touches it, by how much it matters.
const STAY_MS = { warn: 8000, crit: 12000 };
// …and at least this long after the pointer leaves it.
const STAY_AFTER_HOLD_MS = 2500;

const Notice = ({ top, left = 0 }) => {
  const notice = useWorkspaceStore((s) => s.notice);
  const dismissNotice = useWorkspaceStore((s) => s.dismissNotice);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!notice || held) return undefined;
    const remaining = Math.max(
      (STAY_MS[notice.tone] ?? STAY_MS.crit) - (Date.now() - notice.at),
      STAY_AFTER_HOLD_MS,
    );
    const timer = setTimeout(() => {
      // Only the notice this timer was started for: a newer one has its own.
      if (useWorkspaceStore.getState().notice === notice) dismissNotice();
    }, remaining);
    return () => clearTimeout(timer);
  }, [notice, held, dismissNotice]);

  if (!notice) return null;

  const failed = notice.tone === 'crit';
  const Icon = failed ? CircleAlert : AlertTriangle;

  return (
    // Centred over the plan rather than the window: `left` is the width of
    // whatever stands to the left of it (the results panel, when it is open).
    <div
      className="pointer-events-none fixed right-0 z-[65] flex justify-center px-4"
      style={{ top, left }}
    >
      <div
        // Keyed on the notice, so a replacement fades in as a new message
        // rather than swapping its words under the reader.
        key={notice.at}
        // A failure interrupts a screen reader; a caution waits its turn.
        role={failed ? 'alert' : 'status'}
        onMouseEnter={() => setHeld(true)}
        onMouseLeave={() => setHeld(false)}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        className={`pointer-events-auto flex max-w-[34rem] items-start gap-3 rounded-xl border
                    bg-raised py-3 pl-4 pr-2.5 shadow-float animate-fade-in
                    ${failed ? 'border-crit/35' : 'border-warn/35'}`}
      >
        <Icon
          className={`mt-0.5 h-5 w-5 shrink-0 ${failed ? 'text-crit' : 'text-warn'}`}
          aria-hidden="true"
        />
        <p className="min-w-0 flex-1 py-px text-[16px] leading-snug text-fg [overflow-wrap:anywhere]">
          {notice.text}
        </p>
        <button
          type="button"
          onClick={dismissNotice}
          aria-label="Dismiss"
          title="Dismiss"
          className="icon-btn h-8 w-8 shrink-0"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default Notice;
