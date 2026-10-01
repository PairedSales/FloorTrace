import { Fragment } from 'react';
import { RotateCcw, RotateCw, Trash2 } from 'lucide-react';
import { TOOL_GROUPS } from '../toolCatalog';
import BottomSheet from './BottomSheet';

// Turning the plan is one catalogue entry and two directions. A direction
// hidden behind a right-click is no direction at all on a phone, so it is two
// buttons here, as it is two rows in the desktop's Edit plan menu.
const ROTATIONS = [
  { dir: 'counterclockwise', icon: RotateCcw, label: 'Rotate left' },
  { dir: 'clockwise', icon: RotateCw, label: 'Rotate right' },
];

/**
 * The tools, shaped for a thumb.
 *
 * The same tools in the same groups as the desktop action bar's menus — it
 * imports that list rather than restating it — as a two-column grid of named
 * tiles. Two things a menu row does that a tile has to do differently:
 *
 *  1. A row has room for a sentence. A tile has two lines, so its name and,
 *     when it cannot be used, the reason have to fit on its face.
 *  2. Picking a tool is a one-shot decision on a phone — the sheet closes
 *     behind it and hands the whole screen back to the plan.
 *
 * The desktop's one-off commands ("Find the outline again", "Add another
 * outline") are not tiles: they are rows in the phone's menu sheet.
 */
const MobileToolSheet = ({
  open, onClose, activeTool, hasArea, hasToolData, onSelect, onRotate, onClearTools,
}) => (
  <BottomSheet open={open} onClose={onClose} title="Tools" subtitle="Pick one to work on the plan">
    <div className="p-3 pb-6">
      {TOOL_GROUPS.map((group) => (
        <Fragment key={group.id}>
          <h3 className="card-heading px-1 pt-3 pb-2 first:pt-0">{group.title}</h3>
          <div className="grid grid-cols-2 gap-2">
            {group.tools.map((tool) => {
              const Icon = tool.icon;
              const disabled = !!tool.needsArea && !hasArea;
              const active = activeTool === tool.id;

              if (tool.id === 'rotate') {
                return (
                  <div key={tool.id} className="col-span-2 grid grid-cols-2 gap-2">
                    {ROTATIONS.map((spin) => {
                      const SpinIcon = spin.icon;
                      return (
                        <button
                          key={spin.dir}
                          type="button"
                          onClick={() => onRotate(spin.dir)}
                          className="flex items-center gap-2.5 min-h-[52px] px-3 rounded-xl border
                                     border-line bg-panel-2 text-[14px] font-medium text-fg-2
                                     active:bg-sunken active:text-fg transition-colors"
                        >
                          <SpinIcon className="w-5 h-5 shrink-0" aria-hidden="true" />
                          {spin.label}
                        </button>
                      );
                    })}
                  </div>
                );
              }

              return (
                <button
                  key={tool.id}
                  type="button"
                  disabled={disabled}
                  aria-pressed={active}
                  onClick={() => { onSelect(tool.id); onClose(); }}
                  className={`flex flex-col items-start gap-1 min-h-[76px] p-3 rounded-xl border
                              text-left transition-colors disabled:opacity-45
                              ${active
                                ? 'bg-accent text-accent-ink border-accent'
                                : 'bg-panel-2 border-line text-fg-2 active:bg-sunken'}`}
                >
                  <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                  <span className={`text-[13.5px] font-semibold leading-tight
                                    ${active ? 'text-accent-ink' : 'text-fg'}`}>
                    {tool.short}
                  </span>
                  {/* What the tool is for or, when it cannot be used, why —
                      on the tile, because a tooltip on touch is never. */}
                  <span className={`text-[11.5px] leading-tight line-clamp-2
                                    ${active ? 'text-accent-ink/85' : 'text-fg-3'}`}>
                    {disabled ? tool.needsArea : (tool.hint ?? tool.label)}
                  </span>
                </button>
              );
            })}
          </div>
        </Fragment>
      ))}

      {hasToolData && (
        <button
          type="button"
          onClick={() => { onClearTools(); onClose(); }}
          className="mt-4 flex items-center justify-center gap-2 w-full min-h-[52px] rounded-xl
                     border border-crit/40 text-[14px] font-semibold text-crit active:bg-crit/10"
        >
          <Trash2 className="w-[18px] h-[18px]" aria-hidden="true" />
          Clear measurements &amp; areas
        </button>
      )}
    </div>
  </BottomSheet>
);

export default MobileToolSheet;
