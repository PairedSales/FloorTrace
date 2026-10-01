import { useCallback, useEffect } from 'react';
import useWorkspaceStore from '../store/workspaceStore';

/**
 * The open/close plumbing for one dropdown, by id.
 *
 * The id lives in `workspaceStore.menuOpen`, so opening any menu closes
 * whichever other one was open — they live in different components and would
 * not otherwise hear each other — and so `keyboardGuard` can keep shortcuts
 * from firing behind an open menu. `components/Menu.jsx` is the component that
 * wears this; it is its own module so that file stays a component-only export.
 *
 * A menu closes on a window `mousedown` and on Escape. Whatever renders the
 * trigger and the panel must stop `mousedown` on both, or the press that opens
 * the menu also closes it and the press that picks an item never lands.
 */
export function useMenu(id) {
  const open = useWorkspaceStore((s) => s.menuOpen === id);
  const setMenuOpen = useWorkspaceStore((s) => s.setMenuOpen);

  const close = useCallback(() => {
    if (useWorkspaceStore.getState().menuOpen === id) setMenuOpen(null);
  }, [id, setMenuOpen]);
  const show = useCallback(() => setMenuOpen(id), [id, setMenuOpen]);
  const toggle = useCallback(() => {
    setMenuOpen(useWorkspaceStore.getState().menuOpen === id ? null : id);
  }, [id, setMenuOpen]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Gives the slot back if the trigger goes while its menu is open; left
  // taken, shortcuts stay blocked behind a menu that no longer exists.
  useEffect(() => close, [close]);

  return { open, close, show, toggle };
}
