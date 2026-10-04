// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import WelcomeScreen from '../WelcomeScreen';

/**
 * The start screen is the whole window until a plan is open, so what it has to
 * get right is the first thirty seconds: say what the app is for, name every
 * way in, and be honest that "automatic" is not "always right".
 *
 * The introduction — the demo and the four steps — is there every time the
 * start screen is. It was once a first-run thing; the owner wants it kept. The
 * ways in lead the page, so it never stands between a user and the button.
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
  it('fires both actions', () => {
    const onFileOpen = vi.fn();
    const onTryExample = vi.fn();
    const view = render(<WelcomeScreen {...props({ onFileOpen, onTryExample })} />);

    fireEvent.click(view.getByRole('button', { name: /choose a file/i }));
    fireEvent.click(view.getByRole('button', { name: /try the sample plan/i }));

    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onTryExample).toHaveBeenCalledTimes(1);
  });
});
