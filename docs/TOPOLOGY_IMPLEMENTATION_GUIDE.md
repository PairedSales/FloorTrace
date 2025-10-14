# Topology-Guided Line Merging Implementation Guide

## Overview

Complete implementation of a topology-guided wall detection and merging system for FloorTrace. This system replaces previous approaches with a fresh, comprehensive solution based on computational geometry and graph theory.

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Image Input                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Segment Detection (segmentDetection.js)            │
│  - OpenCV Canny + Hough Transform                            │
│  - Returns: Array of {x1, y1, x2, y2, length, angle}        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Topology Graph (topologyGraph.js)                  │
│  - Build nodes from endpoints                                │
│  - Create adjacency relationships                            │
│  - Detect parallel/collinear pairs                           │
│  - Identify junctions                                         │
│  - Returns: {nodes, edges, adjacency, spatialIndex}         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 3: Line Merging (lineMerging.js)                      │
│  - Traverse connected collinear segments                     │
│  - Build chains with confidence scores                        │
│  - Snap endpoints, bridge gaps                               │
│  - Returns: Array of merged chains                           │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 4: Wall Classification (wallClassifier.js)            │
│  - Filter by length and confidence                           │
│  - Assign wall types and orientations                        │
│  - Compute quality scores                                    │
│  - Returns: Array of classified walls                        │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│  Step 5: Visualization (WallGraphOverlay.jsx)               │
│  - React-Konva rendering                                     │
│  - Interactive wall selection                                │
│  - Debug overlay options                                     │
└─────────────────────────────────────────────────────────────┘
```

## File Structure

```
FloorTrace/
├── src/
│   ├── utils/
│   │   ├── geometryUtils.js           # Core geometric functions
│   │   ├── segmentDetection.js        # OpenCV-based line detection
│   │   ├── topologyGraph.js           # Graph construction
│   │   ├── lineMerging.js             # Chain building
│   │   ├── wallClassifier.js          # Wall validation & classification
│   │   ├── testUtils.js               # Testing utilities
│   │   ├── testSetup.js               # Vitest configuration
│   │   ├── geometryUtils.test.js      # Unit tests
│   │   ├── topologyGraph.test.js      # Unit tests
│   │   ├── lineMerging.test.js        # Unit tests
│   │   ├── wallClassifier.test.js     # Unit tests
│   │   └── topology.integration.test.js # Integration tests
│   ├── hooks/
│   │   └── useWallTopology.js         # React hook orchestration
│   └── components/
│       └── WallGraphOverlay.jsx       # Visualization component
├── vitest.config.js
├── TOPOLOGY_TESTING.md
└── TOPOLOGY_IMPLEMENTATION_GUIDE.md
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
npm install --save-dev vitest @vitest/ui jsdom
```

### 2. Basic Usage

```javascript
import { useWallTopology } from './hooks/useWallTopology';
import { WallGraphOverlay } from './components/WallGraphOverlay';

function FloorPlanAnalyzer() {
  const {
    walls,
    graph,
    statistics,
    isLoading,
    runTopologyAnalysis
  } = useWallTopology();
  
  const handleImageLoad = async (image) => {
    await runTopologyAnalysis(image);
  };
  
  return (
    <div>
      {isLoading && <p>Analyzing...</p>}
      
      <Stage width={800} height={600}>
        <WallGraphOverlay
          walls={walls}
          graph={graph}
          showWalls={true}
          showJunctions={true}
        />
      </Stage>
      
      {statistics && (
        <div>
          <h3>Results</h3>
          <p>Walls detected: {statistics.count}</p>
          <p>Total length: {Math.round(statistics.totalLength)}px</p>
        </div>
      )}
    </div>
  );
}
```

### 3. Run Tests

```bash
# All tests
npm test

# With UI
npm test:ui

# With coverage
npm test:coverage

# Integration tests only
npm test:integration
```

## Module Details

### geometryUtils.js

Core geometric utility functions used throughout the system.

**Key Functions:**
- `distance(p1, p2)` - Euclidean distance
- `lineAngle(line)` - Line angle in radians
- `angleBetween(line1, line2)` - Angle difference (0-90°)
- `isCollinear(line1, line2, options)` - Collinearity check
- `isParallel(line1, line2, tolerance)` - Parallel check
- `pointToLineDistance(point, line)` - Perpendicular distance
- `getOrientation(line)` - 'horizontal', 'vertical', or 'diagonal'

**Example:**
```javascript
import { isCollinear, angleBetween } from './utils/geometryUtils';

