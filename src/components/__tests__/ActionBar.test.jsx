// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import ActionBar from '../ActionBar';
import { TOOL_MODES } from '../toolModes';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { beginWork, settleWork, ownerVerdict, resetRequests } from '../../store/documentRequests';

/**
 * One bar says what FloorTrace is doing and what it just did, offers the
 * runner-up outline when there is one, and — while the scale is being set by
 * hand — is that mode's instruction and its way out.
 *
 * It offers no tools: the plan is traced automatically and the outline is
 * looked at, not drawn.
 */
const square = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];

const props = (over = {}) => ({
  tool: 'select',
  onCancel: () => {},
  onUseAlternative: () => {},
  panelOpen: true,
  onShowPanel: () => {},
  ...over,
});

beforeEach(() => {
  useAppStore.setState({
    isProcessing: false,
    processingMessage: '',
    activeTraceId: 't1',
    perimeterTraces: [{ id: 't1', vertices: square, quality: { confidence: 0.9, warnings: [] } }],
  });
  useAppStore.setState({ activeDocumentId: 'doc-1' });
  useWorkspaceStore.setState({ statusFlash: null, menuOpen: null });
});
afterEach(cleanup);

describe('ActionBar at rest', () => {
  it('offers no tools, no menus and no way out of a mode', () => {
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('toolbar')).toBeNull();
    expect(view.queryByRole('menu')).toBeNull();
    expect(view.queryAllByRole('button')).toHaveLength(0);
    expect(view.container.textContent).not.toMatch(/Drag any corner|Paint|Crop|Erase|Measure/);
  });

  it('never states the scale in pixels', () => {
    useAppStore.setState({ calibration: { calibrated: true, feetPerPixel: { x: 0.1, y: 0.1 } } });
    const view = render(<ActionBar {...props()} />);
    expect(view.container.textContent).not.toMatch(/px/);
  });

  // Closing the last plan takes the bar away, and that close is itself a
  // flash — which the next plan's bar used to show and announce on mount.
  it('does not replay a confirmation from before it was on screen', () => {
    useWorkspaceStore.setState({ statusFlash: { text: 'Plan closed', tone: 'ok', at: Date.now() - 60000 } });
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByText('Plan closed')).toBeNull();
  });

  it('shows a fresh confirmation in the live region', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    expect(view.getByText('Area copied')).toBeTruthy();
    expect(view.container.querySelector('[role="status"]').textContent).toContain('Area copied');
  });

  // The bar is the one place the app says what just happened to the plan:
  // green when it was done, amber when it was not and why.
  it('says something done in green and something refused in amber', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Outline found.'); });
    expect(view.getByText('Outline found.').className).toContain('text-ok');

    act(() => { useWorkspaceStore.getState().flashStatus('Couldn’t find the outline on this plan', 'warn'); });
    const refusal = view.getByText('Couldn’t find the outline on this plan');
    expect(refusal.className).toContain('text-warn');
    expect(refusal.className).not.toContain('text-ok');
    // One line, latest wins: there is no second message to overlap the first.
    expect(view.queryByText('Outline found.')).toBeNull();
  });

  // "Finding the outline…" beside the last run's "Outline found." is two
  // answers to one question.
  it('drops what the last job ended on when the next one starts', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Outline found.'); });
    act(() => { useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' }); });
    expect(view.queryByText('Outline found.')).toBeNull();
    expect(view.getByText('Finding the outline…')).toBeTruthy();
    // …and still says what is raised once the job is under way.
    act(() => { useWorkspaceStore.getState().flashStatus('Still working — try that again once this finishes', 'warn'); });
    expect(view.getByText(/Still working/)).toBeTruthy();
  });

  // A run is several jobs back to back — read the sizes, measure the rooms,
  // find the outline — with a gap between each. The last plan's line must not
  // come back in one of the gaps.
  it('does not bring the old line back between two steps of the next run', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Outline found'); });
    act(() => { useAppStore.setState({ isProcessing: true, processingMessage: 'Reading the room sizes…' }); });
    act(() => { useAppStore.setState({ isProcessing: false, processingMessage: '' }); });
    expect(view.queryByText('Outline found')).toBeNull();
    act(() => { useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' }); });
    expect(view.queryByText('Outline found')).toBeNull();
  });

  // The line a job ends in is raised while the job is still marked as running.
  it('keeps the line a job ends in once the job is over', () => {
    useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' });
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Outline found'); });
    act(() => { useAppStore.setState({ isProcessing: false, processingMessage: '' }); });
    expect(view.getByText('Outline found')).toBeTruthy();
  });

  // The bar is one line and truncates; the sentence must still be readable.
  it('carries the whole sentence where a truncated one can be read', () => {
    const view = render(<ActionBar {...props()} />);
    const long = 'Kept the scale you set by hand — the rooms on this plan disagree with it';
    act(() => { useWorkspaceStore.getState().flashStatus(long, 'warn'); });
    expect(view.getByText(long).getAttribute('title')).toBe(long);
  });

  it('offers the way back to the results while they are put away', () => {
    const onShowPanel = vi.fn();
    const view = render(<ActionBar {...props({ panelOpen: false, onShowPanel })} />);
    fireEvent.click(view.getByRole('button', { name: /Show results/ }));
    expect(onShowPanel).toHaveBeenCalled();
    cleanup();
    expect(render(<ActionBar {...props()} />).queryByRole('button', { name: /Show results/ })).toBeNull();
  });
});

