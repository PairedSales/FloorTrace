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
  autoSnapEnabled: true,
  onAutoSnapChange: noop,
};

const header = (props = {}) => render(<AppHeader {...baseProps} {...props} />);

const openMenu = (view) => {
  fireEvent.click(view.getByRole('button', { name: 'Menu' }));
  return view.getByRole('menu');
};

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
  it('opens Help on the guide', () => {
    const opened = [];
    const view = header({ onHelpOpen: (page) => opened.push(page) });
    fireEvent.click(view.getByRole('button', { name: 'Help' }));
    expect(opened).toEqual(['guide']);
  });
});

describe('the Menu holds what is not on screen', () => {
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
  it('makes it a warning when nothing is being kept', () => {
    useAppStore.setState({ draftState: 'off' });
    let view = header();
    expect(view.getByText('Autosave is off').className).toContain('chip-warn');
    cleanup();

    useAppStore.setState({ draftState: 'error' });
    view = header();
    expect(view.getByText('Not saved').className).toContain('chip-crit');
  });
});