const line1 = { x1: 0, y1: 0, x2: 100, y2: 0 };
const line2 = { x1: 105, y1: 0, x2: 200, y2: 0 };

const collinear = isCollinear(line1, line2, {
  angleTolerance: 5,
  distanceTolerance: 10
});

const angle = angleBetween(line1, line2); // ~0 degrees
```

### segmentDetection.js

OpenCV.js-based line segment detection using Canny edge detection and Hough Transform.

**Key Functions:**
- `loadOpenCV()` - Dynamically load OpenCV.js
- `detectSegments(cv, imageMat, options)` - Detect segments from image
- `detectSegmentsFromImage(source, options)` - Convenience wrapper
- `deduplicateSegments(segments)` - Remove duplicates

**Options:**
```javascript
{
  cannyLow: 50,           // Canny low threshold
  cannyHigh: 150,         // Canny high threshold
  houghThreshold: 50,     // Hough accumulator threshold
  minLineLength: 30,      // Minimum line length
  maxLineGap: 10,         // Max gap between segments
  blurKernel: 5,          // Gaussian blur kernel
  minSegmentLength: 15    // Filter segments below this
}
```

**Example:**
```javascript
import { detectSegmentsFromImage } from './utils/segmentDetection';

const image = document.getElementById('floorplan');
const segments = await detectSegmentsFromImage(image, {
  cannyLow: 50,
  cannyHigh: 150,
  minLineLength: 30
});

console.log(`Detected ${segments.length} segments`);
```

### topologyGraph.js

Build adjacency graph representing connectivity between segments.

**Key Functions:**
- `buildTopologyGraph(segments, options)` - Build complete graph
- `getNeighbors(graph, nodeId)` - Get node neighbors
- `findConnectedComponents(graph)` - Find disconnected components
- `findPath(graph, startId, endId)` - BFS pathfinding

**Graph Structure:**
```javascript
{
  nodes: [{ id, x, y, segments: [] }],
  edges: [{ id, startNode, endNode, segment, length, angle }],
  adjacency: Map<nodeId, [neighborIds]>,
  parallelPairs: [{ seg1, seg2, angle }],
  collinearPairs: [{ seg1, seg2, angle }],
  junctions: [{ nodeId, x, y, degree, type }],
  spatialIndex: { querySegments(), queryNodes() },
  metadata: { nodeCount, edgeCount, ... }
}
```

**Example:**
```javascript
import { buildTopologyGraph, findConnectedComponents } from './utils/topologyGraph';

const graph = buildTopologyGraph(segments, {
  endpointTolerance: 8,
  parallelTolerance: 5
});

console.log(`Graph has ${graph.nodes.length} nodes`);
console.log(`Found ${graph.junctions.length} junctions`);

const components = findConnectedComponents(graph);
console.log(`${components.length} disconnected components`);
```

### lineMerging.js

Merge connected and collinear segments into wall chains.

**Key Functions:**
- `mergeLines(segments, graph, options)` - Main merging function
- `chainsToLines(chains)` - Convert to simple line format
- `getChainPoints(chain)` - Get flat point array for rendering

**Chain Structure:**
```javascript
{
  id: 'chain_0',
  segments: [originalSegments],
  merged: { x1, y1, x2, y2, length, angle },
  orientation: 'horizontal' | 'vertical' | 'diagonal',
  length: 150.5,
  confidence: 0.87
}
```

**Example:**
```javascript
import { mergeLines } from './utils/lineMerging';

const chains = mergeLines(segments, graph, {
  angleTolerance: 5,
  gapTolerance: 8,
  mergeCollinear: true,
  snapEndpoints: true
});

chains.forEach(chain => {
  console.log(`Chain ${chain.id}: ${chain.segments.length} segments merged`);
  console.log(`  Length: ${chain.length.toFixed(1)}px`);
  console.log(`  Confidence: ${(chain.confidence * 100).toFixed(1)}%`);
});
```

### wallClassifier.js

Classify and validate wall structures.

**Key Functions:**
- `classifyWalls(chains, graph, options)` - Main classification
- `filterWallsByOrientation(walls, orientations)` - Filter by orientation
- `getWallStatistics(walls)` - Compute statistics
- `rankWallsByImportance(walls)` - Sort by importance

**Wall Structure:**
```javascript
{
  id: 'wall_0',
  chain: { x1, y1, x2, y2 },
  segments: [originalSegments],
  orientation: 'horizontal' | 'vertical' | 'diagonal',
  type: 'corridor' | 'junction' | 'isolated' | ...,
  length: 150.5,
  confidence: 0.87,
  quality: 0.75,
  thickness: 5.2,
  connectivityDegree: 3,
  segmentCount: 4
}
```

**Example:**
```javascript
import { classifyWalls, getWallStatistics } from './utils/wallClassifier';

