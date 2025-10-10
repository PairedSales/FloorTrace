/**
 * Line Detection System for Floor Plans
 * Detects horizontal and vertical lines of varying widths
 */

/**
 * Represents a detected line with position and thickness
 */
class DetectedLine {
  constructor(position, start, end, thickness, isHorizontal) {
    this.position = position; // Y for horizontal, X for vertical
    this.start = start; // Starting coordinate along the line
    this.end = end; // Ending coordinate along the line
    this.thickness = thickness; // Width of the line in pixels
    this.isHorizontal = isHorizontal;
  }

  get length() {
    return this.end - this.start;
  }

  get center() {
    return this.position + this.thickness / 2;
  }

  // Get inner edge (for interior walls)
  get innerEdge() {
    return this.isHorizontal 
      ? this.position + this.thickness // Bottom edge for horizontal
      : this.position + this.thickness; // Right edge for vertical
  }

  // Get outer edge (for exterior walls)
  get outerEdge() {
    return this.position; // Top edge for horizontal, left edge for vertical
  }
}

/**
 * Represents an intersection point between two lines
 */
class LineIntersection {
  constructor(x, y, horizontalLine, verticalLine) {
    this.x = x;
    this.y = y;
    this.horizontalLine = horizontalLine;
    this.verticalLine = verticalLine;
  }

  // Get interior intersection point
  getInteriorPoint() {
    return {
      x: this.verticalLine.innerEdge,
      y: this.horizontalLine.innerEdge
    };
  }

  // Get exterior intersection point
  getExteriorPoint() {
    return {
      x: this.verticalLine.outerEdge,
      y: this.horizontalLine.outerEdge
    };
  }
}

/**
 * Main line detection function
 * @param {HTMLImageElement} image - The floor plan image
 * @returns {Object} Object containing horizontal and vertical lines
 */
export const detectLines = (image) => {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0);
  
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  
  // Convert to grayscale and apply threshold
  const threshold = 128;
  const binaryImage = new Uint8Array(canvas.width * canvas.height);
  
  for (let i = 0; i < data.length; i += 4) {
    const brightness = (data[i] + data[i + 1] + data[i + 2]) / 3;
    binaryImage[i / 4] = brightness < threshold ? 1 : 0; // 1 = dark (line), 0 = light (background)
  }
  
  // Detect horizontal lines
  const horizontalLines = detectHorizontalLines(binaryImage, canvas.width, canvas.height);
  
  // Detect vertical lines
  const verticalLines = detectVerticalLines(binaryImage, canvas.width, canvas.height);
  
  return {
    horizontal: horizontalLines,
    vertical: verticalLines,
    intersections: findIntersections(horizontalLines, verticalLines)
  };
};

/**
 * Detect horizontal lines in the binary image
 */
const detectHorizontalLines = (binaryImage, width, height) => {
  const lines = [];
  const minLineLength = Math.floor(width * 0.05); // Minimum 5% of image width
  const scanStep = 1; // Scan every row
  
  for (let y = 0; y < height; y += scanStep) {
    let lineStart = null;
    let lineThickness = 0;
    let consecutiveDark = 0;
    
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      
      if (binaryImage[idx] === 1) { // Dark pixel (part of line)
        if (lineStart === null) {
          lineStart = x;
        }
        consecutiveDark++;
        
        // Measure thickness by checking pixels below
        let thickness = 1;
        for (let dy = 1; dy < 20 && y + dy < height; dy++) {
          const belowIdx = (y + dy) * width + x;
          if (binaryImage[belowIdx] === 1) {
            thickness++;
          } else {
            break;
          }
        }
        lineThickness = Math.max(lineThickness, thickness);
      } else {
        // End of potential line
        if (lineStart !== null && consecutiveDark >= minLineLength) {
          lines.push(new DetectedLine(y, lineStart, x - 1, lineThickness, true));
        }
        lineStart = null;
        lineThickness = 0;
        consecutiveDark = 0;
      }
    }
    
    // Check if line extends to edge
    if (lineStart !== null && consecutiveDark >= minLineLength) {
      lines.push(new DetectedLine(y, lineStart, width - 1, lineThickness, true));
    }
  }
  
  // Merge nearby parallel lines
  return mergeParallelLines(lines, true);
};

