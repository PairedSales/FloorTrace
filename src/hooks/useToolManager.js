import { useCallback } from 'react';
import useAppStore from '../store/appStore';
import * as undoManager from '../store/undoManager';

/**
 * useToolManager
 *
 * Owns all mutual-exclusion tool toggling. Reads tool flags directly from the
 * Zustand store (via targeted selectors) so App no longer needs to import them
 * purely for the toggle handlers.
 *
 * @returns {{
 *   handleLineToolToggle:   () => void,
 *   handleDrawAreaToggle:   () => void,
 *   handleEraserToolToggle: () => void,
 *   handleCropToolToggle:   () => void,
 *   handleClearTools:       () => void,
 * }}
 */
export function useToolManager() {
  // Read tool state via targeted selectors (each causes re-render only for its
  // own field, same pattern as App.jsx used).
  const lineToolActive   = useAppStore((s) => s.lineToolActive);
  const drawAreaActive   = useAppStore((s) => s.drawAreaActive);
  const eraserToolActive = useAppStore((s) => s.eraserToolActive);
  const cropToolActive   = useAppStore((s) => s.cropToolActive);

  const setLineToolActive         = useAppStore((s) => s.setLineToolActive);
  const setCurrentMeasurementLine = useAppStore((s) => s.setCurrentMeasurementLine);
  const setDrawAreaActive         = useAppStore((s) => s.setDrawAreaActive);
  const setCurrentCustomShape     = useAppStore((s) => s.setCurrentCustomShape);
  const setEraserToolActive       = useAppStore((s) => s.setEraserToolActive);
  const setCropToolActive         = useAppStore((s) => s.setCropToolActive);
  const setMeasurementLines       = useAppStore((s) => s.setMeasurementLines);
  const setCustomShapes           = useAppStore((s) => s.setCustomShapes);

  /**
   * Deactivate every tool and clear transient in-progress state.
   * Saves an undo point first so tool activations are undoable.
   */
  const deactivateAll = useCallback(() => {
    undoManager.save();
    setLineToolActive(false);
    setCurrentMeasurementLine(null);
    setDrawAreaActive(false);
    setCurrentCustomShape(null);
    setEraserToolActive(false);
    setCropToolActive(false);
  }, [
    setCropToolActive,
    setCurrentCustomShape,
    setCurrentMeasurementLine,
    setDrawAreaActive,
    setEraserToolActive,
    setLineToolActive,
  ]);

  // ── individual toggles ────────────────────────────────────────────────────

  const handleLineToolToggle = useCallback(() => {
    if (lineToolActive) {
      undoManager.save();
      setLineToolActive(false);
      setCurrentMeasurementLine(null);
      return;
    }
    deactivateAll();
    setLineToolActive(true);
  }, [lineToolActive, deactivateAll, setLineToolActive, setCurrentMeasurementLine]);

  const handleDrawAreaToggle = useCallback(() => {
    if (drawAreaActive) {
      undoManager.save();
      setDrawAreaActive(false);
      setCurrentCustomShape(null);
      return;
    }
    deactivateAll();
    setDrawAreaActive(true);
  }, [drawAreaActive, deactivateAll, setDrawAreaActive, setCurrentCustomShape]);

  const handleEraserToolToggle = useCallback(() => {
    if (eraserToolActive) {
      undoManager.save();
      setEraserToolActive(false);
      return;
    }
    deactivateAll();
    setEraserToolActive(true);
  }, [eraserToolActive, deactivateAll, setEraserToolActive]);

  const handleCropToolToggle = useCallback(() => {
    if (cropToolActive) {
      undoManager.save();
      setCropToolActive(false);
      return;
    }
    deactivateAll();
    setCropToolActive(true);
  }, [cropToolActive, deactivateAll, setCropToolActive]);

  // ── clear all measurement lines and custom shapes ─────────────────────────

  const handleClearTools = useCallback(() => {
    undoManager.save();
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setCustomShapes([]);
    setCurrentCustomShape(null);
  }, [setMeasurementLines, setCurrentMeasurementLine, setCustomShapes, setCurrentCustomShape]);

  return {
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCropToolToggle,
    handleClearTools,
  };
}
