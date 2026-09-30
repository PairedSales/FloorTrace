// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import MeasurementDock from '../MeasurementDock';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The panel's promises to someone who is not going to read its source:
 *
 *  - it leads with the answer, and never prints a pixel count as square feet;
 *  - it does not dress a doubtful number as finished — Export fills only when
 *    nothing is left to check;
 *  - when the outline could not be found, the way to draw it is right there;
 *  - the scale is said in words, never in pixels per foot.
 */
const square = [{ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1000, y: 500 }, { x: 0, y: 500 }];

const outline = (over = {}) => ({
  id: 'trace-1',
  name: '1st Floor',
  color: '#8b5cf6',
  visible: true,
  type: 'gla',
  vertices: square,
  holes: [],
  quality: { confidence: 0.92, warnings: [] },
  ...over,
});

const calibrated = {
  calibrated: true,
  feetPerPixel: { x: 0.04, y: 0.04 },
  source: 'room-calibration',
  quality: { source: 'auto', roomCount: 3, disagreement: Math.log(1.05) },
};

const noop = () => {};
const props = (over = {}) => ({
  roomDimensions: { width: '', height: '' },
  onDimensionsChange: noop,
  area: 0,
  unit: 'decimal',
  onUnitChange: noop,
  isProcessing: false,
  ocrFailed: false,
  useInteriorWalls: false,
  onInteriorWallToggle: noop,
  canSwitchWallFace: false,
  onDimensionFocus: noop,
  onDimensionBlur: noop,
  onScaleTool: noop,
  onSelectRoom: noop,
  onRestoreAutoScale: noop,
  onExport: noop,
  onFindOutline: noop,
  onPaintOutline: noop,
  onPlaceCorners: noop,
  onUseAlternative: noop,
  onRescan: noop,
  ...over,
});

const card = (view, id) => within(view.container.querySelector(`#dock-${id}`));

beforeEach(() => {
  useAppStore.setState({
    image: 'data:image/png;base64,AAAA',
    perimeterTraces: [],
    activeTraceId: 'trace-1',
    rooms: [],
    detectedDimensions: [],
    calibration: { calibrated: false, feetPerPixel: { x: 1, y: 1 }, source: null, quality: null },
    lastTraceOutcome: null,
    roomOverlay: null,
    focusedWarning: null,
    documents: {},
    documentOrder: [],
    activeDocumentId: null,
  });
  useWorkspaceStore.setState({ showWork: false });
});
afterEach(cleanup);

describe('the area', () => {
  it('leads with the square footage once there is a scale and an outline', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    // 1000 × 500 px at 0.04 ft/px is 40 × 20 ft.
    const view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(card(view, 'report').getByText('800')).toBeTruthy();
    expect(card(view, 'report').getByText('Gross living area')).toBeTruthy();
  });

  it('never prints a pixel count as square feet when there is no scale', () => {
    useAppStore.setState({ perimeterTraces: [outline()] });
    // With no scale the store falls back to a foot per pixel: 500,000 "ft²".
    const view = render(<MeasurementDock {...props({ area: 500000 })} />);
    expect(view.container.textContent).not.toMatch(/500,000/);
    expect(card(view, 'report').getByText('Set the scale to see the area.')).toBeTruthy();
    // Nor in the outline list beside it.
    expect(card(view, 'outline').queryByText(/ft²/)).toBeNull();
  });

  it('says why when the room sizes could not be read', () => {
    const view = render(<MeasurementDock {...props({ ocrFailed: true })} />);
    expect(card(view, 'report').getByText(/couldn’t read any room sizes/)).toBeTruthy();
  });

  it('fills Export only when nothing is left to check', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    let view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(view.getByRole('button', { name: /Export image/ }).className).toContain('btn-primary');
    cleanup();

    useAppStore.setState({
      perimeterTraces: [outline({ holes: [{ ring: square, stale: true }] })],
    });
    view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(view.getByRole('button', { name: /Export image/ }).className).not.toContain('btn-primary');
    expect(view.getByText(/1 thing to check before you use this area/)).toBeTruthy();
  });
});

describe('the outline', () => {
  it('puts the ways to draw it by hand in front of a failed trace', () => {
    const onPaintOutline = vi.fn();
    useAppStore.setState({
      calibration: calibrated,
      lastTraceOutcome: { level: 'failed', reason: null, floors: 0 },
    });
    const view = render(<MeasurementDock {...props({ onPaintOutline })} />);
    const paint = card(view, 'outline').getByRole('button', { name: /Paint over the outside walls/ });
    // The primary way forward, not the retry that just failed.
    expect(paint.className).toContain('btn-primary');
    fireEvent.click(paint);
    expect(onPaintOutline).toHaveBeenCalled();
    expect(card(view, 'outline').getByRole('button', { name: /Click the corners/ })).toBeTruthy();
  });

  it('opens its fixes by itself when there is something to check', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [outline({ holes: [{ ring: square, stale: true }] })],
    });
    const view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(card(view, 'outline').getByRole('button', { name: /Find the outline again/ })).toBeTruthy();
  });

  it('keeps its fixes folded on a clean outline until asked', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(card(view, 'outline').queryByRole('button', { name: /Find the outline again/ })).toBeNull();
    fireEvent.click(card(view, 'outline').getByText('Outline not right?'));
    expect(card(view, 'outline').getByRole('button', { name: /Find the outline again/ })).toBeTruthy();
  });
});

describe('the scale', () => {
  it('says where the scale came from, and never in pixels', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<MeasurementDock {...props({ area: 800 })} />);
    expect(card(view, 'scale').getByText('Measured from 3 rooms on this plan.')).toBeTruthy();
    expect(view.container.querySelector('#dock-scale').textContent).not.toMatch(/px/);
  });

  it('asks for the size of the room in the green box when nothing could be read', () => {
    useAppStore.setState({ roomOverlay: { x1: 0, y1: 0, x2: 100, y2: 100 } });
    const view = render(<MeasurementDock {...props({ ocrFailed: true })} />);
    expect(card(view, 'scale').getByText('Size of the room in the green box:')).toBeTruthy();
    expect(card(view, 'scale').getByLabelText('Width')).toBeTruthy();
    expect(card(view, 'scale').getByLabelText('Length')).toBeTruthy();
  });
});
