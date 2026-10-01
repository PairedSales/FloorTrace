// The plan a first-run user opens when they have none of their own. Shipped
// under `public/`, so it is served at the Vite `base` — a bare `/example-plan.png`
// resolves to the domain root and 404s on GitHub Pages, where the app lives at
// `/FloorTrace/`.
const EXAMPLE_PLAN_URL = `${import.meta.env.BASE_URL.replace(/\/?$/, '/')}example-plan.png`;

const blobToDataUrl = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (e) => resolve(e.target.result);
  reader.onerror = () => reject(new Error('Could not read the example plan.'));
  reader.readAsDataURL(blob);
});

/**
 * The bundled example floorplan, in the shape the image loaders hand back.
 *
 * The drawing is `fixtures/ExampleFloorplan.png`: two levels and a garage, so
 * the first plan a newcomer sees shows two outlines, a garage left out of the
 * living area and a scale taken from several rooms — more of what the app does
 * than the single small storey it used to be.
 *
 * Not run through `prepareDataUrl`: that is the size check and the downscale
 * for a file the user chose, and this is one we shipped and know the size of.
 *
 * @returns {Promise<{dataUrl: string, mimeType: string}>}
 */
export const loadExamplePlan = async () => {
  let response;
  try {
    response = await fetch(EXAMPLE_PLAN_URL);
  } catch {
    throw new Error('Could not load the example plan — check your connection and try again.');
  }
  // Every failure below hands back a plan of your own as the way forward: this
  // is the first-run screen, and a message a user cannot act on leaves them
  // exactly where they started.
  if (!response.ok) {
    throw new Error(`Could not load the example plan (${response.status}) — open a plan of your own instead.`);
  }

  const blob = await response.blob();
  // A 200 carrying something that is not an image is a proxy or a captive
  // portal answering for us. Unguarded it becomes a data URL of HTML handed to
  // the canvas, which shows nothing and then fails the scan for a reason that
  // names neither. An empty `type` stays allowed — plenty of servers send none.
  if (blob.type && !blob.type.startsWith('image/')) {
    throw new Error('Could not load the example plan — open a plan of your own instead.');
  }

  return {
    dataUrl: await blobToDataUrl(blob),
    mimeType: blob.type || 'image/png',
  };
};
