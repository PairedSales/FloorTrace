const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_DIMENSION = 4000; // px

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

const maybeDownscaleDataUrl = async (dataUrl, mimeType = 'image/png') => {
  const image = await dataUrlToImageElement(dataUrl);

  if (
    image.width <= MAX_IMAGE_DIMENSION &&
    image.height <= MAX_IMAGE_DIMENSION
  ) {
    return dataUrl;
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

  return canvas.toDataURL(mimeType);
};

// Load image from file input
export const loadImageFromFile = async (file) => {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Invalid file type. Please select an image file.');
  }

  validateImageSize(file);
  const dataUrl = await fileOrBlobToDataUrl(file);
  return {
    dataUrl: await maybeDownscaleDataUrl(dataUrl, file.type),
    mimeType: file.type,
  };
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
 * @returns {Promise<{pages: Array<{dataUrl: string, mimeType: string, name: string}>, skipped: number}>}
 */
export const loadPagesFromFile = async (file, options = {}) => {
  if (isPdfFile(file)) {
    // Only for a PDF. Reaching into the module to ask *whether* it is one would
    // fetch pdf.js's chunk on every image drop, for a question answerable here.
    const { pdfToPageImages } = await import('./pdfLoader');
    return pdfToPageImages(file, { ...options, maxDimension: MAX_IMAGE_DIMENSION });
  }
  const { dataUrl, mimeType } = await loadImageFromFile(file);
  return { pages: [{ dataUrl, mimeType, name: file.name }], skipped: 0 };
};

// Load image from clipboard
export const loadImageFromClipboard = async () => {
  try {
    const clipboardItems = await navigator.clipboard.read();

    for (const clipboardItem of clipboardItems) {
      for (const type of clipboardItem.types) {
        if (type.startsWith('image/')) {
          const blob = await clipboardItem.getType(type);
          validateImageSize(blob);

          const dataUrl = await fileOrBlobToDataUrl(blob);
          return {
            dataUrl: await maybeDownscaleDataUrl(dataUrl, blob.type),
            mimeType: blob.type,
          };
        }
      }
    }

    throw new Error('No image found in clipboard');
  } catch (error) {
    console.error('Clipboard access error:', error);
    throw new Error('Failed to access clipboard. Make sure you have an image copied.');
  }
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
