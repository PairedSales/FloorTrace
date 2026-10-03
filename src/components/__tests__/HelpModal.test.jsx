// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import HelpModal from '../HelpModal';
import { TOOL_GROUPS } from '../toolCatalog';
import { STEP_TITLES } from '../../utils/progressSteps';

/**
 * Help names controls, so it is the one place a renamed control goes stale
 * without anything failing. These cases tie its words to the catalogue the
 * screen is built from, and cover the one thing in it that leaves the app.
 */
afterEach(cleanup);

const help = (props = {}) => render(<HelpModal onClose={() => {}} {...props} />);

describe('HelpModal', () => {
  it('opens on the guide, and on the shortcuts when asked', () => {
    let view = help();
    expect(view.getByRole('tab', { name: 'How to use FloorTrace' }).getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('The basics')).toBeTruthy();
    cleanup();

    view = help({ initialTab: 'shortcuts' });
    expect(view.getByRole('tab', { name: 'Keyboard shortcuts' }).getAttribute('aria-selected')).toBe('true');
    expect(view.getByText('Opening and saving')).toBeTruthy();
  });

  it('switches pages from its own tabs', () => {
    const view = help();
    fireEvent.click(view.getByRole('tab', { name: 'Keyboard shortcuts' }));
    expect(view.getByText('Looking at the plan')).toBeTruthy();
    expect(view.queryByText('The basics')).toBeNull();
  });

  // The guide tells people which menu to open and which row to choose. Each
  // name it quotes must be one the screen actually prints: the menus above the
  // plan by their titles, and the outline's — which is in the results panel —
  // by its button there and the step it sits in.
  it('names the menus and tools the way the screen does', () => {
    const view = help();
    const guide = view.getByRole('tabpanel').textContent;
    for (const group of TOOL_GROUPS.filter((g) => g.menu && g.id !== 'outline')) {
      expect(guide, `the ${group.title} menu`).toContain(group.title);
    }
    expect(guide).toContain('Change the outline');
    for (const step of [STEP_TITLES.scale.done, STEP_TITLES.outline.done]) {
      expect(guide, step).toContain(step);
    }
    const quoted = ['draw', 'vertex', 'eraser', 'crop', 'scale'];
    const tools = TOOL_GROUPS.flatMap((g) => g.tools);
    for (const id of quoted) {
      const { label } = tools.find((t) => t.id === id);
      expect(guide, label).toContain(label);
    }
    for (const id of ['findOutline', 'addOutline']) {
      const { label } = TOOL_GROUPS.flatMap((g) => g.commands ?? []).find((c) => c.id === id);
      expect(guide, label).toContain(label);
    }
    // The words the redesign retired.
    expect(guide).not.toMatch(/Export|tools on the right|File ▸/);
  });

  it('lists every tool digit the catalogue assigns', () => {
    const view = help({ initialTab: 'shortcuts' });
    for (const tool of TOOL_GROUPS.flatMap((g) => g.tools).filter((t) => t.digit)) {
      const row = view.getByText(tool.label).closest('div');
      expect(row.querySelector('kbd').textContent, tool.label).toBe(tool.digit);
    }
  });

  it('closes on Escape and on its close button', () => {
    const onClose = vi.fn();
    const view = help({ onClose });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    fireEvent.click(view.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  /**
   * The one item that leaves the app. It is worth a test because the failure
   * is silent in both directions: a renamed build output 404s a link that
   * still looks fine, and a link that forgets to say so opens a new tab with
   * nothing saying it will.
   */
  it('opens the tracer walkthrough the build actually writes, in a new tab, and says it leaves', () => {
    const calls = [];
    const real = window.open;
    window.open = (...args) => { calls.push(args); return null; };
    try {
      const view = help();
      fireEvent.click(view.getByRole('button', { name: /How FloorTrace finds the outline — opens in a new tab/ }));
    } finally {
      window.open = real;
    }
    expect(calls).toHaveLength(1);
    const [url, target, features] = calls[0];
    expect(url.endsWith('/tracing-tutorial.html')).toBe(true);
    expect(target).toBe('_blank');
    expect(features).toContain('noopener');
  });
});
