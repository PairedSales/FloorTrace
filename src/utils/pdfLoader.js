// Turning a PDF into the images the rest of the app already knows how to read.
//
// A floorplan arrives as a PDF more often than as anything else — a CubiCasa or
// iGuide deliverable, an MLS attachment, the plan page of a prior report — and
// until now the answer was "export it to PNG yourself first". It is also the
// best input this app can get: a vector page has no resolution of its own, so
// it can be rendered at whatever density the pipeline wants rather than at
// whatever density someone's screenshot happened to have.
//
// pdf.js is ~35 MB installed and is reached only from here, behind a dynamic
// import, so it never enters the entry's static module graph.

// A PDF is read into an ArrayBuffer whole, and a multi-page architectural set
// is genuinely large. Higher than the image cap because the pages are rendered
// one at a time and the buffer is released with the document.
const MAX_PDF_BYTES = 60 * 1024 * 1024;

let pdfjsPromise = null;

/**
 * The library and its worker, loaded once.
 *
 * The worker is self-hosted through Vite's `?url`, the same way Tesseract's is:
 * a CDN at runtime would make an offline-capable app that is not.
 */
const getPdfjs = () => {
  pdfjsPromise = pdfjsPromise ?? (async () => {
    const [lib, worker] = await Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]);
    lib.GlobalWorkerOptions.workerSrc = worker.default;
    return lib;
  })();
  return pdfjsPromise;
};

/**
 * Render one page at the largest size the app will keep.
 *
 * `scale: 1` is 72 dpi — a Letter page comes out 612x792, which is unreadable to
 * OCR and useless to the tracer. The scale is chosen so the long edge lands on
 * `maxDimension` instead, which for a Letter page is about 364 dpi. That is the
 * whole reason to take the PDF rather than a screenshot of it, and getting it
 * wrong would throw the advantage away silently: the trace would simply be
 * worse, with nothing on screen to say why.
 *
 * Pages larger than the ceiling scale *down* to it, which is right — 4000 px is
 * what the rest of the pipeline is willing to hold either way.
 */
async function renderPage(page, maxDimension) {
  const unscaled = page.getViewport({ scale: 1 });
  const scale = maxDimension / Math.max(unscaled.width, unscaled.height);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not render the PDF — no canvas context.');

  // A PDF page has no background of its own. Left transparent, `toDataURL`
  // gives black-on-transparent, and Otsu binarization then reads the whole
  // sheet as ink — every trace fails on a page that looks fine on screen.
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({ canvasContext: context, viewport }).promise;

  // PNG, not JPEG: this is line art, and JPEG's ringing around a thin black
  // line on white is exactly the artefact the wall detector measures.
  const dataUrl = canvas.toDataURL('image/png');
  // Let the bitmap go before the next page allocates its own; six 4000 px
  // pages held at once is a few hundred megabytes for no reason.
  canvas.width = 0;
  canvas.height = 0;
  return { dataUrl, width: viewport.width, height: viewport.height };
}

/**
 * Every page of a PDF, as images, in order.
 *
 * @param {File|Blob} file
 * @param {{maxDimension: number, maxPages?: number, onProgress?: (page: number, total: number) => void}} options
 * @returns {Promise<{pages: Array<{dataUrl: string, mimeType: string, name: string}>, skipped: number}>}
 */
export async function pdfToPageImages(file, { maxDimension, maxPages = Infinity, onProgress } = {}) {
  if (file.size > MAX_PDF_BYTES) {
    throw new Error(`PDF too large. Maximum size is ${Math.round(MAX_PDF_BYTES / 1024 / 1024)} MB.`);
  }

  const pdfjs = await getPdfjs();
  const buffer = await file.arrayBuffer();

  // The loading task, kept: `destroy` lives on it, not on the document it
  // resolves to. Calling `doc.destroy()` throws `TypeError` from inside a
  // `finally`, which replaces a set of perfectly good rendered pages with an
  // error about teardown.
  const task = pdfjs.getDocument({ data: new Uint8Array(buffer) });
  let doc;
  try {
    doc = await task.promise;
  } catch (error) {
    // A password-protected or corrupt file is a normal thing to be handed, and
    // pdf.js's own message ("No password given") is not one to show a user.
    if (error?.name === 'PasswordException') {
      throw new Error('That PDF is password protected.');
    }
    throw new Error('That PDF could not be read.');
  }

  try {
    const total = Math.min(doc.numPages, maxPages);
    const baseName = (file.name ?? 'Plan').replace(/\.pdf$/i, '');
    const pages = [];

    for (let n = 1; n <= total; n += 1) {
      onProgress?.(n, total);
      const page = await doc.getPage(n);
      try {
        const { dataUrl } = await renderPage(page, maxDimension);
        pages.push({
          dataUrl,
          mimeType: 'image/png',
          // One plan per page, so each needs a name a tab can show.
          name: doc.numPages > 1 ? `${baseName} p${n}.png` : `${baseName}.png`,
        });
      } finally {
        page.cleanup();
      }
    }

    return { pages, skipped: Math.max(0, doc.numPages - total) };
  } finally {
    await task.destroy();
  }
}
