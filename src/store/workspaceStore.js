import { create } from 'zustand';

const SHOW_WORK_KEY = 'floortrace:showWork';

// Off unless a previous session turned it on. Read once at module load rather
// than per render, matching `useTheme` and `useEnhancedOcr`; a blocked or full
// localStorage costs the user their preference and nothing else.
const readShowWork = () => {
  try {
    return localStorage.getItem(SHOW_WORK_KEY) === 'true';
  } catch {
    return false;
  }
};

/**
 * State that belongs to the *application window*, not to any one plan.
 *
 * `appStore` holds the working state of a floorplan — its image, calibration,
 * traces, tools and camera. These five fields were sitting alongside it while
 * describing something else entirely: which panel is open, which modal is up,
 * what the status line is flashing. The distinction is about to become
 * load-bearing rather than tidy — with several plans open at once, the store
 * root carries one plan at a time, and anything left there that is really about
 * the window would be saved, restored and swapped along with it.
 *
 * The rule for what lives here: if the answer to "does this change when I
 * switch to another plan?" is no, it belongs in this file.
 *
 * Deliberately NOT moved:
 *  - `focusedWarning` and `errorAnchor` are per-plan — they name a trace and a
 *    place on one drawing.
 *  - `draftState` reads as global today only because there is one draft; it
 *    becomes per-plan the moment there is more than one.
 *
 * Plain `create`, not `subscribeWithSelector`: nothing subscribes to these
 * outside React, and `appStore`'s selector middleware exists for the autosave
 * subscription, which reads none of them.
 */
const useWorkspaceStore = create((set, get) => ({
  showHelpModal: false,

  // Transient confirmation for the status bar ("Area copied"), as {text, at}.
  // `at` is what makes two identical messages in a row two separate flashes
  // rather than one no-op set.
  statusFlash: null,

  // Whether the measurement dock is open. A collapsed panel is a view
  // preference, not a fact about the project, so it must never ride along in a
  // `.floorplan` or be restored by an undo.
  dockOpen: true,

  // The tool the pointer or keyboard focus is resting on, as
  // {name, detail, digit}, or null. The rail is icon-only, so this is how a
  // tool says what it is: the status bar prints it while the pointer is on the
  // button. Unlike `statusFlash` it has a real end — mouseleave/blur — so it is
  // a plain set/clear pair with no timer, and it lives here rather than in
  // React state because App re-renders the whole shell and a hover must not.
  toolHint: null,

  // Whether the Area card's derivation is expanded — the full chain from the
  // scale's evidence through each outline's pixels to the printed total.
  //
  // Here rather than in `appStore`: it answers "does this change when I switch
  // plan?" with no. Persisted, unlike `dockOpen`, because it is an opt-in for
  // people who audit the number rather than a panel they happened to collapse.
  showWork: readShowWork(),

  // Whether the export dialog is up. Same reason.
  showExportDialog: false,

  // Whether a dropdown in the top band is open — any of them, titles and the
  // stage-verb carets alike. `keyboardGuard` reads it: the menus close on a
  // window `mousedown` and on Escape and on nothing else, so with one open,
  // `1` entered draw mode behind it and `O` toggled the very panel the open
  // View menu was offering to toggle. State rather than listener ordering,
  // because both listeners are on `window` and both see the key.
  menuOpen: false,

  // Pending destructive confirmation, as {message, detail, confirmLabel,
  // cancelLabel, resolve}. Parked here so confirmToast() can stay a plain
  // promise-returning function callable from non-React code while a real
  // dialog does the rendering.
  confirmRequest: null,

  setShowHelpModal: (v) => set({ showHelpModal: v }),
  flashStatus: (text) => set({ statusFlash: { text, at: Date.now() } }),
  setToolHint: (hint) => set({ toolHint: hint ?? null }),

  // Clearing is by owner, never unconditional. A rail button can vanish under
  // the pointer — clicking "Clear tools" is what removes the Clear tools
  // button — and an unmount that fired a blind clear would also wipe the hint
  // whichever button the pointer landed on next had already set.
  clearToolHint: (id) => set((s) => (s.toolHint?.id === id ? { toolHint: null } : {})),
  setDockOpen: (v) => set({ dockOpen: v }),

  setShowWork: (v) => {
    const next = !!v;
    set({ showWork: next });
    try {
      localStorage.setItem(SHOW_WORK_KEY, String(next));
    } catch {
      // persistence is best-effort
    }
  },

  setShowExportDialog: (v) => set({ showExportDialog: v }),
  setMenuOpen: (v) => set({ menuOpen: v }),

  requestConfirm: (req) => {
    // A second request while one is open would strand the first promise, so the
    // incumbent is answered `false` — the safe default — before it is replaced.
    //
    // This is why a "close every plan" flow has to await each confirmation in
    // turn: a loop that issues them together would answer all but the last
    // `false` while showing one dialog.
    const pending = get().confirmRequest;
    if (pending) pending.resolve(false);
    set({ confirmRequest: req });
  },

  resolveConfirm: (value) => {
    const pending = get().confirmRequest;
    if (!pending) return;
    set({ confirmRequest: null });
    pending.resolve(value);
  },
}));

export default useWorkspaceStore;
