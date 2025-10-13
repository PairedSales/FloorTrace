/**
 * topologyRoomDetector.js
 * Room detection using topology-guided wall analysis
 * Completely replaces old room detection systems
 */

import Tesseract from 'tesseract.js';
import { dataUrlToImage, imageToCanvas } from './imageLoader';
import { detectSegmentsFromImage } from './segmentDetection.js';
import { buildTopologyGraph } from './topologyGraph.js';
import { mergeLines } from './lineMerging.js';
import { classifyWalls } from './wallClassifier.js';
import { distance, lineBounds } from './geometryUtils.js';

/**
 * Parse dimension text and extract width and height in feet
 * Supports multiple formats:
 * - 5' 10" x 6' 3"
 * - 3' - 7" x 12' - 0"
 * - 5.2 ft x 6.3 ft
 * - 21.3 feet x 11.1 feet
 * - 12 x 10 (assumed feet)
 */
const parseDimensions = (text) => {
  // Pattern 1: Feet and inches
  const feetInchesPattern = /(\d+)\s*'\s*-?\s*(\d+)\s*"\s*x\s*(\d+)\s*'\s*-?\s*(\d+)\s*"/i;
  const feetInchesMatch = text.match(feetInchesPattern);
  if (feetInchesMatch) {
    const width = parseInt(feetInchesMatch[1]) + parseInt(feetInchesMatch[2]) / 12;
    const height = parseInt(feetInchesMatch[3]) + parseInt(feetInchesMatch[4]) / 12;
    return { width, height, match: feetInchesMatch[0], format: 'inches' };
  }
  
  // Pattern 2: Decimal feet
  const decimalFeetPattern = /(\d+(?:\.\d+)?)\s*(?:ft|feet)\s*x\s*(\d+(?:\.\d+)?)\s*(?:ft|feet)/i;
  const decimalFeetMatch = text.match(decimalFeetPattern);
  if (decimalFeetMatch) {
    const width = parseFloat(decimalFeetMatch[1]);
    const height = parseFloat(decimalFeetMatch[2]);
    return { width, height, match: decimalFeetMatch[0], format: 'decimal' };
  }
  
  // Pattern 3: Simple numbers
  const simplePattern = /(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/i;
  const simpleMatch = text.match(simplePattern);
  if (simpleMatch) {
    const width = parseFloat(simpleMatch[1]);
    const height = parseFloat(simpleMatch[2]);
    const hasDecimal = simpleMatch[1].includes('.') || simpleMatch[2].includes('.');
    return { width, height, match: simpleMatch[0], format: hasDecimal ? 'decimal' : 'decimal' };
  }
  
  return null;
};

/**
 * Find enclosed rooms using topology graph cycle detection
 * @param {Object} graph - Topology graph with nodes and edges
 * @param {Array} walls - Classified wall array
 * @returns {Array} Array of detected rooms with wall boundaries
 */
function findEnclosedRooms(graph, walls) {
  const rooms = [];
  
  // Find all cycles in the graph (potential rooms)
  const cycles = findCyclesInGraph(graph);
  
  for (const cycle of cycles) {
    // Get walls that form this cycle
    const roomWalls = cycle.edges.map(edgeId => {
      const edge = graph.edges[edgeId];
      return walls.find(w => w.segments.some(s => s.id === edge.segmentId));
    }).filter(Boolean);
    
    if (roomWalls.length < 3) continue; // Need at least 3 walls
    
    // Compute bounding box of the room
    const bounds = computeRoomBounds(roomWalls);
    
    // Compute room area using shoelace formula
    const area = computePolygonArea(cycle.nodes.map(nodeId => graph.nodes[nodeId]));
    
    // Only keep rooms with reasonable area (not too small, not the entire floor plan)
    if (area < 1000 || area > 1000000) continue;
    
    rooms.push({
      id: `room_${rooms.length}`,
      walls: roomWalls,
      nodes: cycle.nodes,
      bounds,
      area,
      center: {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2
      }
    });
  }
  
  // Sort rooms by area (smallest to largest)
  rooms.sort((a, b) => a.area - b.area);
  
  return rooms;
}

/**
 * Find cycles in the topology graph using DFS
 * @param {Object} graph - Topology graph
 * @returns {Array} Array of cycles (each with nodes and edges)
 */
function findCyclesInGraph(graph) {
  const cycles = [];
  const visited = new Set();
  const recursionStack = new Set();
  const path = [];
  
  function dfs(nodeId, parent) {
    visited.add(nodeId);
    recursionStack.add(nodeId);
    path.push(nodeId);
    
    const neighbors = graph.adjacency.get(nodeId) || [];
    
    for (const neighbor of neighbors) {
      if (neighbor === parent) continue; // Skip back edge to parent
      
      if (recursionStack.has(neighbor)) {
        // Found a cycle
        const cycleStartIndex = path.indexOf(neighbor);
        if (cycleStartIndex !== -1) {
          const cycleNodes = path.slice(cycleStartIndex);
          
          // Get edges for this cycle
          const cycleEdges = [];
          for (let i = 0; i < cycleNodes.length; i++) {
            const from = cycleNodes[i];
            const to = cycleNodes[(i + 1) % cycleNodes.length];
            const edge = graph.edges.find(e => 
              (e.startNode === from && e.endNode === to) ||
              (e.startNode === to && e.endNode === from)
            );
            if (edge) cycleEdges.push(graph.edges.indexOf(edge));
          }
          
          // Only add if we have a proper cycle with edges
          if (cycleEdges.length >= 3 && cycleEdges.length === cycleNodes.length) {
            cycles.push({ nodes: cycleNodes, edges: cycleEdges });
          }
        }
      } else if (!visited.has(neighbor)) {
        dfs(neighbor, nodeId);
      }
    }
    
    path.pop();
    recursionStack.delete(nodeId);
  }
  
  // Try DFS from each unvisited node
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      dfs(node.id, null);
    }
  }
  
  // Deduplicate cycles (same room detected from different starting points)
  return deduplicateCycles(cycles);
}

