// The modifier names, once. Three files printed keybindings and two of them
// carried their own copy of this test — so a Mac saw `⌘` in the menus and
// `Ctrl` in Shortcuts & tips depending on which copy someone last touched.
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

export const MOD = isMac ? '⌘' : 'Ctrl';
export const ALT = isMac ? '⌥' : 'Alt';

// The keys that copy a piece of the screen to the clipboard, which is how most
// plans leave a PDF or a listing page: snip it, then paste it here.
export const SNIP = isMac ? '⌃⇧⌘4' : 'Win+Shift+S';