describe('how long the bar keeps saying it', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lets a confirmation go after a moment', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    act(() => { vi.advanceTimersByTime(3300); });
    expect(view.queryByText('Area copied')).toBeNull();
  });

  // A refusal has to be read, not just noticed.
  it('keeps a refusal longer than a confirmation', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Couldn’t read the room sizes on this plan', 'warn'); });
    act(() => { vi.advanceTimersByTime(3300); });
    expect(view.getByText(/Couldn’t read/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(view.queryByText(/Couldn’t read/)).toBeNull();
  });
});

describe('the runner-up outline', () => {
  const withAlternatives = (quality) => useAppStore.setState({
    perimeterTraces: [{ id: 't1', vertices: square, quality }],
  });

  it('is offered only while there is one, and says how many', () => {
    let view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: /Try another outline/ })).toBeNull();
    cleanup();

    withAlternatives({ alternatives: [{}] });
    view = render(<ActionBar {...props()} />);
    expect(view.getByRole('button', { name: 'Try another outline' })).toBeTruthy();
    cleanup();

    withAlternatives({ alternatives: [{}, {}] });
    view = render(<ActionBar {...props()} />);
    expect(view.getByRole('button', { name: 'Try another outline (2 more)' })).toBeTruthy();
  });

  it('swaps it in on one click', () => {
    withAlternatives({ alternatives: [{}] });
    const onUseAlternative = vi.fn();
    const view = render(<ActionBar {...props({ onUseAlternative })} />);
    fireEvent.click(view.getByRole('button', { name: 'Try another outline' }));
    expect(onUseAlternative).toHaveBeenCalledTimes(1);
  });

  // A saved plan can carry an outline that was edited by hand. A runner-up
  // scored against the detector's own geometry is no alternative to that.
  it('is not offered against an outline edited by hand', () => {
    withAlternatives({ edited: true, alternatives: [{}] });
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: /Try another outline/ })).toBeNull();
  });

  // Swapping the outline under a trace in flight would be undone by the trace
  // landing; in a mode the bar is that mode's.
  it('waits for a running job, and stands down in a mode', () => {
    withAlternatives({ alternatives: [{}] });
    useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' });
    let view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: /Try another outline/ })).toBeNull();
    cleanup();

    useAppStore.setState({ isProcessing: false, processingMessage: '' });
    view = render(<ActionBar {...props({ tool: 'scale' })} />);
    expect(view.queryByRole('button', { name: /Try another outline/ })).toBeNull();
  });

  it('sits outside the part of the bar that gives way', () => {
    withAlternatives({ alternatives: [{}] });
    const view = render(<ActionBar {...props()} />);
    expect(view.getByRole('button', { name: 'Try another outline' }).closest('.action-lead')).toBeNull();
  });
});

