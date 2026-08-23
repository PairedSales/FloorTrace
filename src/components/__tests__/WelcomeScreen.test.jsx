// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import WelcomeScreen from '../WelcomeScreen';
import { WELCOME_KEY, markWelcomed } from '../../hooks/useWelcome';

/**
 * The one property worth defending here is that the demo is a *first-run*
 * thing. It is the whole canvas for ten seconds, and a user who has already
 * seen it is closing a plan to open another one — showing it again is a
 * ten-second animation standing between them and their next drawing.
 *
 * The flag is read in a `useState` initialiser, so it is per-mount: the empty
 * state unmounts the moment an image exists and remounts when one is closed,
 * which is exactly when it needs to be re-read.
 */
beforeEach(() => localStorage.clear());
afterEach(cleanup);

const props = (over = {}) => ({
  isTouch: false,
  onFileOpen: () => {},
  onTryExample: () => {},
  ...over,
});

describe('WelcomeScreen', () => {
  it('shows the pipeline demo and the four stages on a first run', () => {
    const view = render(<WelcomeScreen {...props()} />);

    expect(view.container.querySelector('.ft-demo')).toBeTruthy();
    for (const stage of ['Plan', 'Scale', 'Outline', 'Report']) {
      expect(view.getByText(stage)).toBeTruthy();
    }
    // The caveat is the reason this screen exists rather than a splash: the
    // app's worst failure is a confident wrong answer, so "automatic" is never
    // offered unqualified.
    expect(view.getByText(/paint roughly over the walls/i)).toBeTruthy();
  });

  it('falls back to the compact empty state once the flag is set', () => {
    localStorage.setItem(WELCOME_KEY, '1');
    const view = render(<WelcomeScreen {...props()} />);

    expect(view.container.querySelector('.ft-demo')).toBeNull();
    expect(view.getByText('No floor plan loaded')).toBeTruthy();
    expect(view.queryByRole('button', { name: /try an example/i })).toBeNull();
  });

  it('markWelcomed is what flips it, and survives a re-mount', () => {
    const first = render(<WelcomeScreen {...props()} />);
    expect(first.container.querySelector('.ft-demo')).toBeTruthy();
    cleanup();

    markWelcomed();

    const second = render(<WelcomeScreen {...props()} />);
    expect(second.container.querySelector('.ft-demo')).toBeNull();
  });

  it('fires both actions', () => {
    const onFileOpen = vi.fn();
    const onTryExample = vi.fn();
    const view = render(<WelcomeScreen {...props({ onFileOpen, onTryExample })} />);

    fireEvent.click(view.getByRole('button', { name: /open a plan/i }));
    fireEvent.click(view.getByRole('button', { name: /try an example plan/i }));

    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onTryExample).toHaveBeenCalledTimes(1);
  });

  it('offers no Open button on touch — the action bar below is the route in', () => {
    const view = render(<WelcomeScreen {...props({ isTouch: true })} />);

    expect(view.queryByRole('button', { name: /open a plan/i })).toBeNull();
    expect(view.getByRole('button', { name: /try an example plan/i })).toBeTruthy();
    expect(view.getByText(/photograph a plan/i)).toBeTruthy();
  });

  it('hides the example button until a handler exists', () => {
    const view = render(<WelcomeScreen {...props({ onTryExample: undefined })} />);

    expect(view.queryByRole('button', { name: /try an example/i })).toBeNull();
    expect(view.getByRole('button', { name: /open a plan/i })).toBeTruthy();
  });
});
