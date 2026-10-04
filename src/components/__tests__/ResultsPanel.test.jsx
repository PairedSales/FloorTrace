// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within, act } from '@testing-library/react';
import ResultsPanel from '../ResultsPanel';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { PROGRESS } from '../../utils/progressSteps';

/**
 * The panel's promises to someone who is not going to read its source:
 *
 *  - it leads with the answer, and never prints a pixel count as square feet;
 *  - under the answer are the four steps it was reached by, the same four it
 *    lists while it measures;
 *  - at rest it is the answer and four folded lines, not forty controls;
 *  - a step opens by itself when it holds the next thing to do;
 *  - it says what a picture cannot show — a doubtful scale, an area counted
 *    twice — in the section it is about, and nothing about how well the
 *    outline follows the walls;
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
  isProcessing: false,
  ocrFailed: false,
  useInteriorWalls: false,
  onInteriorWallToggle: noop,
  canSwitchWallFace: false,
  onDimensionFocus: noop,
  onDimensionBlur: noop,
  onScaleTool: noop,
  onSelectRoom: noop,
  onExport: noop,
  onFindOutline: noop,
  onPaintOutline: noop,
  onPlaceCorners: noop,
  onAddOutline: noop,
  onRescan: noop,
  ...over,
});

const part = (view, id) => within(view.container.querySelector(`#panel-${id}`));
const header = (view, id) => view.container.querySelector(`#panel-${id} > h3 > button[aria-expanded]`);
// A step with no fold (the scale, the outline) is open whenever its body is
// on the page.
const isOpen = (view, id) => (header(view, id)
  ? header(view, id).getAttribute('aria-expanded') === 'true'
  : !!view.container.querySelector(`#panel-${id}-body`));
const open = (view, id) => { if (!isOpen(view, id)) fireEvent.click(header(view, id)); };

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
    documents: {},
    documentOrder: [],
    activeDocumentId: null,
    drawModeActive: false,
    scaleToolActive: false,
    scaleLines: [],
    perimeterVertices: null,
    processingMessage: '',
  });
  useWorkspaceStore.setState({ showWork: false });
});
afterEach(cleanup);

describe('the area', () => {
  it('leads with the square footage once there is a scale and an outline', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    // 1000 × 500 px at 0.04 ft/px is 40 × 20 ft.
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(part(view, 'area').getByText('800')).toBeTruthy();
    expect(part(view, 'area').getByText('Gross living area')).toBeTruthy();
  });

  it('never prints a pixel count as square feet when there is no scale', () => {
    useAppStore.setState({ perimeterTraces: [outline()] });
    // Even with the calculation switched on — it is a saved preference, so a
    // plan with no scale can open with it already showing.
    useWorkspaceStore.setState({ showWork: true });
    // With no scale the store falls back to a foot per pixel: 500,000 "ft²".
    const view = render(<ResultsPanel {...props({ area: 500000 })} />);
    expect(view.container.querySelector('#panel-work')).toBeNull();
    expect(view.container.textContent).not.toMatch(/500,000/);
    expect(part(view, 'area').getByText('Set the scale to see the area.')).toBeTruthy();
    // Nor in the outline list beside it.
    open(view, 'outline');
    expect(part(view, 'outline').queryByText(/ft²/)).toBeNull();
  });

  it('says the outlines are hidden, rather than that there is none', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline({ visible: false })] });
    const view = render(<ResultsPanel {...props({ area: 0 })} />);
    expect(part(view, 'area').getByText(/Every outline is hidden/)).toBeTruthy();
  });

  // "No outline yet", half-way through drawing one, reads as the app having
  // lost it.
  it('says the figure is on its way while a new outline is being drawn', () => {
    useAppStore.setState({ calibration: calibrated, perimeterVertices: [] });
    const view = render(<ResultsPanel {...props()} />);
    expect(part(view, 'area').getByText(/once the new outline is drawn/)).toBeTruthy();
    expect(part(view, 'area').queryByText('No outline yet.')).toBeNull();
  });

  it('says why when the room sizes could not be read', () => {
    const view = render(<ResultsPanel {...props({ ocrFailed: true })} />);
    expect(part(view, 'area').getByText(/couldn’t read any room sizes/)).toBeTruthy();
  });

  it('says so under the figure when it is measured to the inside of the walls', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    let view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(part(view, 'area').queryByText(/inside of the walls/)).toBeNull();
    cleanup();
    view = render(<ResultsPanel {...props({ area: 800, useInteriorWalls: true })} />);
    expect(part(view, 'area').getByText(/Measured to the inside of the walls/)).toBeTruthy();
  });
});

describe('at rest it is the answer and its folded parts', () => {
  beforeEach(() => useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] }));

  it('folds only the sum on a clean plan, and always shows the scale and the outline', () => {
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(isOpen(view, 'work')).toBe(false);
    // Neither the scale nor the outline folds.
    for (const id of ['scale', 'outline']) {
      expect(header(view, id), id).toBeNull();
      expect(isOpen(view, id), id).toBe(true);
    }
    expect(part(view, 'scale').getByText('Measured from 3 rooms on this plan.')).toBeTruthy();
    expect(part(view, 'scale').getByRole('button', { name: /Set scale from a known length/ })).toBeTruthy();
    expect(part(view, 'outline').getByLabelText('Outline name').value).toBe('1st Floor');
    expect(part(view, 'outline').getByLabelText('Counts as')).toBeTruthy();
  });

  it('has no unit switch — the units are a setting', () => {
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(view.queryByRole('group', { name: 'Units' })).toBeNull();
  });

  it('opens and folds the sum by hand, and it stays how it was left', () => {
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    fireEvent.click(header(view, 'work'));
    expect(isOpen(view, 'work')).toBe(true);
    // A change elsewhere does not fold it again.
    act(() => useAppStore.setState({ rooms: [{ rect: {} }] }));
    expect(isOpen(view, 'work')).toBe(true);
    fireEvent.click(header(view, 'work'));
    expect(isOpen(view, 'work')).toBe(false);
  });
});

describe('a section opens by itself when it holds the next thing to do', () => {
  it('opens the scale when the rooms did not agree, and says so there', () => {
    useAppStore.setState({
      calibration: {
        ...calibrated,
        quality: { source: 'auto', reason: 'rooms-disagree', roomCount: 4, disagreement: 0.3 },
      },
      perimeterTraces: [outline()],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(isOpen(view, 'scale')).toBe(true);
    expect(part(view, 'scale').getByText(/Rooms disagree by/)).toBeTruthy();
    // What it means for the area, and the way out of it, in the same place.
    expect(part(view, 'scale').getByText(/imply sizes about .* apart/)).toBeTruthy();
    expect(part(view, 'scale').getByRole('button', { name: /Set scale from a known length/ })).toBeTruthy();
    // And its heading says there is something in it.
    expect(part(view, 'scale').getByText('Check')).toBeTruthy();
  });

  it('opens the outline when a cut-out is no longer taken off, and says so on its row', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [outline({ holes: [{ ring: square, stale: true }] })],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(isOpen(view, 'outline')).toBe(true);
    expect(part(view, 'outline').getByText(/A cut-out is no longer inside this outline/)).toBeTruthy();
    expect(part(view, 'outline').getByText(/no longer taken off the area/)).toBeTruthy();
  });

  it('says so under Outline when a garage is outlined inside the living area and counted twice', () => {
    const inner = [{ x: 100, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 300 }, { x: 100, y: 300 }];
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [
        outline(),
        outline({ id: 'trace-2', name: 'Garage', type: 'garage', vertices: inner }),
      ],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(part(view, 'outline').getByText('Garage sits inside 1st Floor')).toBeTruthy();
    expect(part(view, 'outline').getByText(/counted twice/)).toBeTruthy();
    expect(part(view, 'outline').getByText('Check')).toBeTruthy();
  });

  it('opens the scale when there is none', () => {
    useAppStore.setState({ perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 500000 })} />);
    expect(isOpen(view, 'scale')).toBe(true);
    expect(part(view, 'scale').getByRole('button', { name: /Set scale from a known length/ })).toBeTruthy();
  });

  // Measuring a known length ends with typing it into Scale.
  it('opens the scale when the length tool starts, wherever it was left', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    act(() => useAppStore.setState({ scaleToolActive: true }));
    expect(isOpen(view, 'scale')).toBe(true);
    expect(part(view, 'scale').getByText('Lengths you measured')).toBeTruthy();
  });

  it('opens the outlines once there is more than one to tell apart', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [outline(), outline({ id: 'trace-2', name: 'Garage', type: 'garage' })],
    });
    const view = render(<ResultsPanel {...props({ area: 1600 })} />);
    expect(isOpen(view, 'outline')).toBe(true);
    expect(part(view, 'outline').getAllByLabelText('Outline name')).toHaveLength(2);
  });

  it('takes the “Set the scale” button to the scale', () => {
    useAppStore.setState({ perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 500000 })} />);
    fireEvent.click(part(view, 'area').getByRole('button', { name: 'Set the scale' }));
    expect(isOpen(view, 'scale')).toBe(true);
  });
});

/**
 * The green box on the plan is the room the scale was taken from. At rest it
 * was an unexplained rectangle on one room of the house — and it is draggable,
 * so moving it by accident re-set the scale every area is worked out from. It
 * is drawn while the scale step is on show, which is where it is explained —
 * and that step no longer folds, so the box is there whenever the steps are.
 */