/**
 * Detect vertical lines in the binary image
 */
const detectVerticalLines = (binaryImage, width, height) => {
  const lines = [];
  const minLineLength = Math.floor(height * 0.05); // Minimum 5% of image height
  const scanStep = 1; // Scan every column
  
  for (let x = 0; x < width; x += scanStep) {
    let lineStart = null;
    let lineThickness = 0;
    let consecutiveDark = 0;
    
    for (let y = 0; y < height; y++) {
      const idx = y * width + x;
      
      if (binaryImage[idx] === 1) { // Dark pixel (part of line)
        if (lineStart === null) {
          lineStart = y;
        }
        consecutiveDark++;
        
        // Measure thickness by checking pixels to the right
        let thickness = 1;
        for (let dx = 1; dx < 20 && x + dx < width; dx++) {
          const rightIdx = y * width + (x + dx);
          if (binaryImage[rightIdx] === 1) {
            thickness++;
          } else {
            break;
          }
        }
        lineThickness = Math.max(lineThickness, thickness);
      } else {
        // End of potential line
        if (lineStart !== null && consecutiveDark >= minLineLength) {
          lines.push(new DetectedLine(x, lineStart, y - 1, lineThickness, false));
        }
        lineStart = null;
        lineThickness = 0;
        consecutiveDark = 0;
      }
    }
    
    // Check if line extends to edge
    if (lineStart !== null && consecutiveDark >= minLineLength) {
      lines.push(new DetectedLine(x, lineStart, height - 1, lineThickness, false));
    }
  }
  
  // Merge nearby parallel lines
  return mergeParallelLines(lines, false);
};

/**
 * Merge parallel lines that are close together (likely the same wall)
 */
const mergeParallelLines = (lines, isHorizontal) => {
  if (lines.length === 0) return [];
  
  // Sort by position
  lines.sort((a, b) => a.position - b.position);
  
  const merged = [];
  let currentGroup = [lines[0]];
  
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const prevLine = currentGroup[currentGroup.length - 1];
    
    // Check if lines are close enough to be the same wall
    const positionDiff = line.position - prevLine.position;
    const maxThickness = Math.max(line.thickness, prevLine.thickness);
    
    if (positionDiff <= maxThickness + 5) {
      // Lines overlap or are very close - same wall
      currentGroup.push(line);
    } else {
      // Different wall - merge current group and start new one
      merged.push(mergeLineGroup(currentGroup, isHorizontal));
      currentGroup = [line];
    }
  }
  
  // Merge last group
  if (currentGroup.length > 0) {
    merged.push(mergeLineGroup(currentGroup, isHorizontal));
  }
  
  return merged;
};

/**
 * Merge a group of lines into a single line
 */
const mergeLineGroup = (group, isHorizontal) => {
  const minPosition = Math.min(...group.map(l => l.position));
  const maxPosition = Math.max(...group.map(l => l.position + l.thickness));
  const minStart = Math.min(...group.map(l => l.start));
  const maxEnd = Math.max(...group.map(l => l.end));
  const thickness = maxPosition - minPosition;
  
  return new DetectedLine(minPosition, minStart, maxEnd, thickness, isHorizontal);
};

/**
 * Find all intersections between horizontal and vertical lines
 */
const findIntersections = (horizontalLines, verticalLines) => {
  const intersections = [];
  
  for (const hLine of horizontalLines) {
    for (const vLine of verticalLines) {
      // Check if lines intersect
      const hRange = [hLine.start, hLine.end];
      const vRange = [vLine.start, vLine.end];
      
      const xInRange = vLine.position >= hRange[0] && vLine.position <= hRange[1];
      const yInRange = hLine.position >= vRange[0] && hLine.position <= vRange[1];
      
      if (xInRange && yInRange) {
        // Lines intersect - create intersection point
        intersections.push(new LineIntersection(
          vLine.center,
          hLine.center,
          hLine,
          vLine
        ));
      }
    }
  }
  
  return intersections;
};

