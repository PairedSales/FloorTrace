// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';
import MobileMenuSheet from '../MobileMenuSheet';

/**
 * The phone shell cannot be driven in the browser pane — at zero width the app
 * renders it, but nothing has layout to look at, and `MediaQueryList` change
 * events are suppressed there anyway (see the browser-driving notes). So the
 * thing worth pinning is the rule the two shells share: what exists in both is
 * called the same thing in both. A row that only ever appeared on the desktop
 * would be found by a user, not by anything here.
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
    theme="light"
    onToggleTheme={noop}
    onHelpOpen={noop}
    {...props}
  />,
);

afterEach(cleanup);

describe('the phone menu carries the tracer walkthrough', () => {
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
