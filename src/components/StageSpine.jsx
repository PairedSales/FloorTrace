import { Check, AlertTriangle } from 'lucide-react';

/**
 * The app's actual pipeline, as state.
 *
 * FloorTrace has always run load → read dimensions → calibrate scale → trace
 * outline → review, but the UI presented that as twenty flat buttons and never
 * said where the user was in it. This is the smallest honest rendering of it:
 * four stages, each `todo` / `done` / `warn`, derived from the same store the
 * cards below read.
 *
 * It is a status display first and navigation second — clicking a stage jumps
 * to the card that answers it.
 */
const STATE_STYLE = {
  done: { bar: 'bg-ok', label: 'text-fg-2' },
  warn: { bar: 'bg-warn', label: 'text-warn' },
  todo: { bar: 'bg-line', label: 'text-fg-dim' },
};

const Step = ({ label, state, title, onSelect }) => {
  const style = STATE_STYLE[state] ?? STATE_STYLE.todo;
  return (
    <button
      type="button"
      onClick={onSelect}
      title={title}
      className="flex flex-col gap-1.5 text-left cursor-pointer group"
    >
      <span className={`h-[3px] rounded-full ${style.bar}`} />
      <span className={`flex items-center gap-1 text-[10.5px] font-semibold uppercase
                        tracking-[.05em] group-hover:text-fg transition-colors ${style.label}`}>
        {state === 'done' && <Check className="w-3 h-3 shrink-0" aria-hidden="true" />}
        {state === 'warn' && <AlertTriangle className="w-3 h-3 shrink-0" aria-hidden="true" />}
        {label}
      </span>
    </button>
  );
};

const StageSpine = ({ stages, onSelect }) => (
  <div className="grid grid-cols-4 gap-1 shrink-0" role="group" aria-label="Progress">
    {stages.map((s) => (
      <Step key={s.id} {...s} onSelect={() => onSelect?.(s.id)} />
    ))}
  </div>
);

export default StageSpine;
