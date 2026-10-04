// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import PlanTabs from '../PlanTabs';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

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

  it('renames the open plan on a double-click', () => {
    openPlans('Sketch');
    const view = render(<PlanTabs {...props()} />);
    fireEvent.doubleClick(view.getByRole('tab'));
    const field = view.getByLabelText('Plan name');
    fireEvent.change(field, { target: { value: '12 Maple St' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(useAppStore.getState().projectName).toBe('12 Maple St');
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