describe('the room the scale came from', () => {
  const shown = () => useWorkspaceStore.getState().scaleRoomShown;
  beforeEach(() => {
    useWorkspaceStore.setState({ scaleRoomShown: false });
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()], mode: 'normal' });
  });

  it('is drawn on the plan while the panel shows the scale', () => {
    render(<ResultsPanel {...props({ area: 800 })} />);
    expect(shown()).toBe(true);
  });

  it('goes when the panel does', () => {
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    view.unmount();
    expect(shown()).toBe(false);
  });

  // Picking a room ends with checking its green box and its size.
  it('shows the scale while a room is being picked', () => {
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    act(() => useAppStore.setState({ mode: 'manual', detectedDimensions: [{ text: '12x14' }] }));
    expect(isOpen(view, 'scale')).toBe(true);
    expect(shown()).toBe(true);
  });

  // While FloorTrace is first measuring a plan there is no scale step yet,
  // and no box to explain.
  it('is not drawn while a plan is first being measured', () => {
    useAppStore.setState({
      calibration: { calibrated: false, feetPerPixel: { x: 1, y: 1 }, source: null, quality: null },
      perimeterTraces: [], processingMessage: 'Measuring the rooms…',
    });
    render(<ResultsPanel {...props({ isProcessing: true })} />);
    expect(shown()).toBe(false);
  });

  // The phone's sheet has to be closed to reach the plan, so it draws the box
  // always and this flag is not its to set.
  it('is left alone by the phone sheet', () => {
    const view = render(<ResultsPanel {...props({ area: 800, mobile: true })} />);
    expect(isOpen(view, 'scale')).toBe(true);
    expect(shown()).toBe(false);
  });
});

