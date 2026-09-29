import { describe, it, expect } from 'vitest';
import { isCtrlWheelNotch } from '../useCanvasZoom';
import useWorkspaceStore, { ANNOTATION_SIZE_MIN, ANNOTATION_SIZE_MAX } from '../../store/workspaceStore';

describe('isCtrlWheelNotch', () => {
  it('takes a Ctrl + mouse-wheel notch', () => {
    expect(isCtrlWheelNotch({ ctrlKey: true, deltaMode: 0, deltaY: 100 })).toBe(true);
    expect(isCtrlWheelNotch({ ctrlKey: true, deltaMode: 0, deltaY: -120 })).toBe(true);
    expect(isCtrlWheelNotch({ ctrlKey: true, deltaMode: 1, deltaY: 3 })).toBe(true);
  });

  it('leaves a trackpad pinch to the camera', () => {
    expect(isCtrlWheelNotch({ ctrlKey: true, deltaMode: 0, deltaY: 2.37 })).toBe(false);
    expect(isCtrlWheelNotch({ ctrlKey: true, deltaMode: 0, deltaY: -4 })).toBe(false);
  });

  it('ignores a wheel without Ctrl', () => {
    expect(isCtrlWheelNotch({ ctrlKey: false, deltaMode: 0, deltaY: 100 })).toBe(false);
  });
});

describe('setAnnotationSize', () => {
  it('clamps to its bounds and ignores nonsense', () => {
    const { setAnnotationSize } = useWorkspaceStore.getState();
    setAnnotationSize(100);
    expect(useWorkspaceStore.getState().annotationSize).toBe(ANNOTATION_SIZE_MAX);
    setAnnotationSize(0.01);
    expect(useWorkspaceStore.getState().annotationSize).toBe(ANNOTATION_SIZE_MIN);
    setAnnotationSize(NaN);
    expect(useWorkspaceStore.getState().annotationSize).toBe(ANNOTATION_SIZE_MIN);
    setAnnotationSize(1.2);
    expect(useWorkspaceStore.getState().annotationSize).toBe(1.2);
  });
});
