// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within, act } from '@testing-library/react';
import ActionBar from '../ActionBar';
import { TOOL_GROUPS } from '../toolCatalog';
import { TOOL_MODES } from '../toolModes';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { beginWork, settleWork, ownerVerdict, resetRequests } from '../../store/documentRequests';

/**
 * One bar says both things: what can be done to the plan, and — while a tool
 * is running — that tool's instruction, its brush and its way out.
 *
 * At rest the cases are about the menus: every tool and command has a home,
 * each row says what it is for, and a row that cannot be used says why.
 * Running, they are the cases where the instruction and the controls compete
 * for the width of the plan.
 */
const square = [{ x: 0, y: 0 }, { x: 9, y: 0 }, { x: 9, y: 9 }, { x: 0, y: 9 }];

const props = (over = {}) => ({
  tool: 'select',
  count: 0,
  brushSize: 24,
  onBrushSizeChange: () => {},
  onCancel: () => {},
  onDone: null,
  hasArea: true,
  hasToolData: false,
  onSelect: () => {},
  panelOpen: true,
  onShowPanel: () => {},
  ...over,
});

const openMenu = (view, name) => {
  fireEvent.click(view.getByRole('button', { name }));
  return view.getByRole('menu');
};
const rowsOf = (menu) => within(menu).getAllByRole('menuitem')
  .map((row) => row.querySelector('.font-medium').textContent.trim());
const row = (menu, label) => within(menu).getByText(label).closest('[role="menuitem"]');

beforeEach(() => {
  useAppStore.setState({
    isProcessing: false,
    processingMessage: '',
    drawModeActive: false,
    activeTraceId: 't1',
    perimeterTraces: [{ id: 't1', vertices: square, quality: { confidence: 0.9, warnings: [] } }],
  });
  useAppStore.setState({ activeDocumentId: 'doc-1' });
  useWorkspaceStore.setState({ statusFlash: null, menuOpen: null, retraceOfferFor: null });
});
afterEach(cleanup);

describe('ActionBar at rest', () => {
  it('offers three jobs by name, and a tip — no mode name, no way out', () => {
    const view = render(<ActionBar {...props()} />);
    const toolbar = view.getByRole('toolbar', { name: 'Tools' });
    expect(within(toolbar).getAllByRole('button').map((b) => b.textContent.trim()))
      .toEqual(['Outline', 'Measure', 'Edit plan']);
    // The standing answer to "the outline is not right": where the fix is,
    // said once and calmly rather than as a warning about each trace.
    expect(view.getByText('Outline not right? Drag any corner, or redraw it from the Outline menu.')).toBeTruthy();
    expect(view.queryByText('Cancel')).toBeNull();
  });

  it('keeps the corner tip until there is an outline to drag', () => {
    useAppStore.setState({ perimeterTraces: [{ id: 't1', vertices: [] }] });
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByText(/Drag any corner/)).toBeNull();
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

  it('shows a fresh confirmation in place of the tip, in the live region', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    expect(view.getByText('Area copied')).toBeTruthy();
    expect(view.container.querySelector('[role="status"]').textContent).toContain('Area copied');
    expect(view.queryByText(/Drag any corner/)).toBeNull();
  });

  // The bar is the one place the app says what just happened to the plan:
  // green when it was done, amber when it was not and why.
  it('says something done in green and something refused in amber', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Outline found.'); });
    expect(view.getByText('Outline found.').className).toContain('text-ok');

    act(() => { useWorkspaceStore.getState().flashStatus('An outline needs at least three corners', 'warn'); });
    const refusal = view.getByText('An outline needs at least three corners');
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
});

describe('how long the bar keeps saying it', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('lets a confirmation go after a moment', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    act(() => { vi.advanceTimersByTime(3300); });
    expect(view.queryByText('Area copied')).toBeNull();
    expect(view.getByText(/Drag any corner/)).toBeTruthy();
  });

  // A refusal has to be read, not just noticed.
  it('keeps a refusal longer than a confirmation', () => {
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Nothing painted — drag over the outside walls first', 'warn'); });
    act(() => { vi.advanceTimersByTime(3300); });
    expect(view.getByText(/Nothing painted/)).toBeTruthy();
    act(() => { vi.advanceTimersByTime(3000); });
    expect(view.queryByText(/Nothing painted/)).toBeNull();
  });
});