describe('while FloorTrace is measuring the plan by itself', () => {
  it('shows the job as the four steps, and nothing to fold or correct', () => {
    useAppStore.setState({ processingMessage: PROGRESS.measuringRooms, detectedDimensions: [{}] });
    const view = render(<ResultsPanel {...props({ isProcessing: true })} />);
    const steps = part(view, 'steps').getAllByRole('listitem');
    expect(steps.map((s) => s.querySelector('[data-step-title]').textContent)).toEqual([
      'Reading the room sizes', 'Working out the scale', 'Finding the outside walls', 'Adding up the area',
    ]);
    expect(steps.map((s) => s.getAttribute('data-state'))).toEqual(['done', 'active', 'todo', 'todo']);
    expect(steps[1].getAttribute('aria-current')).toBe('step');
    // Where the figure will be, and that it is coming.
    expect(part(view, 'area').getByText('The area will show here in a moment.')).toBeTruthy();
    expect(view.container.querySelector('#panel-scale')).toBeNull();
    expect(view.container.querySelector('#panel-outline')).toBeNull();
    expect(view.queryByRole('button', { name: /Save image/ })).toBeNull();
  });

  // The list must not draw a check beside a step that produced nothing.
  it('does not tick a step that produced nothing', () => {
    useAppStore.setState({ processingMessage: PROGRESS.findingOutline, detectedDimensions: [] });
    const view = render(<ResultsPanel {...props({ isProcessing: true })} />);
    const [read, scale] = part(view, 'steps').getAllByRole('listitem');
    expect(read.getAttribute('data-state')).toBe('skipped');
    expect(scale.getAttribute('data-state')).toBe('skipped');
  });

  it('says it in a line when the job is not one of the three steps', () => {
    useAppStore.setState({ processingMessage: 'Drawing the outline from your painting…' });
    const view = render(<ResultsPanel {...props({ isProcessing: true })} />);
    expect(part(view, 'area').getByText('Drawing the outline from your painting…')).toBeTruthy();
    expect(view.queryAllByRole('listitem')).toHaveLength(0);
    expect(view.container.querySelector('#panel-steps')).toBeNull();
  });

  it('keeps the answer on screen while a plan that has one is measured again', () => {
    useAppStore.setState({
      calibration: calibrated, perimeterTraces: [outline()], processingMessage: PROGRESS.findingOutline,
    });
    const view = render(<ResultsPanel {...props({ area: 800, isProcessing: true })} />);
    expect(part(view, 'area').getByText('800')).toBeTruthy();
    expect(view.container.querySelector('#panel-scale')).toBeTruthy();
  });
});

