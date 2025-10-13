/**
 * testUtils.js
 * Utility functions for testing
 */

/**
 * Load an image from a path
 * @param {string} imagePath - Path to image file
 * @returns {Promise<HTMLImageElement>} Loaded image
 */
export async function loadImage(imagePath) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error(`Failed to load image: ${err}`));
    
    // For testing, we'll use the path directly
    img.src = imagePath;
  });
}

/**
 * Load the example floorplan image for testing
 * @returns {Promise<HTMLImageElement>} Loaded example floorplan
 */
export async function loadExampleFloorplan() {
  // In a browser environment, this would be the relative path
  // In Node.js/Vitest with jsdom, we need to handle this differently
  const imagePath = '/ExampleFloorplan.png';
  
  // For Node.js testing, create a mock image
  if (typeof window === 'undefined' || !window.Image) {
    return createMockImage(1024, 768);
  }
  
  try {
    return await loadImage(imagePath);
  } catch {
    console.warn('Could not load example floorplan, using mock image');
    return createMockImage(1024, 768);
  }
}

/**
 * Create a mock image for testing in non-browser environments
 * @param {number} width - Image width
 * @param {number} height - Image height
 * @returns {Object} Mock image object
 */
export function createMockImage(width = 1024, height = 768) {
  return {
    width,
    height,
    naturalWidth: width,
    naturalHeight: height,
    src: 'mock://image',
    complete: true,
    onload: null,
    onerror: null
  };
}

/**
 * Create a canvas from an image (for testing)
 * @param {HTMLImageElement} image - Image element
 * @returns {HTMLCanvasElement} Canvas with image drawn
 */
export function imageToCanvas(image) {
  if (typeof document === 'undefined') {
    // Mock canvas for Node.js
    return createMockCanvas(image.width, image.height);
  }
  
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth || image.width;
  canvas.height = image.naturalHeight || image.height;
  
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  
  return canvas;
}

/**
 * Create a mock canvas for testing
 * @param {number} width - Canvas width
 * @param {number} height - Canvas height
 * @returns {Object} Mock canvas object
 */
export function createMockCanvas(width = 1024, height = 768) {
  const imageData = new Uint8ClampedArray(width * height * 4);
  
  // Fill with white
  for (let i = 0; i < imageData.length; i += 4) {
    imageData[i] = 255;     // R
    imageData[i + 1] = 255; // G
    imageData[i + 2] = 255; // B
    imageData[i + 3] = 255; // A
  }
  
  return {
    width,
    height,
    getContext: () => ({
      drawImage: () => {},
      getImageData: () => ({ data: imageData, width, height }),
      putImageData: () => {},
      fillRect: () => {},
      clearRect: () => {},
      strokeRect: () => {}
    }),
    toDataURL: () => 'data:image/png;base64,mock'
  };
}

/**
 * Create mock segments for testing
 * @param {string} type - Type of test pattern ('grid', 'simple', 'complex')
 * @returns {Array} Array of test segments
 */
export function createMockSegments(type = 'simple') {
  switch (type) {
    case 'simple':
      return [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 100, y1: 0, x2: 100, y2: 100, id: 'seg_1', length: 100, angle: Math.PI/2 },
        { x1: 100, y1: 100, x2: 0, y2: 100, id: 'seg_2', length: 100, angle: Math.PI },
        { x1: 0, y1: 100, x2: 0, y2: 0, id: 'seg_3', length: 100, angle: -Math.PI/2 }
      ];
    
    case 'collinear': {
      return [
        { x1: 0, y1: 0, x2: 50, y2: 0, id: 'seg_0', length: 50, angle: 0 },
        { x1: 50, y1: 0, x2: 100, y2: 0, id: 'seg_1', length: 50, angle: 0 },
        { x1: 100, y1: 0, x2: 150, y2: 0, id: 'seg_2', length: 50, angle: 0 }
      ];
    }
    
    case 'parallel': {
      return [
        { x1: 0, y1: 0, x2: 100, y2: 0, id: 'seg_0', length: 100, angle: 0 },
        { x1: 0, y1: 10, x2: 100, y2: 10, id: 'seg_1', length: 100, angle: 0 },
        { x1: 0, y1: 20, x2: 100, y2: 20, id: 'seg_2', length: 100, angle: 0 }
      ];
    }
    
    case 'grid': {
      const segments = [];
      let id = 0;
      
      // Horizontal lines
      for (let y = 0; y <= 300; y += 100) {
        segments.push({
          x1: 0, y1: y, x2: 300, y2: y,
          id: `seg_${id++}`,
          length: 300,
          angle: 0
        });
      }
      
      // Vertical lines
      for (let x = 0; x <= 300; x += 100) {
        segments.push({
          x1: x, y1: 0, x2: x, y2: 300,
          id: `seg_${id++}`,
          length: 300,
          angle: Math.PI/2
        });
      }
      
      return segments;
    }
    
    case 'complex': {
      return [
        // Outer rectangle
        { x1: 0, y1: 0, x2: 200, y2: 0, id: 'seg_0', length: 200, angle: 0 },
        { x1: 200, y1: 0, x2: 200, y2: 150, id: 'seg_1', length: 150, angle: Math.PI/2 },
        { x1: 200, y1: 150, x2: 0, y2: 150, id: 'seg_2', length: 200, angle: Math.PI },
        { x1: 0, y1: 150, x2: 0, y2: 0, id: 'seg_3', length: 150, angle: -Math.PI/2 },
        
        // Internal wall
        { x1: 100, y1: 0, x2: 100, y2: 150, id: 'seg_4', length: 150, angle: Math.PI/2 },
        
        // Diagonal
        { x1: 0, y1: 0, x2: 100, y2: 75, id: 'seg_5', length: 125, angle: Math.atan2(75, 100) }
      ];
    }
    
    default:
      return [];
  }
}

