// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, within, act } from '@testing-library/react';
import { Menu, MenuItem, MenuSep } from '../Menu';
import useWorkspaceStore from '../../store/workspaceStore';
import { shortcutsBlocked } from '../../utils/keyboardGuard';

/**
 * Every dropdown in the app is this component, so its contracts are the app's:
 * one open at a time across components, the keyboard told while one is open,
 * and a press outside closing it without the trigger or the panel closing it
 * on themselves.
 */
const TwoMenus = ({ onPick = () => {} }) => (
  <div>
    <Menu id="a" group="bar" label="Outline">
      <MenuItem label="Paint over the walls" description="Paint roughly over the outside walls" keys="1"
        onSelect={() => onPick('paint')} />
      <MenuSep />
      <MenuItem label="Cut out an open area" description="Draw an outline first." disabled
        onSelect={() => onPick('void')} />
    </Menu>
    <Menu id="b" group="bar" label="Measure">
      <MenuItem label="Measure a distance" onSelect={() => onPick('line')} />
    </Menu>
    <button type="button">Plain</button>
  </div>
);

const trigger = (view, name) => view.getByRole('button', { name });

beforeEach(() => useWorkspaceStore.setState({ menuOpen: null }));
afterEach(cleanup);

describe('Menu', () => {
  it('opens on its trigger and says so to assistive tech', () => {
    const view = render(<TwoMenus />);
    expect(view.queryByRole('menu')).toBeNull();
    fireEvent.click(trigger(view, 'Outline'));
    expect(view.getByRole('menu')).toBeTruthy();
    expect(trigger(view, 'Outline').getAttribute('aria-expanded')).toBe('true');
  });

  it('opens one at a time, across menus', () => {
    const view = render(<TwoMenus />);
    fireEvent.click(trigger(view, 'Outline'));
    fireEvent.click(trigger(view, 'Measure'));
    expect(view.getAllByRole('menu')).toHaveLength(1);
    expect(trigger(view, 'Outline').getAttribute('aria-expanded')).toBe('false');
  });

  it('closes when a menu elsewhere in the window opens', () => {
    const view = render(<TwoMenus />);
    fireEvent.click(trigger(view, 'Outline'));
    act(() => useWorkspaceStore.getState().setMenuOpen('main'));
    expect(view.queryByRole('menu')).toBeNull();
  });

  // `shortcutsBlocked` reads the store. Without it `1` started painting behind
  // an open menu — which prints the very key it was swallowing.
  it('tells the keyboard guard while it is open, and gives the keyboard back', () => {
    const view = render(<TwoMenus />);
    expect(shortcutsBlocked(document.body)).toBe(false);
    fireEvent.click(trigger(view, 'Outline'));
    expect(shortcutsBlocked(document.body)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(view.queryByRole('menu')).toBeNull();
    expect(shortcutsBlocked(document.body)).toBe(false);
  });

  it('stays open when its own trigger or panel is pressed, and closes on a press outside', () => {
    const view = render(<TwoMenus />);
    const outline = trigger(view, 'Outline');
    fireEvent.mouseDown(outline);
    fireEvent.click(outline);
    fireEvent.mouseDown(view.getByRole('menu'));
    expect(view.getByRole('menu')).toBeTruthy();
    fireEvent.mouseDown(window);
    expect(view.queryByRole('menu')).toBeNull();
  });

  // `useKeyboardShortcuts` reads mouse buttons 3/4 (undo/redo) off window
  // `mousedown`. A swallow scoped to a wrapper killed that for whatever plain
  // button the pointer happened to be over.
  it('lets a plain button beside it send its mousedown to the window', () => {
    const view = render(<TwoMenus />);
    const spy = vi.fn();
    window.addEventListener('mousedown', spy);
    fireEvent.mouseDown(trigger(view, 'Plain'));
    window.removeEventListener('mousedown', spy);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('switches to a neighbour on hover only once one of the row is open', () => {
    const view = render(<TwoMenus />);
    fireEvent.mouseEnter(trigger(view, 'Measure'));
    expect(view.queryByRole('menu')).toBeNull();

    fireEvent.click(trigger(view, 'Outline'));
    fireEvent.mouseEnter(trigger(view, 'Measure'));
    expect(within(view.getByRole('menu')).getByText('Measure a distance')).toBeTruthy();
  });

  it('picks a row, closes, and gives the slot back', () => {
    const onPick = vi.fn();
    const view = render(<TwoMenus onPick={onPick} />);
    fireEvent.click(trigger(view, 'Outline'));
    fireEvent.click(within(view.getByRole('menu')).getByText('Paint over the walls'));
    expect(onPick).toHaveBeenCalledWith('paint');
    expect(view.queryByRole('menu')).toBeNull();
    expect(useWorkspaceStore.getState().menuOpen).toBeNull();
  });

  // `aria-disabled`, not `disabled`: the row has to stay reachable to say why
  // it cannot be used.
  it('keeps a row that cannot be used in place, with its reason, and ignores a click on it', () => {
    const onPick = vi.fn();
    const view = render(<TwoMenus onPick={onPick} />);
    fireEvent.click(trigger(view, 'Outline'));
    const row = within(view.getByRole('menu')).getByText('Cut out an open area').closest('[role="menuitem"]');
    expect(row.getAttribute('aria-disabled')).toBe('true');
    expect(within(row).getByText('Draw an outline first.')).toBeTruthy();
    fireEvent.click(row);
    expect(onPick).not.toHaveBeenCalled();
    expect(view.getByRole('menu')).toBeTruthy();
  });

  it('moves through its rows with the arrow keys, skipping what cannot be used', () => {
    const view = render(
      <Menu id="keys" label="Outline">
        <MenuItem label="One" />
        <MenuItem label="Two" disabled />
        <MenuItem label="Three" />
      </Menu>,
    );
    fireEvent.click(trigger(view, 'Outline'));
    const menu = view.getByRole('menu');
    const rows = within(menu).getAllByRole('menuitem');
    rows[0].focus();
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[2]);
    fireEvent.keyDown(menu, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(rows[0]);
  });

  it('gives the slot back when it unmounts with its menu open', () => {
    const view = render(<TwoMenus />);
    fireEvent.click(trigger(view, 'Outline'));
    expect(useWorkspaceStore.getState().menuOpen).toBeTruthy();
    view.unmount();
    expect(useWorkspaceStore.getState().menuOpen).toBeFalsy();
  });
});