describe('saving the image', () => {
  it('is the filled button as soon as there is an area to save', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(view.getByRole('button', { name: /Save image/ }).className).toContain('btn-primary');
  });

  // The outline is on the plan and the user has looked at it. A button that
  // waited on the detector's opinion of it never filled on some plans.
  it('does not wait on what the detector made of the outline', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [outline({
        quality: {
          source: 'auto',
          confidence: 0.4,
          warnings: [
            { code: 'bridged-opening', severity: 'warn', message: 'a gap was closed' },
            { code: 'unsealed', severity: 'error', message: 'the outline never closed' },
          ],
        },
      })],
      lastTraceOutcome: { level: 'poor', reason: 'the outline never closed', floors: 1 },
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(view.getByRole('button', { name: /Save image/ }).className).toContain('btn-primary');
    // …and none of it is narrated: no list, no count, no percentage.
    expect(view.container.querySelector('#panel-checks')).toBeNull();
    expect(view.queryByText(/to check/i)).toBeNull();
    expect(view.queryByText(/gap|never closed|wall match|%/i)).toBeNull();
  });

  it('is not the filled button while the area has no scale behind it', () => {
    useAppStore.setState({ perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 500000 })} />);
    expect(view.getByRole('button', { name: /Save image/ }).className).not.toContain('btn-primary');
  });

  it('is pinned to the foot of the panel, outside what scrolls', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const onExport = vi.fn();
    const view = render(<ResultsPanel {...props({ area: 800, onExport })} />);
    const save = view.getByRole('button', { name: /Save image/ });
    expect(save.closest('.overflow-y-auto')).toBeNull();
    fireEvent.click(save);
    expect(onExport).toHaveBeenCalled();
  });

  it('is not offered before there is anything to save', () => {
    const view = render(<ResultsPanel {...props()} />);
    expect(view.queryByRole('button', { name: /Save image/ })).toBeNull();
  });
});

