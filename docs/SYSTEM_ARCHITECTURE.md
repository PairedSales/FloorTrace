# FloorTrace System Architecture

## 🎯 Wall Detection System: Topology-Guided Approach

### Executive Summary

FloorTrace uses a **Topology-Guided Line Merging and Adjacency Graph** system for wall detection. This approach:

1. ✅ **Detects line segments** using OpenCV Hough Transform
2. ✅ **Builds connectivity graph** with nodes, edges, and junctions
3. ✅ **Merges collinear segments** into wall chains
4. ✅ **Classifies walls** using geometric and topological constraints

This matches the project specification perfectly:
> "Topology-guided line merging / adjacency graph on detected segments. Start with a strong line segment detector, build a connectivity graph / adjacency structure, prune/merge/classify chains of segments using orientation, thickness, length, adjacency constraints."

---

## 📁 Active System Files

### Core Topology System

Located in `src/utils/`:

| File | Purpose |
|------|---------|
| `segmentDetection.js` | OpenCV Canny + Hough line detection |
| `topologyGraph.js` | Adjacency graph construction, junction detection |
| `lineMerging.js` | Collinear segment merging, chain building |
| `wallClassifier.js` | Wall validation, type/quality classification |
| `geometryUtils.js` | Distance, angles, collinearity calculations |
| `topologyRoomDetector.js` | Room detection using cycle detection |
| `topologyPerimeterTracer.js` | Perimeter tracing via connected components |

### React Integration

| File | Purpose |
|------|---------|
| `src/hooks/useWallTopology.js` | React hook orchestrator |
| `src/components/WallGraphOverlay.jsx` | Konva visualization |

### Testing

| File | Purpose |
|------|---------|
| `*.test.js` | Unit tests for each module |
| `topology.integration.test.js` | End-to-end integration tests |
| `testUtils.js` | Mock data generators |

---

## 🚀 Current Integration

### App.jsx (Production)

```javascript
// ✅ CORRECT - Current imports
import { detectRoom, detectAllDimensions } from './utils/topologyRoomDetector';
import { tracePerimeter, switchPerimeterEdge } from './utils/topologyPerimeterTracer';
```

**Status:** ✅ **Working correctly, no changes needed**

---

## 📊 Pipeline Flow

```
Image Input
    ↓
┌─────────────────────────────────────────────┐
│ 1. Segment Detection (segmentDetection.js) │
│    - OpenCV Canny edge detection           │
│    - Probabilistic Hough Transform         │
│    - Output: 100+ line segments            │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 2. Topology Graph (topologyGraph.js)       │
│    - Create nodes from endpoints           │
│    - Build adjacency relationships         │
│    - Detect junctions and connections      │
│    - Spatial indexing for performance      │
│    - Output: Graph with 50+ nodes          │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 3. Line Merging (lineMerging.js)           │
│    - Traverse connected segments           │
│    - Merge collinear chains                │
│    - Bridge small gaps                     │
│    - Confidence scoring                    │
│    - Output: 20+ wall chains               │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 4. Wall Classification (wallClassifier.js) │
│    - Length/confidence filtering           │
│    - Orientation constraints (H/V)         │
│    - Thickness estimation                  │
│    - Type assignment (exterior/interior)   │
│    - Output: 18+ classified walls          │
└─────────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────────┐
│ 5. Room/Perimeter Detection                │
│    - Cycle detection for rooms             │
│    - Connected components for perimeter    │
│    - Interior/exterior edge calculation    │
└─────────────────────────────────────────────┘
    ↓
Output: Walls, Rooms, Perimeter
```

---

## 🧪 Testing Strategy

### Test Patterns

```javascript
import { createMockSegments } from './utils/testUtils';

// Pre-defined test patterns
const simple = createMockSegments('simple');        // Basic square
const collinear = createMockSegments('collinear');  // Segment merging test
const parallel = createMockSegments('parallel');    // Parallel walls
const grid = createMockSegments('grid');            // Junction test
const complex = createMockSegments('complex');      // Real-world scenario
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage report
npm test:coverage

# Interactive UI
npm test:ui

# Integration tests only
npm test:integration
```

### Test Coverage

- ✅ **Unit Tests**: Each module independently tested
- ✅ **Integration Tests**: Full pipeline with all patterns
- ✅ **Edge Cases**: Empty, single segment, large datasets
- ✅ **Performance**: 500x500 grid in <1 second
- ✅ **Target Coverage**: 80%+ lines, functions, statements

---

## 📚 Documentation

### Primary Documentation (READ THESE)

