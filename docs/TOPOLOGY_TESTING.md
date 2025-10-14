# Topology System Testing Guide

## Overview

Comprehensive testing suite for the Topology-Guided Line Merging and Adjacency Graph system in FloorTrace.

## Test Structure

### Unit Tests

Each module has dedicated unit tests:

1. **geometryUtils.test.js** - Core geometric functions
   - Distance calculations
   - Angle measurements
   - Collinearity detection
   - Line operations

2. **topologyGraph.test.js** - Graph building and operations
   - Node creation and merging
   - Edge connectivity
   - Spatial indexing
   - Junction detection

3. **lineMerging.test.js** - Segment merging
   - Collinear segment merging
   - Chain building
   - Endpoint snapping
   - Confidence scoring

4. **wallClassifier.test.js** - Wall classification
   - Filtering by length/confidence
   - Wall type assignment
   - Quality scoring
   - Statistics generation

### Integration Tests

**topology.integration.test.js** - Full pipeline testing

Tests every step of the process with multiple test patterns:
- Simple square pattern
- Collinear segments
- Parallel walls
- Grid patterns
- Complex mixed patterns

## Running Tests

### Install Dependencies

```bash
npm install --save-dev vitest @vitest/ui jsdom
```

### Run All Tests

```bash
npm test
```

### Run With UI

```bash
npm run test:ui
```

### Run With Coverage

```bash
npm run test:coverage
```

### Run Specific Test File

```bash
npm test geometryUtils.test.js
npm test topology.integration.test.js
```

### Watch Mode

```bash
npm test -- --watch
```

## Test Patterns

The test suite includes several pre-built patterns using `createMockSegments()`:

### 1. Simple Pattern
```javascript
createMockSegments('simple')
```
- Basic square (4 segments)
- Tests basic connectivity
- Perpendicular corners

### 2. Collinear Pattern
```javascript
createMockSegments('collinear')
```
- 3 segments in a line
- Tests segment merging
- Validates chain building

### 3. Parallel Pattern
```javascript
createMockSegments('parallel')
```
- 3 parallel horizontal lines
- Tests parallel detection
- Validates redundant wall merging

### 4. Grid Pattern
```javascript
createMockSegments('grid')
```
- 4x4 grid of lines
- Tests junction detection
- Validates spatial indexing
- Tests orientation classification

### 5. Complex Pattern
```javascript
createMockSegments('complex')
```
- Mixed orientations
- Interior walls
- Diagonal segments
- Tests advanced scenarios

## Testing Each Pipeline Step

### Step 1: Segment Detection

```javascript
import { detectSegments } from './segmentDetection.js';

const segments = createMockSegments('simple');
// Validates:
// - All segments have x1, y1, x2, y2
// - Length and angle are computed
// - Segments are normalized
```

### Step 2: Topology Graph

```javascript
import { buildTopologyGraph } from './topologyGraph.js';

const graph = buildTopologyGraph(segments);
// Validates:
// - Nodes created from endpoints
// - Nearby endpoints merged
// - Adjacency relationships correct
// - Parallel/collinear pairs detected
// - Junctions identified
// - Spatial index functional
```

### Step 3: Line Merging

```javascript
import { mergeLines } from './lineMerging.js';

const chains = mergeLines(segments, graph);
// Validates:
// - Collinear segments merged
// - Perpendicular segments separate
// - Confidence scores computed
// - Orientations assigned
// - Chain continuity preserved
```

### Step 4: Wall Classification

```javascript
import { classifyWalls } from './wallClassifier.js';

const walls = classifyWalls(chains, graph);
// Validates:
// - Length/confidence filtering
// - Wall types assigned
// - Quality scores computed
// - Thickness estimated
// - Connectivity calculated
```

### Step 5: Statistics

```javascript
import { getWallStatistics } from './wallClassifier.js';

const stats = getWallStatistics(walls);
// Validates:
// - Count accuracy
// - Length aggregation
// - Confidence averaging
// - Orientation breakdown
// - Type distribution
```

## Using ExampleFloorplan.png

The integration tests automatically attempt to load the example floorplan:

```javascript
import { loadExampleFloorplan } from './testUtils.js';

const image = await loadExampleFloorplan();
// Falls back to mock data if image unavailable
```

To test with actual floorplan detection (when OpenCV is available):

```javascript
import { detectSegmentsFromImage } from './segmentDetection.js';

const image = await loadExampleFloorplan();
const segments = await detectSegmentsFromImage(image);
const graph = buildTopologyGraph(segments);
// ... continue pipeline
```

## Validation Utilities

### assertValidSegments()
```javascript
import { assertValidSegments } from './testUtils.js';

assertValidSegments(segments);
// Throws if segments invalid
```

### assertValidGraph()
```javascript
import { assertValidGraph } from './testUtils.js';

assertValidGraph(graph);
// Throws if graph structure invalid
```

