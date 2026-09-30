// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import TopBar from '../TopBar';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The band's contracts.
 *
 * **It never fills a button.** Export is the end of the job and earns an
 * outline once there is an area, never the fill: a filled accent over a
 * doubtful trace is a wrong answer that looks green.
 *
 * **Every command has a home.** The band gave up its two pipeline buttons and
 * their carets; the menus below are the landing checklist for everything a
 * user reaches from here, and the dock owns the outline's and the scale's
 * corrections.
 *
 * **One dropdown at a time, and the keyboard knows about it.**
 */
const noop = () => {};

const baseProps = {
  image: 'data:image/png;base64,AAA',
  isProcessing: false,
  hasArea: false,
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
  onCloseActivePlan: noop,
  onCloseAllPlans: noop,
  onOpenSettings: noop,
  onHelpOpen: noop,
  onFitToWindow: noop,
  onZoomIn: noop,
  onZoomOut: noop,
  onRotate: noop,
  dockOpen: true,
  onDockToggle: noop,
  showSideLengths: true,
  onShowSideLengthsChange: noop,
  autoSnapEnabled: true,
  onAutoSnapChange: noop,
};

const bar = (props = {}) => render(<TopBar {...baseProps} {...props} />);

// Opens a dropdown by the accessible name of the control that owns it.
const openMenu = (view, name) => {
  fireEvent.click(view.getByRole('button', { name }));
  return view.getByRole('menu');
};

const itemsOf = (menu) => within(menu).getAllByRole('menuitem')
  .map((i) => (i.getAttribute('aria-label') ?? i.textContent).replace(/\s+/g, ' ').trim());

beforeEach(() => useWorkspaceStore.setState({ menuOpen: null }));
afterEach(cleanup);

describe('the band never fills a button', () => {
  it('outlines Export once there is an area, and never fills it', () => {
    const view = bar({ hasArea: true });
    const exportBtn = view.getByRole('button', { name: 'Export' });
    expect(exportBtn.className).toContain('toolbar-btn-ready');
    expect(view.container.querySelectorAll('.toolbar-btn-primary')).toHaveLength(0);
  });

  it('leaves Export plain before there is anything to export', () => {
    const view = bar();
    expect(view.getByRole('button', { name: 'Export' }).className).not.toContain('toolbar-btn-ready');
  });

  it('shows only the name, the menus and Open before a plan is open', () => {
    const view = bar({ image: null });
    const labelled = view.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim());
    expect(labelled).toEqual(['File', 'View', 'Help', 'Open']);
    expect(view.getByText('FloorTrace')).toBeTruthy();
  });

  it('asks the pipeline for nothing — reading dimensions and finding the outline happen on their own', () => {
    const view = bar();
    expect(view.queryByRole('button', { name: /Read dimensions/ })).toBeNull();
    expect(view.queryByRole('button', { name: /Find outline/ })).toBeNull();
  });
});

describe('every command has a home', () => {
  const homes = [
    ['File', ['Open floor plan…', 'Paste floor plan', 'Export image…', 'Copy image',
      'Save project file', 'Save project file as…', 'New plan tab', 'Close plan', 'Settings…']],
    ['View', ['Fit plan to window', 'Zoom in', 'Zoom out', 'Rotate right 45°', 'Rotate left 45°',
      'Measurement panel', 'Wall lengths on the plan', 'Snap corners to walls']],
    ['Help', ['How to use FloorTrace…', 'Keyboard shortcuts…', 'How automatic tracing works — opens in a new tab']],
  ];

  it.each(homes)('%s lists %j', (title, expected) => {
    const menu = openMenu(bar(), title);
    const items = itemsOf(menu);
    for (const label of expected) expect(items.some((t) => t.startsWith(label)), label).toBe(true);
  });

  it('lists the several-plan commands only when there are several plans', () => {
    let items = itemsOf(openMenu(bar({ planCount: 1 }), 'File'));
    expect(items.some((t) => t.startsWith('Save all plans'))).toBe(false);
    expect(items.some((t) => t.startsWith('Close all plans'))).toBe(false);
    cleanup();
    items = itemsOf(openMenu(bar({ planCount: 3 }), 'File'));
    expect(items.some((t) => t.startsWith('Save all plans'))).toBe(true);
    expect(items.some((t) => t.startsWith('Close all plans'))).toBe(true);
  });

  it('opens Help on the page it names', () => {
    const opened = [];
    const view = bar({ onHelpOpen: (page) => opened.push(page) });
    fireEvent.click(within(openMenu(view, 'Help')).getByText('Keyboard shortcuts…'));
    fireEvent.click(within(openMenu(view, 'Help')).getByText('How to use FloorTrace…'));
    expect(opened).toEqual(['shortcuts', 'guide']);
  });

  it('rotates both ways from View, where the rail used to hide one behind a right-click', () => {
    const turned = [];
    const view = bar({ onRotate: (d) => turned.push(d) });
    fireEvent.click(within(openMenu(view, 'View')).getByText('Rotate left 45°'));
    expect(turned).toEqual(['counterclockwise']);
  });

  it('does not make the mark a button — closing everything lives in File', () => {
    const view = bar();
    expect(view.queryByRole('button', { name: /Start fresh/ })).toBeNull();
  });
});

