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

// A hole is a bare ring or a tagged ring `{ id, ring, source }`. Every consumer
// of a trace's holes goes through here so the two shapes never diverge
// downstream — and so a v1 `.floorplan` written before the tag keeps loading.
// Index-preserving on purpose: callers zip the result back against `holes`.
export const holeRings = (holes) =>
  (holes ?? []).map((h) => (Array.isArray(h) ? h : h?.ring));

// Stable identity for a hole, so selection and removal agree about which ring
// is which even for the untagged rings an old project file carries.
export const holeKey = (hole, index) =>
  (!Array.isArray(hole) && hole?.id) ? hole.id : `ring-${index}`;

// Replacing a trace's holes replaces what the detector found. A void the user
// punched is their assertion about the building and outlives a re-trace — the
// interior/exterior wall toggle reaches both merge sites in one click and does
// not look destructive. Lives here beside the other hole helpers rather than in
// appStore, which floorManager cannot import from without making a cycle.
export const mergeHoles = (existing, incoming) =>
  [...(existing ?? []).filter((h) => h?.source === 'user'), ...(incoming ?? [])];

// Calculate area of a polygon using the shoelace formula.
// feetPerPixel: real-world feet represented by one image pixel { x, y }
// holes: enclosed voids (courtyards, light wells) subtracted from the outline
export const calculateArea = (vertices, feetPerPixel, holes = null) => {
  if (!vertices || vertices.length < 3) {
    return 0;
  }

  let area = Math.abs(signedArea(vertices));
  for (const ring of holeRings(holes)) {
    if (ring?.length >= 3) area -= Math.abs(signedArea(ring));
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