1. **`TOPOLOGY_SYSTEM_README.md`** ⭐ **START HERE**
   - System overview
   - Quick start guide
   - Pipeline details
   - Test instructions

2. **`TOPOLOGY_IMPLEMENTATION_GUIDE.md`**
   - Detailed implementation
   - Algorithm explanations
   - API reference
   - Performance tuning

3. **`TOPOLOGY_TESTING.md`**
   - Test patterns
   - Test utilities
   - Coverage requirements
   - Debugging tips

4. **`TOPOLOGY_SNAPPING_GUIDE.md`**
   - Vertex snapping logic
   - Junction handling
   - Endpoint merging

### Secondary Documentation

- `WALL_DETECTION_SYSTEMS.md` - Comparison of systems
- `MIGRATION_GUIDE.md` - Migration from old systems
- `INTERIOR_EXTERIOR_EDGE_GUIDE.md` - Edge calculation

---

## ⚠️ About Alternative Systems

### Classical Wall Detection System

There is an alternative system in `wallDetector.js`, `roomDetector.js`, `perimeterDetector.js`.

**Status:** ⚠️ **NOT ACTIVE** - Not used by App.jsx

**Purpose:**
- Experimental alternative approach
- Uses classical image processing (no topology graph)
- Recently had CNN code removed
- Can be kept for experimentation but **should not be the focus**

**What NOT to do:**
- ❌ Don't switch App.jsx to use this system
- ❌ Don't prioritize its documentation
- ❌ Don't write production tests for it

---

## 🎯 Key Algorithms

### 1. Endpoint Merging (Topology Graph)

```javascript
// Merge endpoints within tolerance
const MERGE_TOLERANCE = 10; // pixels

for (const node of nodes) {
  for (const candidate of spatialIndex.findNearby(node, MERGE_TOLERANCE)) {
    if (distance(node, candidate) < MERGE_TOLERANCE) {
      mergeNodes(node, candidate);
    }
  }
}
```

### 2. Collinear Chain Merging (Line Merging)

```javascript
// Check if segments can merge
const canMerge = (seg1, seg2) => {
  const angleThreshold = Math.PI / 36; // 5 degrees
  const distanceThreshold = 15; // pixels
  
  return angleDiff(seg1, seg2) < angleThreshold &&
         endpointDistance(seg1, seg2) < distanceThreshold;
};
```

### 3. Wall Classification (Wall Classifier)

```javascript
// Classify wall type based on position
const classifyWall = (wall, imageBounds) => {
  const edgeThreshold = 50; // pixels from edge
  
  if (nearEdge(wall, imageBounds, edgeThreshold)) {
    return 'exterior';
  }
  return 'interior';
};
```

---

## 🔍 Interior vs Exterior Edges

For condo floor plans, the system defaults to **interior edges** (inner face of walls):

```javascript
// Default: interior edges for living space calculation
const [useInteriorWalls, setUseInteriorWalls] = useState(true);

// Trace perimeter with interior/exterior option
const result = await tracePerimeter(image, useInteriorWalls, wallData);
```

Users can toggle to exterior edges via UI for property boundary calculations.

---

## 🚀 Performance

### Benchmarks (1024x768 image)

| Stage | Time |
|-------|------|
| Segment Detection | 500-800ms |
| Graph Construction | 100-200ms |
| Line Merging | 50-100ms |
| Classification | 20-50ms |
| **Total** | **~1-2 seconds** |

### Optimization

- Spatial indexing reduces O(n²) to O(n log n)
- Caching graph between operations
- Lazy evaluation of expensive computations
- Web Workers for background processing (future)

---

## 💡 Development Guidelines

### When Modifying the System

1. **Run tests first**: `npm test` to establish baseline
2. **Write failing test**: Add test for new behavior
3. **Implement change**: Modify code to pass test
4. **Verify all tests pass**: Ensure no regressions
5. **Update documentation**: Keep docs in sync

### Debug Mode

Enable debug mode to see intermediate results:

```javascript
const wallData = await detectWalls(imageDataUrl, {
  debugMode: true
});

// Access debug data
console.log('Segments:', wallData.debug.segments);
console.log('Graph:', wallData.debug.graph);
console.log('Chains:', wallData.debug.chains);
```

---

## 📞 Questions?

- **System overview**: Read `TOPOLOGY_SYSTEM_README.md`
- **Implementation details**: See `TOPOLOGY_IMPLEMENTATION_GUIDE.md`
- **Testing**: Check `TOPOLOGY_TESTING.md`
- **Architecture comparison**: Review `WALL_DETECTION_SYSTEMS.md`

---

*Last Updated: October 13, 2025*
