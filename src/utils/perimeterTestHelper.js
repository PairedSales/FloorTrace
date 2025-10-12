/**
 * Perimeter Tracing Test Helper
 * 
 * Advanced testing utilities for debugging inner/outer wall edge detection
 */

import { detectWalls, canvasToDataUrl } from './wallDetector';
import { dataUrlToImage, imageToCanvas } from './imageLoader';

/**
 * Edge strategy types
 */
export const EDGE_STRATEGIES = {
  INNER: 'inner',   // Use inner edges (current behavior)
  OUTER: 'outer',   // Use outer edges  
  CENTER: 'center', // Use center lines
  MIXED: 'mixed'    // Adaptive strategy
};

/**
 * Comprehensive perimeter test with edge visualization
 */
export const testPerimeterWithEdges = async (imageDataUrl, options = {}) => {
  const {
    minWallLength = 100,
    edgeStrategy = EDGE_STRATEGIES.INNER,
    showDebugOverlay = true
  } = options;

  console.log('=== Perimeter Edge Test ===');
  console.log(`Edge Strategy: ${edgeStrategy}`);

  // Run wall detection
  const wallData = await detectWalls(imageDataUrl, {
    minWallLength,
    debugMode: true
  });

  // Build perimeter with different edge strategies
  const perimeterResults = {};
  
  for (const strategy of Object.values(EDGE_STRATEGIES)) {
    const perimeter = buildPerimeterWithStrategy(
      wallData.exterior,
      wallData.imageSize.width,
      wallData.imageSize.height,
      strategy
    );
    
    perimeterResults[strategy] = {
      vertices: perimeter.vertices,
      edges: perimeter.edges,
      quality: assessPerimeterQuality(perimeter.vertices)
    };
  }

  // Create visualizations
  const visualizations = {
    wallBoundingBoxes: await visualizeWallBoundingBoxes(imageDataUrl, wallData),
    edgeComparison: await visualizeEdgeComparison(imageDataUrl, wallData, perimeterResults),
    perimeters: {}
  };

  // Create individual perimeter visualizations
  for (const [strategy, result] of Object.entries(perimeterResults)) {
    visualizations.perimeters[strategy] = await visualizePerimeterWithEdges(
      imageDataUrl,
      wallData,
      result.vertices,
      result.edges,
      strategy
    );
  }

  return {
    wallData,
    perimeterResults,
    visualizations,
    recommendation: recommendBestStrategy(perimeterResults)
  };
};

/**
 * Build perimeter using specified edge strategy
 */
export const buildPerimeterWithStrategy = (exteriorWalls, imageWidth, imageHeight, strategy) => {
  if (exteriorWalls.length === 0) {
    return { vertices: [], edges: [] };
  }

  const hWalls = exteriorWalls.filter(w => w.isHorizontal);
  const vWalls = exteriorWalls.filter(w => !w.isHorizontal);

  if (hWalls.length === 0 || vWalls.length === 0) {
    return { vertices: [], edges: [] };
  }

  // Find extreme walls
  const topWalls = hWalls.filter(w => w.centerY < imageHeight / 2);
  const bottomWalls = hWalls.filter(w => w.centerY >= imageHeight / 2);
  const leftWalls = vWalls.filter(w => w.centerX < imageWidth / 2);
  const rightWalls = vWalls.filter(w => w.centerX >= imageWidth / 2);

  const topWall = topWalls.length > 0 
    ? topWalls.reduce((min, w) => w.centerY < min.centerY ? w : min)
    : null;
  const bottomWall = bottomWalls.length > 0
    ? bottomWalls.reduce((max, w) => w.centerY > max.centerY ? w : max)
    : null;
  const leftWall = leftWalls.length > 0
    ? leftWalls.reduce((min, w) => w.centerX < min.centerX ? w : min)
    : null;
  const rightWall = rightWalls.length > 0
    ? rightWalls.reduce((max, w) => w.centerX > max.centerX ? w : max)
    : null;

  if (!topWall || !bottomWall || !leftWall || !rightWall) {
    return { vertices: [], edges: [] };
  }

  // Get edge coordinates based on strategy
  const edges = getEdgeCoordinates(topWall, bottomWall, leftWall, rightWall, strategy);
  
  // Build vertices (simple rectangle for now - will be enhanced)
  const vertices = [
    { x: edges.left, y: edges.top },
    { x: edges.right, y: edges.top },
    { x: edges.right, y: edges.bottom },
    { x: edges.left, y: edges.bottom }
  ];

  return {
    vertices,
    edges: {
      top: edges.top,
      bottom: edges.bottom,
      left: edges.left,
      right: edges.right,
      strategy,
      walls: { topWall, bottomWall, leftWall, rightWall }
    }
  };
};

