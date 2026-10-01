// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import WelcomeScreen from '../WelcomeScreen';
import { WELCOME_KEY, markWelcomed } from '../../hooks/useWelcome';

/**
 * The start screen is the whole window until a plan is open, so what it has to
 * get right is the first thirty seconds: say what the app is for, offer one
 * obvious way in, and be honest that "automatic" is not "always right".
 *
 * The introduction — the demo and the three steps — is a *first-run* thing. A
 * user who has already seen it is closing a plan to open another one, and a
 * ten-second animation standing between them and their next drawing is noise.
 *
 * The flag is read in a `useState` initialiser, so it is per-mount: the screen
 * unmounts the moment an image exists and remounts when one is closed, which
 * is exactly when it needs to be re-read.
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
  it('shows the demo and the job in three plain steps on a first run', () => {
    const view = render(<WelcomeScreen {...props()} />);

    expect(view.container.querySelector('.ft-demo')).toBeTruthy();
    expect(view.getByRole('heading', { name: 'Measure a floor plan' })).toBeTruthy();
    for (const step of ['Open a floor plan', 'FloorTrace measures it', 'Check it and save the image']) {
      expect(view.getByText(step)).toBeTruthy();
    }
    // The pipeline's own vocabulary stays off the first screen anyone sees.
    expect(view.queryByText(/feet per pixel/i)).toBeNull();
    // What is on screen, not the demo's embedded stylesheet.
    const visible = [...view.container.querySelectorAll('h1, p, li, button, text')]
      .map((el) => el.textContent).join(' ');
    expect(visible).not.toMatch(/\bpx\b/);
    // The caveat is the reason this screen exists rather than a splash: the
    // app's worst failure is a confident wrong answer, so "automatic" is never
    // offered unqualified.
    expect(view.getByText(/paint roughly over the walls/i)).toBeTruthy();
  });

  // The introduction never stands between a user and the button.
  it('puts the way in ahead of the introduction in the reading order', () => {
    const view = render(<WelcomeScreen {...props()} />);
    const choose = view.getByRole('button', { name: /choose a file/i });
    const demo = view.container.querySelector('.ft-demo');
    expect(choose.compareDocumentPosition(demo) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('drops the introduction once the flag is set, and keeps the way in and the caveat', () => {
    localStorage.setItem(WELCOME_KEY, '1');
    const view = render(<WelcomeScreen {...props()} />);

    expect(view.container.querySelector('.ft-demo')).toBeNull();
    expect(view.queryByText('FloorTrace measures it')).toBeNull();
    expect(view.getByRole('heading', { name: 'Open a floor plan' })).toBeTruthy();
    expect(view.getByText('Drop a floor plan here')).toBeTruthy();
    expect(view.getByRole('button', { name: /choose a file/i })).toBeTruthy();
    expect(view.getByText(/paint roughly over the walls/i)).toBeTruthy();
  });

  it('markWelcomed is what flips it, and survives a re-mount', () => {
    const first = render(<WelcomeScreen {...props()} />);
    expect(first.container.querySelector('.ft-demo')).toBeTruthy();
    cleanup();

    markWelcomed();

    const second = render(<WelcomeScreen {...props()} />);
    expect(second.container.querySelector('.ft-demo')).toBeNull();
  });

  // A second plan's empty tab is shown to someone who has already met the app,
  // and is the one place that says what adding a plan is for.
  it('says what adding a plan is for on a second plan’s empty tab, without the introduction', () => {
    const view = render(<WelcomeScreen {...props({ adding: true })} />);
    expect(view.getByRole('heading', { name: 'Add another plan' })).toBeTruthy();
    expect(view.getByText(/measures each plan and adds them up/)).toBeTruthy();
    expect(view.container.querySelector('.ft-demo')).toBeNull();
    // The sample would be added to the property's total.
    expect(view.queryByRole('button', { name: /try the sample plan/i })).toBeNull();
  });

  it('fires both actions', () => {
    const onFileOpen = vi.fn();
    const onTryExample = vi.fn();
    const view = render(<WelcomeScreen {...props({ onFileOpen, onTryExample })} />);

    fireEvent.click(view.getByRole('button', { name: /choose a file/i }));
    fireEvent.click(view.getByRole('button', { name: /try the sample plan/i }));

    expect(onFileOpen).toHaveBeenCalledTimes(1);
    expect(onTryExample).toHaveBeenCalledTimes(1);
  });

  // The drop itself is the app root's; the zone only says "yes, here".
  it('lights the drop zone while a file is dragged over the window', () => {
    const view = render(<WelcomeScreen {...props()} />);
    const drag = (type) => {
      const event = new Event(type, { bubbles: true });
      event.dataTransfer = { types: ['Files'] };
      act(() => { window.dispatchEvent(event); });
    };
    drag('dragenter');
    expect(view.getByText('Drop it to open it')).toBeTruthy();
    drag('drop');
    expect(view.getByText('Drop a floor plan here')).toBeTruthy();
  });

  it('offers no file button on touch — the action bar below is the route in', () => {
    const view = render(<WelcomeScreen {...props({ isTouch: true })} />);

    expect(view.queryByRole('button', { name: /choose a file/i })).toBeNull();
    expect(view.queryByText('Drop a floor plan here')).toBeNull();
    expect(view.getByRole('button', { name: /try the sample plan/i })).toBeTruthy();
    expect(view.getByText(/photograph a plan/i)).toBeTruthy();
  });

  it('hides the sample button until a handler exists', () => {
    const view = render(<WelcomeScreen {...props({ onTryExample: undefined })} />);

    expect(view.queryByRole('button', { name: /try the sample/i })).toBeNull();
    expect(view.getByRole('button', { name: /choose a file/i })).toBeTruthy();
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
