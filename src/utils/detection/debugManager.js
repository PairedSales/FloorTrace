/**
 * Calculates distance (length) between two points in pixels.
 */
export const calculateDistance = (p1, p2) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Calculates angle in degrees (-180 to 180) between two points.
 */
export const calculateAngle = (p1, p2) => {
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
};

/**
 * Formats a coordinate point for display.
 */
export const formatPoint = (p) => {
  return `(${Math.round(p.x)}, ${Math.round(p.y)})`;
};

/**
 * Compile stages list for Room Tracing.
 */
export const buildRoomDebugStages = async (debug, generateScreenshot) => {
  const stages = [];
  const scale = debug.scale ?? 1.0;
  const w = debug.normalizedSize.width;
  const h = debug.normalizedSize.height;

  const mapPt = (pt) => ({ x: pt.x / scale, y: pt.y / scale });
  const mapPoly = (poly) => (poly ? poly.map(mapPt) : []);

  // 1. Raw Thresholded Mask
  const thresholdedMaskUrl = await generateScreenshot(debug.thresholdedMask, w, h, 'thresholded');
  stages.push({
    id: 'thresholded',
    name: '1. Raw Thresholded Mask',
    maskUrl: null, // do not render on canvas automatically to avoid overlapping the original image if undesired, or keep it. Let's keep it null on canvas so it doesn't overlay, or let the user toggle! Wait, if we keep maskUrl: null, then it won't overlay on the main canvas at all! The canvas will only draw the geometries. The side panel will show the high quality screenshot. This is perfect and matches the request exactly!
    images: [
      { name: 'Raw Binarized Wall Pixels', url: thresholdedMaskUrl }
    ],
    geometry: { polygons: [], lines: [], points: [] },
    explanation: {
      seeing: 'A raw binary black-and-white mask of the floor plan where all pixels darker than the global threshold are binarized as wall candidates.',
      expected: 'All walls should appear as dark foreground pixels. Text elements, dimensional lines, and other non-wall markings will also be present at this stage.'
    },
    metadata: {
      'Stage Name': 'Thresholded Walls',
      'Width': `${w}px (Normalized)`,
      'Height': `${h}px (Normalized)`,
      'Scale Factor': scale.toFixed(3),
      'Timing': `${debug.timings?.preprocess?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 2. Filtered / Cleaned Mask
  const filteredMaskUrl = await generateScreenshot(debug.filteredMask, w, h, 'filtered');
  const componentsGeometry = { polygons: [], lines: [], points: [] };
  const screenshotComponents = [];

  if (debug.rawComponents) {
    debug.rawComponents.forEach((comp) => {
      const bbox = comp.bbox;
      const polyPoints = [
        { x: bbox.minX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.maxY },
        { x: bbox.minX, y: bbox.maxY },
      ];
      
      const isKept = debug.filteredComponents?.some((fc) => fc.id === comp.id);
      
      // Bounding box mapped coordinates for main canvas
      componentsGeometry.polygons.push({
        id: `comp-${comp.id}`,
        points: polyPoints.map(mapPt),
        label: `Comp ${comp.id} (size: ${comp.size})`,
        type: isKept ? 'temporary' : 'rejected',
        properties: {
          'Component ID': comp.id,
          'Size (pixels)': comp.size,
          'Bounding Box': `(${bbox.minX},${bbox.minY}) to (${bbox.maxX},${bbox.maxY})`,
          'Status': isKept ? 'Kept' : 'Rejected (noise/text)',
        }
      });

      // Bounding box normalized coordinates for screenshot
      screenshotComponents.push({
        type: 'polygon',
        points: polyPoints,
        class: isKept ? 'temporary' : 'rejected'
      });
    });
  }

  const componentsScreenshotUrl = await generateScreenshot(debug.filteredMask, w, h, 'filtered', screenshotComponents);

  stages.push({
    id: 'filtered',
    name: '2. Noise & Text Filtered Mask',
    maskUrl: null,
    images: [
      { name: 'Cleaned Wall Mask', url: filteredMaskUrl },
      { name: 'Classified Noise & Text Bounds', url: componentsScreenshotUrl }
    ],
    geometry: componentsGeometry,
    explanation: {
      seeing: 'A cleaned mask overlay where small noise components, labels, and text characters have been filtered out (shown as red/rejected bounding boxes).',
      expected: 'Major structural wall components should remain intact. Non-wall elements (dimensions, labels, stairs) should be successfully removed.'
    },
    metadata: {
      'Stage Name': 'Cleaned Wall Components',
      'Raw Components': debug.rawComponents?.length ?? 'N/A',
      'Kept Components': debug.filteredComponents?.length ?? 'N/A',
      'Timing': `${debug.timings?.wallMask?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 3. Closed Mask
  const closedMaskUrl = await generateScreenshot(debug.closedMask, w, h, 'closed');
  stages.push({
    id: 'closed',
    name: '3. Morphologically Closed Mask',
    maskUrl: null,
    images: [
      { name: 'Closed Wall Gaps', url: closedMaskUrl }
    ],
    geometry: { polygons: [], lines: [], points: [] },
    explanation: {
      seeing: 'The binarized walls after morphological closing, which dilates (thickens) and then erodes wall components to seal small openings.',
      expected: 'Windows, doors, and tiny graphical gaps should be completely closed to prevent the room flood fill from leaking into other areas.'
    },
    metadata: {
      'Stage Name': 'Morphological Closing',
      'Closing Radius': `${debug.closeRadius}px`,
      'Timing': `${debug.timings?.traceExterior?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 4. Room Flood Filled Mask
  const roomMaskUrl = await generateScreenshot(debug.roomMask, w, h, 'room');
  const seedGeometry = { polygons: [], lines: [], points: [] };
  const screenshotSeed = [];

  if (debug.seed) {
    const mappedSeed = mapPt(debug.seed);
    seedGeometry.points.push({
      id: 'flood-seed',
      x: mappedSeed.x,
      y: mappedSeed.y,
      label: 'Flood Fill Seed',
      type: 'temporary',
      properties: {
        'Seed Coordinates': formatPoint(mappedSeed),
        'Leak Detected': debug.leakDetected ? 'YES (Adaptive closing applied)' : 'NO (Successfully sealed)',
      }
    });

    screenshotSeed.push({
      type: 'point',
      x: debug.seed.x,
      y: debug.seed.y,
      class: 'final'
    });
  }

  const seedScreenshotUrl = await generateScreenshot(debug.closedMask, w, h, 'closed', screenshotSeed);

  stages.push({
    id: 'floodFilled',
    name: '4. Flood-Filled Room',
    maskUrl: null,
    images: [
      { name: 'Room Flood Fill Region', url: roomMaskUrl },
      { name: 'Room Click Seed Point', url: seedScreenshotUrl }
    ],
    geometry: seedGeometry,
    explanation: {
      seeing: 'The active room chamber flooded using a 4-neighbor queue starting from your click (the blue seed point), overlaid in green.',
      expected: 'The green flood area should completely fill the room up to the structural walls. If it overflows into other rooms, a boundary leak occurred.'
    },
    metadata: {
      'Stage Name': 'Room Flood Fill',
      'Leak Detected': debug.leakDetected ? 'Yes (Retried with larger radius)' : 'No',
      'Timing': `${debug.timings?.detectRoom?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 5. Raw Traced Polygon
  const rawRoomPoly = mapPoly(debug.rawRoomPolygon);
  const rawPolyGeometry = { polygons: [], lines: [], points: [] };
  const screenshotRawPoly = [];

  if (rawRoomPoly.length >= 3) {
    rawPolyGeometry.polygons.push({
      id: 'raw-room-poly',
      points: rawRoomPoly,
      label: 'Raw Room Boundary Trace',
      type: 'temporary',
      properties: {
        'Vertices': rawRoomPoly.length,
      }
    });
    rawRoomPoly.forEach((pt, i) => {
      rawPolyGeometry.points.push({
        id: `raw-room-vertex-${i}`,
        x: pt.x,
        y: pt.y,
        label: `Vertex ${i}`,
        type: 'temporary',
        properties: {
          'Index': i,
          'Coordinates': formatPoint(pt),
        }
      });
    });

    screenshotRawPoly.push({
      type: 'polygon',
      points: debug.rawRoomPolygon,
      class: 'interior'
    });
    debug.rawRoomPolygon.forEach((pt) => {
      screenshotRawPoly.push({
        type: 'point',
        x: pt.x,
        y: pt.y,
        class: 'interior'
      });
    });
  }

  const rawPolyScreenshotUrl = await generateScreenshot(debug.roomMask, w, h, 'room', screenshotRawPoly);

  stages.push({
    id: 'rawPolygon',
    name: '5. Raw Boundary Tracing',
    maskUrl: null,
    images: [
      { name: 'Raw Moore Contour Outline', url: rawPolyScreenshotUrl }
    ],
    geometry: rawPolyGeometry,
    explanation: {
      seeing: 'The raw polygon boundary generated by tracing the contours of the green flood-filled room component using Moore Boundary Tracing.',
      expected: 'A continuous, un-simplified outline wrapping the exact pixel boundary of the room. The polygon will appear jagged and follow pixel diagonals.'
    },
    metadata: {
      'Stage Name': 'Moore Boundary Tracing',
      'Raw Vertex Count': rawRoomPoly.length,
    },
    timestamp: Date.now(),
  });

  // 6. Snapped & Final Solution
  const snappedRoomPoly = mapPoly(debug.snappedRoomPolygon);
  const snappedPolyGeometry = { polygons: [], lines: [], points: [] };
  const screenshotSnappedPoly = [];

  if (snappedRoomPoly.length >= 3) {
    snappedPolyGeometry.polygons.push({
      id: 'snapped-room-poly',
      points: snappedRoomPoly,
      label: 'Snapped Room Wall Solution',
      type: 'final',
      properties: {
        'Final Vertices': snappedRoomPoly.length,
        'Dominant Angles': debug.dominantAngles?.join(', ') || 'N/A',
      }
    });

    screenshotSnappedPoly.push({
      type: 'polygon',
      points: debug.snappedRoomPolygon,
      class: 'final'
    });

    for (let i = 0; i < snappedRoomPoly.length; i++) {
      const p1 = snappedRoomPoly[i];
      const p2 = snappedRoomPoly[(i + 1) % snappedRoomPoly.length];
      const len = calculateDistance(p1, p2);
      const angle = calculateAngle(p1, p2);
      
      snappedPolyGeometry.lines.push({
        id: `wall-edge-${i}`,
        start: p1,
        end: p2,
        label: `Wall Edge ${i} (${Math.round(len)}px, ${Math.round(angle)}°)`,
        type: 'final',
        properties: {
          'Edge Index': i,
          'Length (pixels)': Math.round(len),
          'Angle (degrees)': `${angle.toFixed(1)}°`,
          'Start Vertex': formatPoint(p1),
          'End Vertex': formatPoint(p2),
        }
      });

      screenshotSnappedPoly.push({
        type: 'line',
        start: debug.snappedRoomPolygon[i],
        end: debug.snappedRoomPolygon[(i + 1) % debug.snappedRoomPolygon.length],
        class: 'final'
      });
    }

    snappedRoomPoly.forEach((pt, i) => {
      snappedPolyGeometry.points.push({
        id: `final-vertex-${i}`,
        x: pt.x,
        y: pt.y,
        label: `Vertex ${i}`,
        type: 'final',
        properties: {
          'Index': i,
          'Coordinates': formatPoint(pt),
          'Connected Edges': `${i === 0 ? snappedRoomPoly.length - 1 : i - 1} and ${i}`,
        }
      });

      screenshotSnappedPoly.push({
        type: 'point',
        x: debug.snappedRoomPolygon[i].x,
        y: debug.snappedRoomPolygon[i].y,
        class: 'final'
      });
    });
  }

  const finalCleanScreenshotUrl = await generateScreenshot(null, w, h, null, screenshotSnappedPoly);
  const finalAlignedScreenshotUrl = await generateScreenshot(debug.filteredMask, w, h, 'filtered', screenshotSnappedPoly);

  stages.push({
    id: 'finalSolution',
    name: '6. Final Snapped Wall Solution',
    maskUrl: null,
    images: [
      { name: 'Final Wall Trace Geometry', url: finalCleanScreenshotUrl },
      { name: 'Traces Aligned to Wall Mask', url: finalAlignedScreenshotUrl }
    ],
    geometry: snappedPolyGeometry,
    explanation: {
      seeing: 'The final, grid-aligned wall tracing mapped back to original coordinates, with simplified segments and snap-locked wall angles.',
      expected: 'A clean room outline following the blueprint lines. The walls should snap orthogonally (0°/90°/180°) and vertices should align cleanly.'
    },
    metadata: {
      'Stage Name': 'Snapped Wall Solver',
      'Final Vertices': snappedRoomPoly.length,
      'Dominant Angles': debug.dominantAngles?.join('°, ') + '°' || 'N/A',
      'Total Timing': `${debug.timings?.total?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  return stages;
};

/**
 * Compile stages list for Boundary Tracing.
 */
export const buildBoundaryDebugStages = async (debug, generateScreenshot) => {
  const stages = [];
  const scale = debug.scale ?? 1.0;
  const w = debug.normalizedSize.width;
  const h = debug.normalizedSize.height;

  const mapPt = (pt) => ({ x: pt.x / scale, y: pt.y / scale });
  const mapPoly = (poly) => (poly ? poly.map(mapPt) : []);

  // 1. Raw Thresholded Mask
  const thresholdedMaskUrl = await generateScreenshot(debug.thresholdedMask, w, h, 'thresholded');
  stages.push({
    id: 'thresholded',
    name: '1. Raw Thresholded Mask',
    maskUrl: null,
    images: [
      { name: 'Raw Binarized Wall Pixels', url: thresholdedMaskUrl }
    ],
    geometry: { polygons: [], lines: [], points: [] },
    explanation: {
      seeing: 'A raw binary black-and-white mask of the floor plan where all pixels darker than the global threshold are binarized as wall candidates.',
      expected: 'All walls should appear as dark foreground pixels. Text elements, dimensional lines, and other non-wall markings will also be present at this stage.'
    },
    metadata: {
      'Stage Name': 'Thresholded Walls',
      'Width': `${w}px`,
      'Height': `${h}px`,
      'Scale Factor': scale.toFixed(3),
      'Timing': `${debug.timings?.preprocess?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 2. Filtered / Cleaned Mask
  const filteredMaskUrl = await generateScreenshot(debug.filteredMask, w, h, 'filtered');
  const componentsGeometry = { polygons: [], lines: [], points: [] };
  const screenshotComponents = [];

  if (debug.rawComponents) {
    debug.rawComponents.forEach((comp) => {
      const bbox = comp.bbox;
      const polyPoints = [
        { x: bbox.minX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.minY },
        { x: bbox.maxX, y: bbox.maxY },
        { x: bbox.minX, y: bbox.maxY },
      ];
      
      const isKept = debug.filteredComponents?.some((fc) => fc.id === comp.id);
      componentsGeometry.polygons.push({
        id: `comp-${comp.id}`,
        points: polyPoints.map(mapPt),
        label: `Comp ${comp.id} (size: ${comp.size})`,
        type: isKept ? 'temporary' : 'rejected',
        properties: {
          'Component ID': comp.id,
          'Size': comp.size,
          'Status': isKept ? 'Kept' : 'Rejected',
        }
      });

      screenshotComponents.push({
        type: 'polygon',
        points: polyPoints,
        class: isKept ? 'temporary' : 'rejected'
      });
    });
  }

  const componentsScreenshotUrl = await generateScreenshot(debug.filteredMask, w, h, 'filtered', screenshotComponents);

  stages.push({
    id: 'filtered',
    name: '2. Noise & Text Filtered Mask',
    maskUrl: null,
    images: [
      { name: 'Cleaned Wall Mask', url: filteredMaskUrl },
      { name: 'Classified Component Bounds', url: componentsScreenshotUrl }
    ],
    geometry: componentsGeometry,
    explanation: {
      seeing: 'A cleaned mask overlay where small noise components, labels, and text characters have been filtered out (shown as red/rejected bounding boxes).',
      expected: 'Major structural wall components should remain intact. Non-wall elements (dimensions, labels, stairs) should be successfully removed.'
    },
    metadata: {
      'Stage Name': 'Cleaned Wall Components',
      'Raw Components Count': debug.rawComponents?.length ?? 'N/A',
      'Kept Components Count': debug.filteredComponents?.length ?? 'N/A',
      'Timing': `${debug.timings?.wallMask?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 3. Closed Mask
  const closedMaskUrl = await generateScreenshot(debug.closedMask, w, h, 'closed');
  stages.push({
    id: 'closed',
    name: '3. Morphologically Closed Mask',
    maskUrl: null,
    images: [
      { name: 'Closed Wall Gaps', url: closedMaskUrl }
    ],
    geometry: { polygons: [], lines: [], points: [] },
    explanation: {
      seeing: 'The binarized walls after morphological closing, which dilates (thickens) and then erodes wall components to seal small openings.',
      expected: 'Windows, doors, and tiny graphical gaps should be completely closed to form a single continuous building envelope.'
    },
    metadata: {
      'Stage Name': 'Morphological Closing',
      'Closing Radius': `${debug.closeRadius}px`,
      'Timing': `${debug.timings?.traceExterior?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  // 4. Exterior Footprint Mask
  const footprintMaskUrl = await generateScreenshot(debug.footprintMask, w, h, 'footprint');
  stages.push({
    id: 'footprint',
    name: '4. Footprint Mask',
    maskUrl: null,
    images: [
      { name: 'Building Footprint', url: footprintMaskUrl }
    ],
    geometry: { polygons: [], lines: [], points: [] },
    explanation: {
      seeing: 'The building footprint mask representing the interior space (shown in indigo), computed by flooding outward from the page edges.',
      expected: 'A solid indigo shape fully filling the interior building footprint. The background page outside should be empty/clear.'
    },
    metadata: {
      'Stage Name': 'Exterior Building Footprint',
      'Wall Thickness Estimation': `${debug.wallThickness}px`,
    },
    timestamp: Date.now(),
  });

  // 5. Raw Traced Boundaries
  const rawOuter = mapPoly(debug.rawOuterPolygon);
  const rawInner = mapPoly(debug.rawInnerPolygon);
  const rawBoundariesGeometry = { polygons: [], lines: [], points: [] };
  const screenshotRawBounds = [];

  if (rawOuter.length >= 3) {
    rawBoundariesGeometry.polygons.push({
      id: 'raw-outer-boundary',
      points: rawOuter,
      label: 'Raw Outer Boundary Trace',
      type: 'exterior',
      properties: {
        'Vertices': rawOuter.length,
        'Type': 'Exterior Footprint Edge',
      }
    });

    screenshotRawBounds.push({
      type: 'polygon',
      points: debug.rawOuterPolygon,
      class: 'exterior'
    });
  }

  if (rawInner.length >= 3) {
    rawBoundariesGeometry.polygons.push({
      id: 'raw-inner-boundary',
      points: rawInner,
      label: 'Raw Inner Boundary Trace',
      type: 'interior',
      properties: {
        'Vertices': rawInner.length,
        'Type': 'Interior Wall Edge',
      }
    });

    screenshotRawBounds.push({
      type: 'polygon',
      points: debug.rawInnerPolygon,
      class: 'interior'
    });
  }

  const rawBoundsScreenshotUrl = await generateScreenshot(debug.footprintMask, w, h, 'footprint', screenshotRawBounds);

  stages.push({
    id: 'rawBoundaries',
    name: '5. Raw Boundaries Tracing',
    maskUrl: null,
    images: [
      { name: 'Raw Moore Boundaries Traces', url: rawBoundsScreenshotUrl }
    ],
    geometry: rawBoundariesGeometry,
    explanation: {
      seeing: 'The raw contours traced along the outer footprint edge (shown in purple) and eroded inner walls (shown in cyan) before simplification.',
      expected: 'Continuous outline paths enclosing the perimeter. Lines will look jagged and follow individual pixels.'
    },
    metadata: {
      'Stage Name': 'Footprint Boundary Tracing',
      'Outer Raw Vertices': rawOuter.length,
      'Inner Raw Vertices': rawInner.length,
    },
    timestamp: Date.now(),
  });

  // 6. Snapped & Final Solution
  const snappedOuter = mapPoly(debug.snappedOuterPolygon);
  const snappedInner = mapPoly(debug.snappedInnerPolygon);
  const snappedBoundariesGeometry = { polygons: [], lines: [], points: [] };
  const screenshotSnappedBounds = [];

  if (snappedOuter.length >= 3) {
    snappedBoundariesGeometry.polygons.push({
      id: 'final-outer-boundary',
      points: snappedOuter,
      label: 'Final Snapped Outer Boundary',
      type: 'exterior',
      properties: {
        'Vertices': snappedOuter.length,
        'Type': 'Exterior Walls',
      }
    });

    screenshotSnappedBounds.push({
      type: 'polygon',
      points: debug.snappedOuterPolygon,
      class: 'exterior'
    });

    for (let i = 0; i < snappedOuter.length; i++) {
      const p1 = snappedOuter[i];
      const p2 = snappedOuter[(i + 1) % snappedOuter.length];
      const len = calculateDistance(p1, p2);
      const angle = calculateAngle(p1, p2);
      
      snappedBoundariesGeometry.lines.push({
        id: `outer-wall-edge-${i}`,
        start: p1,
        end: p2,
        label: `Exterior Edge ${i} (${Math.round(len)}px, ${Math.round(angle)}°)`,
        type: 'exterior',
        properties: {
          'Edge Index': i,
          'Length (pixels)': Math.round(len),
          'Angle (degrees)': `${angle.toFixed(1)}°`,
          'Start Vertex': formatPoint(p1),
          'End Vertex': formatPoint(p2),
        }
      });

      screenshotSnappedBounds.push({
        type: 'line',
        start: debug.snappedOuterPolygon[i],
        end: debug.snappedOuterPolygon[(i + 1) % debug.snappedOuterPolygon.length],
        class: 'exterior'
      });
    }

    snappedOuter.forEach((pt, i) => {
      snappedBoundariesGeometry.points.push({
        id: `outer-vertex-${i}`,
        x: pt.x,
        y: pt.y,
        label: `Exterior Vertex ${i}`,
        type: 'exterior',
        properties: {
          'Index': i,
          'Type': 'Exterior Vertex',
          'Coordinates': formatPoint(pt),
        }
      });

      screenshotSnappedBounds.push({
        type: 'point',
        x: debug.snappedOuterPolygon[i].x,
        y: debug.snappedOuterPolygon[i].y,
        class: 'exterior'
      });
    });
  }

  if (snappedInner.length >= 3) {
    snappedBoundariesGeometry.polygons.push({
      id: 'final-inner-boundary',
      points: snappedInner,
      label: 'Final Snapped Inner Boundary',
      type: 'interior',
      properties: {
        'Vertices': snappedInner.length,
        'Type': 'Interior Walls',
      }
    });

    screenshotSnappedBounds.push({
      type: 'polygon',
      points: debug.snappedInnerPolygon,
      class: 'interior'
    });

    for (let i = 0; i < snappedInner.length; i++) {
      const p1 = snappedInner[i];
      const p2 = snappedInner[(i + 1) % snappedInner.length];
      const len = calculateDistance(p1, p2);
      const angle = calculateAngle(p1, p2);
      
      snappedBoundariesGeometry.lines.push({
        id: `inner-wall-edge-${i}`,
        start: p1,
        end: p2,
        label: `Interior Edge ${i} (${Math.round(len)}px, ${Math.round(angle)}°)`,
        type: 'interior',
        properties: {
          'Edge Index': i,
          'Length (pixels)': Math.round(len),
          'Angle (degrees)': `${angle.toFixed(1)}°`,
          'Start Vertex': formatPoint(p1),
          'End Vertex': formatPoint(p2),
        }
      });

      screenshotSnappedBounds.push({
        type: 'line',
        start: debug.snappedInnerPolygon[i],
        end: debug.snappedInnerPolygon[(i + 1) % debug.snappedInnerPolygon.length],
        class: 'interior'
      });
    }

    snappedInner.forEach((pt, i) => {
      snappedBoundariesGeometry.points.push({
        id: `inner-vertex-${i}`,
        x: pt.x,
        y: pt.y,
        label: `Interior Vertex ${i}`,
        type: 'interior',
        properties: {
          'Index': i,
          'Type': 'Interior Vertex',
          'Coordinates': formatPoint(pt),
        }
      });

      screenshotSnappedBounds.push({
        type: 'point',
        x: debug.snappedInnerPolygon[i].x,
        y: debug.snappedInnerPolygon[i].y,
        class: 'interior'
      });
    });
  }

  const finalCleanScreenshotUrl = await generateScreenshot(null, w, h, null, screenshotSnappedBounds);
  const finalAlignedScreenshotUrl = await generateScreenshot(debug.footprintMask, w, h, 'footprint', screenshotSnappedBounds);

  stages.push({
    id: 'finalSolution',
    name: '6. Final Snapped Boundaries Solution',
    maskUrl: null,
    images: [
      { name: 'Final Boundaries Geometry', url: finalCleanScreenshotUrl },
      { name: 'Trace Aligned to Footprint', url: finalAlignedScreenshotUrl }
    ],
    geometry: snappedBoundariesGeometry,
    explanation: {
      seeing: 'The final, grid-aligned inner and outer boundaries mapped to original scale, simplified, and locked to the dominant floor plan orientations.',
      expected: 'Clean concentric outlines representing the interior and exterior wall lines. Both traces should snap orthogonally (0°/90°/180°).'
    },
    metadata: {
      'Stage Name': 'Boundary Wall Solver',
      'Wall Thickness': `${debug.wallThickness}px`,
      'Dominant Angles': debug.dominantAngles?.join('°, ') + '°' || 'N/A',
      'Total Timing': `${debug.timings?.total?.toFixed(1) ?? 'N/A'}ms`,
    },
    timestamp: Date.now(),
  });

  return stages;
};