/**
 * Get edge coordinates based on strategy
 */
const getEdgeCoordinates = (topWall, bottomWall, leftWall, rightWall, strategy) => {
  let top, bottom, left, right;

  switch (strategy) {
    case EDGE_STRATEGIES.INNER:
      // Inner edges (current implementation)
      top = topWall.boundingBox.y2;      // Bottom edge of top wall
      bottom = bottomWall.boundingBox.y1; // Top edge of bottom wall
      left = leftWall.boundingBox.x2;     // Right edge of left wall
      right = rightWall.boundingBox.x1;   // Left edge of right wall
      break;

    case EDGE_STRATEGIES.OUTER:
      // Outer edges
      top = topWall.boundingBox.y1;      // Top edge of top wall
      bottom = bottomWall.boundingBox.y2; // Bottom edge of bottom wall
      left = leftWall.boundingBox.x1;     // Left edge of left wall
      right = rightWall.boundingBox.x2;   // Right edge of right wall
      break;

    case EDGE_STRATEGIES.CENTER:
      // Center lines
      top = topWall.centerY;
      bottom = bottomWall.centerY;
      left = leftWall.centerX;
      right = rightWall.centerX;
      break;

    case EDGE_STRATEGIES.MIXED:
      // Adaptive: Use outer edges for perimeter
      top = topWall.boundingBox.y1;
      bottom = bottomWall.boundingBox.y2;
      left = leftWall.boundingBox.x1;
      right = rightWall.boundingBox.x2;
      break;

    default:
      throw new Error(`Unknown edge strategy: ${strategy}`);
  }

  return { top, bottom, left, right };
};

/**
 * Assess perimeter quality
 */
const assessPerimeterQuality = (vertices) => {
  if (vertices.length < 4) {
    return {
      score: 0,
      issues: ['Too few vertices'],
      isClosed: false
    };
  }

  const issues = [];
  let score = 100;

  // Check if closed
  const first = vertices[0];
  const last = vertices[vertices.length - 1];
  const closingDist = Math.sqrt((last.x - first.x) ** 2 + (last.y - first.y) ** 2);
  const isClosed = closingDist < 50;

  if (!isClosed) {
    issues.push(`Not closed (gap: ${closingDist.toFixed(1)}px)`);
    score -= 30;
  }

  // Check for axis alignment
  let nonAxisAligned = 0;
  for (let i = 0; i < vertices.length - 1; i++) {
    const curr = vertices[i];
    const next = vertices[i + 1];
    const dx = Math.abs(next.x - curr.x);
    const dy = Math.abs(next.y - curr.y);
    
    if (dx > 5 && dy > 5) {
      nonAxisAligned++;
    }
  }

  if (nonAxisAligned > 0) {
    issues.push(`${nonAxisAligned} non-axis-aligned segments`);
    score -= Math.min(20, nonAxisAligned * 5);
  }

  // Calculate area
  let area = 0;
  for (let i = 0; i < vertices.length; i++) {
    const curr = vertices[i];
    const next = vertices[(i + 1) % vertices.length];
    area += curr.x * next.y - next.x * curr.y;
  }
  area = Math.abs(area) / 2;

  return {
    score,
    issues,
    isClosed,
    vertexCount: vertices.length,
    area,
    closingGap: closingDist
  };
};

/**
 * Recommend best edge strategy
 */
const recommendBestStrategy = (perimeterResults) => {
  let bestStrategy = null;
  let bestScore = -1;

  for (const [strategy, result] of Object.entries(perimeterResults)) {
    if (result.quality.score > bestScore) {
      bestScore = result.quality.score;
      bestStrategy = strategy;
    }
  }

  return {
    strategy: bestStrategy,
    score: bestScore,
    details: perimeterResults[bestStrategy]
  };
};

/**
 * Visualize wall bounding boxes with edge indicators
 */
