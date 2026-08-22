// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import StatusBar from '../StatusBar';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * One band says both things now: what mode the app is in, and — while a tool is
 * running — that tool's instruction, its brush and its way out. The cases here
 * are the ones where those two jobs compete for 452 px, which is the narrowest
 * this band ever is.
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
  onExport: () => {},
};

beforeEach(() => {
  useAppStore.setState({
    zoomScale: 1,
    calibration: null,
    isProcessing: false,
    processingMessage: '',
    draftState: 'saved',
  });
  useWorkspaceStore.setState({ toolHint: null, statusFlash: null });
});
afterEach(cleanup);

describe('StatusBar at rest', () => {
  it('reports the mode, the scale, the zoom and the draft', () => {
    const view = render(<StatusBar {...props} />);
    expect(view.getByText('Select')).toBeTruthy();
    expect(view.getByText('Drag a corner to adjust an outline')).toBeTruthy();
    expect(view.getByText('not set')).toBeTruthy();
    expect(view.getByText('100%')).toBeTruthy();
    expect(view.getByText('Draft saved')).toBeTruthy();
    expect(view.queryByText('Cancel')).toBeNull();
  });

  it('gives the hint cell to whichever tool the pointer is on', () => {
    const view = render(<StatusBar {...props} />);
    useWorkspaceStore.setState({ toolHint: { id: 'crop', name: 'Crop', detail: 'Keep only the part you drag over', digit: '8' } });
    view.rerender(<StatusBar {...props} />);
    expect(view.getByText('Keep only the part you drag over')).toBeTruthy();
    expect(view.queryByText('Drag a corner to adjust an outline')).toBeNull();
  });
});

describe('StatusBar while a tool is running', () => {
  it('states the mode and its instruction from TOOL_MODES', () => {
    const view = render(<StatusBar {...props} tool="pick" />);
    expect(view.getByText('Choosing a room')).toBeTruthy();
    expect(view.getByText(/take the scale from it/)).toBeTruthy();
  });

  it('stands the standing cells down to make room', () => {
    const view = render(<StatusBar {...props} tool="vertex" onDone={() => {}} />);
    // Scale and zoom are facts you read between actions; they cannot share this
    // band with an instruction and two buttons.
    expect(view.queryByText('not set')).toBeNull();
    expect(view.queryByText('100%')).toBeNull();
    expect(view.queryByText('Draft saved')).toBeNull();
    expect(view.getByText('Cancel')).toBeTruthy();
    expect(view.getByText('Close outline')).toBeTruthy();
  });

  it('keeps a draft warning, because that one is not a fact but a risk', () => {
    useAppStore.setState({ draftState: 'off' });
    const view = render(<StatusBar {...props} tool="vertex" />);
    expect(view.getByText('Not kept')).toBeTruthy();
  });

  it('offers Cancel always and Done only when the mode commits', () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const view = render(<StatusBar {...props} tool="crop" onCancel={onCancel} onDone={onDone} />);
    // `crop` has no doneLabel: there is nothing to close, only a drag to make.
    expect(view.queryByText(/Close/)).toBeNull();
    fireEvent.click(view.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();

    view.rerender(<StatusBar {...props} tool="draw" onCancel={onCancel} onDone={onDone} />);
    fireEvent.click(view.getByText('Trace my outline'));
    expect(onDone).toHaveBeenCalled();
  });

  it('carries the brush only for the modes that paint', () => {
    const onBrushSizeChange = vi.fn();
    const view = render(<StatusBar {...props} tool="vertex" />);
    expect(view.queryByLabelText('Brush size')).toBeNull();

    view.rerender(<StatusBar {...props} tool="draw" onBrushSizeChange={onBrushSizeChange} />);
    const slider = view.getByLabelText('Brush size');
    expect(view.getByText('24 px')).toBeTruthy();
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
    expect(view.getByText(/Paint roughly over the exterior walls/)).toBeTruthy();

    useWorkspaceStore.setState({ toolHint: { id: 'eraser', name: 'Erase', detail: 'Remove clutter' } });
    view.rerender(<StatusBar {...props} tool="draw" />);
    expect(view.getByText('Remove clutter')).toBeTruthy();

    useAppStore.setState({ isProcessing: true, processingMessage: 'Tracing…' });
    view.rerender(<StatusBar {...props} tool="draw" />);
    expect(view.getByText('Tracing…')).toBeTruthy();
    expect(view.queryByText('Remove clutter')).toBeNull();
  });

  // The count changes on every click, so it must not sit in the live region —
  // aria-atomic would re-announce the mode and the instruction with it.
  it('keeps the changing count out of the live region', () => {
    const view = render(<StatusBar {...props} tool="vertex" count={3} />);
    const live = view.container.querySelector('[role="status"]');
    expect(live.textContent).toContain('Placing corners');
    expect(live.textContent).not.toContain('3 corners');
  });
});
