const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_DIMENSION = 4000; // px

// Below this the plan has no room for a wall. The tracer works at 1400 px and
// calls anything under 3 px of stroke untraceable, so a sheet whose long edge is
// under ~1000 px arrives with hairlines where the walls are and dimension text
// too small for OCR to resolve. The detector reaches the same verdict on its own
// (`low-resolution`), but only after the ten seconds it takes to get there —
// this is the same fact, before the wait rather than after it.
export const MIN_TRACEABLE_DIMENSION = 1000; // px

/** By type when the browser gives one, by name when it does not. */
export const isPdfFile = (file) => (
  file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name ?? '')
);

const fileOrBlobToDataUrl = (fileOrBlob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = (e) => {
      resolve(e.target.result);
    };

    reader.onerror = (error) => {
      reject(error);
    };

    reader.readAsDataURL(fileOrBlob);
  });
};

const dataUrlToImageElement = (dataUrl) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });

const validateImageSize = (fileOrBlob) => {
  if (fileOrBlob.size > MAX_FILE_SIZE_BYTES) {
    throw new Error('Image too large. Maximum size is 20 MB.');
  }
};

/**
 * The image as the app will hold it, and what is worth saying about it.
 *
 * @returns {Promise<{dataUrl: string, mimeType: string, width: number,
 *   height: number, lowResolution: boolean}>}
 */
const prepareDataUrl = async (dataUrl, mimeType = 'image/png') => {
  const image = await dataUrlToImageElement(dataUrl);

  if (
    image.width <= MAX_IMAGE_DIMENSION &&
    image.height <= MAX_IMAGE_DIMENSION
  ) {
    return {
      dataUrl,
      mimeType,
      width: image.width,
      height: image.height,
      lowResolution: Math.max(image.width, image.height) < MIN_TRACEABLE_DIMENSION,
    };
  }

  const scale = Math.min(
    MAX_IMAGE_DIMENSION / image.width,
    MAX_IMAGE_DIMENSION / image.height,
  );
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(image.width * scale);
  canvas.height = Math.round(image.height * scale);

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Failed to process image.');
  }
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  // PNG, never the source type. Re-encoding a JPEG plan as JPEG lays a second
  // generation of ringing around every wall line — this is line art, and that
  // ringing is exactly the artefact the wall detector measures. `pdfLoader`
  // renders PNG for this reason and says so; this path quietly did the
  // opposite, and only for the large images that need the trace most.
  return {
    dataUrl: canvas.toDataURL('image/png'),
    mimeType: 'image/png',
    width: canvas.width,
    height: canvas.height,
    // It was over 4000 px a moment ago.
    lowResolution: false,
  };
};

// Load image from file input
export const loadImageFromFile = async (file) => {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Invalid file type. Please select an image file.');
  }

  validateImageSize(file);
  const dataUrl = await fileOrBlobToDataUrl(file);
  return prepareDataUrl(dataUrl, file.type);
};

/**
 * A file as the page images it contains.
 *
 * One entry for an image; one per page for a PDF, which is what makes a
 * two-page plan set two plans. The PDF path is behind a dynamic import so
 * pdf.js stays out of the entry chunk, and it is handed `MAX_IMAGE_DIMENSION`
 * so a vector page is rendered at the largest size the app will keep rather
 * than at pdf.js's 72 dpi default.
 *
 * Each page carries `lowResolution`: too small for the tracer to follow, said
 * before the trace rather than ten seconds into it.
 *
 * @returns {Promise<{pages: Array<{dataUrl: string, mimeType: string, name: string,
 *   lowResolution: boolean}>, skipped: number, totalPages: number}>}
 */
export const loadPagesFromFile = async (file, options = {}) => {
  if (isPdfFile(file)) {
    // Only for a PDF. Reaching into the module to ask *whether* it is one would
    // fetch pdf.js's chunk on every image drop, for a question answerable here.
    const { pdfToPageImages } = await import('./pdfLoader');
    return pdfToPageImages(file, { ...options, maxDimension: MAX_IMAGE_DIMENSION });
  }
  const { dataUrl, mimeType, lowResolution } = await loadImageFromFile(file);
  return {
    pages: [{ dataUrl, mimeType, name: file.name, lowResolution }],
    skipped: 0,
    totalPages: 1,
  };
};

const firstImageBlob = async (clipboardItems) => {
  for (const clipboardItem of clipboardItems) {
    for (const type of clipboardItem.types) {
      if (type.startsWith('image/')) return clipboardItem.getType(type);
    }
  }
  return null;
};

/**
 * What did not make it in, said in pages the user can count.
 *
 * Built here, from both numbers, because neither side holds them both: the
 * loader knows how many pages it rendered and the caller knows how many of
 * those it had room to open. Reporting the loader's count is how "Opened the
 * first 6 pages" came to be printed over three plans.
 *
 * @returns {string|null} null when the whole document is open
 */
export const pageShortfall = ({ opened, rendered, totalPages }) => {
  if (totalPages <= 1 || opened >= totalPages) return null;
  const reason = opened < rendered
    ? 'there is no room for more plans'
    : `${rendered} pages at a time is the most this can open`;
  return `Opened ${opened} of ${totalPages} pages — ${reason}. Open the rest from the PDF separately.`;
};

/** Too small to trace, said on the way in rather than after the trace. */
export const lowResolutionNote = (count) => {
  if (!count) return null;
  return count === 1
    ? 'This image is small — at this size the walls are hairlines and the trace will miss parts of the building. Open a larger copy if you have one.'
    : `${count} of these pages are too small to trace reliably — open larger copies if you have them.`;
};

// Load image from clipboard
export const loadImageFromClipboard = async () => {
  let blob = null;
  try {
    blob = await firstImageBlob(await navigator.clipboard.read());
  } catch (error) {
    // Only the clipboard read is in here. Everything below used to be too, so
    // a 20 MB screenshot came back as "copy an image first" — advice for a
    // clipboard that in fact held exactly the right thing.
    console.error('Clipboard access error:', error);
    throw new Error('Could not read the clipboard. Allow clipboard access, or drop the file instead.');
  }

  if (!blob) throw new Error('Nothing to paste — copy an image first.');
  validateImageSize(blob);
  const dataUrl = await fileOrBlobToDataUrl(blob);
  return prepareDataUrl(dataUrl, blob.type);
};

// Convert data URL to Image object
export const dataUrlToImage = (dataUrl) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
};