const visualizeWallBoundingBoxes = async (imageDataUrl, wallData) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  // Draw image (semi-transparent)
  ctx.globalAlpha = 0.3;
  ctx.drawImage(img, 0, 0);
  ctx.globalAlpha = 1.0;

  // Draw exterior walls with bounding boxes
  for (const wall of wallData.exterior) {
    const bbox = wall.boundingBox;
    
    // Draw bounding box
    ctx.strokeStyle = 'red';
    ctx.lineWidth = 2;
    ctx.strokeRect(bbox.x1, bbox.y1, bbox.x2 - bbox.x1, bbox.y2 - bbox.y1);
    
    // Draw center point
    ctx.fillStyle = 'red';
    ctx.beginPath();
    ctx.arc(wall.centerX, wall.centerY, 4, 0, Math.PI * 2);
    ctx.fill();
    
    // Label orientation
    ctx.fillStyle = 'white';
    ctx.strokeStyle = 'black';
    ctx.lineWidth = 3;
    ctx.font = 'bold 12px Arial';
    const label = wall.isHorizontal ? 'H' : 'V';
    ctx.strokeText(label, wall.centerX - 5, wall.centerY + 5);
    ctx.fillText(label, wall.centerX - 5, wall.centerY + 5);

    // Draw edge indicators
    if (wall.isHorizontal) {
      // Top edge (y1) in green
      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bbox.x1, bbox.y1);
      ctx.lineTo(bbox.x2, bbox.y1);
      ctx.stroke();
      
      // Bottom edge (y2) in blue
      ctx.strokeStyle = 'cyan';
      ctx.beginPath();
      ctx.moveTo(bbox.x1, bbox.y2);
      ctx.lineTo(bbox.x2, bbox.y2);
      ctx.stroke();
    } else {
      // Left edge (x1) in green
      ctx.strokeStyle = 'lime';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(bbox.x1, bbox.y1);
      ctx.lineTo(bbox.x1, bbox.y2);
      ctx.stroke();
      
      // Right edge (x2) in blue
      ctx.strokeStyle = 'cyan';
      ctx.beginPath();
      ctx.moveTo(bbox.x2, bbox.y1);
      ctx.lineTo(bbox.x2, bbox.y2);
      ctx.stroke();
    }
  }

  // Add legend
  ctx.fillStyle = 'white';
  ctx.fillRect(10, 10, 200, 100);
  ctx.strokeStyle = 'black';
  ctx.strokeRect(10, 10, 200, 100);
  
  ctx.fillStyle = 'black';
  ctx.font = 'bold 14px Arial';
  ctx.fillText('Wall Edges:', 20, 30);
  
  ctx.strokeStyle = 'lime';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(20, 50);
  ctx.lineTo(60, 50);
  ctx.stroke();
  ctx.fillStyle = 'black';
  ctx.font = '12px Arial';
  ctx.fillText('Outer Edge', 70, 54);
  
  ctx.strokeStyle = 'cyan';
  ctx.beginPath();
  ctx.moveTo(20, 70);
  ctx.lineTo(60, 70);
  ctx.stroke();
  ctx.fillText('Inner Edge', 70, 74);

  ctx.fillStyle = 'red';
  ctx.beginPath();
  ctx.arc(40, 90, 4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'black';
  ctx.fillText('Center', 70, 94);

  return canvas.toDataURL();
};

/**
 * Visualize edge strategy comparison
 */
const visualizeEdgeComparison = async (imageDataUrl, wallData, perimeterResults) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  // Draw image (very transparent)
  ctx.globalAlpha = 0.2;
  ctx.drawImage(img, 0, 0);
  ctx.globalAlpha = 1.0;

  // Define colors for each strategy
  const colors = {
    [EDGE_STRATEGIES.INNER]: 'rgba(255, 0, 0, 0.8)',
    [EDGE_STRATEGIES.OUTER]: 'rgba(0, 255, 0, 0.8)',
    [EDGE_STRATEGIES.CENTER]: 'rgba(0, 0, 255, 0.8)',
    [EDGE_STRATEGIES.MIXED]: 'rgba(255, 255, 0, 0.8)'
  };

  // Draw each perimeter
  for (const [strategy, result] of Object.entries(perimeterResults)) {
    if (result.vertices.length === 0) continue;

    ctx.strokeStyle = colors[strategy];
    ctx.lineWidth = 3;
    ctx.setLineDash([5, 5]);
    
    ctx.beginPath();
    ctx.moveTo(result.vertices[0].x, result.vertices[0].y);
    for (let i = 1; i < result.vertices.length; i++) {
      ctx.lineTo(result.vertices[i].x, result.vertices[i].y);
    }
    ctx.closePath();
    ctx.stroke();
    
    ctx.setLineDash([]);
  }

  // Draw legend
  const legendY = 10;
  const legendX = 10;
  let yOffset = 0;

  ctx.fillStyle = 'white';
  ctx.fillRect(legendX, legendY, 250, 120);
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, 250, 120);

  ctx.fillStyle = 'black';
  ctx.font = 'bold 14px Arial';
  ctx.fillText('Edge Strategies:', legendX + 10, legendY + 20 + yOffset);
  yOffset += 25;

  for (const [strategy, color] of Object.entries(colors)) {
    const result = perimeterResults[strategy];
    if (!result) continue;

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(legendX + 10, legendY + 10 + yOffset);
    ctx.lineTo(legendX + 40, legendY + 10 + yOffset);
    ctx.stroke();

    ctx.fillStyle = 'black';
    ctx.font = '12px Arial';
    ctx.fillText(
      `${strategy.toUpperCase()} (score: ${result.quality.score})`,
      legendX + 50,
      legendY + 14 + yOffset
    );
    
    yOffset += 20;
  }

  return canvas.toDataURL();
};

