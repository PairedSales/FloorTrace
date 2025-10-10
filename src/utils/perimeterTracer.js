import { dataUrlToImage, imageToCanvas } from './imageLoader';

// Trace the perimeter of the floor plan
export const tracePerimeter = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    const ctx = canvas.getContext('2d');
    
    // Apply edge detection
    const edges = detectEdges(ctx, canvas.width, canvas.height);
    
    // Find the outer perimeter
    const perimeter = findPerimeter(edges, canvas.width, canvas.height);
    
    // Simplify the perimeter to vertices (Douglas-Peucker algorithm)
    const vertices = simplifyPath(perimeter, 5);
    
    // Ensure vertices are axis-aligned (snap to grid)
    const alignedVertices = alignToAxis(vertices, 10);
    
    return {
      vertices: alignedVertices,
      original: perimeter
    };
  } catch (error) {
    console.error('Error tracing perimeter:', error);
    return null;
  }
};

// Simple edge detection using brightness threshold
const detectEdges = (ctx, width, height) => {
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;
  const edges = new Uint8Array(width * height);
  
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      
      // Get brightness of current pixel
      const brightness = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
      
      // Check neighboring pixels for contrast
      let maxDiff = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          
          const nIdx = ((y + dy) * width + (x + dx)) * 4;
          const nBrightness = (data[nIdx] + data[nIdx + 1] + data[nIdx + 2]) / 3;
          const diff = Math.abs(brightness - nBrightness);
          maxDiff = Math.max(maxDiff, diff);
        }
      }
      
      // Mark as edge if contrast is high
      if (maxDiff > 50) {
        edges[y * width + x] = 1;
      }
    }
  }
  
  return edges;
};

// Find the outer perimeter of the floor plan
const findPerimeter = (edges, width, height) => {
  // Find the leftmost edge point to start
  let startPoint = null;
  for (let x = 0; x < width && !startPoint; x++) {
    for (let y = 0; y < height; y++) {
      if (edges[y * width + x] === 1) {
        startPoint = { x, y };
        break;
      }
    }
  }
  
  if (!startPoint) {
    // No edges found, return rectangle around image
    return [
      { x: 50, y: 50 },
      { x: width - 50, y: 50 },
      { x: width - 50, y: height - 50 },
      { x: 50, y: height - 50 }
    ];
  }
  
  // Trace the perimeter using a simple contour following algorithm
  const perimeter = [];
  const visited = new Set();
  let current = startPoint;
  const directions = [
    { dx: 0, dy: -1 }, // up
    { dx: 1, dy: -1 }, // up-right
    { dx: 1, dy: 0 },  // right
    { dx: 1, dy: 1 },  // down-right
    { dx: 0, dy: 1 },  // down
    { dx: -1, dy: 1 }, // down-left
    { dx: -1, dy: 0 }, // left
    { dx: -1, dy: -1 } // up-left
  ];
  
  let direction = 2; // Start going right
  const maxSteps = 10000;
  let steps = 0;
  
  while (steps < maxSteps) {
    const key = `${current.x},${current.y}`;
    if (visited.has(key) && perimeter.length > 10) {
      break; // We've completed the loop
    }
    
    visited.add(key);
    perimeter.push({ ...current });
    
    // Look for next edge point
    let found = false;
    for (let i = 0; i < 8; i++) {
      const testDir = (direction + i) % 8;
      const next = {
        x: current.x + directions[testDir].dx,
        y: current.y + directions[testDir].dy
      };
      
      if (next.x >= 0 && next.x < width && 
          next.y >= 0 && next.y < height &&
          edges[next.y * width + next.x] === 1) {
        current = next;
        direction = testDir;
        found = true;
        break;
      }
    }
    
    if (!found) {
      // Dead end, try to jump to nearest unvisited edge
      let minDist = Infinity;
      let nearest = null;
      
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (edges[y * width + x] === 1 && !visited.has(`${x},${y}`)) {
            const dist = Math.sqrt((x - current.x) ** 2 + (y - current.y) ** 2);
            if (dist < minDist && dist < 50) {
              minDist = dist;
              nearest = { x, y };
            }
          }
        }
      }
      
      if (nearest) {
        current = nearest;
      } else {
        break;
      }
    }
    
    steps++;
  }
  
  return perimeter;
};

// Simplify path using Douglas-Peucker algorithm
const simplifyPath = (points, tolerance = 5) => {
  if (points.length <= 2) return points;
  
  // Find the point with maximum distance from the line between start and end
  let maxDist = 0;
  let maxIndex = 0;
  const start = points[0];
  const end = points[points.length - 1];
  
  for (let i = 1; i < points.length - 1; i++) {
    const dist = pointToLineDistance(points[i], start, end);
    if (dist > maxDist) {
      maxDist = dist;
      maxIndex = i;
    }
  }
  
  // If max distance is greater than tolerance, recursively simplify
  if (maxDist > tolerance) {
    const left = simplifyPath(points.slice(0, maxIndex + 1), tolerance);
    const right = simplifyPath(points.slice(maxIndex), tolerance);
    return left.slice(0, -1).concat(right);
  } else {
    return [start, end];
  }
};

// Calculate distance from point to line
const pointToLineDistance = (point, lineStart, lineEnd) => {
  const dx = lineEnd.x - lineStart.x;
  const dy = lineEnd.y - lineStart.y;
  
  if (dx === 0 && dy === 0) {
    return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2);
  }
  
  const t = Math.max(0, Math.min(1, 
    ((point.x - lineStart.x) * dx + (point.y - lineStart.y) * dy) / (dx * dx + dy * dy)
  ));
  
  const projection = {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy
  };
  
  return Math.sqrt((point.x - projection.x) ** 2 + (point.y - projection.y) ** 2);
};

// Align vertices to axis (snap to grid)
const alignToAxis = (vertices, gridSize = 10) => {
  return vertices.map(v => ({
    x: Math.round(v.x / gridSize) * gridSize,
    y: Math.round(v.y / gridSize) * gridSize
  }));
};

// Manual perimeter creation
export const createManualPerimeter = (width, height) => {
  // Create a default rectangular perimeter
  const margin = 50;
  return {
    vertices: [
      { x: margin, y: margin },
      { x: width - margin, y: margin },
      { x: width - margin, y: height - margin },
      { x: margin, y: height - margin }
    ]
  };
};
