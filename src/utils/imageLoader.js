const MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024; // 20 MB
const MAX_IMAGE_DIMENSION = 4000; // px

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
  return maybeDownscaleDataUrl(dataUrl, file.type);
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
          return maybeDownscaleDataUrl(dataUrl, blob.type);
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
