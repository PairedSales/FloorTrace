// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import TopBar from '../TopBar';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The band's two contracts, neither of which the old two-component row could
 * state, let alone hold.
 *
 * **The accent means one thing** — "this is the step you are on" — so exactly
 * one control may carry it, it must never be a control you cannot press, and it
 * must never be Export. The row it replaces hard-wired the fill onto *Find
 * outline*, so first paint over an empty canvas showed a filled accent button
 * at `opacity-40`, which is 1.76:1.
 *
 * **Every command that left the row still has a home.** Five labelled verbs
 * became three, and the two that went are only redesigned rather than removed
 * if a test says where they landed. `commandHomes` below is that landing
 * checklist, and it is the reason a caret exists at all.
 */
const noop = () => {};

const baseProps = {
  image: 'data:image/png;base64,AAA',
  isProcessing: false,
  hasArea: false,
  calibrated: false,
  perimeterTraces: [],
  drawModeActive: false,
  planCount: 1,
  canOpenPlan: true,
  onFileOpen: noop,
  onPasteImage: noop,
  onExport: noop,
  onCopyExhibit: noop,
  onSaveProject: noop,
  onSaveProjectAs: noop,
  onSaveAllProjects: noop,
  onNewPlan: noop,
  onNextPlan: noop,
  onPrevPlan: noop,
  onCloseActivePlan: noop,
  onCloseAllPlans: noop,
  onHelpOpen: noop,
  onFindRoomSize: noop,
  onSelectRoom: noop,
  canSelectRoom: true,
  onScaleTool: noop,
  onTracePerimeter: noop,
  onPaintOutline: noop,
  onPlaceCorners: noop,
  onAddOutline: noop,
  onFitToWindow: noop,
  dockOpen: true,
  onDockToggle: noop,
  showSideLengths: false,
  onShowSideLengthsChange: noop,
  autoSnapEnabled: true,
  onAutoSnapChange: noop,
  saveOnExit: true,
  onSaveOnExitChange: noop,
  enhancedOcr: false,
  onEnhancedOcrChange: noop,
  theme: 'system',
  onCycleTheme: noop,
};

const traced = (n = 1) => Array.from({ length: n }, (_, i) => ({
  id: `t${i}`,
  vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
}));

const bar = (props = {}) => render(<TopBar {...baseProps} {...props} />);
// A split button is one control in two halves, and both halves take the fill
// together — so the caret is not a second primary. Counted by the labelled half.
const primaries = (view) =>
  [...view.container.querySelectorAll('.toolbar-btn-primary')]
    .filter((b) => !b.getAttribute('aria-haspopup'))
    .map((b) => b.textContent.trim());

// Opens a dropdown by the accessible name of the control that owns it.
const openMenu = (view, name) => {
  fireEvent.click(view.getByRole('button', { name }));
  return view.getByRole('menu');
};

beforeEach(() => useWorkspaceStore.setState({ menuOpen: false }));
afterEach(cleanup);

describe('the primary is the step you are on', () => {
  it('puts no accent on the row before a plan is open', () => {
    const view = bar({ image: null });
    expect(primaries(view)).toEqual([]);
  });

  it('moves from Read dimensions to Find outline when a scale lands', () => {
    expect(primaries(bar()).map((t) => t.trim())).toEqual(['Read dimensions']);
    cleanup();
    expect(primaries(bar({ calibrated: true }))).toEqual(['Find outline']);
  });

  it('stands down once an outline exists, rather than promoting Export', () => {
    const view = bar({ calibrated: true, perimeterTraces: traced(), hasArea: true });
    expect(primaries(view)).toEqual([]);
    // Export earns the outlined treatment and never the fill: a filled accent
    // over a `fair` trace is a wrong answer that looks green.
    const exportBtn = view.getByRole('button', { name: 'Export' });
    expect(exportBtn.className).toContain('toolbar-btn-ready');
    expect(exportBtn.className).not.toContain('toolbar-btn-primary');
  });

  it('never marks a control you cannot press', () => {
    // The state the old row got wrong on first paint, plus the two that follow.
    for (const props of [{ image: null }, { isProcessing: true }, { calibrated: true, isProcessing: true }]) {
      const view = bar(props);
      const marked = [...view.container.querySelectorAll('.toolbar-btn-primary')];
      expect(marked.filter((b) => b.disabled)).toEqual([]);
      cleanup();
    }
  });

  it('fills both halves of a split button, so it reads as one object', () => {
    const view = bar();
    const caret = view.getByRole('button', { name: 'More ways to set the scale' });
    expect(caret.className).toContain('toolbar-btn-primary');
    // ...and the other split stays quiet, or there would be two primaries.
    expect(view.getByRole('button', { name: 'More ways to make an outline' }).className)
      .not.toContain('toolbar-btn-primary');
  });

  it('says which step it is in the accessibility tree, not only in colour', () => {
    const view = bar();
    expect(view.getByRole('button', { name: 'Read dimensions' }).getAttribute('aria-current')).toBe('step');
    expect(view.getByRole('button', { name: 'Find outline' }).getAttribute('aria-current')).toBeNull();
  });

  it('keeps every verb the same shape in every stage, so the row cannot reflow', () => {
    // The weight and the border box live on `-stage`, permanently; `-primary`
    // and `-ready` only recolour. If either moves back onto a state class, the
    // row changes width the moment the stage advances.
    for (const props of [{}, { calibrated: true }, { calibrated: true, perimeterTraces: traced(), hasArea: true }]) {
      const view = bar(props);
      for (const name of ['Read dimensions', 'Find outline', 'Export']) {
        expect(view.getByRole('button', { name }).className).toContain('toolbar-btn-stage');
      }
      cleanup();
    }
  });
});

