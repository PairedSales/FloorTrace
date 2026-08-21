/**
 * Document identity — which plans exist, what order they are in, and which one
 * the store root is currently carrying.
 *
 * A *document* here is one image and everything measured from it: its own
 * calibration, traces, OCR results, undo history and camera. It is the level a
 * tab will address. Note the terminology carefully, because this repo has a
 * collision waiting: `floorManager.js` calls a polygon *within* one image a
 * "floor", and the `.floorplan` file format has a `floors[]` array that is
 * document-shaped and always holds exactly one entry. The two meanings are
 * inverted. Nothing new may use "floor" for this level.
 *
 * What lives in `documents` is **metadata only** — the small, cheap facts a tab
 * strip needs in order to draw a plan it is not currently showing. Working
 * state never comes here; it lives on the store root for the active plan.
 */
// Minted in `ids.js` alongside `newTraceId`, and re-exported here: see that
// file for why a leaf module owns both.
import { newDocumentId } from './ids';

export { newDocumentId };

/** The metadata a plan carries whether or not it is the one on screen. */
export const newDocumentMeta = (patch = {}) => ({
  // The file this plan came from, if any, so a tab can name itself before the
  // user has typed a subject line. Captured at ingest and kept here rather than
  // in working state: every projection of working state is derived by exclusion
  // from one declaration, so a field added there is enrolled in undo, autosave
  // and the `.floorplan` whether or not that makes sense. This belongs in none
  // of the three.
  sourceFileName: null,
  ...patch,
});

/**
 * How a plan names itself, in fallback order: the subject line the user typed,
 * then the file it came from with its extension dropped, then a positional
 * placeholder. Shared so the window title and any later tab strip cannot
 * disagree about what a plan is called.
 */
export const documentLabel = ({ projectName, sourceFileName, index = 0 }) => {
  const named = (projectName ?? '').trim();
  if (named) return named;
  const file = (sourceFileName ?? '').trim();
  if (file) return file.replace(/\.[^./\\]+$/, '') || file;
  return `Untitled ${index + 1}`;
};

export function createDocumentSlice(set, get) {
  const firstId = newDocumentId();

  return {
    activeDocumentId: firstId,
    documentOrder: [firstId],
    documents: { [firstId]: newDocumentMeta() },

    /** Patch the metadata of one plan. Unknown ids are ignored, not created. */
    setDocumentMeta: (docId, patch) => set((state) => {
      const existing = state.documents[docId];
      if (!existing) return {};
      return { documents: { ...state.documents, [docId]: { ...existing, ...patch } } };
    }),

    /** Patch the active plan's metadata. */
    setActiveDocumentMeta: (patch) => {
      const { activeDocumentId, setDocumentMeta } = get();
      if (activeDocumentId) setDocumentMeta(activeDocumentId, patch);
    },

    /** The active plan's metadata, never undefined. */
    activeDocumentMeta: () => {
      const state = get();
      return state.documents[state.activeDocumentId] ?? newDocumentMeta();
    },

    /**
     * What the active plan is called. Resolved through `documentLabel` so the
     * window title and a tab cannot disagree.
     */
    activeDocumentLabel: () => {
      const state = get();
      const meta = state.documents[state.activeDocumentId] ?? newDocumentMeta();
      const index = Math.max(0, state.documentOrder.indexOf(state.activeDocumentId));
      return documentLabel({
        projectName: state.projectName,
        sourceFileName: meta.sourceFileName,
        index,
      });
    },

    /**
     * Forget everything the active plan's metadata said. Paired with the
     * store's `restart()`, which clears the working state beside it — the
     * identity survives, because it is still the same tab.
     */
    resetActiveDocumentMeta: () => {
      const { activeDocumentId } = get();
      if (!activeDocumentId) return;
      set((state) => ({
        documents: { ...state.documents, [activeDocumentId]: newDocumentMeta() },
      }));
    },
  };
}
