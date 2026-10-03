import useAppStore from '../store/appStore';
import { MAX_TRACES, alternativeCount as countAlternatives } from '../utils/planStage';

const BUSY_REASON = 'Wait until FloorTrace has finished what it is doing.';

/**
 * What each row of a task menu is allowed to do right now.
 *
 * Its own hook because two places hang these menus: the bar above the plan
 * (Measure, Edit plan) and the results panel's outline step (the ways to change
 * the outline). The same row must stand down, or grey out with the same reason,
 * wherever it is listed.
 *
 * Returns a function of a `toolCatalog.js` entry: `null` to stand the row down,
 * otherwise whether it is usable and, when it is not, why. Rows that cannot be
 * used stay in place — a row never moves out from under the pointer.
 *
 * Commands that start work (find the outline, the next-best outline) wait for a
 * running job; tools do not — entering a mode changes nothing the job was
 * computed from.
 */
export const useToolRows = ({ hasArea = false, hasToolData = false } = {}) => {
  const isProcessing = useAppStore((s) => s.isProcessing);
  const perimeterTraces = useAppStore((s) => s.perimeterTraces);
  const activeTraceId = useAppStore((s) => s.activeTraceId);
  const painting = useAppStore((s) => s.drawModeActive);

  const traces = perimeterTraces ?? [];
  const tracedCount = traces.filter((t) => t.vertices?.length >= 3).length;
  const alternatives = countAlternatives(traces, activeTraceId);

  return (entry) => {
    if (!entry) return null;
    switch (entry.id) {
      case 'alternative':
        if (!alternatives) return null;
        return {
          label: alternatives > 1 ? `Try another outline (${alternatives} more)` : entry.label,
          disabled: isProcessing || painting,
          reason: BUSY_REASON,
        };
      case 'findOutline':
        return {
          label: tracedCount > 0 ? entry.label : 'Find the outline',
          disabled: isProcessing || painting,
          reason: BUSY_REASON,
        };
      case 'addOutline':
        if (tracedCount === 0) {
          return { disabled: true, reason: 'Draw the first outline before adding another.' };
        }
        return traces.length >= MAX_TRACES
          ? { disabled: true, reason: `${MAX_TRACES} outlines is the most one plan can have.` }
          : { disabled: false };
      case 'clearMeasurements':
        return hasToolData ? { disabled: false } : null;
      default:
        return { disabled: !!entry.needsArea && !hasArea, reason: entry.needsArea };
    }
  };
};
