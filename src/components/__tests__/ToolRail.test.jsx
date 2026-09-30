// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, within, act } from '@testing-library/react';
import ToolRail from '../ToolRail';
import { TOOL_GROUPS } from '../toolCatalog';
import useWorkspaceStore from '../../store/workspaceStore';

/**
 * Two things are worth defending here.
 *
 * **The rail says what its buttons are.** Every visible tool carries its name
 * on the page, and the rare tools live behind More rather than being dropped —
 * each one is still reachable, and a running one still shows on the rail.
 *
 * **The hover hint never gets stuck.** `toolHint` has no timeout, so anything
 * that ends a hover without a `mouseleave` leaves the status bar describing
 * something the user is no longer pointing at, and nothing on screen looks
 * broken while it does.
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
const openMore = (view) => {
  fireEvent.click(view.getByRole('button', { name: /^More tools/ }));
  return view.getByRole('menu');
};

beforeEach(() => useWorkspaceStore.setState({ toolHint: null, menuOpen: null }));
afterEach(cleanup);

describe('ToolRail says what each tool is', () => {
  it('labels every tool on the rail, on the page rather than in a tooltip', () => {
    const view = render(<ToolRail {...railProps} />);
    const main = TOOL_GROUPS.filter((g) => !g.overflow).flatMap((g) => g.tools);
    for (const tool of main) {
      expect(within(button(view, tool.label)).getByText(tool.short)).toBeTruthy();
    }
  });

  it('keeps the rare tools behind More, and every one of them reachable', () => {
    const picked = [];
    const turned = [];
    const view = render(
      <ToolRail {...railProps} hasArea onSelect={(id) => picked.push(id)} onRotate={(d) => turned.push(d)} />,
    );
    const overflow = TOOL_GROUPS.find((g) => g.overflow).tools;
    for (const tool of overflow) {
      expect(view.queryByRole('button', { name: tool.label })).toBeNull();
    }

    fireEvent.click(within(openMore(view)).getByText('Measure an angle'));
    expect(picked).toEqual(['angle']);
    // Picking closes the menu and gives the keyboard back.
    expect(view.queryByRole('menu')).toBeNull();
    expect(useWorkspaceStore.getState().menuOpen).toBeNull();

    // Rotation is two explicit directions, where it used to be a right-click.
    fireEvent.click(within(openMore(view)).getByText('Rotate left'));
    fireEvent.click(within(openMore(view)).getByText('Rotate right'));
    expect(turned).toEqual(['counterclockwise', 'clockwise']);
  });

  it('shows a running tool from the overflow on the More button', () => {
    const view = render(<ToolRail {...railProps} hasArea activeTool="angle" />);
    const more = view.getByRole('button', { name: /^More tools/ });
    expect(within(more).getByText('Angle')).toBeTruthy();
    expect(more.getAttribute('aria-label')).toMatch(/Measure an angle is on/);
  });

  it('gives a disabled overflow tool its reason, and ignores a click on it', () => {
    const picked = [];
    const view = render(<ToolRail {...railProps} onSelect={(id) => picked.push(id)} />);
    const menu = openMore(view);
    expect(within(menu).getByText('Measuring an angle needs an outline first.')).toBeTruthy();
    fireEvent.click(within(menu).getByText('Measure an angle'));
    expect(picked).toEqual([]);
  });

  it('closes the overflow when another menu opens', () => {
    const view = render(<ToolRail {...railProps} />);
    openMore(view);
    // The top band's File menu, opening elsewhere in the window.
    act(() => useWorkspaceStore.getState().setMenuOpen('top:file'));
    expect(view.queryByRole('menu')).toBeNull();
  });
});

describe('ToolRail hover hints', () => {
  it('names the tool the pointer is on, and gives it back on leave', () => {
    const view = render(<ToolRail {...railProps} />);
    const paint = button(view, 'Paint the outline');

    fireEvent.mouseEnter(paint);
    expect(hint()).toMatchObject({ id: 'draw', name: 'Paint the outline', digit: '1' });
    expect(hint().detail).toMatch(/outside walls/);

    fireEvent.mouseLeave(paint);
    expect(hint()).toBeNull();
  });

  it('gives a disabled tool its reason rather than its description', () => {
    const view = render(<ToolRail {...railProps} />);
    fireEvent.mouseEnter(button(view, 'Measure an area'));
    expect(hint().detail).toMatch(/needs an outline first/);
  });

  // The button is `aria-disabled`, not `disabled`, precisely so the hover above
  // fires at all — a `disabled` button dispatches no pointer events in Chrome.
  it('does not act on a click while it is disabled', () => {
    let picked = null;
    const view = render(<ToolRail {...railProps} onSelect={(id) => { picked = id; }} />);
    fireEvent.click(button(view, 'Measure an area'));
    expect(picked).toBeNull();

    fireEvent.click(button(view, 'Paint the outline'));
    expect(picked).toBe('draw');
  });

  it('re-states the hint when the reason changes under the pointer', () => {
    const view = render(<ToolRail {...railProps} />);
    fireEvent.mouseEnter(button(view, 'Measure an area'));
    expect(hint().detail).toMatch(/needs an outline first/);

    // An outline lands while the pointer has not moved.
    view.rerender(<ToolRail {...railProps} hasArea />);
    expect(hint().detail).toMatch(/deck, a patio/);
  });

  it('gives up the hint when the hovered button unmounts', () => {
    const view = render(<ToolRail {...railProps} hasToolData />);
    fireEvent.mouseEnter(button(view, 'Clear all measurements and shapes'));
    expect(hint()).toMatchObject({ id: 'clear', name: 'Clear' });

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
    fireEvent.mouseEnter(button(view, 'Erase marks on the plan'));
    expect(hint()).not.toBeNull();

    view.unmount();
    expect(hint()).toBeNull();
  });
});
