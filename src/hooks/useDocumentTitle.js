import { useEffect } from 'react';
import useAppStore from '../store/appStore';
import { documentLabel } from '../store/documentManager';

const APP_NAME = 'FloorTrace';

/**
 * Name the browser tab after the plan that is open.
 *
 * `index.html` ships a static `<title>` and nothing in the app has ever
 * assigned one, which is fine while there is exactly one plan and no way to
 * have two windows meaningfully apart. It stops being fine as soon as a second
 * plan is possible: the window title is the only identity cue that survives
 * minimising, and it is what a taskbar, a window switcher and a second browser
 * tab of this app all read.
 *
 * The label comes from `documentLabel`, the same fallback chain a tab strip
 * will use, so the two cannot disagree about what a plan is called.
 */
export function useDocumentTitle() {
  const projectName = useAppStore((s) => s.projectName);
  const image = useAppStore((s) => s.image);
  const documents = useAppStore((s) => s.documents);
  const activeDocumentId = useAppStore((s) => s.activeDocumentId);
  const documentOrder = useAppStore((s) => s.documentOrder);

  useEffect(() => {
    // Nothing open is not an untitled plan, it is no plan — so the app names
    // itself rather than claiming to hold "Untitled 1".
    if (!image) {
      document.title = APP_NAME;
      return;
    }
    const meta = documents[activeDocumentId];
    const label = documentLabel({
      projectName,
      sourceFileName: meta?.sourceFileName,
      index: Math.max(0, documentOrder.indexOf(activeDocumentId)),
    });
    document.title = `${label} — ${APP_NAME}`;
  }, [projectName, image, documents, activeDocumentId, documentOrder]);
}