describe('every command that left the row still has a home', () => {
  const commandHomes = [
    ['More ways to set the scale', ['Read dimensions', 'Select room to scale from', 'Set the scale by hand']],
    ['More ways to make an outline', ['Find outline', 'Paint outline', 'Place corners', 'Add another outline']],
  ];

  it.each(commandHomes)('%s lists %j', (caret, expected) => {
    const view = bar({ calibrated: true, perimeterTraces: traced() });
    const menu = openMenu(view, caret);
    const items = within(menu).getAllByRole('menuitem').map((i) => i.textContent.replace(/\s+/g, ' ').trim());
    for (const label of expected) expect(items.some((t) => t.startsWith(label))).toBe(true);
  });

  it('offers no eighth outline — the cap the old menu item ignored', () => {
    const view = bar({ calibrated: true, perimeterTraces: traced(7) });
    const menu = openMenu(view, 'More ways to make an outline');
    expect(within(menu).getByRole('menuitem', { name: 'Add another outline' }).disabled).toBe(true);
  });

  it('offers nothing to pick from until a scan has read something', () => {
    const view = bar({ canSelectRoom: false });
    const menu = openMenu(view, 'More ways to set the scale');
    expect(within(menu).getByRole('menuitem', { name: 'Select room to scale from' }).disabled).toBe(true);
  });
});

describe('one dropdown, and the keyboard knows about it', () => {
  it('tells the keyboard guard while any of the four is open', () => {
    // `shortcutsBlocked` reads this. Without it `1` entered draw mode behind an
    // open menu and `O` toggled the very panel the open View menu was offering.
    const view = bar();
    expect(useWorkspaceStore.getState().menuOpen).toBe(false);
    openMenu(view, 'More ways to make an outline');
    expect(useWorkspaceStore.getState().menuOpen).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(useWorkspaceStore.getState().menuOpen).toBe(false);
  });

  it('opens one at a time — a caret closes a title', () => {
    const view = bar();
    openMenu(view, 'File');
    openMenu(view, 'More ways to set the scale');
    expect(view.getAllByRole('menu')).toHaveLength(1);
    expect(view.getByRole('button', { name: 'File' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open when the trigger itself is pressed, and closes on a press outside', () => {
    // The band closes on a window `mousedown`, so the trigger and its panel have
    // to swallow theirs or the menu would close on the very press that opened it.
    const view = bar();
    const caret = view.getByRole('button', { name: 'More ways to make an outline' });
    fireEvent.mouseDown(caret);
    fireEvent.click(caret);
    expect(view.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(window);
    expect(view.queryByRole('menu')).toBeNull();
  });

  it('lets a plain command mousedown reach the window', () => {
    // `useKeyboardShortcuts` reads mouse buttons 3/4 (undo/redo) off window
    // `mousedown`. A swallow scoped to the whole group killed that for whatever
    // command the pointer happened to be over.
    const view = bar();
    let seen = 0;
    const spy = () => { seen += 1; };
    window.addEventListener('mousedown', spy);
    fireEvent.mouseDown(view.getByRole('button', { name: 'Export' }));
    window.removeEventListener('mousedown', spy);
    expect(seen).toBe(1);
  });

  it('gives the flag back when the band unmounts', () => {
    const view = bar();
    openMenu(view, 'View');
    expect(useWorkspaceStore.getState().menuOpen).toBe(true);
    view.unmount();
    expect(useWorkspaceStore.getState().menuOpen).toBe(false);
  });
});

describe('the row names each thing once', () => {
  it('has no two controls sharing an accessible name', () => {
    const view = bar();
    const names = view.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
  });

  it('labels only the three pipeline verbs, and leaves the utilities as icons', () => {
    const view = bar();
    const labelled = view.getAllByRole('button')
      .filter((b) => b.textContent.trim() && !b.getAttribute('aria-haspopup'))
      .map((b) => b.textContent.trim());
    expect(labelled).toEqual(['Read dimensions', 'Find outline', 'Export']);
  });
});
