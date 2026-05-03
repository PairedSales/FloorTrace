import { Plus, X } from 'lucide-react';
import useAppStore from '../store/appStore';

const FloorTabs = () => {
  const floors = useAppStore((s) => s.floors);
  const activeFloorId = useAppStore((s) => s.activeFloorId);
  const addFloor = useAppStore((s) => s.addFloor);
  const switchFloor = useAppStore((s) => s.switchFloor);
  const closeFloor = useAppStore((s) => s.closeFloor);

  // Only visible with 2+ floors
  if (floors.length < 2) return null;

  const canAddMore = floors.length < 4;

  return (
    <div className="flex shrink-0 flex-col border-r border-chrome-700 bg-chrome-800 pointer-events-none">
      <section className="px-3 py-3 pointer-events-auto">
        <div className="flex items-center justify-between mb-1.5">
          <h3 className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">
            Floors
          </h3>
          {canAddMore && (
            <button
              onClick={addFloor}
              className="text-[11px] font-semibold text-accent uppercase tracking-wider hover:text-accent-hover cursor-pointer transition-colors duration-200 flex items-center gap-0.5"
              title="Add new floor"
            >
              <Plus className="w-3 h-3" />
              ADD
            </button>
          )}
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {floors.map((floor) => {
            const isActive = floor.id === activeFloorId;

            return (
              <div
                key={floor.id}
                role="button"
                tabIndex={0}
                onClick={() => switchFloor(floor.id)}
                onKeyDown={(e) => e.key === 'Enter' && switchFloor(floor.id)}
                className={`group relative flex flex-col items-center gap-1 px-2 py-2 rounded-md text-[10px] font-medium transition-all duration-200 cursor-pointer select-none ${
                  isActive
                    ? 'bg-accent/15 text-accent border border-accent/30'
                    : 'bg-chrome-900/50 text-slate-400 border border-chrome-700 hover:text-slate-200 hover:border-chrome-600'
                }`}
                title={floor.name}
              >
                <span className="leading-none whitespace-nowrap">{floor.name}</span>

                {/* Close button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    closeFloor(floor.id);
                  }}
                  className={`absolute -top-1 -right-1 w-3.5 h-3.5 flex items-center justify-center rounded-full bg-chrome-800 border transition-all duration-200 ${
                    isActive
                      ? 'border-accent/30 text-accent/60 hover:text-red-400 hover:border-red-400/40 opacity-0 group-hover:opacity-100'
                      : 'border-chrome-600 text-slate-500 hover:text-red-400 hover:border-red-400/40 opacity-0 group-hover:opacity-100'
                  }`}
                  title={`Close ${floor.name}`}
                >
                  <X className="w-2 h-2" />
                </button>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};

export default FloorTabs;
