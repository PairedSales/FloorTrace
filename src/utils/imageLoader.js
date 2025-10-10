// Load image from file input
export const loadImageFromFile = (file) => {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      reject(new Error('Invalid file type. Please select an image file.'));
      return;
    }

    const reader = new FileReader();
    
    reader.onload = (e) => {
      resolve(e.target.result);
    };
    
    reader.onerror = (error) => {
      reject(error);
    };
    
    reader.readAsDataURL(file);
  });
};

// Load image from clipboard
export const loadImageFromClipboard = async () => {
  try {
    const clipboardItems = await navigator.clipboard.read();
    
    for (const clipboardItem of clipboardItems) {
      for (const type of clipboardItem.types) {
        if (type.startsWith('image/')) {
          const blob = await clipboardItem.getType(type);
          const reader = new FileReader();
          
          return new Promise((resolve, reject) => {
            reader.onload = (e) => {
              resolve(e.target.result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
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

// Convert Image to Canvas for processing
export const imageToCanvas = (img) => {
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, 0, 0);
  return canvas;
};
