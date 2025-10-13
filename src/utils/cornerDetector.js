/**
 * Corner Detection for Floor Plans
 * Detects actual wall corners and intersections for precise vertex snapping
 */

/**
 * Detects corners in a floor plan image using edge detection and corner finding
 * @param {HTMLImageElement} image - The floor plan image
 * @returns {Array<{x: number, y: number}>} Array of corner points
 */
export const detectCorners = (image) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const width = canvas.width;
  const height = canvas.height;
  
  // Convert to grayscale
  const gray = new Uint8Array(width * height);
  for (let i = 0; i < data.length; i += 4) {
    const idx = i / 4;
    gray[idx] = Math.floor(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  
  // Apply Sobel edge detection
  const sobelX = new Float32Array(width * height);
  const sobelY = new Float32Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      
      // Sobel X kernel
      const gx = 
        -gray[(y - 1) * width + (x - 1)] + gray[(y - 1) * width + (x + 1)] +
        -2 * gray[y * width + (x - 1)] + 2 * gray[y * width + (x + 1)] +
        -gray[(y + 1) * width + (x - 1)] + gray[(y + 1) * width + (x + 1)];
      
      // Sobel Y kernel
      const gy = 
        -gray[(y - 1) * width + (x - 1)] - 2 * gray[(y - 1) * width + x] - gray[(y - 1) * width + (x + 1)] +
        gray[(y + 1) * width + (x - 1)] + 2 * gray[(y + 1) * width + x] + gray[(y + 1) * width + (x + 1)];
      
      sobelX[idx] = gx;
      sobelY[idx] = gy;
    }
  }
  
  // Harris corner detection
  const cornerResponse = new Float32Array(width * height);
  const k = 0.04; // Harris corner detector free parameter
  const windowSize = 3;
  
  for (let y = windowSize; y < height - windowSize; y++) {
    for (let x = windowSize; x < width - windowSize; x++) {
      let Ixx = 0, Iyy = 0, Ixy = 0;
      
      // Sum over window
      for (let wy = -windowSize; wy <= windowSize; wy++) {
        for (let wx = -windowSize; wx <= windowSize; wx++) {
          const idx = (y + wy) * width + (x + wx);
          const ix = sobelX[idx];
          const iy = sobelY[idx];
          
          Ixx += ix * ix;
          Iyy += iy * iy;
          Ixy += ix * iy;
        }
      }
      
      // Harris corner response: det(M) - k * trace(M)^2
      const det = Ixx * Iyy - Ixy * Ixy;
      const trace = Ixx + Iyy;
      const response = det - k * trace * trace;
      
      cornerResponse[y * width + x] = response;
    }
  }
  
  // Find local maxima above threshold
  const corners = [];
  const threshold = 1000000; // Adjust based on testing
  const suppressionRadius = 10; // Non-maximum suppression radius
  
  for (let y = windowSize; y < height - windowSize; y++) {
    for (let x = windowSize; x < width - windowSize; x++) {
      const idx = y * width + x;
      const response = cornerResponse[idx];
      
      if (response < threshold) continue;
      
      // Check if local maximum
      let isLocalMax = true;
      for (let dy = -suppressionRadius; dy <= suppressionRadius && isLocalMax; dy++) {
        for (let dx = -suppressionRadius; dx <= suppressionRadius && isLocalMax; dx++) {
          if (dx === 0 && dy === 0) continue;
          const checkY = y + dy;
          const checkX = x + dx;
          if (checkX >= 0 && checkX < width && checkY >= 0 && checkY < height) {
            const checkIdx = checkY * width + checkX;
            if (cornerResponse[checkIdx] > response) {
              isLocalMax = false;
            }
          }
        }
      }
      
      if (isLocalMax) {
        corners.push({ x, y, strength: response });
      }
    }
  }
  
  // Sort by strength and take top corners
  corners.sort((a, b) => b.strength - a.strength);
  const maxCorners = 500; // Limit number of corners
  const topCorners = corners.slice(0, maxCorners);
  
  console.log(`Detected ${topCorners.length} corners`);
  
  // Return just x,y coordinates
  return topCorners.map(c => ({ x: c.x, y: c.y }));
};