/**
 * Find the perimeter of the floor plan using detected lines
 * @param {Array} horizontalLines - Detected horizontal lines
 * @param {Array} verticalLines - Detected vertical lines
 * @param {boolean} useInterior - True for interior walls, false for exterior
 * @returns {Array} Array of vertices forming the perimeter
 */
export const findPerimeter = (horizontalLines, verticalLines, useInterior = true) => {
  if (horizontalLines.length === 0 || verticalLines.length === 0) {
    return null;
  }
  
  // Find the outermost lines
  const topLine = horizontalLines.reduce((min, line) => 
    line.position < min.position ? line : min
  );
  const bottomLine = horizontalLines.reduce((max, line) => 
    line.position > max.position ? line : max
  );
  const leftLine = verticalLines.reduce((min, line) => 
    line.position < min.position ? line : min
  );
  const rightLine = verticalLines.reduce((max, line) => 
    line.position > max.position ? line : max
  );
  
  // Get the appropriate edge based on interior/exterior setting
  const getEdge = (line, isHorizontal) => {
    if (isHorizontal) {
      return useInterior ? line.innerEdge : line.outerEdge;
    } else {
      return useInterior ? line.innerEdge : line.outerEdge;
    }
  };
  
  // Create vertices at the corners
  const vertices = [
    { x: getEdge(leftLine, false), y: getEdge(topLine, true) },      // Top-left
    { x: getEdge(rightLine, false), y: getEdge(topLine, true) },     // Top-right
    { x: getEdge(rightLine, false), y: getEdge(bottomLine, true) },  // Bottom-right
    { x: getEdge(leftLine, false), y: getEdge(bottomLine, true) }    // Bottom-left
  ];
  
  return vertices;
};

/**
 * Find a room box around detected dimensions using line data
 * @param {Object} dimensionBBox - Bounding box of the detected dimension text {x, y, width, height}
 * @param {Array} horizontalLines - Detected horizontal lines
 * @param {Array} verticalLines - Detected vertical lines
 * @returns {Object} Room overlay {x1, y1, x2, y2}
 */
export const findRoomBox = (dimensionBBox, horizontalLines, verticalLines) => {
  const centerX = dimensionBBox.x + dimensionBBox.width / 2;
  const centerY = dimensionBBox.y + dimensionBBox.height / 2;
  
  // Find the closest lines on each side
  const linesAbove = horizontalLines.filter(l => l.innerEdge < centerY);
  const linesBelow = horizontalLines.filter(l => l.outerEdge > centerY);
  const linesLeft = verticalLines.filter(l => l.innerEdge < centerX);
  const linesRight = verticalLines.filter(l => l.outerEdge > centerX);
  
  // Get the closest line on each side
  const topLine = linesAbove.length > 0 
    ? linesAbove.reduce((closest, line) => 
        Math.abs(line.innerEdge - centerY) < Math.abs(closest.innerEdge - centerY) ? line : closest
      )
    : null;
    
  const bottomLine = linesBelow.length > 0
    ? linesBelow.reduce((closest, line) => 
        Math.abs(line.outerEdge - centerY) < Math.abs(closest.outerEdge - centerY) ? line : closest
      )
    : null;
    
  const leftLine = linesLeft.length > 0
    ? linesLeft.reduce((closest, line) => 
        Math.abs(line.innerEdge - centerX) < Math.abs(closest.innerEdge - centerX) ? line : closest
      )
    : null;
    
  const rightLine = linesRight.length > 0
    ? linesRight.reduce((closest, line) => 
        Math.abs(line.outerEdge - centerX) < Math.abs(closest.outerEdge - centerX) ? line : closest
      )
    : null;
  
  // Create room box using interior edges
  if (topLine && bottomLine && leftLine && rightLine) {
    return {
      x1: leftLine.innerEdge,
      y1: topLine.innerEdge,
      x2: rightLine.innerEdge,
      y2: bottomLine.innerEdge
    };
  }
  
  return null;
};

export { DetectedLine, LineIntersection };
