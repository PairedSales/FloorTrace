import { Check, Loader2, Minus } from 'lucide-react';

/**
 * One step of the results panel: what FloorTrace did, what came of it, and —
 * folded behind it — the way to change it.
 *
 * The panel is the job in four steps that stay on screen: the room sizes were
 * read, the scale was worked out, the outside walls were found, the area was
 * added up. They are the same four lines the panel shows while it is measuring,
 * ticked off, so the finished panel reads as the record of what just happened
 * rather than as a different screen. Each step says its own conclusion in the
 * `summary` ("Measured from 3 rooms on this plan") and carries the one way to
 * change it. A step opens by itself when it holds the next thing to do; opened
 * or closed by hand, it stays that way.
 *
 * Shared rather than copied, so a step added later cannot arrive with its own
 * heading weight and padding and read as a different app half a panel down.
 *
 * ## The mark
 *
 * `state` is what the circle says, in form as well as colour:
 *
 *   done     a tick                the step produced something
 *   check    an exclamation mark   it holds something a picture cannot show
 *   todo     its number            not done yet
 *   active   a spinner             being done right now
 *   skipped  a dash                it ran and produced nothing
 *
 * An open step's tick is filled, so the one being looked at stands out of the
 * column.
 *
 * ## The header
 *
 * With `onToggle` the whole header is one button, and its last word says what
 * pressing it does: `actionLabel` ("Change", "Show the sum") while folded,
 * "Close" while open. Without it the step does not fold: `action` is whatever
 * belongs on its right (a real button of its own), and any children are always
 * on show under it (pass `open` so the mark is filled and the summary, which
 * the body says in full, is not repeated).
 *
 * `summary` is said only while folded: open, the step says it in full. `badge`
 * is a state (a chip) and is never dropped.
 */

const MARK = {
  done: 'bg-accent/15 text-accent-strong',
  open: 'bg-accent text-accent-ink',
  active: 'bg-accent text-accent-ink',
  // `panel-2`, not white: the dark theme's warn is a light amber.
  check: 'bg-warn text-panel-2',
  todo: 'border-[1.5px] border-line-strong bg-panel-2 text-fg-2',
  skipped: 'border-[1.5px] border-line-strong bg-panel-2 text-fg-3',
};

export const StepMark = ({ state = 'done', open = false, number }) => (
  <span
    aria-hidden="true"
    className={`relative z-[1] grid place-items-center w-7 h-7 shrink-0 rounded-full
                text-[15px] font-bold tabular-nums
                ${MARK[state === 'done' && open ? 'open' : state] ?? MARK.done}`}
  >
    {state === 'done' && <Check className="w-4 h-4" strokeWidth={3} />}
    {state === 'check' && '!'}
    {state === 'todo' && number}
    {state === 'active' && <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />}
    {state === 'skipped' && <Minus className="w-4 h-4" strokeWidth={2.5} />}
  </span>
);

// The line that joins one mark to the next, down the column of them.
export const StepLine = () => (
  <span aria-hidden="true" className="absolute left-[41px] top-[42px] -bottom-2.5 w-0.5 bg-line" />
);

const PanelSection = ({
  id,
  title,
  summary,
  badge,
  open = false,
  onToggle,
  state = 'done',
  number,
  actionLabel = 'Change',
  action,
  last = false,
  children,
}) => {
  const foldable = !!onToggle;
  const head = (
    <>
      <StepMark state={state} open={open} number={number} />
      <span className="flex-1 min-w-0 pt-0.5">
        <span className="flex items-baseline gap-2.5">
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 flex-1 min-w-0">
            <span data-step-title className={`text-[16.5px] font-bold leading-snug
                              ${state === 'todo' || state === 'skipped' ? 'text-fg-2' : 'text-fg'}`}>
              {title}
            </span>
            {badge}
          </span>
          {foldable && (
            <span className="shrink-0 text-[15px] font-bold text-accent-strong group-hover:underline">
              {open ? 'Close' : actionLabel}
            </span>
          )}
        </span>
        {/* Said only while folded: open, the step says it in full. */}
        {!open && summary && (
          <span className="block mt-0.5 text-[15.5px] leading-snug text-fg-2 [overflow-wrap:anywhere]">
            {summary}
          </span>
        )}
      </span>
    </>
  );

  return (
    <section id={id} className="relative">
      {!last && <StepLine />}
      <h3>
        {foldable ? (
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={onToggle}
            className="group flex w-full items-start gap-3.5 px-7 py-2.5 text-left
                       cursor-pointer transition-colors hover:bg-sunken/60"
          >
            {head}
          </button>
        ) : (
          <div className="flex w-full items-start gap-3.5 px-7 py-2.5 text-left">
            {head}
            {action && <span className="shrink-0 pt-0.5">{action}</span>}
          </div>
        )}
      </h3>
      {(foldable ? open : !!children) && (
        <div id={`${id}-body`} className="pl-[70px] pr-7 pt-1 pb-4">
          {children}
        </div>
      )}
    </section>
  );
};

export default PanelSection;