/**
 * Remove duplicate cycles (same room from different start points)
 */
function deduplicateCycles(cycles) {
  const unique = [];
  
  for (const cycle of cycles) {
    const sortedNodes = [...cycle.nodes].sort((a, b) => a - b);
    const key = sortedNodes.join(',');
    
    if (!unique.some(c => {
      const sortedExisting = [...c.nodes].sort((a, b) => a - b);
      return sortedExisting.join(',') === key;
    })) {
      unique.push(cycle);
    }
  }
  
  return unique;
}

/**
 * Compute bounding box from walls
 */
function computeRoomBounds(walls) {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  
  for (const wall of walls) {
    const bounds = lineBounds(wall.chain);
    minX = Math.min(minX, bounds.minX);
    minY = Math.min(minY, bounds.minY);
    maxX = Math.max(maxX, bounds.maxX);
    maxY = Math.max(maxY, bounds.maxY);
  }
  
  return { minX, minY, maxX, maxY };
}

/**
 * Compute polygon area using shoelace formula
 */
function computePolygonArea(nodes) {
  if (nodes.length < 3) return 0;
  
  let area = 0;
  for (let i = 0; i < nodes.length; i++) {
    const j = (i + 1) % nodes.length;
    area += nodes[i].x * nodes[j].y;
    area -= nodes[j].x * nodes[i].y;
  }
  
  return Math.abs(area / 2);
}

/**
 * Find the room closest to a dimension text bounding box
 */