const walls = classifyWalls(chains, graph, {
  minLength: 25,
  minConfidence: 0.3,
  filterIsolated: false,
  computeThickness: true,
  mergeParallel: true
});

const stats = getWallStatistics(walls);
console.log(`Detected ${stats.count} walls`);
console.log(`Average length: ${stats.avgLength.toFixed(1)}px`);
console.log(`Orientations:`, stats.orientations);
```

### useWallTopology.js

React hook for orchestrating the complete pipeline.

**Hook API:**
```javascript
const {
  // State
  isLoading,
  progress,          // 0-100
  error,
  segments,
  graph,
  chains,
  walls,
  statistics,
  debugData,
  
  // Methods
  runTopologyAnalysis,  // (imageSource) => Promise
  runStep,              // (step, input) => Promise
  reset,
  abort,
  updateConfig,
  
  // Utilities
  hasResults,
  isReady
} = useWallTopology(options);
```

**Example:**
```javascript
import { useWallTopology } from './hooks/useWallTopology';

function MyComponent() {
  const {
    walls,
    statistics,
    isLoading,
    progress,
    runTopologyAnalysis
  } = useWallTopology({
    cannyLow: 50,
    cannyHigh: 150,
    minWallLength: 30,
    minConfidence: 0.5
  });
  
  const handleAnalyze = async (image) => {
    try {
      const result = await runTopologyAnalysis(image);
      console.log('Analysis complete:', result);
    } catch (err) {
      console.error('Analysis failed:', err);
    }
  };
  
  return (
    <div>
      {isLoading && <ProgressBar value={progress} />}
      {statistics && <StatsDisplay stats={statistics} />}
    </div>
  );
}
```

### WallGraphOverlay.jsx

React-Konva visualization components.

**Components:**
- `WallGraphOverlay` - Main visualization layer
- `DebugTopologyOverlay` - Debug visualization
- `TopologyStatsPanel` - Statistics panel
- `TopologyControlPanel` - Visibility controls
- `WallDetailPanel` - Wall detail view

**Example:**
```javascript
import { Stage, Layer } from 'react-konva';
import {
  WallGraphOverlay,
  TopologyStatsPanel,
  TopologyControlPanel
} from './components/WallGraphOverlay';

function Visualizer({ walls, graph, statistics }) {
  const [config, setConfig] = useState({
    showSegments: false,
    showWalls: true,
    showNodes: false,
    showJunctions: true,
    showLabels: false,
    opacity: 0.9
  });
  
  const [selectedWall, setSelectedWall] = useState(null);
  
  return (
    <div>
      <Stage width={1024} height={768}>
        <Layer>
          <Image src={floorplanImage} />
        </Layer>
        
        <WallGraphOverlay
          walls={walls}
          graph={graph}
          {...config}
          onWallClick={setSelectedWall}
          selectedWallId={selectedWall?.id}
        />
      </Stage>
      
      <TopologyControlPanel
        config={config}
        onChange={setConfig}
      />
      
      <TopologyStatsPanel
        statistics={statistics}
      />
    </div>
  );
}
```

## Configuration Guide

### Segment Detection Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `cannyLow` | 50 | Lower Canny threshold (higher = fewer edges) |
| `cannyHigh` | 150 | Upper Canny threshold |
| `houghThreshold` | 50 | Hough accumulator threshold (higher = fewer lines) |
| `minLineLength` | 30 | Minimum line length in pixels |
| `maxLineGap` | 10 | Max gap to bridge between segments |
| `minSegmentLength` | 15 | Filter segments shorter than this |

**Tuning Tips:**
- High noise: Increase `cannyLow` and `houghThreshold`
- Missing walls: Decrease `cannyLow` and `minLineLength`
- Too many segments: Increase `minSegmentLength` and `houghThreshold`

### Graph Building Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `endpointTolerance` | 8 | Max distance to merge endpoints |
| `parallelTolerance` | 5 | Max angle for parallel detection (degrees) |
| `collinearTolerance` | `{angleTolerance: 5, distanceTolerance: 10}` | Collinearity thresholds |

### Line Merging Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `angleTolerance` | 5 | Max angle difference for merging (degrees) |
| `gapTolerance` | 8 | Max gap to bridge between segments |
| `mergeCollinear` | true | Enable collinear merging |
| `snapEndpoints` | true | Snap nearby endpoints |

### Wall Classification Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `minLength` | 25 | Minimum wall length |
| `minConfidence` | 0.3 | Minimum confidence score |
| `filterIsolated` | false | Remove isolated walls |
| `computeThickness` | true | Estimate wall thickness |
| `mergeParallel` | true | Merge redundant parallel walls |

## Performance Optimization

### 1. Spatial Indexing

The topology graph includes a spatial index for fast queries:

```javascript
const nearSegments = graph.spatialIndex.querySegments(x, y, radius);
const nearNodes = graph.spatialIndex.queryNodes(x, y, radius);
```

### 2. Caching

Cache OpenCV loading:

```javascript
let cachedCV = null;