describe('the outline', () => {
  it('puts the ways to draw it by hand in front of a failed trace', () => {
    const onPaintOutline = vi.fn();
    useAppStore.setState({
      calibration: calibrated,
      lastTraceOutcome: { level: 'failed', reason: null, floors: 0 },
    });
    const view = render(<ResultsPanel {...props({ onPaintOutline })} />);
    expect(isOpen(view, 'outline')).toBe(true);
    const paint = part(view, 'outline').getByRole('button', { name: /Paint over the walls/ });
    // The primary way forward, not the retry that just failed.
    expect(paint.className).toContain('btn-primary');
    fireEvent.click(paint);
    expect(onPaintOutline).toHaveBeenCalled();
    expect(part(view, 'outline').getByRole('button', { name: /Click the corners/ })).toBeTruthy();
    expect(part(view, 'outline').getByRole('button', { name: /Try the automatic outline again/ })).toBeTruthy();
  });

  // With no outline there is no picture to read the reason from, so this is the
  // one time the detector's reason is put into words.
  it('says why a trace found nothing, when the trace said', () => {
    useAppStore.setState({
      calibration: calibrated,
      lastTraceOutcome: {
        level: 'failed', floors: 0,
        reason: 'the walls are drawn too thin at this image size to be followed reliably',
      },
    });
    const view = render(<ResultsPanel {...props()} />);
    expect(part(view, 'outline').getByText(
      'The walls are drawn too thin at this image size to be followed reliably.',
    )).toBeTruthy();
  });

  it('says where a type FloorTrace chose was read from', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [
        outline(),
        outline({
          id: 'trace-2', name: 'Basement', type: 'below-grade',
          typeSource: 'detected', typeEvidence: { text: ' BASEMENT ' },
          vertices: [{ x: 2000, y: 0 }, { x: 2500, y: 0 }, { x: 2500, y: 500 }, { x: 2000, y: 500 }],
        }),
      ],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(part(view, 'outline').getByText('Set from “BASEMENT” on the plan.')).toBeTruthy();
  });

  it('leads with finding it when nothing has been tried', () => {
    useAppStore.setState({ calibration: calibrated });
    const view = render(<ResultsPanel {...props()} />);
    expect(part(view, 'outline').getByRole('button', { name: 'Find the outline' }).className)
      .toContain('btn-primary');
  });

  // The ways to change an outline that exists are one menu, not a row of
  // buttons: opening the step shows the outline, and the tools are a click on.
  it('does not lay the redraw tools out as buttons once there is an outline', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'outline');
    expect(part(view, 'outline').queryByRole('button', { name: /Paint over the walls/ })).toBeNull();
    expect(part(view, 'outline').queryByRole('button', { name: /Find the outline/ })).toBeNull();
    expect(part(view, 'outline').getByRole('button', { name: /Add another outline/ })).toBeTruthy();
  });

  // Through the shell, not the store: the shell is what takes an added outline
  // back out again if it is abandoned before it is drawn.
  it('adds another outline through the shell', () => {
    const onAddOutline = vi.fn();
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800, onAddOutline })} />);
    open(view, 'outline');
    fireEvent.click(part(view, 'outline').getByRole('button', { name: /Add another outline/ }));
    expect(onAddOutline).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().perimeterTraces).toHaveLength(1);
  });

  it('spells out what GLA is in the list of what an outline counts as', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'outline');
    const options = [...part(view, 'outline').getByLabelText('Counts as').options].map((o) => o.textContent);
    expect(options[0]).toBe('Living area (GLA)');
    expect(options).toContain('Garage');
  });

  it('offers inside or outside of the walls only where the outline can take it, and says the standard', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const onInteriorWallToggle = vi.fn();
    let view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'outline');
    expect(part(view, 'outline').queryByRole('group', { name: /Measure every outline to/ })).toBeNull();
    cleanup();

    view = render(<ResultsPanel {...props({ area: 800, canSwitchWallFace: true, onInteriorWallToggle })} />);
    open(view, 'outline');
    const group = part(view, 'outline').getByRole('group', { name: /Measure every outline to/ });
    expect(within(group).getByRole('button', { name: 'Outside of walls' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'Inside' }));
    expect(onInteriorWallToggle).toHaveBeenCalledWith(true);
    expect(part(view, 'outline').getByText(/normally measured to the outside/)).toBeTruthy();
  });
});