function findRoomNearDimension(rooms, dimensionBBox) {
  if (!rooms || rooms.length === 0) return null;
  
  const dimCenter = {
    x: dimensionBBox.x + dimensionBBox.width / 2,
    y: dimensionBBox.y + dimensionBBox.height / 2
  };
  
  let closestRoom = null;
  let minDist = Infinity;
  
  for (const room of rooms) {
    const dist = distance(dimCenter, room.center);
    
    // Check if dimension is inside room bounds
    const inside = 
      dimCenter.x >= room.bounds.minX &&
      dimCenter.x <= room.bounds.maxX &&
      dimCenter.y >= room.bounds.minY &&
      dimCenter.y <= room.bounds.maxY;
    
    if (inside || dist < minDist) {
      if (inside) minDist = 0; // Prioritize rooms containing the dimension
      else minDist = dist;
      closestRoom = room;
    }
  }
  
  return closestRoom;
}

/**
 * Convert room to overlay format
 */
function roomToOverlay(room) {
  if (!room) return null;
  
  return {
    x1: room.bounds.minX,
    y1: room.bounds.minY,
    x2: room.bounds.maxX,
    y2: room.bounds.maxY,
    center: room.center,
    area: room.area,
    walls: room.walls
  };
}

/**
 * Detect room using topology-guided wall analysis
 * Main entry point - replaces old detectRoom function
 */