describe('the offer to find the outline again, after the plan’s image was edited', () => {
  const offer = () => useWorkspaceStore.setState({ retraceOfferFor: 'doc-1' });

  it('stands in the bar at rest, and one click takes it', () => {
    offer();
    const onSelect = vi.fn();
    const view = render(<ActionBar {...props({ onSelect })} />);
    expect(view.getByText('The plan has changed.')).toBeTruthy();
    // In place of the standing tip, not beside it.
    expect(view.queryByText(/Drag any corner/)).toBeNull();
    fireEvent.click(view.getByRole('button', { name: 'Find the outline again' }));
    expect(onSelect).toHaveBeenCalledWith('findOutline');
  });

  // It is an offer: the outline may have been adjusted by hand, and the user
  // may have erased a note for the saved image and nothing else.
  it('can be turned down, and stays turned down', () => {
    offer();
    const view = render(<ActionBar {...props()} />);
    fireEvent.click(view.getByRole('button', { name: 'Keep the outline as it is' }));
    expect(useWorkspaceStore.getState().retraceOfferFor).toBeNull();
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
    expect(view.getByText(/Drag any corner/)).toBeTruthy();
  });

  it('is not made on a plan it was not raised for', () => {
    offer();
    useAppStore.setState({ activeDocumentId: 'doc-2' });
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
  });

  it('is not made with no outline to find again — the panel is already offering to find one', () => {
    offer();
    useAppStore.setState({ perimeterTraces: [{ id: 't1', vertices: [] }] });
    const view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
  });

  // Every eraser stroke edits the image. Nothing is said while the eraser is
  // still in the user's hand; it is there when they put the tool down.
  it('waits for the tool to be put down, and for a running job to finish', () => {
    offer();
    let view = render(<ActionBar {...props({ tool: 'eraser' })} />);
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
    cleanup();

    useAppStore.setState({ isProcessing: true, processingMessage: 'Finding the outline…' });
    view = render(<ActionBar {...props()} />);
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
  });

  it('gives way to what just happened', () => {
    offer();
    const view = render(<ActionBar {...props()} />);
    act(() => { useWorkspaceStore.getState().flashStatus('Area copied'); });
    expect(view.getByText('Area copied')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Find the outline again' })).toBeNull();
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

describe('every tool and command has a home', () => {
  // The landing checklist for everything the old rail and the old panel
  // offered. A group without a `menu` is not a bar menu: the scale's
  // corrections live on the panel.
  const homes = [
    ['Outline', ['Paint over the walls', 'Click the corners', 'Find the outline again',
      'Cut out an open area', 'Remove several corners', 'Add another outline']],
    ['Measure', ['Measure a distance', 'Measure an area', 'Measure an angle']],
    ['Edit plan', ['Crop the plan', 'Erase marks on the plan', 'Turn the plan right', 'Turn the plan left']],
  ];

  it.each(homes)('%s lists %j', (title, expected) => {
    expect(rowsOf(openMenu(render(<ActionBar {...props()} />), title))).toEqual(expected);
  });

  it('gives every row a sentence saying what it is for', () => {
    const view = render(<ActionBar {...props()} />);
    for (const [title] of homes) {
      const menu = openMenu(view, title);
      for (const item of within(menu).getAllByRole('menuitem')) {
        expect(item.querySelector('.text-fg-3')?.textContent.length, item.textContent).toBeGreaterThan(10);
      }
      fireEvent.keyDown(window, { key: 'Escape' });
    }
  });

  it('hands back the id the catalogue lists, for tools and commands alike', () => {
    const picked = [];
    const view = render(<ActionBar {...props({ onSelect: (id) => picked.push(id) })} />);
    fireEvent.click(row(openMenu(view, 'Outline'), 'Paint over the walls'));
    fireEvent.click(row(openMenu(view, 'Outline'), 'Find the outline again'));
    fireEvent.click(row(openMenu(view, 'Measure'), 'Measure an angle'));
    // Turning is two explicit directions, where it used to hide one behind a
    // right-click.
    fireEvent.click(row(openMenu(view, 'Edit plan'), 'Turn the plan left'));
    expect(picked).toEqual(['draw', 'findOutline', 'angle', 'rotateLeft']);
    // Picking closes the menu and gives the keyboard back.
    expect(view.queryByRole('menu')).toBeNull();
    expect(useWorkspaceStore.getState().menuOpen).toBeNull();
  });

  it('prints the digit beside each tool that has one', () => {
    const view = render(<ActionBar {...props()} />);
    const tools = TOOL_GROUPS.filter((g) => g.menu).flatMap((g) => g.tools.map((t) => [g.title, t]));
    for (const [title, tool] of tools) {
      if (!tool.digit) continue;
      const menu = openMenu(view, title);
      expect(row(menu, tool.label).querySelector('kbd').textContent, tool.label).toBe(tool.digit);
      fireEvent.keyDown(window, { key: 'Escape' });
    }
  });

  it('keeps a tool that needs an outline in place, with its reason, and ignores a click on it', () => {
    const picked = [];
    const view = render(<ActionBar {...props({ hasArea: false, onSelect: (id) => picked.push(id) })} />);
    const item = row(openMenu(view, 'Measure'), 'Measure an area');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(within(item).getByText('Measuring an area needs an outline first.')).toBeTruthy();
    fireEvent.click(item);
    expect(picked).toEqual([]);
  });

  it('lists the next-best outline only while there is one, and says how many', () => {
    let view = render(<ActionBar {...props()} />);
    expect(rowsOf(openMenu(view, 'Outline'))).not.toContain('Try another outline');
    cleanup();

    useAppStore.setState({
      perimeterTraces: [{ id: 't1', vertices: square, quality: { alternatives: [{}, {}] } }],
    });
    view = render(<ActionBar {...props()} />);
    expect(rowsOf(openMenu(view, 'Outline'))).toContain('Try another outline (2 more)');
    cleanup();

    // Once the geometry is the user's, a runner-up scored against the
    // detector's own is no longer an alternative to it.
    useAppStore.setState({
      perimeterTraces: [{ id: 't1', vertices: square, quality: { edited: true, alternatives: [{}] } }],
    });
    view = render(<ActionBar {...props()} />);
    expect(rowsOf(openMenu(view, 'Outline')).some((r) => r.startsWith('Try another'))).toBe(false);
  });

  it('lists Clear only while there is something to clear', () => {
    let view = render(<ActionBar {...props()} />);
    expect(rowsOf(openMenu(view, 'Measure'))).not.toContain('Clear your measurements');
    cleanup();
    view = render(<ActionBar {...props({ hasToolData: true })} />);
    expect(rowsOf(openMenu(view, 'Measure'))).toContain('Clear your measurements');
  });

  it('will not add an outline before the first is drawn', () => {
    useAppStore.setState({ perimeterTraces: [{ id: 't1', vertices: [] }] });
    const view = render(<ActionBar {...props({ hasArea: false })} />);
    const menu = openMenu(view, 'Outline');
    expect(row(menu, 'Add another outline').getAttribute('aria-disabled')).toBe('true');
    // With nothing drawn, "again" would be a lie.
    expect(rowsOf(menu)).toContain('Find the outline');
  });

  // The old top band disabled these while a job ran. Unguarded, a second trace
  // started during the first one's run cleared the busy state in the middle of
  // the second's.
  it('makes the commands that start work wait for a running job, and the tools not', () => {
    useAppStore.setState({
      isProcessing: true,
      perimeterTraces: [{ id: 't1', vertices: square, quality: { alternatives: [{}] } }],
    });
    const view = render(<ActionBar {...props()} />);
    const menu = openMenu(view, 'Outline');
    expect(row(menu, 'Find the outline again').getAttribute('aria-disabled')).toBe('true');
    expect(row(menu, 'Try another outline').getAttribute('aria-disabled')).toBe('true');
    // Modes are not work: entering one changes nothing the job was computed from.
    expect(row(menu, 'Paint over the walls').getAttribute('aria-disabled')).toBeNull();
  });

  it('makes them wait while an outline is being painted', () => {
    useAppStore.setState({ drawModeActive: true });
    const view = render(<ActionBar {...props()} />);
    expect(row(openMenu(view, 'Outline'), 'Find the outline again').getAttribute('aria-disabled')).toBe('true');
  });
});

describe('ActionBar while a tool is running', () => {
  it('stands the menus down and states the mode and its instruction from TOOL_MODES', () => {
    const view = render(<ActionBar {...props({ tool: 'pick' })} />);
    expect(view.queryByRole('toolbar')).toBeNull();
    expect(view.getByText(TOOL_MODES.pick.name)).toBeTruthy();
    expect(view.getByText(TOOL_MODES.pick.hint)).toBeTruthy();
  });

  it('offers Cancel always and Done only when the mode commits', () => {
    const onCancel = vi.fn();
    const onDone = vi.fn();
    const view = render(<ActionBar {...props({ tool: 'crop', onCancel, onDone })} />);
    // `crop` has no doneLabel: there is nothing to finish, only a drag to make.
    expect(view.queryByText(/Finish|Draw the outline/)).toBeNull();
    fireEvent.click(view.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalled();

    view.rerender(<ActionBar {...props({ tool: 'draw', onCancel, onDone })} />);
    fireEvent.click(view.getByText('Draw the outline'));
    expect(onDone).toHaveBeenCalled();
  });

  // Each measurement lands as it is made, so there is nothing to cancel —
  // and leaving a finished one through "Cancel" reads as taking it back.
  it('leaves a tool that has nothing to commit with Done, not Cancel', () => {
    const onCancel = vi.fn();
    for (const tool of ['scale', 'line', 'angle', 'eraser', 'cornerEraser']) {
      const view = render(<ActionBar {...props({ tool, onCancel })} />);
      expect(view.queryByText('Cancel'), tool).toBeNull();
      const done = view.getByRole('button', { name: /^Done/ });
      expect(done.className, tool).toContain('btn-primary');
      fireEvent.click(done);
      cleanup();
    }
    expect(onCancel).toHaveBeenCalledTimes(5);
  });

  it('carries the brush only for the modes that paint, in words rather than pixels', () => {
    const onBrushSizeChange = vi.fn();
    const view = render(<ActionBar {...props({ tool: 'vertex' })} />);
    expect(view.queryByLabelText('Brush size')).toBeNull();

    view.rerender(<ActionBar {...props({ tool: 'draw', onBrushSizeChange })} />);
    const slider = view.getByLabelText('Brush size');
    expect(view.queryByText('24 px')).toBeNull();
    fireEvent.change(slider, { target: { value: '80' } });
    expect(onBrushSizeChange).toHaveBeenCalledWith(80);
  });

  it('counts the corners placed so far', () => {
    const view = render(<ActionBar {...props({ tool: 'vertex', count: 1 })} />);
    expect(view.getByText('1 corner')).toBeTruthy();
    view.rerender(<ActionBar {...props({ tool: 'vertex', count: 4 })} />);
    expect(view.getByText('4 corners')).toBeTruthy();
  });

  it('lets Working… take the instruction', () => {
    const view = render(<ActionBar {...props({ tool: 'draw' })} />);
    expect(view.getByText(/Paint roughly over the outside walls/)).toBeTruthy();

    act(() => useAppStore.setState({ isProcessing: true, processingMessage: 'Tracing…' }));
    expect(view.getByText('Tracing…')).toBeTruthy();
    expect(view.queryByText(/Paint roughly over the outside walls/)).toBeNull();
  });

  // The count changes on every click, so it must not sit in the live region —
  // aria-atomic would re-announce the mode and the instruction with it.
  it('keeps the changing count out of the live region', () => {
    const view = render(<ActionBar {...props({ tool: 'vertex', count: 3 })} />);
    const live = view.container.querySelector('[role="status"]');
    expect(live.textContent).toContain(TOOL_MODES.vertex.name);
    expect(live.textContent).not.toContain('3 corners');
  });

  // The words give way; the way out does not.
  it('keeps Cancel and Done outside the part of the bar that gives way', () => {
    const view = render(<ActionBar {...props({ tool: 'draw', onDone: () => {} })} />);
    expect(view.getByText('Cancel').closest('.action-lead')).toBeNull();
    expect(view.getByText('Draw the outline').closest('.action-lead')).toBeNull();
    expect(view.getByText(/Paint roughly/).closest('.action-lead')).toBeTruthy();
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

  // The menus stay: a tool can be picked through a long job, and a wedged job
  // must not lock the user out of every tool.
  it('says what it is doing, and keeps the menus', () => {
    const view = render(<ActionBar {...props()} />);
    expect(view.getByText('Finding the outline…')).toBeTruthy();
    expect(view.getByRole('toolbar', { name: 'Tools' })).toBeTruthy();
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
