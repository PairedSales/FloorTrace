// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import DocumentTabs from '../DocumentTabs';
import useAppStore from '../../store/appStore';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The band costs the plan 30 px, so the cases here are the two that decide
 * whether it is worth them: whether it renders at all, and whether what it
 * renders is tabs or empty panel.
 */
const props = {
  onSelect: () => {},
  onClose: () => {},
  onNew: () => {},
  isProcessing: false,
};

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
  useWorkspaceStore.setState({ dockOpen: true });
  useAppStore.setState({ image: null });
});
afterEach(cleanup);

describe('DocumentTabs', () => {
  it('renders nothing at one plan', () => {
    openPlans('Sketch 2026-08-20');
    const { container } = render(<DocumentTabs {...props} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the strip once a second plan is open', () => {
    openPlans('Sketch 2026-08-20', 'Sketch 2026-08-21');
    const view = render(<DocumentTabs {...props} />);
    expect(view.getAllByRole('tab').length).toBe(2);
    expect(view.getByLabelText('New plan')).toBeTruthy();
  });

  // The screenshot this came from: one tab, then several hundred px of panel,
  // then a new-plan button in the far corner.
  it('sizes a tab to its own name and puts the new-plan button beside it', () => {
    openPlans('Sketch 2026-08-20', 'Sketch 2026-08-21');
    const view = render(<DocumentTabs {...props} />);
    const [first] = [...view.container.querySelectorAll('[data-tab-id]')];
    expect(first.style.flex).toBe('0 1 auto');
    expect(first.style.maxWidth).toBe('200px');

    // The button is inside the strip, so the strip's own element is its parent
    // rather than a sibling pinned to the row's far end.
    const strip = view.container.querySelector('[role="tablist"]').parentElement;
    expect(strip.contains(view.getByLabelText('New plan'))).toBe(true);
    expect(strip.className).not.toMatch(/flex-1/);
  });
});