/**
 * Validate that a topology analysis result is well-formed
 * @param {Object} result - Analysis result
 * @returns {Object} Validation result with { valid, errors }
 */
export function validateTopologyResult(result) {
  const errors = [];
  
  if (!result) {
    errors.push('Result is null or undefined');
    return { valid: false, errors };
  }
  
  if (!result.segments || !Array.isArray(result.segments)) {
    errors.push('Segments missing or not an array');
  }
  
  if (!result.graph) {
    errors.push('Graph missing');
  } else {
    if (!result.graph.nodes || !Array.isArray(result.graph.nodes)) {
      errors.push('Graph nodes missing or not an array');
    }
    if (!result.graph.edges || !Array.isArray(result.graph.edges)) {
      errors.push('Graph edges missing or not an array');
    }
    if (!result.graph.adjacency) {
      errors.push('Graph adjacency missing');
    }
  }
  
  if (!result.chains || !Array.isArray(result.chains)) {
    errors.push('Chains missing or not an array');
  }
  
  if (!result.walls || !Array.isArray(result.walls)) {
    errors.push('Walls missing or not an array');
  }
  
  if (!result.statistics) {
    errors.push('Statistics missing');
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

/**
 * Assert that segments are properly formed
 * @param {Array} segments - Segments to validate
 * @throws {Error} If segments are invalid
 */
export function assertValidSegments(segments) {
  if (!Array.isArray(segments)) {
    throw new Error('Segments must be an array');
  }
  
  segments.forEach((seg, idx) => {
    if (typeof seg.x1 !== 'number' || typeof seg.y1 !== 'number' ||
        typeof seg.x2 !== 'number' || typeof seg.y2 !== 'number') {
      throw new Error(`Segment ${idx} has invalid coordinates`);
    }
    
    if (seg.length !== undefined && seg.length < 0) {
      throw new Error(`Segment ${idx} has negative length`);
    }
  });
}

/**
 * Assert that graph is properly formed
 * @param {Object} graph - Graph to validate
 * @throws {Error} If graph is invalid
 */
export function assertValidGraph(graph) {
  if (!graph) {
    throw new Error('Graph is null or undefined');
  }
  
  if (!Array.isArray(graph.nodes)) {
    throw new Error('Graph nodes must be an array');
  }
  
  if (!Array.isArray(graph.edges)) {
    throw new Error('Graph edges must be an array');
  }
  
  if (!(graph.adjacency instanceof Map)) {
    throw new Error('Graph adjacency must be a Map');
  }
  
  // Validate nodes
  graph.nodes.forEach((node, idx) => {
    if (typeof node.id !== 'number') {
      throw new Error(`Node ${idx} has invalid id`);
    }
    if (typeof node.x !== 'number' || typeof node.y !== 'number') {
      throw new Error(`Node ${idx} has invalid coordinates`);
    }
  });
  
  // Validate edges
  graph.edges.forEach((edge, idx) => {
    if (typeof edge.startNode !== 'number' || typeof edge.endNode !== 'number') {
      throw new Error(`Edge ${idx} has invalid node references`);
    }
  });
}

/**
 * Assert that walls are properly formed
 * @param {Array} walls - Walls to validate
 * @throws {Error} If walls are invalid
 */
export function assertValidWalls(walls) {
  if (!Array.isArray(walls)) {
    throw new Error('Walls must be an array');
  }
  
  walls.forEach((wall, idx) => {
    if (!wall.id) {
      throw new Error(`Wall ${idx} has no id`);
    }
    
    if (!wall.chain) {
      throw new Error(`Wall ${idx} has no chain`);
    }
    
    if (typeof wall.length !== 'number' || wall.length <= 0) {
      throw new Error(`Wall ${idx} has invalid length`);
    }
    
    if (!wall.orientation) {
      throw new Error(`Wall ${idx} has no orientation`);
    }
    
    if (typeof wall.confidence !== 'number' || wall.confidence < 0 || wall.confidence > 1) {
      throw new Error(`Wall ${idx} has invalid confidence`);
    }
  });
}
