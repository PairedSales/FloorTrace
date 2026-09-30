// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import SettingsDialog from '../SettingsDialog';
import useWorkspaceStore from '../../store/workspaceStore';
import { shortcutsBlocked } from '../../utils/keyboardGuard';

/**
 * The workspace's preferences, each with a sentence. The cases are the ones
 * where a setting could land in the wrong place: a unit that should be pinned
 * and is not, a theme that cycles instead of being chosen, and a dialog that
 * lets the keyboard reach the plan behind it.
 */
const props = (over = {}) => ({
  onClose: () => {},
  onUnitChange: () => {},
  theme: 'system',
  onThemeChange: () => {},
  saveOnExit: true,
  onSaveOnExitChange: () => {},
  enhancedOcr: false,
  onEnhancedOcrChange: () => {},
  ...over,
});

beforeEach(() => useWorkspaceStore.setState({ unitPreference: 'auto', showSettings: false }));
afterEach(cleanup);

describe('SettingsDialog', () => {
  it('pins a unit through the same path as the panel, and hands "same as the plan" back', () => {
    const onUnitChange = vi.fn();
    const view = render(<SettingsDialog {...props({ onUnitChange })} />);
    expect(view.getByLabelText(/Same as the plan/).checked).toBe(true);

    fireEvent.click(view.getByLabelText(/Feet and inches/));
    expect(onUnitChange).toHaveBeenCalledWith('inches');

    act(() => useWorkspaceStore.setState({ unitPreference: 'inches' }));
    expect(view.getByLabelText(/Feet and inches/).checked).toBe(true);
    fireEvent.click(view.getByLabelText(/Same as the plan/));
    expect(useWorkspaceStore.getState().unitPreference).toBe('auto');
  });

  it('chooses a theme rather than cycling one', () => {
    const onThemeChange = vi.fn();
    const view = render(<SettingsDialog {...props({ onThemeChange })} />);
    fireEvent.click(view.getByLabelText('Dark'));
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('says what the slow reader costs before it is switched on', () => {
    const onEnhancedOcrChange = vi.fn();
    const view = render(<SettingsDialog {...props({ onEnhancedOcrChange })} />);
    expect(view.getByText(/pause the app for about 10 seconds/)).toBeTruthy();
    fireEvent.click(view.getByLabelText(/Try harder to read room sizes/));
    expect(onEnhancedOcrChange).toHaveBeenCalledWith(true);
  });

  it('turns autosave off from its own checkbox', () => {
    const onSaveOnExitChange = vi.fn();
    const view = render(<SettingsDialog {...props({ onSaveOnExitChange })} />);
    fireEvent.click(view.getByLabelText(/Keep my work in this browser/));
    expect(onSaveOnExitChange).toHaveBeenCalledWith(false);
  });

  it('closes on Escape and Done, and keeps shortcuts off the plan while open', () => {
    const onClose = vi.fn();
    const view = render(<SettingsDialog {...props({ onClose })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(view.getByText('Done'));
    expect(onClose).toHaveBeenCalledTimes(2);

    useWorkspaceStore.setState({ showSettings: true });
    expect(shortcutsBlocked(document.body)).toBe(true);
  });
});
