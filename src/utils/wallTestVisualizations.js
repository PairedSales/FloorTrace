/**
 * Wall Detection Test Visualizations
 * 
 * Creates detailed visualizations for each step of the wall detection pipeline.
 * Each visualization is designed to help debug and understand the algorithm's behavior.
 */

/**
 * Create a blank canvas
 */
const createCanvas = (width, height, fillColor = 'white') => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = fillColor;
  ctx.fillRect(0, 0, width, height);
  return { canvas, ctx };
};

/**
 * Visualize grayscale image
 */
export const visualizeGrayscale = (grayscale, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < grayscale.length; i++) {
    const value = grayscale[i];
    const offset = i * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

/**
 * Visualize binary image
 */
export const visualizeBinary = (binary, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < binary.length; i++) {
    const value = binary[i] === 1 ? 0 : 255; // Invert for visibility (black = walls)
    const offset = i * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

/**
 * Visualize likelihood map as heatmap
 */
export const visualizeLikelihoodHeatmap = (likelihood, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  const imageData = ctx.createImageData(width, height);
  
  for (let i = 0; i < likelihood.length; i++) {
    const value = likelihood[i];
    const offset = i * 4;
    
    // Create heat map: blue (low) -> green -> yellow -> red (high)
    let r, g, b;
    if (value < 0.25) {
      // Blue to cyan
      const t = value / 0.25;
      r = 0;
      g = Math.round(t * 255);
      b = 255;
    } else if (value < 0.5) {
      // Cyan to green
      const t = (value - 0.25) / 0.25;
      r = 0;
      g = 255;
      b = Math.round((1 - t) * 255);
    } else if (value < 0.75) {
      // Green to yellow
      const t = (value - 0.5) / 0.25;
      r = Math.round(t * 255);
      g = 255;
      b = 0;
    } else {
      // Yellow to red
      const t = (value - 0.75) / 0.25;
      r = 255;
      g = Math.round((1 - t) * 255);
      b = 0;
    }
    
    imageData.data[offset] = r;
    imageData.data[offset + 1] = g;
    imageData.data[offset + 2] = b;
    imageData.data[offset + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

/**
 * Visualize edge detection results
 */
export const visualizeEdges = (magnitude, width, height) => {
  const { canvas, ctx } = createCanvas(width, height, 'black');
  const imageData = ctx.createImageData(width, height);
  
  // Normalize magnitude
  const maxMag = Math.max(...Array.from(magnitude));
  
  for (let i = 0; i < magnitude.length; i++) {
    const value = Math.round((magnitude[i] / maxMag) * 255);
    const offset = i * 4;
    imageData.data[offset] = value;
    imageData.data[offset + 1] = value;
    imageData.data[offset + 2] = value;
    imageData.data[offset + 3] = 255;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL();
};

/**
 * Visualize line segments on white background
 */
export const visualizeLineSegments = (segments, width, height, color = 'rgba(255, 0, 0, 0.8)') => {
  const { canvas, ctx } = createCanvas(width, height);
  
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  
  for (const segment of segments) {
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
  }
  
  return canvas.toDataURL();
};

/**
 * Visualize line segments with orientation colors
 */
export const visualizeSegmentsByOrientation = (segments, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  
  ctx.lineWidth = 3;
  
  for (const segment of segments) {
    const orientation = segment.getOrientation();
    
    if (orientation === 'horizontal') {
      ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)'; // Red
    } else if (orientation === 'vertical') {
      ctx.strokeStyle = 'rgba(0, 0, 255, 0.7)'; // Blue
    } else {
      ctx.strokeStyle = 'rgba(128, 128, 128, 0.5)'; // Gray for diagonals
    }
    
    ctx.beginPath();
    ctx.moveTo(segment.x1, segment.y1);
    ctx.lineTo(segment.x2, segment.y2);
    ctx.stroke();
  }
  
  // Add legend
  ctx.font = 'bold 14px Arial';
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  
  const legendX = 10;
  const legendY = height - 60;
  
  // Horizontal
  ctx.strokeText('— Horizontal', legendX, legendY);
  ctx.fillStyle = 'red';
  ctx.fillText('— Horizontal', legendX, legendY);
  
  // Vertical
  ctx.fillStyle = 'white';
  ctx.strokeText('— Vertical', legendX, legendY + 20);
  ctx.fillStyle = 'blue';
  ctx.fillText('— Vertical', legendX, legendY + 20);
  
  // Diagonal
  ctx.fillStyle = 'white';
  ctx.strokeText('— Diagonal', legendX, legendY + 40);
  ctx.fillStyle = 'gray';
  ctx.fillText('— Diagonal', legendX, legendY + 40);
  
  return canvas.toDataURL();
};

/**
 * Visualize exterior vs interior walls
 */
export const visualizeExteriorInterior = (exterior, interior, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  
  // Draw interior walls (purple)
  ctx.strokeStyle = 'rgba(128, 0, 128, 0.6)';
  ctx.lineWidth = 3;
  for (const wall of interior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillStyle = 'rgba(128, 0, 128, 0.3)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Draw exterior walls (green)
  ctx.strokeStyle = 'rgba(0, 200, 0, 0.8)';
  ctx.lineWidth = 4;
  for (const wall of exterior) {
    const { x1, y1, x2, y2 } = wall.boundingBox;
    ctx.fillStyle = 'rgba(0, 200, 0, 0.3)';
    ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
    ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
  }
  
  // Add legend
  ctx.font = 'bold 14px Arial';
  ctx.lineWidth = 3;
  
  const legendX = 10;
  const legendY = 30;
  
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.strokeText(`■ Exterior (${exterior.length})`, legendX, legendY);
  ctx.fillStyle = 'rgba(0, 200, 0, 1)';
  ctx.fillText(`■ Exterior (${exterior.length})`, legendX, legendY);
  
  ctx.fillStyle = 'white';
  ctx.strokeText(`■ Interior (${interior.length})`, legendX, legendY + 25);
  ctx.fillStyle = 'rgba(128, 0, 128, 1)';
  ctx.fillText(`■ Interior (${interior.length})`, legendX, legendY + 25);
  
  return canvas.toDataURL();
};

/**
 * Visualize perimeter
 */
export const visualizePerimeter = (perimeter, width, height) => {
  const { canvas, ctx } = createCanvas(width, height, '#f0f0f0');
  
  if (!perimeter || !perimeter.vertices || perimeter.vertices.length === 0) {
    ctx.fillStyle = 'red';
    ctx.font = 'bold 20px Arial';
    ctx.fillText('No perimeter detected', width / 2 - 100, height / 2);
    return canvas.toDataURL();
  }
  
  // Draw perimeter polygon
  ctx.strokeStyle = 'rgba(0, 150, 0, 0.9)';
  ctx.fillStyle = 'rgba(0, 200, 0, 0.2)';
  ctx.lineWidth = 4;
  
  ctx.beginPath();
  ctx.moveTo(perimeter.vertices[0].x, perimeter.vertices[0].y);
  for (let i = 1; i < perimeter.vertices.length; i++) {
    ctx.lineTo(perimeter.vertices[i].x, perimeter.vertices[i].y);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  
  // Draw vertices
  ctx.fillStyle = 'red';
  for (const vertex of perimeter.vertices) {
    ctx.beginPath();
    ctx.arc(vertex.x, vertex.y, 5, 0, 2 * Math.PI);
    ctx.fill();
  }
  
  // Add vertex count
  ctx.fillStyle = 'black';
  ctx.font = 'bold 16px Arial';
  ctx.fillText(`${perimeter.vertices.length} vertices`, 10, 25);
  
  return canvas.toDataURL();
};

/**
 * Visualize comparison before/after
 */
export const visualizeComparison = (beforeSegments, afterSegments, width, height, title) => {
  const { canvas, ctx } = createCanvas(width * 2 + 20, height);
  
  // Draw "before" on left
  ctx.fillStyle = 'white';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(255, 0, 0, 0.6)';
  ctx.lineWidth = 2;
  for (const seg of beforeSegments) {
    ctx.beginPath();
    ctx.moveTo(seg.x1, seg.y1);
    ctx.lineTo(seg.x2, seg.y2);
    ctx.stroke();
  }
  
  ctx.fillStyle = 'black';
  ctx.font = 'bold 14px Arial';
  ctx.fillText(`Before: ${beforeSegments.length} segments`, 10, 20);
  
  // Draw "after" on right
  ctx.fillStyle = 'white';
  ctx.fillRect(width + 20, 0, width, height);
  ctx.strokeStyle = 'rgba(0, 0, 255, 0.6)';
  ctx.lineWidth = 2;
  for (const seg of afterSegments) {
    ctx.beginPath();
    ctx.moveTo(seg.x1 + width + 20, seg.y1);
    ctx.lineTo(seg.x2 + width + 20, seg.y2);
    ctx.stroke();
  }
  
  ctx.fillStyle = 'black';
  ctx.fillText(`After: ${afterSegments.length} segments`, width + 30, 20);
  
  // Draw separator
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(width + 10, 0);
  ctx.lineTo(width + 10, height);
  ctx.stroke();
  
  return canvas.toDataURL();
};

/**
 * Visualize room finding results
 */
export const visualizeRoomFinding = (originalImage, wallData, dimensions, rooms, width, height) => {
  return new Promise(async (resolve) => {
    const { canvas, ctx } = createCanvas(width, height);
    
    // Draw original image if available
    if (originalImage) {
      try {
        const img = await loadImage(originalImage);
        ctx.drawImage(img, 0, 0);
        
        // Add semi-transparent overlay
        ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
        ctx.fillRect(0, 0, width, height);
      } catch (e) {
        console.warn('Could not load original image for room visualization');
      }
    }
    
    // Draw all walls lightly
    ctx.strokeStyle = 'rgba(200, 200, 200, 0.5)';
    ctx.lineWidth = 2;
    if (wallData.allWalls) {
      for (const wall of wallData.allWalls) {
        const { x1, y1, x2, y2 } = wall.boundingBox;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      }
    }
    
    // Draw dimension boxes and found rooms
    for (let i = 0; i < dimensions.length; i++) {
      const dim = dimensions[i];
      const room = rooms[i];
      
      // Draw dimension bbox (yellow dashed)
      ctx.strokeStyle = 'rgba(255, 200, 0, 0.8)';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(dim.bbox.x, dim.bbox.y, dim.bbox.width, dim.bbox.height);
      ctx.setLineDash([]);
      
      if (room) {
        // Draw room box (green solid)
        ctx.strokeStyle = 'rgba(0, 255, 0, 0.9)';
        ctx.fillStyle = 'rgba(0, 255, 0, 0.1)';
        ctx.lineWidth = 3;
        const roomWidth = room.x2 - room.x1;
        const roomHeight = room.y2 - room.y1;
        ctx.fillRect(room.x1, room.y1, roomWidth, roomHeight);
        ctx.strokeRect(room.x1, room.y1, roomWidth, roomHeight);
        
        // Draw label
        ctx.font = 'bold 14px Arial';
        ctx.fillStyle = 'white';
        ctx.strokeStyle = 'black';
        ctx.lineWidth = 3;
        const label = `${dim.width} × ${dim.height} ft`;
        ctx.strokeText(label, room.x1 + 5, room.y1 + 20);
        ctx.fillStyle = 'lime';
        ctx.fillText(label, room.x1 + 5, room.y1 + 20);
      } else {
        // Mark as failed
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(dim.bbox.x, dim.bbox.y);
        ctx.lineTo(dim.bbox.x + dim.bbox.width, dim.bbox.y + dim.bbox.height);
        ctx.moveTo(dim.bbox.x + dim.bbox.width, dim.bbox.y);
        ctx.lineTo(dim.bbox.x, dim.bbox.y + dim.bbox.height);
        ctx.stroke();
      }
    }
    
    resolve(canvas.toDataURL());
  });
};

/**
 * Helper to load image from data URL
 */
const loadImage = (dataUrl) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataUrl;
  });
};

/**
 * Create a multi-panel diagnostic view
 */
export const createDiagnosticPanel = (panels, panelWidth, panelHeight) => {
  const cols = Math.ceil(Math.sqrt(panels.length));
  const rows = Math.ceil(panels.length / cols);
  
  const padding = 10;
  const totalWidth = cols * (panelWidth + padding) + padding;
  const totalHeight = rows * (panelHeight + padding + 30) + padding;
  
  const { canvas, ctx } = createCanvas(totalWidth, totalHeight, '#f5f5f5');
  
  return new Promise(async (resolve) => {
    for (let i = 0; i < panels.length; i++) {
      const panel = panels[i];
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * (panelWidth + padding) + padding;
      const y = row * (panelHeight + padding + 30) + padding;
      
      // Draw panel background
      ctx.fillStyle = 'white';
      ctx.fillRect(x, y, panelWidth, panelHeight + 30);
      
      // Draw title
      ctx.fillStyle = 'black';
      ctx.font = 'bold 12px Arial';
      ctx.fillText(panel.title, x + 5, y + 15);
      
      // Draw image
      if (panel.imageDataUrl) {
        try {
          const img = await loadImage(panel.imageDataUrl);
          ctx.drawImage(img, x, y + 25, panelWidth, panelHeight);
        } catch (e) {
          console.warn('Could not load panel image:', panel.title);
        }
      }
      
      // Draw border
      ctx.strokeStyle = '#ccc';
      ctx.lineWidth = 1;
      ctx.strokeRect(x, y, panelWidth, panelHeight + 30);
    }
    
    resolve(canvas.toDataURL());
  });
};
