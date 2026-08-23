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

/**
 * Nothing here renders with layout, so the demo itself cannot be verified by a
 * program — but its *wiring* can, and every failure mode of that wiring is
 * silent. An element carrying `ft-outline` without `ft-a` never animates and
 * sits at its authored `stroke-dashoffset` forever: the outline is simply
 * always drawn, which looks like a design choice rather than a broken beat.
 */
describe('the demo timeline is wired end to end', () => {
  const css = () => render(<WelcomeScreen {...props()} />).container
    .querySelector('.ft-demo style').textContent;

  const animatedEls = (container) =>
    [...container.querySelectorAll('.ft-demo [class*="ft-"]')]
      .map((el) => ({ el, beats: [...el.classList].filter((c) => /^ft-(?!a$|demo$|draw$|transient$|wall$|scan$|chip$|label$|area$)/.test(c)) }))
      .filter((e) => e.beats.length > 0);

  it('every element with a beat class also carries ft-a', () => {
    const view = render(<WelcomeScreen {...props()} />);
    for (const { el, beats } of animatedEls(view.container)) {
      expect(el.classList.contains('ft-a'), `${beats.join(' ')} is not animated`).toBe(true);
    }
  });

  it('every beat class resolves to an animation-name and a @keyframes', () => {
    const view = render(<WelcomeScreen {...props()} />);
    const sheet = css();
    for (const { beats } of animatedEls(view.container)) {
      for (const beat of beats) {
        expect(sheet, `.${beat} has no animation-name rule`)
          .toContain(`.ft-demo .${beat} { animation-name: ${beat}; }`);
        expect(sheet, `@keyframes ${beat} is missing`).toContain(`@keyframes ${beat}`);
      }
    }
  });

  it('declares no keyframes nothing uses', () => {
    const view = render(<WelcomeScreen {...props()} />);
    const used = new Set(animatedEls(view.container).flatMap((e) => e.beats));
    const declared = [...css().matchAll(/@keyframes (ft-[\w-]+)/g)].map((m) => m[1]);
    expect(declared.length).toBeGreaterThan(0);
    for (const name of declared) {
      expect(used.has(name), `@keyframes ${name} is dead`).toBe(true);
    }
  });

  // The still that a reduced-motion user gets is the *finished* picture, not
  // whatever the 0% keyframe happens to say — which for the outline is an
  // undrawn one. Only the two things that never had a resting state are held
  // back.
  it('the reduced-motion block renders the finished picture', () => {
    const sheet = css();
    const block = sheet.slice(sheet.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block).toContain('animation: none !important');
    expect(block).toContain('stroke-dashoffset: 0');
    expect(block).toContain('.ft-transient { opacity: 0 !important; }');
  });
});
