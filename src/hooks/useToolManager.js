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
  const angleToolActive   = useAppStore((s) => s.angleToolActive);
  const drawModeActive   = useAppStore((s) => s.drawModeActive);
  const scaleToolActive  = useAppStore((s) => s.scaleToolActive);
  const voidToolActive   = useAppStore((s) => s.voidToolActive);

  const setLineToolActive         = useAppStore((s) => s.setLineToolActive);
  const setCurrentMeasurementLine = useAppStore((s) => s.setCurrentMeasurementLine);
  const setDrawAreaActive         = useAppStore((s) => s.setDrawAreaActive);
  const setCurrentCustomShape     = useAppStore((s) => s.setCurrentCustomShape);
  const setEraserToolActive       = useAppStore((s) => s.setEraserToolActive);
  const setCropToolActive         = useAppStore((s) => s.setCropToolActive);
  const setAngleToolActive         = useAppStore((s) => s.setAngleToolActive);
  const setDrawModeActive         = useAppStore((s) => s.setDrawModeActive);
  const setVoidToolActive         = useAppStore((s) => s.setVoidToolActive);
  const setMeasurementLines       = useAppStore((s) => s.setMeasurementLines);
  const setCustomShapes           = useAppStore((s) => s.setCustomShapes);
  const setScaleToolActive        = useAppStore((s) => s.setScaleToolActive);
  const setCurrentScaleLine       = useAppStore((s) => s.setCurrentScaleLine);

  /**
   * Deactivate every tool and clear transient in-progress state.
   * Saves an undo point first so tool activations are undoable.
   */
  const deactivateAll = useCallback(() => {
    if (lineToolActive || drawAreaActive || eraserToolActive || cropToolActive
        || scaleToolActive || voidToolActive) {
      undoManager.save();
    }
    setLineToolActive(false);
    setCurrentMeasurementLine(null);
    setDrawAreaActive(false);
    setCurrentCustomShape(null);
    setEraserToolActive(false);
    setCropToolActive(false);
    setAngleToolActive(false);
    setDrawModeActive(false);
    setScaleToolActive(false);
    setCurrentScaleLine(null);
    setVoidToolActive(false);
  }, [
    lineToolActive,
    drawAreaActive,
    eraserToolActive,
    cropToolActive,
    scaleToolActive,
    voidToolActive,
    setAngleToolActive,
    setCropToolActive,
    setCurrentCustomShape,
    setCurrentMeasurementLine,
    setCurrentScaleLine,
    setDrawAreaActive,
    setDrawModeActive,
    setEraserToolActive,
    setLineToolActive,
    setScaleToolActive,
    setVoidToolActive,
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

  const handleScaleToolToggle = useCallback(() => {
    if (scaleToolActive) {
      undoManager.save();
      setScaleToolActive(false);
      setCurrentScaleLine(null);
      return;
    }
    deactivateAll();
    setScaleToolActive(true);
  }, [scaleToolActive, deactivateAll, setScaleToolActive, setCurrentScaleLine]);

  const handleVoidToolToggle = useCallback(() => {
    if (voidToolActive) {
      undoManager.save();
      setVoidToolActive(false);
      return;
    }
    deactivateAll();
    setVoidToolActive(true);
  }, [voidToolActive, deactivateAll, setVoidToolActive]);

  const handleAngleToolToggle = useCallback(() => {
    if (angleToolActive) {
      setAngleToolActive(false);
      return;
    }
    deactivateAll();
    setAngleToolActive(true);
  }, [angleToolActive, deactivateAll, setAngleToolActive]);

  // Draw mode owns the perimeter, so activating it is not symmetric with the
  // other tools: App clears the outline and the strokes around this call.
  const handleDrawModeToggle = useCallback(() => {
    if (drawModeActive) {
      setDrawModeActive(false);
      return false;
    }
    deactivateAll();
    setDrawModeActive(true);
    return true;
  }, [drawModeActive, deactivateAll, setDrawModeActive]);

  // ── clear all measurement lines and custom shapes ─────────────────────────

  const handleClearTools = useCallback(() => {
    undoManager.save();
    setMeasurementLines([]);
    setCurrentMeasurementLine(null);
    setCustomShapes([]);
    setCurrentCustomShape(null);
  }, [setMeasurementLines, setCurrentMeasurementLine, setCustomShapes, setCurrentCustomShape]);

  return {
    // Exported so the shell can leave whatever tool is on without knowing
    // which one it was — the rail's Select button and the status bar's
    // Cancel both mean "no tool", not "toggle this specific flag".
    deactivateAll,
    handleLineToolToggle,
    handleDrawAreaToggle,
    handleEraserToolToggle,
    handleCropToolToggle,
    handleAngleToolToggle,
    handleDrawModeToggle,
    handleScaleToolToggle,
    handleClearTools,
    handleVoidToolToggle,
  };
}