describe('ActionBar while the scale is being set by hand', () => {
  it('has exactly two modes, and both are about the scale', () => {
    expect(Object.keys(TOOL_MODES).sort()).toEqual(['pick', 'scale']);
  });

  it.each(['scale', 'pick'])('states the %s mode and its instruction from TOOL_MODES', (tool) => {
    const view = render(<ActionBar {...props({ tool })} />);
    expect(view.getByText(TOOL_MODES[tool].name)).toBeTruthy();
    expect(view.getByText(TOOL_MODES[tool].hint)).toBeTruthy();
  });

  // A length lands when it is typed and a room when it is clicked, so there is
  // nothing to cancel — and leaving through "Cancel" reads as taking it back.
  it('is left with Done, not Cancel', () => {
    const onCancel = vi.fn();
    for (const tool of ['scale', 'pick']) {
      const view = render(<ActionBar {...props({ tool, onCancel })} />);
      expect(view.queryByText('Cancel'), tool).toBeNull();
      const done = view.getByRole('button', { name: /^Done/ });
      expect(done.className, tool).toContain('btn-primary');
      fireEvent.click(done);
      cleanup();
    }
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  it('lets Working… take the instruction', () => {
    const view = render(<ActionBar {...props({ tool: 'scale' })} />);
    expect(view.getByText(TOOL_MODES.scale.hint)).toBeTruthy();

    act(() => useAppStore.setState({ isProcessing: true, processingMessage: 'Tracing…' }));
    expect(view.getByText('Tracing…')).toBeTruthy();
    expect(view.queryByText(TOOL_MODES.scale.hint)).toBeNull();
  });

  // The words give way; the way out does not.
  it('keeps Done outside the part of the bar that gives way', () => {
    const view = render(<ActionBar {...props({ tool: 'scale' })} />);
    expect(view.getByRole('button', { name: /^Done/ }).closest('.action-lead')).toBeNull();
    expect(view.getByText(TOOL_MODES.scale.hint).closest('.action-lead')).toBeTruthy();
    expect(view.container.querySelector('.action-row-running')).toBeTruthy();
  });
});

/**
 * A trace can hold the app for thirty seconds, and without this the bar said
 * "Working…" for all of them: a slow trace and a wedged one were the same
 * screen, with nothing to press either way.
 */
describe('ActionBar while work is running', () => {
  beforeEach(() => {
    resetRequests();
    vi.useFakeTimers();
    useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' });
  });
  afterEach(() => {
    vi.useRealTimers();
    useAppStore.setState({ isProcessing: false, processingMessage: '' });
  });

  it('says what it is doing', () => {
    const view = render(<ActionBar {...props()} />);
    expect(view.getByText('Finding the outline…')).toBeTruthy();
  });

  // A trace is usually well under a second, and a counter that flashes up and
  // vanishes on every one of them is noise.
  it('stays quiet about a job that finishes quickly', () => {
    const work = beginWork('trace');
    const view = render(<ActionBar {...props()} />);
    act(() => { vi.advanceTimersByTime(4000); });
    expect(view.queryByText('Stop')).toBeNull();
    expect(view.queryByText(/^\d+s$/)).toBeNull();
    settleWork(work);
  });

  it('says how long it has been going, and offers the way out', () => {
    const work = beginWork('trace');
    const view = render(<ActionBar {...props()} />);
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
    const view = render(<ActionBar {...props()} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('6s')).toBeTruthy();
    expect(view.queryByText('Stop')).toBeNull();
  });

  // The OCR pool has no interrupt, so a Stop could only drop the *result* while
  // the spinner kept turning for another twenty seconds. Still says how long.
  it('offers no Stop for a scan, which cannot be stopped', () => {
    const work = beginWork('scan');
    const view = render(<ActionBar {...props()} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('6s')).toBeTruthy();
    expect(view.queryByText('Stop')).toBeNull();
    settleWork(work);
  });

  it('keeps Stop outside the part of the bar that gives way', () => {
    const work = beginWork('trace');
    const view = render(<ActionBar {...props()} />);
    act(() => { vi.advanceTimersByTime(6000); });
    expect(view.getByText('Stop').closest('.action-lead')).toBeNull();
    settleWork(work);
  });

  // The region is aria-atomic, so a number that changes every second would
  // re-announce the whole bar every second.
  it('keeps the ticking clock out of the live region', () => {
    const work = beginWork('trace');
    const view = render(<ActionBar {...props()} />);
    act(() => { vi.advanceTimersByTime(6000); });
    const live = view.container.querySelector('[role="status"]');
    expect(live.textContent).toContain('Finding the outline…');
    expect(live.textContent).not.toContain('6s');
    settleWork(work);
  });
});