export const detectRoom = async (imageDataUrl) => {
  try {
    console.log('Starting topology-guided room detection...');
    
    // Step 1: Run OCR to find dimensions
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    
    console.log('Running OCR...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => console.log('OCR Progress:', m)
    });
    
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789'\"ftx .-",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO
    });
    
    const result = await worker.recognize(canvas, {}, { blocks: true });
    await worker.terminate();
    
    // Parse dimensions
    const text = result.data.text;
    const textLines = text.split('\n');
    
    let firstDimension = null;
    let dimensionBBox = null;
    
    for (const line of textLines) {
      const parsed = parseDimensions(line);
      if (parsed) {
        firstDimension = parsed;
        
        // Find bounding box
        let words = [];
        if (result.data.blocks) {
          for (const block of result.data.blocks) {
            if (block.paragraphs) {
              for (const paragraph of block.paragraphs) {
                if (paragraph.lines) {
                  for (const line of paragraph.lines) {
                    if (line.words) {
                      words.push(...line.words);
                    }
                  }
                }
              }
            }
          }
        }
        
        for (const word of words) {
          if (word.text && parsed.match.includes(word.text.replace(/\s/g, ''))) {
            if (!dimensionBBox) {
              dimensionBBox = {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
              };
            } else {
              const minX = Math.min(dimensionBBox.x, word.bbox.x0);
              const minY = Math.min(dimensionBBox.y, word.bbox.y0);
              const maxX = Math.max(dimensionBBox.x + dimensionBBox.width, word.bbox.x1);
              const maxY = Math.max(dimensionBBox.y + dimensionBBox.height, word.bbox.y1);
              dimensionBBox = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              };
            }
          }
        }
        break;
      }
    }
    
    if (!firstDimension) {
      console.log('No room dimensions found in OCR text');
      return null;
    }
    
    console.log(`Found dimension: ${firstDimension.width} x ${firstDimension.height} ft`);
    
    // Step 2: Detect segments and build topology
    console.log('Detecting line segments...');
    const segments = await detectSegmentsFromImage(img, {
      cannyLow: 50,
      cannyHigh: 150,
      houghThreshold: 50,
      minLineLength: 30,
      maxLineGap: 10
    });
    
    console.log(`Found ${segments.length} segments`);
    
    if (segments.length === 0) {
      console.log('No segments detected, using fallback');
      return createFallbackRoom(firstDimension, dimensionBBox, img);
    }
    
    // Step 3: Build topology graph
    console.log('Building topology graph...');
    const graph = buildTopologyGraph(segments, {
      endpointTolerance: 8,
      parallelTolerance: 5
    });
    
    console.log(`Graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
    
    // Step 4: Merge into walls
    console.log('Merging segments into walls...');
    const chains = mergeLines(segments, graph, {
      angleTolerance: 5,
      gapTolerance: 8,
      mergeCollinear: true
    });
    
    console.log(`Created ${chains.length} wall chains`);
    
    // Step 5: Classify walls
    console.log('Classifying walls...');
    const walls = classifyWalls(chains, graph, {
      minLength: 25,
      minConfidence: 0.3,
      computeThickness: true
    });
    
    console.log(`Classified ${walls.length} walls`);
    
    // Step 6: Find enclosed rooms
    console.log('Finding enclosed rooms...');
    const rooms = findEnclosedRooms(graph, walls);
    
    console.log(`Found ${rooms.length} potential rooms`);
    
    // Step 7: Match dimension to room
    let roomOverlay = null;
    
    if (dimensionBBox && rooms.length > 0) {
      const matchedRoom = findRoomNearDimension(rooms, dimensionBBox);
      if (matchedRoom) {
        console.log('Successfully matched dimension to room');
        roomOverlay = roomToOverlay(matchedRoom);
      }
    }
    
    // Fallback: Use largest reasonable room
    if (!roomOverlay && rooms.length > 0) {
      console.log('Using largest reasonable room as fallback');
      const reasonableRooms = rooms.filter(r => r.area >= 5000 && r.area <= 500000);
      if (reasonableRooms.length > 0) {
        roomOverlay = roomToOverlay(reasonableRooms[reasonableRooms.length - 1]);
      }
    }
    
    // Final fallback
    if (!roomOverlay) {
      console.log('No rooms found, using dimension-based fallback');
      roomOverlay = createFallbackRoom(firstDimension, dimensionBBox, img).overlay;
    }
    
    return {
      dimensions: {
        width: firstDimension.width.toString(),
        height: firstDimension.height.toString()
      },
      overlay: roomOverlay,
      detectedFormat: firstDimension.format,
      topologyData: {
        segments,
        graph,
        walls,
        rooms
      }
    };
    
  } catch (error) {
    console.error('Error in topology-guided room detection:', error);
    return null;
  }
};

/**
 * Create fallback room when topology detection fails
 */
function createFallbackRoom(dimension, dimensionBBox, img) {
  if (dimensionBBox) {
    const padding = 50;
    return {
      dimensions: {
        width: dimension.width.toString(),
        height: dimension.height.toString()
      },
      overlay: {
        x1: Math.max(0, dimensionBBox.x - padding),
        y1: Math.max(0, dimensionBBox.y - padding),
        x2: Math.min(img.width, dimensionBBox.x + dimensionBBox.width + padding),
        y2: Math.min(img.height, dimensionBBox.y + dimensionBBox.height + padding)
      },
      detectedFormat: dimension.format
    };
  }
  
  return {
    dimensions: {
      width: dimension.width.toString(),
      height: dimension.height.toString()
    },
    overlay: {
      x1: img.width * 0.25,
      y1: img.height * 0.25,
      x2: img.width * 0.75,
      y2: img.height * 0.75
    },
    detectedFormat: dimension.format
  };
}

/**
 * Get all detected dimensions for manual mode
 * Replaces old detectAllDimensions function
 */
export const detectAllDimensions = async (imageDataUrl) => {
  try {
    const img = await dataUrlToImage(imageDataUrl);
    const canvas = imageToCanvas(img);
    
    console.log('detectAllDimensions: Starting OCR...');
    const worker = await Tesseract.createWorker('eng', 1, {
      logger: (m) => console.log('OCR Progress:', m)
    });
    
    await worker.setParameters({
      tessedit_char_whitelist: "0123456789'\"ftx .-",
      tessedit_pageseg_mode: Tesseract.PSM.AUTO
    });
    
    const result = await worker.recognize(canvas, {}, { blocks: true });
    await worker.terminate();
    
    const text = result.data.text;
    const textLines = text.split('\n');
    
    const dimensions = [];
    let detectedFormat = null;
    
    // Get words for bounding box lookup
    let words = [];
    if (result.data.blocks) {
      for (const block of result.data.blocks) {
        if (block.paragraphs) {
          for (const paragraph of block.paragraphs) {
            if (paragraph.lines) {
              for (const line of paragraph.lines) {
                if (line.words) {
                  words.push(...line.words);
                }
              }
            }
          }
        }
      }
    }
    
    const globalUsedWordIndices = new Set();
    
    for (const line of textLines) {
      const trimmedLine = line.trim();
      if (!trimmedLine) continue;
      
      const parsed = parseDimensions(trimmedLine);
      
      if (parsed) {
        if (!detectedFormat) {
          detectedFormat = parsed.format;
        }
        
        let dimensionBBox = null;
        const numericTokens = parsed.match.match(/\d+/g) || [];
        
        // Find matching words
        const matchingWords = [];
        for (let wordIndex = 0; wordIndex < words.length; wordIndex++) {
          const word = words[wordIndex];
          if (!word.text || !word.bbox) continue;
          if (globalUsedWordIndices.has(wordIndex)) continue;
          
          const wordText = word.text.trim();
          if (wordText.length === 0) continue;
          
          const containsNumber = numericTokens.some(num => wordText.includes(num));
          if (containsNumber) {
            matchingWords.push({ word, index: wordIndex });
          }
        }
        
        // Cluster words spatially
        if (matchingWords.length > 0) {
          let clusterWords = [matchingWords[0]];
          const maxVerticalDistance = 100;
          const maxHorizontalDistance = 300;
          
          for (let i = 1; i < matchingWords.length; i++) {
            const { word } = matchingWords[i];
            const wordCenterX = (word.bbox.x0 + word.bbox.x1) / 2;
            const wordCenterY = (word.bbox.y0 + word.bbox.y1) / 2;
            
            let isClose = false;
            for (const clusterItem of clusterWords) {
              const clusterWord = clusterItem.word;
              const clusterCenterX = (clusterWord.bbox.x0 + clusterWord.bbox.x1) / 2;
              const clusterCenterY = (clusterWord.bbox.y0 + clusterWord.bbox.y1) / 2;
              
              const verticalDist = Math.abs(wordCenterY - clusterCenterY);
              const horizontalDist = Math.abs(wordCenterX - clusterCenterX);
              
              if (verticalDist <= maxVerticalDistance && horizontalDist <= maxHorizontalDistance) {
                isClose = true;
                break;
              }
            }
            
            if (isClose) {
              clusterWords.push(matchingWords[i]);
            }
          }
          
          // Build bbox
          for (const { word, index } of clusterWords) {
            globalUsedWordIndices.add(index);
            
            if (!dimensionBBox) {
              dimensionBBox = {
                x: word.bbox.x0,
                y: word.bbox.y0,
                width: word.bbox.x1 - word.bbox.x0,
                height: word.bbox.y1 - word.bbox.y0
              };
            } else {
              const minX = Math.min(dimensionBBox.x, word.bbox.x0);
              const minY = Math.min(dimensionBBox.y, word.bbox.y0);
              const maxX = Math.max(dimensionBBox.x + dimensionBBox.width, word.bbox.x1);
              const maxY = Math.max(dimensionBBox.y + dimensionBBox.height, word.bbox.y1);
              dimensionBBox = {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY
              };
            }
          }
        }
        
        // Fallback bbox
        if (!dimensionBBox) {
          const dimensionIndex = dimensions.length;
          dimensionBBox = {
            x: img.width / 2 - 100,
            y: img.height * 0.3 + (dimensionIndex * 80),
            width: 200,
            height: 50
          };
        }
        
        dimensions.push({
          width: parsed.width,
          height: parsed.height,
          text: parsed.match,
          bbox: dimensionBBox,
          format: parsed.format
        });
      }
    }
    
    console.log(`detectAllDimensions: Found ${dimensions.length} dimensions`);
    return { dimensions, detectedFormat };
  } catch (error) {
    console.error('Error detecting all dimensions:', error);
    return { dimensions: [], detectedFormat: null };
  }
};
