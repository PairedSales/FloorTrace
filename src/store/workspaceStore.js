import { create } from 'zustand';

const SHOW_WORK_KEY = 'floortrace:showWork';
const UNIT_KEY = 'floortrace:unit';
const ANNOTATION_SIZE_KEY = 'floortrace:annotationSize';

// Ctrl+wheel multiplies the on-canvas labels and handles by this much per
// notch, within these bounds. Below 0.5 a vertex is too small to grab; above
// 2.5 a side-length label covers the edge it names.
export const ANNOTATION_SIZE_MIN = 0.5;
export const ANNOTATION_SIZE_MAX = 2.5;
export const ANNOTATION_SIZE_STEP = 1.1;

// Rounded so notching up and back down lands on exactly 1 again.
const clampAnnotationSize = (v) =>
  Math.round(Math.min(ANNOTATION_SIZE_MAX, Math.max(ANNOTATION_SIZE_MIN, v)) * 1000) / 1000;

// 'auto' plus the three units Settings offers. Kept here rather than imported
// from a formatter: this is the *preference's* vocabulary, and 'auto' is not a
// unit anything can format in.
export const UNIT_PREFERENCES = ['auto', 'decimal', 'inches', 'metric'];

export const UNIT_PREFERENCE_LABEL = {
  auto: 'Match the plan',
  decimal: 'Feet',
  inches: 'Feet & inches',
  metric: 'Meters',
};

const readUnitPreference = () => {
  try {
    const saved = localStorage.getItem(UNIT_KEY);
    return UNIT_PREFERENCES.includes(saved) ? saved : 'auto';
  } catch {
    return 'auto';
  }
};

const readAnnotationSize = () => {
  try {
    const saved = Number(localStorage.getItem(ANNOTATION_SIZE_KEY));
    return saved > 0 ? clampAnnotationSize(saved) : 1;
  } catch {
    return 1;
  }
};

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
 *  - `draftState` reads as global today only because there is one draft; it
 *    becomes per-plan the moment there is more than one.
 *
 * Plain `create`, not `subscribeWithSelector`: nothing subscribes to these
 * outside React, and `appStore`'s selector middleware exists for the autosave
 * subscription, which reads none of them.
 */
const useWorkspaceStore = create((set, get) => ({
  // Which help page is up — 'guide' or 'shortcuts' — or false. `true` (the
  // phone menu's toggle) reads as the guide.
  showHelpModal: false,

  // Whether the Settings dialog is up.
  showSettings: false,

  // What just happened to the plan, for the bar above it ("Area copied"), as
  // {text, tone, at}. `tone` is 'ok' or 'warn'. `at` is what makes two
  // identical messages in a row two separate flashes rather than one no-op set.
  statusFlash: null,

  // The one notice: something outside the plan went wrong — a file, a save,
  // storage — as {text, tone, action, at}, or null. One slot and no queue:
  // a second notice replaces the first (`utils/notify.js`).
  notice: null,

  // How the slower reader for room sizes is getting on — 'idle' | 'starting' |
  // 'ready' | 'failed' — for the switch that turns it on to say in its own line.
  enhancedOcrStatus: 'idle',
  // Whether the results panel is open. A panel put away is a view preference,
  // not a fact about the project, so it must never ride along in a
  // `.floorplan` or be restored by an undo.
  panelOpen: true,

  // Whether the panel's "How the area was calculated" section is open — the
  // full chain from the scale's evidence through each outline's pieces to the
  // printed total.
  //
  // Here rather than in `appStore`: it answers "does this change when I switch
  // plan?" with no. Persisted, unlike `panelOpen`, because it is an opt-in for
  // people who audit the number rather than a panel they happened to put away.
  showWork: readShowWork(),

  // Which unit the user wants to read every plan in, or 'auto' to take it from
  // whatever the scan found printed on the drawing.
  //
  // Workspace-level and persisted, unlike `appStore.unit`, which is the unit
  // one plan is *currently* displayed in. That field has to stay per-plan — it
  // rides along in a `.floorplan` and in a park — but it was the only answer
  // there was, so a scan that read a metric plan moved a user who works in feet
  // off feet, and every new plan started at the default again. This is the
  // standing answer; `unit` is the live one, and `useUnitPreference` is what
  // keeps the second following the first.
  unitPreference: readUnitPreference(),

  // How large the canvas draws its labels and vertex handles, as a multiple of
  // their normal screen size. A view preference like the theme — it never
  // reaches the exhibit or a `.floorplan` — and the same on every plan, so it
  // is here and persisted rather than per-plan.
  annotationSize: readAnnotationSize(),

  // Whether the room the scale was taken from is drawn on the plan — the green
  // box. True while the panel's Scale section is open, which is where the box
  // is explained and where its size is typed. At rest it is not drawn: it was
  // an unexplained green rectangle on someone's laundry room, and dragging it
  // — which is easy to do while trying to move the plan — re-sets the scale
  // every area is worked out from, without a word.
  scaleRoomShown: false,

  // Whether the export dialog is up. Same reason.
  showExportDialog: false,

  // Which dropdown is open, by id, or null — the header's Menu, the action
  // bar's task menus and the plan tabs' overflow alike (`components/Menu.jsx`).
  // An id rather than a flag so that opening one closes any other: they live in
  // different components, and the triggers swallow their `mousedown`, so
  // neither would otherwise hear the other open.
  //
  // `keyboardGuard` reads it as a flag: the menus close on a window
  // `mousedown` and on Escape and on nothing else, so with one open, `1`
  // started painting behind it and `O` toggled the very panel the open menu
  // was offering to toggle. State rather than listener ordering, because both
  // listeners are on `window` and both see the key.
  menuOpen: null,

  // Pending destructive confirmation, as {message, detail, confirmLabel,
  // cancelLabel, resolve}. Parked here so askConfirm() can stay a plain
  // promise-returning function callable from non-React code while a real
  // dialog does the rendering.
  confirmRequest: null,

  setShowHelpModal: (v) => set({ showHelpModal: v }),
  setShowSettings: (v) => set({ showSettings: !!v }),
  flashStatus: (text, tone = 'ok') => set({
    statusFlash: { text, tone: tone === 'warn' ? 'warn' : 'ok', at: Date.now() },
  }),
  setNotice: ({ text, tone = 'crit', action = null }) => set({
    notice: { text, tone: tone === 'warn' ? 'warn' : 'crit', action, at: Date.now() },
  }),
  dismissNotice: () => set({ notice: null }),
  setEnhancedOcrStatus: (v) => set({ enhancedOcrStatus: v }),
  setPanelOpen: (v) => set({ panelOpen: v }),
  setScaleRoomShown: (v) => set({ scaleRoomShown: !!v }),

  setShowWork: (v) => {
    const next = !!v;
    set({ showWork: next });
    try {
      localStorage.setItem(SHOW_WORK_KEY, String(next));
    } catch {
      // persistence is best-effort
    }
  },

  // Anything not in the vocabulary is ignored rather than stored: this value is
  // read back into `appStore.unit`, where an unrecognised one formats nothing.
  setUnitPreference: (v) => {
    if (!UNIT_PREFERENCES.includes(v)) return;
    set({ unitPreference: v });
    try {
      localStorage.setItem(UNIT_KEY, v);
    } catch {
      // persistence is best-effort
    }
  },

  setAnnotationSize: (v) => {
    if (!(v > 0)) return;
    const next = clampAnnotationSize(v);
    set({ annotationSize: next });
    try {
      localStorage.setItem(ANNOTATION_SIZE_KEY, String(next));
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
