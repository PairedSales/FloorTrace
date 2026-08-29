import { useEffect, useCallback } from 'react';
import useAppStore from '../store/appStore';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * useUnitPreference
 *
 * The user's standing choice of unit, and the one place it is enforced.
 *
 * `appStore.unit` is per-plan and has to be: it rides along in a `.floorplan`,
 * in a park and in an undo snapshot. But it was also the *only* answer, so
 * every arrival path got to decide it — a scan that read a metric plan, a
 * project saved by someone else, a new plan falling back to the default — and
 * a user who works in feet was moved off feet by the drawing.
 *
 * Enforced in an effect rather than at each of those paths on purpose: there
 * are five of them (scan, new plan, project load, adopt, draft restore) and
 * they are the paths that keep being added to. One effect on the live plan
 * covers all of them and cannot be forgotten by the sixth.
 *
 * Workspace-level: it follows whichever plan is live, so it must never sit
 * inside a keyed subtree.
 *
 * @returns {{ unitPreference: string, setUnitPreference: (v: string) => void,
 *             chooseUnit: (unit: string) => void }}
 */
export default function useUnitPreference() {
  const unit = useAppStore((s) => s.unit);
  const setUnit = useAppStore((s) => s.setUnit);
  const unitPreference = useWorkspaceStore((s) => s.unitPreference);
  const setUnitPreference = useWorkspaceStore((s) => s.setUnitPreference);

  useEffect(() => {
    if (unitPreference === 'auto' || unit === unitPreference) return;
    setUnit(unitPreference);
  }, [unitPreference, unit, setUnit]);

  // Picking a unit from the dock's pill group *is* choosing a preferred unit —
  // there is no second gesture that says "and mean it". Without this the pills
  // and the View menu would be two controls for one setting, with the one you
  // reach for first being the one that does not last.
  const chooseUnit = useCallback((next) => {
    setUnitPreference(next);
    // Not left to the effect: with the preference already on `next`, a pinned
    // value the user re-picks after an undo restored a different `unit` would
    // otherwise be a no-op set.
    setUnit(next);
  }, [setUnit, setUnitPreference]);

  return { unitPreference, setUnitPreference, chooseUnit };
}
