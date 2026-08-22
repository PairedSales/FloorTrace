// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import ToolRail from '../ToolRail';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * The rail is icon-only, so `toolHint` is the only thing that says what a
 * button is. Every case here is a way that channel gets *stuck* — a hint has no
 * timeout, so anything that ends a hover without a `mouseleave` leaves the
 * status bar describing something the user is no longer pointing at, and
 * nothing on screen looks broken while it does.
 *
 * The first component test in the repo. Rendering `ToolRail` is cheap for the
 * same reason it is worth testing: it imports the tool catalog and the
 * workspace store, and nothing else.
 */
const hint = () => useWorkspaceStore.getState().toolHint;

const railProps = {
  activeTool: 'select',
  hasArea: false,
  hasToolData: false,
  onSelect: () => {},
  onRotate: () => {},
  onClearTools: () => {},
};

const button = (view, label) => view.getByRole('button', { name: label });

beforeEach(() => useWorkspaceStore.setState({ toolHint: null }));
afterEach(cleanup);

describe('ToolRail hover hints', () => {
  it('names the tool the pointer is on, and gives it back on leave', () => {
    const view = render(<ToolRail {...railProps} />);
    const paint = button(view, 'Paint the outline');

    fireEvent.mouseEnter(paint);
    expect(hint()).toMatchObject({ id: 'draw', name: 'Paint outline', digit: '1' });
    expect(hint().detail).toMatch(/exterior walls/);

    fireEvent.mouseLeave(paint);
    expect(hint()).toBeNull();
  });

  it('gives a disabled tool its reason rather than its description', () => {
    const view = render(<ToolRail {...railProps} />);
    fireEvent.mouseEnter(button(view, 'Draw an area'));
    expect(hint().detail).toMatch(/needs a traced outline/);
  });

  // The button is `aria-disabled`, not `disabled`, precisely so the hover above
  // fires at all — a `disabled` button dispatches no pointer events in Chrome.
  it('does not act on a click while it is disabled', () => {
    let picked = null;
    const view = render(<ToolRail {...railProps} onSelect={(id) => { picked = id; }} />);
    fireEvent.click(button(view, 'Draw an area'));
    expect(picked).toBeNull();

    fireEvent.click(button(view, 'Paint the outline'));
    expect(picked).toBe('draw');
  });

  it('re-states the hint when the reason changes under the pointer', () => {
    const view = render(<ToolRail {...railProps} />);
    fireEvent.mouseEnter(button(view, 'Draw an area'));
    expect(hint().detail).toMatch(/needs a traced outline/);

    // An outline lands while the pointer has not moved.
    view.rerender(<ToolRail {...railProps} hasArea />);
    expect(hint().detail).toMatch(/patio, deck/);
  });

  it('gives up the hint when the hovered button unmounts', () => {
    const view = render(<ToolRail {...railProps} hasToolData />);
    fireEvent.mouseEnter(button(view, 'Clear all measurements and shapes'));
    expect(hint()).toMatchObject({ id: 'clear', name: 'Clear tools' });

    // Clearing is what removes the button, so this hover can never end in a
    // mouseleave.
    view.rerender(<ToolRail {...railProps} hasToolData={false} />);
    expect(hint()).toBeNull();
  });

  it('does not clear a hint another button has already taken', () => {
    const view = render(<ToolRail {...railProps} hasToolData />);
    fireEvent.mouseEnter(button(view, 'Clear all measurements and shapes'));
    fireEvent.mouseEnter(button(view, 'Crop the plan'));
    expect(hint()).toMatchObject({ id: 'crop' });

    // The clear button's unmount cleanup runs after the crop button set its
    // own hint; a blind clear here would blank a hint that is still true.
    view.rerender(<ToolRail {...railProps} hasToolData={false} />);
    expect(hint()).toMatchObject({ id: 'crop' });
  });

  it('leaves nothing behind when the rail itself goes', () => {
    const view = render(<ToolRail {...railProps} />);
    fireEvent.mouseEnter(button(view, 'Erase clutter'));
    expect(hint()).not.toBeNull();

    view.unmount();
    expect(hint()).toBeNull();
  });
});
