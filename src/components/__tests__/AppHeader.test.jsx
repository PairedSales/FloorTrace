// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within } from '@testing-library/react';
import AppHeader from '../AppHeader';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The header's contracts.
 *
 * **It is a frame, not a menu bar.** One Menu holds what is not on screen; the
 * old File, View and Help are gone, and with them the job of guessing which
 * drawer a command was filed in.
 *
 * **It never fills a button.** The filled button is Save image, at the foot of
 * the results it saves. A filled accent in the part of the window read first,
 * over a doubtful trace, is a wrong answer that looks finished.
 *
 * **Whether work is being kept is said, not assumed.**
 */
const noop = () => {};

const baseProps = {
  image: 'data:image/png;base64,AAA',
  isProcessing: false,
  planCount: 1,
  onSelectPlan: noop,
  onClosePlan: noop,
  onNewPlan: noop,
  onFileOpen: noop,
  onPasteImage: noop,
  onExport: noop,
  onCopyExhibit: noop,
  onSaveProject: noop,
  onSaveProjectAs: noop,
  onSaveAllProjects: noop,
  onCloseActivePlan: noop,
  onCloseAllPlans: noop,
  onOpenSettings: noop,
  onHelpOpen: noop,
  panelOpen: true,
  onPanelToggle: noop,
  showSideLengths: true,
  onShowSideLengthsChange: noop,
  onAutoSnapChange: noop,
};

const header = (props = {}) => render(<AppHeader {...baseProps} {...props} />);

const openMenu = (view) => {
  fireEvent.click(view.getByRole('button', { name: 'Menu' }));
  return view.getByRole('menu');
};

const rowsOf = (menu) => within(menu).getAllByRole('menuitem')
  .map((row) => row.querySelector('.font-medium').textContent.trim());

const row = (menu, label) => within(menu).getByText(label).closest('[role="menuitem"]');

beforeEach(() => {
  useWorkspaceStore.setState({ menuOpen: null });
  useAppStore.setState({
    image: baseProps.image,
    draftState: 'saved',
    documentOrder: ['doc-0'],
    activeDocumentId: 'doc-0',
    projectName: 'Maple St',
    documents: { 'doc-0': { title: 'Maple St' } },
  });
});
afterEach(cleanup);

describe('the header is a frame, not a menu bar', () => {
  it('has no File, View or Help menus — one Menu, and a Help button', () => {
    const view = header();
    for (const gone of ['File', 'View']) {
      expect(view.queryByRole('button', { name: gone })).toBeNull();
    }
    expect(view.getByRole('button', { name: 'Menu' }).getAttribute('aria-haspopup')).toBe('menu');
    expect(view.getByRole('button', { name: 'Help' }).getAttribute('aria-haspopup')).toBeNull();
  });

  it('opens Help on the guide', () => {
    const opened = [];
    const view = header({ onHelpOpen: (page) => opened.push(page) });
    fireEvent.click(view.getByRole('button', { name: 'Help' }));
    expect(opened).toEqual(['guide']);
  });

  it('is only the name, Help and Menu before a plan is open', () => {
    useAppStore.setState({ image: null });
    const view = header({ image: null });
    const names = view.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim());
    expect(names).toEqual(['Help', 'Menu']);
    expect(view.getByText('FloorTrace')).toBeTruthy();
  });

  it('never fills a button', () => {
    const view = header();
    expect(view.container.querySelectorAll('.btn-primary')).toHaveLength(0);
  });

  it('does not make the mark a button — closing lives in the Menu', () => {
    const view = header();
    expect(view.getByText('FloorTrace').closest('button')).toBeNull();
  });

  it('has no two controls sharing an accessible name', () => {
    const view = header();
    const names = view.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent.trim());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the Menu holds what is not on screen', () => {
  it('lists opening, saving, the two switches, Settings and closing', () => {
    const rows = rowsOf(openMenu(header()));
    expect(rows).toEqual([
      'Open a floor plan…', 'Paste a floor plan',
      'Save image…', 'Copy image', 'Save project file', 'Save project file as…',
      'Wall lengths on the plan', 'Results panel',
      'Settings…',
      'Close this plan',
    ]);
  });

  // Closing the plan you are looking at is a different act from closing every
  // plan; the second is only listed where it means something different.
  it('lists the several-plan commands only when there are several plans', () => {
    let rows = rowsOf(openMenu(header({ planCount: 1 })));
    expect(rows).not.toContain('Save all plans');
    expect(rows).not.toContain('Close all plans');
    cleanup();
    rows = rowsOf(openMenu(header({ planCount: 3 })));
    expect(rows).toContain('Save all plans');
    expect(rows).toContain('Close all plans');
  });

  it('runs the command it names', () => {
    const calls = [];
    const view = header({
      onExport: () => calls.push('export'),
      onOpenSettings: () => calls.push('settings'),
      onPanelToggle: () => calls.push('panel'),
      onShowSideLengthsChange: (v) => calls.push(`lengths:${v}`),
    });
    fireEvent.click(row(openMenu(view), 'Save image…'));
    fireEvent.click(row(openMenu(view), 'Settings…'));
    fireEvent.click(row(openMenu(view), 'Results panel'));
    fireEvent.click(row(openMenu(view), 'Wall lengths on the plan'));
    expect(calls).toEqual(['export', 'settings', 'panel', 'lengths:false']);
  });

  // On the start screen it used to open as eight greyed-out rows around the
  // two that worked.
  it('lists only what can be done before a plan is open', () => {
    useAppStore.setState({ image: null });
    expect(rowsOf(openMenu(header({ image: null })))).toEqual([
      'Open a floor plan…', 'Paste a floor plan', 'Settings…',
    ]);
  });

  it('can close an empty plan that is one of several', () => {
    useAppStore.setState({ image: null });
    const rows = rowsOf(openMenu(header({ image: null, planCount: 2 })));
    expect(rows).toContain('Close this plan');
    expect(rows).not.toContain('Save image…');
  });

  it('makes what would read a half-measured plan wait for the running job', () => {
    // The image is rendered from a snapshot, so a trace landing behind it would
    // be saved as the measurement that preceded it.
    const menu = openMenu(header({ isProcessing: true }));
    expect(row(menu, 'Save image…').getAttribute('aria-disabled')).toBe('true');
    expect(row(menu, 'Copy image').getAttribute('aria-disabled')).toBe('true');
    expect(row(menu, 'Open a floor plan…').getAttribute('aria-disabled')).toBe('true');
    expect(row(menu, 'Settings…').getAttribute('aria-disabled')).toBeNull();
  });
});

describe('whether the work is being kept', () => {
  it('says so in a word at rest', () => {
    const view = header();
    expect(view.getByText('Autosaved')).toBeTruthy();
  });

  it('makes it a warning when nothing is being kept', () => {
    useAppStore.setState({ draftState: 'off' });
    let view = header();
    expect(view.getByText('Autosave is off').className).toContain('chip-warn');
    cleanup();

    useAppStore.setState({ draftState: 'error' });
    view = header();
    expect(view.getByText('Not saved').className).toContain('chip-crit');
  });

  it('says nothing before there is a plan to keep', () => {
    useAppStore.setState({ image: null });
    const view = header({ image: null });
    expect(view.queryByText('Autosaved')).toBeNull();
  });
});
