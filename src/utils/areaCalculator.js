// Calculate area of a polygon using the shoelace formula
export const calculateArea = (vertices, scale) => {
  if (!vertices || vertices.length < 3) {
    return 0;
  }
  
  // Calculate area in pixels using shoelace formula
  let area = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += vertices[i].x * vertices[j].y;
    area -= vertices[j].x * vertices[i].y;
  }
  
  area = Math.abs(area) / 2;
  
  // Convert from pixels to square feet using scale
  const areaInSquareFeet = area * scale * scale;
  
  return areaInSquareFeet;
};

// Calculate perimeter length
export const calculatePerimeter = (vertices, scale) => {
  if (!vertices || vertices.length < 2) {
    return 0;
  }
  
  let perimeter = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = vertices[j].x - vertices[i].x;
    const dy = vertices[j].y - vertices[i].y;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  // Convert from pixels to feet using scale
  return perimeter * scale;
};

// Calculate bounding box of vertices
export const getBoundingBox = (vertices) => {
  if (!vertices || vertices.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  
  let minX = vertices[0].x;
  let minY = vertices[0].y;
  let maxX = vertices[0].x;
  let maxY = vertices[0].y;
  
  for (const vertex of vertices) {
    minX = Math.min(minX, vertex.x);
    minY = Math.min(minY, vertex.y);
    maxX = Math.max(maxX, vertex.x);
    maxY = Math.max(maxY, vertex.y);
  }
  
  return { minX, minY, maxX, maxY };
};

// Check if a point is inside a polygon
export const isPointInPolygon = (point, vertices) => {
  if (!vertices || vertices.length < 3) {
    return false;
  }
  
  let inside = false;
  const n = vertices.length;
  
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = vertices[i].x;
    const yi = vertices[i].y;
    const xj = vertices[j].x;
    const yj = vertices[j].y;
    
    const intersect = ((yi > point.y) !== (yj > point.y)) &&
                     (point.x < (xj - xi) * (point.y - yi) / (yj - yi) + xi);
    
    if (intersect) {
      inside = !inside;
    }
  }
  
  return inside;
};

// Get centroid of polygon
export const getCentroid = (vertices) => {
  if (!vertices || vertices.length === 0) {
    return { x: 0, y: 0 };
  }
  
  let area = 0;
  let cx = 0;
  let cy = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const a = vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
    area += a;
    cx += (vertices[i].x + vertices[j].x) * a;
    cy += (vertices[i].y + vertices[j].y) * a;
  }
  
  area *= 0.5;
  
  if (Math.abs(area) < 0.0001) {
    // Degenerate polygon, return average of vertices
    const sumX = vertices.reduce((sum, v) => sum + v.x, 0);
    const sumY = vertices.reduce((sum, v) => sum + v.y, 0);
    return { x: sumX / n, y: sumY / n };
  }
  
  cx /= (6 * area);
  cy /= (6 * area);
  
  return { x: cx, y: cy };
};