/**
 * The one item in this band that leaves the app. It is worth a test because
 * the failure is silent in both directions: a renamed build output 404s a menu
 * item that still looks fine, and an item that forgets `external` opens a new
 * tab with nothing saying it will.
 */
describe('the walkthrough opens out of the app', () => {
  const item = (view) =>
    within(openMenu(view, 'Help')).getByRole('menuitem', { name: /How automatic tracing works/ });

  it('sits in Help, and says it leaves', () => {
    expect(item(bar()).getAttribute('aria-label')).toBe(
      'How automatic tracing works — opens in a new tab',
    );
  });

  it('opens the page the build actually writes, in a new tab', () => {
    const calls = [];
    const real = window.open;
    window.open = (...args) => { calls.push(args); return null; };
    try {
      fireEvent.click(item(bar()));
    } finally {
      window.open = real;
    }
    expect(calls).toHaveLength(1);
    const [url, target, features] = calls[0];
    expect(url.endsWith('/tracing-tutorial.html')).toBe(true);
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
  });

  it('is available with no plan open — it is how you find out what the app does', () => {
    expect(item(bar({ image: null })).disabled).toBe(false);
  });
});

describe('one dropdown, and the keyboard knows about it', () => {
  it('tells the keyboard guard while a menu is open', () => {
    // `shortcutsBlocked` reads this. Without it `1` entered draw mode behind an
    // open menu and `O` toggled the very panel the open View menu was offering.
    const view = bar();
    expect(useWorkspaceStore.getState().menuOpen).toBeFalsy();
    openMenu(view, 'View');
    expect(useWorkspaceStore.getState().menuOpen).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(useWorkspaceStore.getState().menuOpen).toBeFalsy();
  });

  it('opens one at a time', () => {
    const view = bar();
    openMenu(view, 'File');
    openMenu(view, 'Help');
    expect(view.getAllByRole('menu')).toHaveLength(1);
    expect(view.getByRole('button', { name: 'File' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('stays open when the trigger itself is pressed, and closes on a press outside', () => {
    // The band closes on a window `mousedown`, so the trigger and its panel have
    // to swallow theirs or the menu would close on the very press that opened it.
    const view = bar();
    const title = view.getByRole('button', { name: 'View' });
    fireEvent.mouseDown(title);
    fireEvent.click(title);
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
    expect(useWorkspaceStore.getState().menuOpen).toBeTruthy();
    view.unmount();
    expect(useWorkspaceStore.getState().menuOpen).toBeFalsy();
  });
});

describe('the row names each thing once', () => {
  it('has no two controls sharing an accessible name', () => {
    const view = bar();
    const names = view.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
  });

  it('labels Open and Export, and leaves the universal utilities as icons', () => {
    const view = bar();
    const labelled = view.getAllByRole('button')
      .filter((b) => b.textContent.trim() && !b.getAttribute('aria-haspopup'))
      .map((b) => b.textContent.trim());
    expect(labelled).toEqual(['Open', 'Export']);
  });
});
