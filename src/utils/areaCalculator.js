// Signed shoelace: area, centroid and winding all derive from this one
// primitive. Taking the absolute value per-lobe hides self-intersection, where
// the lobes cancel and the area silently under-reports.
export const signedArea = (vertices) => {
  if (!vertices || vertices.length < 3) return 0;
  let sum = 0;
  const n = vertices.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    sum += vertices[i].x * vertices[j].y - vertices[j].x * vertices[i].y;
  }
  return sum / 2;
};

// Calculate area of a polygon using the shoelace formula.
// feetPerPixel: real-world feet represented by one image pixel { x, y }
// holes: enclosed voids (courtyards, light wells) subtracted from the outline
export const calculateArea = (vertices, feetPerPixel, holes = null) => {
  if (!vertices || vertices.length < 3) {
    return 0;
  }

  let area = Math.abs(signedArea(vertices));
  for (const hole of holes ?? []) {
    if (hole?.length >= 3) area -= Math.abs(signedArea(hole));
  }
  area = Math.max(0, area);

  // Convert from pixels to square feet using non-uniform X and Y scale factors
  const scaleX = typeof feetPerPixel === 'number' ? feetPerPixel : (feetPerPixel?.x ?? 1.0);
  const scaleY = typeof feetPerPixel === 'number' ? feetPerPixel : (feetPerPixel?.y ?? 1.0);
  const areaInSquareFeet = area * scaleX * scaleY;

  return areaInSquareFeet;
};

// Calculate perimeter length
// feetPerPixel: real-world feet represented by one image pixel { x, y }
export const calculatePerimeter = (vertices, feetPerPixel) => {
  if (!vertices || vertices.length < 2) {
    return 0;
  }
  
  const scaleX = typeof feetPerPixel === 'number' ? feetPerPixel : (feetPerPixel?.x ?? 1.0);
  const scaleY = typeof feetPerPixel === 'number' ? feetPerPixel : (feetPerPixel?.y ?? 1.0);
  
  let perimeter = 0;
  const n = vertices.length;
  
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = (vertices[j].x - vertices[i].x) * scaleX;
    const dy = (vertices[j].y - vertices[i].y) * scaleY;
    perimeter += Math.sqrt(dx * dx + dy * dy);
  }
  
  return perimeter;
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