describe('the four steps stay on the panel', () => {
  const titles = (view) => [...view.container.querySelectorAll('#panel-steps section [data-step-title]')]
    .map((s) => s.textContent);

  it('says each step as what it came to', () => {
    useAppStore.setState({
      calibration: calibrated, perimeterTraces: [outline()], detectedDimensions: [{}, {}, {}],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    expect(titles(view)).toEqual([
      'Read the room sizes', 'Worked out the scale', 'Found the outside walls', 'Added up the area',
    ]);
    expect(part(view, 'sizes').getByText('3 room sizes on this plan')).toBeTruthy();
    expect(part(view, 'work').getByText('The sum behind 800 ft²')).toBeTruthy();
  });

  it('says a step that has nothing to show as that, and keeps all four', () => {
    const view = render(<ResultsPanel {...props()} />);
    expect(titles(view)).toEqual([
      'No room sizes read', 'The scale is not set', 'No outline yet', 'No area yet',
    ]);
    // The sum is only for a measured area.
    expect(view.container.querySelector('#panel-work')).toBeNull();
  });

  it('reads the room sizes again from the first step', () => {
    const onRescan = vi.fn();
    const view = render(<ResultsPanel {...props({ onRescan })} />);
    fireEvent.click(part(view, 'sizes').getByRole('button', { name: 'Read again' }));
    expect(onRescan).toHaveBeenCalledTimes(1);
  });

  // Changing the outline is the outline step's: its tools are one menu, which
  // opens beside the panel, over the plan they act on.
  it('carries the ways to change the outline in the outline step', () => {
    const picked = [];
    useWorkspaceStore.setState({ menuOpen: null });
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800, onSelectTool: (id) => picked.push(id) })} />);
    open(view, 'outline');
    fireEvent.click(part(view, 'outline').getByRole('button', { name: /Change the outline/ }));
    const rows = within(view.getByRole('menu')).getAllByRole('menuitem')
      .map((r) => r.querySelector('.font-medium').textContent.trim());
    // Adding another outline has its own line under the list.
    expect(rows).toEqual([
      'Paint over the walls', 'Click the corners', 'Find the outline again',
      'Cut out an open area', 'Remove several corners',
    ]);
    fireEvent.click(within(view.getByRole('menu')).getByText('Paint over the walls'));
    expect(picked).toEqual(['draw']);
    expect(view.queryByRole('menu')).toBeNull();
  });

  // The phone passes no way to start a tool from here: it has its own sheet.
  it('offers no such menu to a shell that cannot start a tool', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'outline');
    expect(part(view, 'outline').queryByRole('button', { name: /Change the outline/ })).toBeNull();
  });
});

describe('a shell that offers no drawing', () => {
  // The phone passes none of the ways to draw an outline.
  it('does not end the empty section on a colon over nothing', () => {
    useAppStore.setState({ calibration: calibrated });
    const view = render(
      <ResultsPanel {...props({ onFindOutline: undefined, onPaintOutline: undefined, onPlaceCorners: undefined })} />,
    );
    expect(part(view, 'outline').getByText('No outline yet.')).toBeTruthy();
    expect(part(view, 'outline').queryByText(/draw it yourself/)).toBeNull();
  });

  it('puts the way out under the figure on the phone, where nothing is pinned', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800, mobile: true })} />);
    expect(part(view, 'area').getByRole('button', { name: /Save image/ })).toBeTruthy();
  });
});

