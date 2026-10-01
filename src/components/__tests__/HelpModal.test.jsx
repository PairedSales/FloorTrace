// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import HelpModal from '../HelpModal';

/**
 * Help names controls, so it is the one place a renamed control goes stale
 * without anything failing. These cases tie its words to the ones the screen
 * prints, and cover the one thing in it that leaves the app.
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

  // The guide tells people which button to choose. Each name it quotes must be
  // one the screen actually prints (`ResultsPanel.jsx`, `ActionBar.jsx`).
  it('names the controls the way the screen does', () => {
    const view = help();
    const guide = view.getByRole('tabpanel').textContent;
    for (const label of [
      'Try another outline', 'Use a different room', 'Set scale using known length', 'Save image',
    ]) {
      expect(guide, label).toContain(label);
    }
    // The words the redesign retired, and the tools that are gone.
    expect(guide).not.toMatch(/Export|tools on the right|File ▸/);
    expect(guide).not.toMatch(/Paint over|Click the corners|Crop the plan|Erase marks|drag it into place/i);
  });

  it('lists no tool digits: there are no tools to pick', () => {
    const view = help({ initialTab: 'shortcuts' });
    const keys = [...view.getByRole('tabpanel').querySelectorAll('kbd')].map((k) => k.textContent);
    expect(keys.filter((k) => /^[1-9]$/.test(k))).toEqual([]);
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
