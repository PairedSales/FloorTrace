// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import StatusBar from '../StatusBar';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { beginWork, settleWork, ownerVerdict, resetRequests } from '../../store/documentRequests';

/**
 * One band says both things: what is happening, and — while a tool is running —
 * that tool's instruction, its brush and its way out. The cases here are the
 * ones where those two jobs compete for the width of the plan, and the ones
 * that keep it saying nothing technical at rest.
 */
const props = {
  tool: 'select',
  count: 0,
  brushSize: 24,
  onBrushSizeChange: () => {},
  onCancel: () => {},
  onDone: null,
  hasImage: true,
  onZoomIn: () => {},
  onZoomOut: () => {},
  onFitToWindow: () => {},
  onExport: () => {},
};

beforeEach(() => {
  useAppStore.setState({
    zoomScale: 1,
    calibration: null,
    isProcessing: false,
    processingMessage: '',
    draftState: 'saved',
    perimeterTraces: [{ id: 't1', vertices: [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }] }],
  });
  useWorkspaceStore.setState({ toolHint: null, statusFlash: null });
});
afterEach(cleanup);

describe('StatusBar at rest', () => {
  it('gives a tip, the zoom and whether the work is saved — and no mode name', () => {
    const view = render(<StatusBar {...props} />);
    expect(view.getByText(/Drag any corner to reshape the outline/)).toBeTruthy();
    expect(view.getByText('100%')).toBeTruthy();
    expect(view.getByText('Fit')).toBeTruthy();
    expect(view.getByText('Saved')).toBeTruthy();
    // "Select" was a mode name for not being in a mode.
    expect(view.queryByText('Select')).toBeNull();
    expect(view.queryByText('Cancel')).toBeNull();
  });

  it('keeps the corner tip until there is an outline to drag', () => {
    useAppStore.setState({ perimeterTraces: [{ id: 't1', vertices: [] }] });
    const view = render(<StatusBar {...props} />);
    expect(view.queryByText(/Drag any corner/)).toBeNull();
    expect(view.getByText('100%')).toBeTruthy();
  });

  it('never states the scale in pixels', () => {
    useAppStore.setState({
      calibration: { calibrated: true, feetPerPixel: { x: 0.1, y: 0.1 } },
    });
    const view = render(<StatusBar {...props} />);
    expect(view.container.textContent).not.toMatch(/px/);
  });

  it('fits the plan from beside the zoom', () => {
    const onFitToWindow = vi.fn();
    const view = render(<StatusBar {...props} onFitToWindow={onFitToWindow} />);
    fireEvent.click(view.getByText('Fit'));
    expect(onFitToWindow).toHaveBeenCalled();
  });

  // Closing the last plan takes the band away, and that close is itself a
  // flash — which the next plan's band used to show and announce on mount.
  it('does not replay a confirmation from before it was on screen', () => {
    useWorkspaceStore.setState({ statusFlash: { text: 'Plan closed', at: Date.now() - 60000 } });
    const view = render(<StatusBar {...props} />);
    expect(view.queryByText('Plan closed')).toBeNull();
  });

  it('shows a fresh confirmation', () => {
    const view = render(<StatusBar {...props} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    expect(view.getByText('Area copied')).toBeTruthy();
  });

  it('gives the hint cell to whichever tool the pointer is on', () => {
    const view = render(<StatusBar {...props} />);
    useWorkspaceStore.setState({ toolHint: { id: 'crop', name: 'Crop the plan', detail: 'Keep only the part you drag over', digit: '7' } });
    view.rerender(<StatusBar {...props} />);
    expect(view.getByText('Keep only the part you drag over')).toBeTruthy();
    expect(view.queryByText(/Drag any corner to reshape the outline/)).toBeNull();
  });
});

describe('StatusBar while a tool is running', () => {
  it('states the mode and its instruction from TOOL_MODES', () => {
    const view = render(<StatusBar {...props} tool="pick" />);
    expect(view.getByText('Choosing a room')).toBeTruthy();
    expect(view.getByText(/set the scale from that room/)).toBeTruthy();
  });

  it('stands the standing cells down to make room', () => {
    const view = render(<StatusBar {...props} tool="vertex" onDone={() => {}} />);
    // Zoom and the save state are facts you read between actions; they cannot
    // share this band with an instruction and two buttons.
    expect(view.queryByText('100%')).toBeNull();
    expect(view.queryByText('Saved')).toBeNull();
    expect(view.getByText('Cancel')).toBeTruthy();
    expect(view.getByText('Finish outline')).toBeTruthy();
  });

  it('keeps a save warning, because that one is not a fact but a risk', () => {
    useAppStore.setState({ draftState: 'off' });
    const view = render(<StatusBar {...props} tool="vertex" />);
    expect(view.getByText('Autosave is off')).toBeTruthy();
  });

  it('offers Cancel always and Done only when the mode commits', () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const view = render(<StatusBar {...props} tool="crop" onCancel={onCancel} onDone={onDone} />);
    // `crop` has no doneLabel: there is nothing to finish, only a drag to make.
    expect(view.queryByText(/Finish|Draw the outline/)).toBeNull();
    fireEvent.click(view.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();

    view.rerender(<StatusBar {...props} tool="draw" onCancel={onCancel} onDone={onDone} />);
    fireEvent.click(view.getByText('Draw the outline'));
    expect(onDone).toHaveBeenCalled();
  });

  it('carries the brush only for the modes that paint, in words rather than pixels', () => {
    const onBrushSizeChange = vi.fn();
    const view = render(<StatusBar {...props} tool="vertex" />);
    expect(view.queryByLabelText('Brush size')).toBeNull();

    view.rerender(<StatusBar {...props} tool="draw" onBrushSizeChange={onBrushSizeChange} />);
    const slider = view.getByLabelText('Brush size');
    expect(view.queryByText('24 px')).toBeNull();
    fireEvent.change(slider, { target: { value: '80' } });
    expect(onBrushSizeChange).toHaveBeenCalledWith(80);
  });

  it('counts the corners placed so far', () => {
    const view = render(<StatusBar {...props} tool="vertex" count={1} />);
    expect(view.getByText('1 corner')).toBeTruthy();
    view.rerender(<StatusBar {...props} tool="vertex" count={4} />);
    expect(view.getByText('4 corners')).toBeTruthy();
  });

  it('lets a hover and then Working… take the instruction in that order', () => {
    const view = render(<StatusBar {...props} tool="draw" />);
    expect(view.getByText(/Paint roughly over the outside walls/)).toBeTruthy();

    useWorkspaceStore.setState({ toolHint: { id: 'eraser', name: 'Erase marks', detail: 'White out notes' } });
    view.rerender(<StatusBar {...props} tool="draw" />);
    expect(view.getByText('White out notes')).toBeTruthy();

    useAppStore.setState({ isProcessing: true, processingMessage: 'Tracing…' });
    view.rerender(<StatusBar {...props} tool="draw" />);
    expect(view.getByText('Tracing…')).toBeTruthy();
    expect(view.queryByText('White out notes')).toBeNull();
  });

  // The count changes on every click, so it must not sit in the live region —
  // aria-atomic would re-announce the mode and the instruction with it.
  it('keeps the changing count out of the live region', () => {
    const view = render(<StatusBar {...props} tool="vertex" count={3} />);
    const live = view.container.querySelector('[role="status"]');
    expect(live.textContent).toContain('Clicking corners');
    expect(live.textContent).not.toContain('3 corners');
  });
});

/**
 * A trace can hold the app for thirty seconds, and until this the band said
 * "Working…" for all of them: a slow trace and a wedged one were the same
 * screen, with nothing to press either way.
 */
describe('StatusBar while work is running', () => {
  beforeEach(() => {
    resetRequests();
    vi.useFakeTimers();
    useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAppStore.setState({ isProcessing: false, processingMessage: '' });
  });

  // A trace is usually well under a second, and a counter that flashes up and
  // vanishes on every one of them is noise.
  it('stays quiet about a job that finishes quickly', () => {
    const work = beginWork('trace');
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(view.getByText('Finding the outline…')).toBeTruthy();
    expect(view.queryByText('Stop')).toBeNull();
    expect(view.queryByText(/^\d+s$/)).toBeNull();
    settleWork(work);
  });

  it('says how long it has been going, and offers the way out', () => {
    const work = beginWork('trace');
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('6s')).toBeTruthy();

    fireEvent.click(view.getByText('Stop'));
    // Aborted, so anything the trace still delivers is dropped rather than
    // written over a plan the user has moved on from.
    expect(ownerVerdict(work)).toBe('dropped');
    settleWork(work);
  });

  // A project save or a PDF render holds `isProcessing` and owns no token, and
  // a Stop that stops nothing is worse than no Stop at all.
  it('offers no Stop for work nothing owns', () => {
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('6s')).toBeTruthy();
    expect(view.queryByText('Stop')).toBeNull();
  });

  // The OCR pool has no interrupt, so a Stop could only drop the *result* while
  // the spinner kept turning for another twenty seconds. Still says how long.
  it('offers no Stop for a scan, which cannot be stopped', () => {
    const work = beginWork('scan');
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('6s')).toBeTruthy();
    expect(view.queryByText('Stop')).toBeNull();
    settleWork(work);
  });

  // Same rule as the vertex count: the region is aria-atomic, so a number that
  // changes every second would re-announce the whole band every second.
  // The lead's words give way; the Stop does not. It lived inside the lead,
  // which could not shrink past it, and a narrow band painted the zoom over it.
  it('keeps Stop outside the part of the band that gives way', () => {
    const work = beginWork('trace');
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(6000); });
    const stop = view.getByText('Stop');
    expect(stop.closest('.status-lead')).toBeNull();
    expect(view.container.querySelector('.status-row-processing')).toBeTruthy();
    settleWork(work);
  });

  it('keeps the ticking clock out of the live region', () => {
    const work = beginWork('trace');
    const view = render(<StatusBar {...props} />);
    act(() => { vi.advanceTimersByTime(6000); });
    const live = view.container.querySelector('[role="status"]');
    expect(live.textContent).toContain('Finding the outline…');
    expect(live.textContent).not.toContain('6s');
    settleWork(work);
  });
});