/**
 * Visualize perimeter with edge details
 */
const visualizePerimeterWithEdges = async (imageDataUrl, wallData, vertices, edges, strategy) => {
  const img = await dataUrlToImage(imageDataUrl);
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d');

  // Draw image (semi-transparent)
  ctx.globalAlpha = 0.4;
  ctx.drawImage(img, 0, 0);
  ctx.globalAlpha = 1.0;

  // Draw wall bounding boxes (light)
  for (const wall of wallData.exterior) {
    const bbox = wall.boundingBox;
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(bbox.x1, bbox.y1, bbox.x2 - bbox.x1, bbox.y2 - bbox.y1);
  }

  // Highlight the edge lines being used
  if (edges.walls) {
    const { topWall, bottomWall, leftWall, rightWall } = edges.walls;
    
    // Highlight selected edges
    ctx.strokeStyle = 'yellow';
    ctx.lineWidth = 3;
    
    // Top edge
    ctx.beginPath();
    ctx.moveTo(leftWall.boundingBox.x1, edges.top);
    ctx.lineTo(rightWall.boundingBox.x2, edges.top);
    ctx.stroke();
    
    // Bottom edge
    ctx.beginPath();
    ctx.moveTo(leftWall.boundingBox.x1, edges.bottom);
    ctx.lineTo(rightWall.boundingBox.x2, edges.bottom);
    ctx.stroke();
    
    // Left edge
    ctx.beginPath();
    ctx.moveTo(edges.left, topWall.boundingBox.y1);
    ctx.lineTo(edges.left, bottomWall.boundingBox.y2);
    ctx.stroke();
    
    // Right edge
    ctx.beginPath();
    ctx.moveTo(edges.right, topWall.boundingBox.y1);
    ctx.lineTo(edges.right, bottomWall.boundingBox.y2);
    ctx.stroke();
  }

  // Draw perimeter
  if (vertices.length > 0) {
    ctx.strokeStyle = 'lime';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(vertices[0].x, vertices[0].y);
    for (let i = 1; i < vertices.length; i++) {
      ctx.lineTo(vertices[i].x, vertices[i].y);
    }
    ctx.closePath();
    ctx.stroke();

    // Draw vertices
    ctx.fillStyle = 'lime';
    for (const vertex of vertices) {
      ctx.beginPath();
      ctx.arc(vertex.x, vertex.y, 6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Add title
  ctx.fillStyle = 'white';
  ctx.strokeStyle = 'black';
  ctx.lineWidth = 3;
  ctx.font = 'bold 18px Arial';
  ctx.strokeText(strategy.toUpperCase(), 20, 30);
  ctx.fillText(strategy.toUpperCase(), 20, 30);

  return canvas.toDataURL();
};

/**
 * Export detailed test report
 */
export const exportPerimeterTestReport = (testResults) => {
  const report = {
    timestamp: new Date().toISOString(),
    wallStatistics: {
      totalWalls: testResults.wallData.allWalls.length,
      exteriorWalls: testResults.wallData.exterior.length,
      interiorWalls: testResults.wallData.interior.length
    },
    perimeterResults: {}
  };

  for (const [strategy, result] of Object.entries(testResults.perimeterResults)) {
    report.perimeterResults[strategy] = {
      vertexCount: result.vertices.length,
      quality: result.quality,
      edges: {
        top: result.edges.top,
        bottom: result.edges.bottom,
        left: result.edges.left,
        right: result.edges.right
      }
    };
  }

  report.recommendation = testResults.recommendation;

  const json = JSON.stringify(report, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `perimeter-test-report-${Date.now()}.json`;
  a.click();
  
  URL.revokeObjectURL(url);
  console.log('Test report exported');
};