### assertValidWalls()
```javascript
import { assertValidWalls } from './testUtils.js';

assertValidWalls(walls);
// Throws if walls invalid
```

### validateTopologyResult()
```javascript
import { validateTopologyResult } from './testUtils.js';

const result = { segments, graph, chains, walls, statistics };
const validation = validateTopologyResult(result);

if (!validation.valid) {
  console.error('Errors:', validation.errors);
}
```

## Coverage Goals

Target coverage thresholds:
- **Lines**: 80%
- **Functions**: 80%
- **Branches**: 75%
- **Statements**: 80%

## Debugging Failed Tests

### Enable Verbose Output

```bash
npm test -- --reporter=verbose
```

### Run Single Test

```javascript
it.only('your test name', () => {
  // This test will run exclusively
});
```

### Inspect Test Data

```javascript
it('test name', () => {
  const segments = createMockSegments('simple');
  console.log('Segments:', segments);
  
  const graph = buildTopologyGraph(segments);
  console.log('Graph metadata:', graph.metadata);
  console.log('Nodes:', graph.nodes.length);
  console.log('Junctions:', graph.junctions);
});
```

### Use Snapshot Testing

```javascript
import { expect } from 'vitest';

it('produces consistent output', () => {
  const segments = createMockSegments('simple');
  const graph = buildTopologyGraph(segments);
  
  expect(graph.metadata).toMatchSnapshot();
});
```

## Performance Testing

The integration tests include performance checks:

```javascript
it('handles large segment counts efficiently', () => {
  const segments = createLargeGrid(); // 500x500 grid
  
  const startTime = Date.now();
  const graph = buildTopologyGraph(segments);
  const chains = mergeLines(segments, graph);
  const walls = classifyWalls(chains, graph);
  const duration = Date.now() - startTime;
  
  expect(duration).toBeLessThan(1000); // < 1 second
});
```

## Continuous Integration

Add to your CI pipeline:

```yaml
# .github/workflows/test.yml
name: Test

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
        with:
          node-version: '18'
      - run: npm install
      - run: npm test -- --coverage
      - run: npm run test:integration
```

## Common Test Scenarios

### Test 1: End-to-End Simple Square

```javascript
const segments = createMockSegments('simple');
const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });
const chains = mergeLines(segments, graph);
const walls = classifyWalls(chains, graph);

expect(graph.nodes.length).toBe(4); // 4 corners
expect(walls.length).toBe(4); // 4 walls
```

### Test 2: Collinear Merge

```javascript
const segments = createMockSegments('collinear');
const graph = buildTopologyGraph(segments, { endpointTolerance: 2 });
const chains = mergeLines(segments, graph);

expect(chains.length).toBe(1); // Merged into one
expect(chains[0].segments.length).toBe(3); // Contains all 3
```

### Test 3: Parallel Detection

```javascript
const segments = createMockSegments('parallel');
const graph = buildTopologyGraph(segments);

expect(graph.parallelPairs.length).toBeGreaterThan(0);
```

### Test 4: Junction Detection

```javascript
const segments = createMockSegments('grid');
const graph = buildTopologyGraph(segments, { endpointTolerance: 5 });

expect(graph.junctions.length).toBeGreaterThan(0);
const multiJunctions = graph.junctions.filter(j => j.degree >= 3);
expect(multiJunctions.length).toBeGreaterThan(0);
```

## Adding New Tests

1. Create test file: `feature.test.js`
2. Import utilities:
```javascript
import { describe, it, expect } from 'vitest';
import { createMockSegments, assertValid... } from './testUtils.js';
```

3. Write tests:
```javascript
describe('New Feature', () => {
  it('does something', () => {
    const segments = createMockSegments('simple');
    // Your test logic
    expect(result).toBe(expected);
  });
});
```

4. Run: `npm test feature.test.js`

## Troubleshooting

### OpenCV Not Loading
- Tests use mocked OpenCV by default
- Real OpenCV tests run in browser environment
- Check `testSetup.js` for mock configuration

### Image Loading Fails
- Tests fall back to mock data automatically
- Check file path in `testUtils.js`
- Ensure ExampleFloorplan.png is in project root

### Flaky Tests
- Check tolerance values in assertions
- Use `.toBeCloseTo()` for floating point
- Increase timeout if needed: `testTimeout: 10000`

## Best Practices

1. **Test in isolation** - Each test should be independent
2. **Use descriptive names** - Clear test descriptions
3. **Validate assumptions** - Use assertion utilities
4. **Test edge cases** - Empty, single, large inputs
5. **Check performance** - Ensure reasonable execution time
6. **Mock dependencies** - Use test utilities for consistency

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm test` | Run all tests |
| `npm run test:ui` | Interactive test UI |
| `npm run test:coverage` | Generate coverage report |
| `npm test -- --watch` | Watch mode |
| `npm test -- geometryUtils` | Run specific test |
| `npm test -- --reporter=verbose` | Verbose output |
