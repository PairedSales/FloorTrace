// Shared setup for the hook tests.
//
// The store-level suites (`src/store/__tests__/`) already cover park/adopt and
// the projections. What they cannot reach is the logic that lives inside a
// hook's effects — a debounced write that has to name the right plan, a
// subscription that has to fire on close — and that is precisely where the
// multi-plan defects were. These run the real hook against the real store, with
// only the persistence layer replaced, so a test failure means the decision was
// wrong rather than that a mock drifted.
//
// Files that use this need `// @vitest-environment happy-dom` at the top. The
// default environment stays node deliberately: the detection suites are
// CPU-bound pure-JS pipelines that gain nothing from a DOM and would pay for it.

import useAppStore from '../../store/appStore';
import {
  clearParked, newDocumentId, newDocumentMeta,
} from '../../store/documentManager';
import { resetRequests } from '../../store/documentRequests';
import * as undoManager from '../../store/undoManager';

export const app = () => useAppStore.getState();

export const IMAGE_A = 'data:image/png;base64,PLAN-A';
export const IMAGE_B = 'data:image/png;base64,PLAN-B';

/** Put the store back to exactly one, empty, active plan. */
export const oneDocument = () => {
  clearParked();
  resetRequests();
  undoManager.clear();
  app().restart();
  const id = newDocumentId();
  useAppStore.setState({
    documents: { [id]: newDocumentMeta() },
    documentOrder: [id],
    activeDocumentId: id,
    _swappingDocument: false,
  });
  return id;
};

/** A second plan, parked, so a switch has somewhere to go. */
export const addParkedDocument = (state = {}) => {
  const id = newDocumentId();
  useAppStore.setState((s) => ({
    documents: { ...s.documents, [id]: newDocumentMeta({ hasWork: true }) },
    documentOrder: [...s.documentOrder, id],
  }));
  app().parkRestoredDocument(id, {
    state: { ...app().getParkedState(), ...state },
    history: null,
  });
  return id;
};

/**
 * A plan the workspace knows about but has never hydrated — a tab drawn from
 * the index after a reload, whose state is still only on disk. `adoptWorkspace`
 * opens with `clearParked()`, so this is what every background plan looks like
 * until the first switch to it, and it is the case Save all got wrong.
 */
export const addUnhydratedDocument = () => {
  const id = newDocumentId();
  useAppStore.setState((s) => ({
    documents: {
      ...s.documents,
      [id]: newDocumentMeta({ hasWork: true, hydrated: false, title: 'On disk only' }),
    },
    documentOrder: [...s.documentOrder, id],
  }));
  return id;
};
