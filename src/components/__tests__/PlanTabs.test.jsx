// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PlanTabs from '../PlanTabs';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';
import { MAX_OPEN_DOCUMENTS } from '../../store/documentManager';

/**
 * The open plans, in the header. The cases are the ones that decide whether
 * the strip earns its place: that it names the plan from the first one, that it
 * offers the way to add another in words, and that a tab is a tab rather than a
 * share of the window.
 */
const props = (over = {}) => ({
  onSelect: () => {},
  onClose: () => {},
  onNew: () => {},
  isProcessing: false,
  ...over,
});

const openPlans = (...names) => {
  const ids = names.map((_, i) => `doc-${i}`);
  useAppStore.setState({
    documentOrder: ids,
    activeDocumentId: ids[0],
    projectName: names[0],
    documents: Object.fromEntries(ids.map((id, i) => [id, { title: names[i], sourceFileName: '' }])),
  });
  return ids;
};

beforeEach(() => {
  useWorkspaceStore.setState({ menuOpen: null });
  useAppStore.setState({ image: 'data:image/png;base64,AAA' });
});
afterEach(cleanup);

describe('PlanTabs', () => {
  it('shows nothing before the first plan is open', () => {
    useAppStore.setState({ image: null });
    openPlans('');
    const view = render(<PlanTabs {...props()} />);
    expect(view.queryByRole('tab')).toBeNull();
    expect(view.queryByRole('button', { name: /Add plan/ })).toBeNull();
  });

  // One tab is the plan's name — what the saved image is filed under — and the
  // way to add another sits beside it, in words.
  it('names the plan from the first one, with the way to add another', () => {
    openPlans('12 Maple St');
    const view = render(<PlanTabs {...props()} />);
    expect(view.getAllByRole('tab')).toHaveLength(1);
    expect(view.getByRole('tab').textContent).toBe('12 Maple St');
    expect(view.getByRole('button', { name: /Add plan/ })).toBeTruthy();
  });

  it('still shows an empty second plan’s tab, so there is a way back', () => {
    useAppStore.setState({ image: null });
    openPlans('', '12 Maple St');
    const view = render(<PlanTabs {...props()} />);
    expect(view.getAllByRole('tab')).toHaveLength(2);
  });

  it('switches, adds and closes', () => {
    const [, second] = openPlans('Upper', 'Lower');
    const onSelect = vi.fn();
    const onNew = vi.fn();
    const onClose = vi.fn();
    const view = render(<PlanTabs {...props({ onSelect, onNew, onClose })} />);

    fireEvent.click(view.getByRole('tab', { name: 'Lower' }));
    expect(onSelect).toHaveBeenCalledWith(second);
    fireEvent.click(view.getByRole('button', { name: /Add plan/ }));
    expect(onNew).toHaveBeenCalled();
    fireEvent.click(view.getByRole('button', { name: 'Close Lower' }));
    expect(onClose).toHaveBeenCalledWith(second);
  });

  // The last plan can be closed from its tab: it empties in place and the
  // start screen takes over, which is what "close" means to the person
  // pressing it.
  it('lets the only plan be closed', () => {
    const [only] = openPlans('12 Maple St');
    const onClose = vi.fn();
    const view = render(<PlanTabs {...props({ onClose })} />);
    fireEvent.click(view.getByRole('button', { name: 'Close 12 Maple St' }));
    expect(onClose).toHaveBeenCalledWith(only);
  });

  it('renames the open plan on a double-click', () => {
    openPlans('Sketch');
    const view = render(<PlanTabs {...props()} />);
    fireEvent.doubleClick(view.getByRole('tab'));
    const field = view.getByLabelText('Plan name');
    fireEvent.change(field, { target: { value: '12 Maple St' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(useAppStore.getState().projectName).toBe('12 Maple St');
  });

  it('sizes a tab to its own name, and keeps Add plan beside the tabs', () => {
    openPlans('Upper', 'Lower');
    const view = render(<PlanTabs {...props()} />);
    const [first] = [...view.container.querySelectorAll('[data-tab-id]')];
    expect(first.style.flex).toBe('0 1 auto');
    expect(first.style.maxWidth).toBe('230px');
    const tablist = view.getByRole('tablist');
    expect(tablist.className).not.toMatch(/flex-1/);
    expect(tablist.parentElement.contains(view.getByRole('button', { name: /Add plan/ }))).toBe(true);
  });

  it('says why no more can be added at the limit', () => {
    openPlans(...Array.from({ length: MAX_OPEN_DOCUMENTS }, (_, i) => `Plan ${i + 1}`));
    const view = render(<PlanTabs {...props()} />);
    const add = view.getByRole('button', { name: /Add plan/ });
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toMatch(/most that can be open/);
  });

  it('marks a plan whose scale was held back', () => {
    openPlans('Upper', 'Lower');
    useAppStore.setState((s) => ({
      documents: { ...s.documents, 'doc-1': { ...s.documents['doc-1'], needsRescale: true } },
    }));
    const view = render(<PlanTabs {...props()} />);
    expect(view.getByRole('tab', { name: 'Lower' }).querySelector('svg')).toBeTruthy();
    expect(view.getByRole('tab', { name: 'Upper' }).querySelector('svg')).toBeNull();
  });
});
