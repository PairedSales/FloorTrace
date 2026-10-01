// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import Dialog from '../Dialog';

/**
 * The frame every dialog in the app wears. What it promises is behaviour, and
 * each promise was broken by at least one of the four hand-built overlays it
 * replaced: a key that closed the dialog and the tool behind it, a Tab that
 * walked out into the plan, a focus that went nowhere and never came back.
 */
afterEach(cleanup);

const frame = (props = {}) => render(
  <Dialog title="Settings" onClose={() => {}} {...props}>
    <button type="button">First</button>
    <button type="button">Last</button>
  </Dialog>,
);

describe('Dialog', () => {
  it('is a named modal dialog', () => {
    const view = frame({ subtitle: 'How FloorTrace behaves.' });
    const dialog = view.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-labelledby')).textContent).toBe('Settings');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')).textContent)
      .toBe('How FloorTrace behaves.');
  });

  // Capture and stopped: the same press must not also cancel the tool running
  // behind the dialog, whose listener is on the same window.
  it('closes on Escape, and keeps the press from the plan behind it', () => {
    const onClose = vi.fn();
    const behind = vi.fn();
    window.addEventListener('keydown', behind);
    frame({ onClose });
    fireEvent.keyDown(document.body, { key: 'Escape' });
    window.removeEventListener('keydown', behind);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(behind).not.toHaveBeenCalled();
  });

  it('closes on a press on the backdrop, not on a press inside', () => {
    const onClose = vi.fn();
    const view = frame({ onClose });
    fireEvent.mouseDown(view.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(view.getByRole('dialog').parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps Tab inside', () => {
    const view = frame();
    const close = view.getByRole('button', { name: 'Close' });
    const last = view.getByRole('button', { name: 'Last' });
    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('takes the focus when it opens, and gives it back when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();

    const view = frame();
    expect(view.getByRole('dialog').contains(document.activeElement)).toBe(true);
    view.unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  it('leaves the focus with a child that asked for it', () => {
    const view = render(
      <Dialog title="Save image" onClose={() => {}}>
        <input aria-label="Title" autoFocus />
      </Dialog>,
    );
    expect(document.activeElement).toBe(view.getByLabelText('Title'));
  });

  // A question is answered with one of its buttons.
  it('has no close button when it is asking a question', () => {
    const view = render(
      <Dialog title="Close this plan?" role="alertdialog" hideClose onClose={() => {}}
        footer={<button type="button">Cancel</button>} />,
    );
    expect(view.getByRole('alertdialog')).toBeTruthy();
    expect(view.queryByRole('button', { name: 'Close' })).toBeNull();
  });
});