describe('the scale', () => {
  it('says where the scale came from, and never in pixels', () => {
    useAppStore.setState({ calibration: calibrated, perimeterTraces: [outline()] });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'scale');
    expect(part(view, 'scale').getByText('Measured from 3 rooms on this plan.')).toBeTruthy();
    expect(view.container.querySelector('#panel-scale').textContent).not.toMatch(/px/);
  });

  // With nothing read there are two ways to set the scale. The simpler one
  // leads, as the one filled button on the panel; the room is the alternative.
  it('leads with measuring a length when nothing could be read, and offers the room as the other way', () => {
    useAppStore.setState({ roomOverlay: { x1: 0, y1: 0, x2: 100, y2: 100 } });
    const view = render(<ResultsPanel {...props({ ocrFailed: true })} />);
    const scale = part(view, 'scale');
    expect(scale.getByText(/needs one measurement from you/)).toBeTruthy();
    const measure = scale.getByRole('button', { name: /Set scale from a known length/ });
    expect(measure.className).toContain('btn-primary');
    // One filled button at a time: with no outline either, the scale's is the
    // one, because it is what the figure at the top is asking for.
    expect(view.container.querySelectorAll('.btn-primary')).toHaveLength(1);
    expect(scale.getByText(/Or use a whole room: drag the green box/)).toBeTruthy();
    expect(scale.getByLabelText('Width')).toBeTruthy();
    expect(scale.getByLabelText('Length')).toBeTruthy();
    // The way to set it comes before the alternative.
    expect(measure.compareDocumentPosition(scale.getByLabelText('Width'))
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // Typing the length is the second half of the tool. It used to sit at the
  // foot of the section, under two fields for a different way of setting the
  // scale, where a length could be typed into the wrong box.
  it('is only the measuring while a length is being measured, with the box to type into', () => {
    useAppStore.setState({
      roomOverlay: { x1: 0, y1: 0, x2: 100, y2: 100 },
      scaleToolActive: true,
      scaleLines: [{ id: 'scale-1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, feet: null }],
    });
    const view = render(<ResultsPanel {...props({ ocrFailed: true })} />);
    const scale = part(view, 'scale');
    const box = scale.getByLabelText('Length of line 1');
    // The cursor is waiting in it.
    expect(document.activeElement).toBe(box);
    expect(scale.queryByLabelText('Width')).toBeNull();
    expect(scale.queryByRole('button', { name: /Set scale from a known length/ })).toBeNull();
    expect(scale.queryByRole('button', { name: /Read the room sizes again/ })).toBeNull();
  });

  it('brings the other ways back once the measuring is done, with the lengths still listed', () => {
    useAppStore.setState({
      calibration: { ...calibrated, source: 'line-calibration', quality: { source: 'line', lineCount: 1, feet: 20 } },
      perimeterTraces: [outline()],
      scaleLines: [{ id: 'scale-1', start: { x: 0, y: 0 }, end: { x: 100, y: 0 }, feet: 20 }],
    });
    const view = render(<ResultsPanel {...props({ area: 800 })} />);
    open(view, 'scale');
    const scale = part(view, 'scale');
    expect(scale.getByLabelText('Length of line 1').value).toBe('20.0 ft');
    expect(scale.getByRole('button', { name: /Set scale from a known length/ })).toBeTruthy();
    // A line that already has its length does not take the cursor.
    expect(document.activeElement).not.toBe(scale.getByLabelText('Length of line 1'));
  });

  // Picking re-uses what was already read, which is cheaper and usually right.
  it('leads with picking a room when room sizes were read but no scale came of them', () => {
    useAppStore.setState({ detectedDimensions: [{ text: '12x14' }] });
    const view = render(<ResultsPanel {...props()} />);
    const scale = part(view, 'scale');
    expect(scale.getByRole('button', { name: /Pick a room to scale from/ }).className).toContain('btn-primary');
    expect(scale.getByRole('button', { name: /Set scale from a known length/ }).className).not.toContain('btn-primary');
  });

  // A second scan started during the first one's automatic run cleared the
  // busy state in the middle of the second's trace.
  it('makes the commands that start work wait for a running job', () => {
    useAppStore.setState({
      calibration: calibrated,
      perimeterTraces: [outline()],
      detectedDimensions: [{ text: '12x14' }],
    });
    const view = render(<ResultsPanel {...props({ area: 800, isProcessing: true })} />);
    open(view, 'scale');
    expect(part(view, 'sizes').getByRole('button', { name: 'Read again' }).disabled).toBe(true);
    expect(view.getByRole('button', { name: /Use a different room/ }).disabled).toBe(true);
    // A mode is not work.
    expect(view.getByRole('button', { name: /Set scale from a known length/ }).disabled).toBe(false);
  });

});
