// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import MobileMenuSheet from '../MobileMenuSheet';

/**
 * The phone shell cannot be driven in the browser pane — at zero width the app
 * renders it, but nothing has layout to look at, and `MediaQueryList` change
 * events are suppressed there anyway (see the browser-driving notes). So the
 * one thing worth pinning is the rule the two shells share: every View item
 * exists in both, with the same words. A row that only ever appeared on the
 * desktop would be found by a user, not by anything here.
 */
const noop = () => {};

const sheet = (props = {}) => render(
  <MobileMenuSheet
    open
    onClose={noop}
    image="data:image/png;base64,AAA"
    hasArea={false}
    onFileOpen={noop}
    onTakePhoto={noop}
    onExport={noop}
    onCopyExhibit={noop}
    onSaveProject={noop}
    onCloseActivePlan={noop}
    onFindRoomSize={noop}
    onTracePerimeter={noop}
    onDrawExterior={noop}
    onOutlineByVertex={noop}
    onAddFloor={noop}
    canAddOutline
    onFitToWindow={noop}
    showSideLengths={false}
    onShowSideLengthsChange={noop}
    autoSnapEnabled
    onAutoSnapChange={noop}
    onUnitChange={noop}
    saveOnExit
    onSaveOnExitChange={noop}
    enhancedOcr={false}
    onEnhancedOcrChange={noop}
    theme="system"
    onCycleTheme={noop}
    onHelpOpen={noop}
    {...props}
  />,
);

afterEach(cleanup);

describe('the phone menu carries the desktop View items', () => {
  it('offers the tracer walkthrough, and says where it goes', () => {
    sheet();
    const row = screen.getByText('How the outline is traced');
    expect(row).toBeTruthy();
    expect(screen.getByText('A walkthrough of the tracer, in a new tab')).toBeTruthy();
  });

  it('opens the page the build writes, in a new tab', () => {
    sheet();
    const calls = [];
    const real = window.open;
    window.open = (...args) => { calls.push(args); return null; };
    try {
      fireEvent.click(screen.getByText('How the outline is traced').closest('button'));
    } finally {
      window.open = real;
    }
    expect(calls).toHaveLength(1);
    expect(calls[0][0].endsWith('/tracing-tutorial.html')).toBe(true);
    expect(calls[0][1]).toBe('_blank');
    expect(calls[0][2]).toContain('noopener');
  });

  it('closes the sheet behind it — a new tab over an open sheet is a trap', () => {
    let closed = 0;
    sheet({ onClose: () => { closed += 1; } });
    const real = window.open;
    window.open = () => null;
    try {
      fireEvent.click(screen.getByText('How the outline is traced').closest('button'));
    } finally {
      window.open = real;
    }
    expect(closed).toBe(1);
  });
});