async function getCV() {
  if (!cachedCV) {
    cachedCV = await loadOpenCV();
  }
  return cachedCV;
}
```

### 3. Progressive Processing

Process large images in chunks or use lower resolution:

```javascript
// Downscale for detection
const scale = 0.5;
const smallCanvas = downscale(originalCanvas, scale);
const segments = await detectSegmentsFromImage(smallCanvas);

// Scale segments back up
const fullSegments = segments.map(seg => ({
  x1: seg.x1 / scale,
  y1: seg.y1 / scale,
  x2: seg.x2 / scale,
  y2: seg.y2 / scale,
  ...
}));
```

## Common Issues & Solutions

### Issue: OpenCV Not Loading

**Solution:** Ensure OpenCV.js is accessible:

```javascript
// Option 1: CDN (auto-loaded by segmentDetection.js)
// Option 2: Local copy
<script src="/opencv.js"></script>

// Option 3: Check loading
const cv = await loadOpenCV();
console.log('OpenCV version:', cv.getBuildInformation());
```

### Issue: No Segments Detected

**Solutions:**
1. Lower `cannyLow` threshold (try 30)
2. Lower `houghThreshold` (try 30)
3. Reduce `minLineLength` (try 20)
4. Check image quality and contrast

### Issue: Too Many Segments

**Solutions:**
1. Increase `cannyLow` threshold (try 70)
2. Increase `houghThreshold` (try 70)
3. Increase `minSegmentLength` (try 25)
4. Use `deduplicateSegments()`

### Issue: Walls Not Merging

**Solutions:**
1. Increase `gapTolerance` (try 15)
2. Increase `angleTolerance` (try 10)
3. Increase `endpointTolerance` (try 12)
4. Check if segments are truly collinear

### Issue: Performance Slow

**Solutions:**
1. Reduce image resolution before detection
2. Increase segment filtering thresholds
3. Disable unused features (e.g., `computeThickness: false`)
4. Use spatial index for large datasets

## Advanced Usage

### Custom Pipeline

Run individual steps with custom logic:

```javascript
import { detectSegmentsFromImage } from './utils/segmentDetection';
import { buildTopologyGraph } from './utils/topologyGraph';
import { mergeLines } from './utils/lineMerging';
import { classifyWalls } from './utils/wallClassifier';

// Step 1: Detect
const segments = await detectSegmentsFromImage(image);

// Custom filtering
const filteredSegments = segments.filter(s => s.length > 50);

// Step 2: Graph
const graph = buildTopologyGraph(filteredSegments);

// Custom graph analysis
console.log('Junctions:', graph.junctions);

// Step 3: Merge
const chains = mergeLines(filteredSegments, graph);

// Step 4: Classify
const walls = classifyWalls(chains, graph);

// Custom post-processing
const importantWalls = walls.filter(w => w.quality > 0.7);
```

### Export Results

```javascript
import { exportWalls } from './utils/wallClassifier';
import { exportGraph } from './utils/topologyGraph';

// Export walls to JSON
const wallsJSON = JSON.stringify(exportWalls(walls));

// Export graph to JSON
const graphJSON = JSON.stringify(exportGraph(graph));

// Save to file
const blob = new Blob([wallsJSON], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'walls.json';
a.click();
```

## Next Steps

1. **Install dependencies**: `npm install`
2. **Run tests**: `npm test`
3. **Integrate into App**: Import `useWallTopology` hook
4. **Add visualization**: Use `WallGraphOverlay` component
5. **Customize parameters**: Adjust thresholds for your use case
6. **Test with real data**: Use ExampleFloorplan.png or your own images

## API Reference

See individual module documentation in source files for complete API details.

## Support

For issues or questions:
1. Check TOPOLOGY_TESTING.md for test examples
2. Review source code comments
3. Run integration tests to verify setup
4. Check browser console for errors
