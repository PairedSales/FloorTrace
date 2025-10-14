# Wall Detection Testing System

A comprehensive testing framework for the FloorTrace wall detection system. This system allows you to test different parameter configurations and analyze results systematically.

## 📁 Directory Structure

```
testing-system/
├── inputs.json          # Test configuration (edit this)
├── run-test.js         # Main test runner
├── README.md           # This file
└── test-results/       # Output folder (auto-created)
    └── [timestamp]/    # Each test run gets its own folder
        ├── 1-original.png
        ├── 2-all-walls.png
        ├── 3-exterior-walls.png
        ├── 4-interior-walls.png
        ├── 5-combined.png
        ├── 6-overlay.png
        ├── analysis.json
        ├── walls.json
        ├── inputs-used.json
        └── report.html
```

## 🚀 Quick Start

1. **Edit parameters** in `inputs.json`
2. **Run the test**:
   ```bash
   node run-test.js
   ```
3. **View results** in `test-results/[timestamp]/report.html`

## 📊 What Gets Generated

### Images
- **1-original.png** - Original floor plan
- **2-all-walls.png** - All detected walls
- **3-exterior-walls.png** - Exterior walls only (red)
- **4-interior-walls.png** - Interior walls only (blue)
- **5-combined.png** - Combined view with legend
- **6-overlay.png** - Detection overlaid on original image

### Data Files
- **analysis.json** - Test metrics and statistics
- **walls.json** - Complete wall data (coordinates, dimensions, etc.)
- **inputs-used.json** - Copy of parameters used for this run
- **report.html** - Interactive HTML report with all visualizations

## ⚙️ Configuration Parameters

### Preprocessing
```json
"preprocessing": {
  "thresholdMethod": "adaptive",      // "global", "adaptive", or "otsu"
  "globalThresholdValue": 128,        // Used if method is "global"
  "adaptiveWindowSize": 15,           // Window size for adaptive threshold
  "adaptiveC": 2,                     // Constant for adaptive threshold
  "removeNoise": true,                // Remove small noise components
  "minComponentSize": 15,             // Minimum component size to keep
  "useClosing": true,                 // Apply morphological closing
  "closingKernelSize": 9              // Kernel size for closing
}
```

### Wall Detection
```json
"wallDetection": {
  "minWallLength": 50,                // Minimum wall length in pixels
  "fillGaps": true,                   // Fill gaps (doors/windows)
  "maxGapLength": 100,                // Maximum gap to fill
  "debugMode": true                   // Enable debug output
}
```

### Line Detection
```json
"lineDetection": {
  "minLength": 50,                    // Minimum line segment length
  "minScore": 0.2,                    // Minimum likelihood score
  "maxGap": 10,                       // Max gap in edge chains
  "orientationConstraint": false,     // Enforce H/V only
  "angleTolerance": 0.785398,         // ~45° in radians
  "edgeThresholdPercent": 5,          // % of max edge magnitude
  "minEdgeThreshold": 0.1,            // Absolute minimum threshold
  "minChainLength": 3                 // Min pixels in edge chain
}
```

### Segment Merging
```json
"segmentMerging": {
  "maxDistance": 20,                  // Max perpendicular distance
  "maxGap": 50,                       // Max gap along line
  "angleTolerance": 0.2               // Max angle difference (radians)
}
```

### Gap Filling
```json
"gapFilling": {
  "maxGapLength": 100,                // Maximum gap to bridge
  "alignmentTolerance": 10,           // Alignment tolerance
  "angleTolerance": 0.1               // Angle tolerance
}
```

### Post-Processing
```json
"postProcessing": {
  "minLength": 50,                    // Filter: min length
  "enforceOrientation": false,        // Only keep H/V walls
  "allowedOrientations": ["horizontal", "vertical", "diagonal"],
  "angleTolerance": 0.785398,         // Orientation tolerance
  "removeIsolated": false,            // Remove unconnected walls
  "connectionThreshold": 25,          // Distance for connections
  "snapGrid": false,                  // Snap to grid
  "gridSize": 5,                      // Grid size in pixels
  "snapOrientation": false,           // Snap to perfect H/V
  "removeDups": true,                 // Remove duplicates
  "duplicateThreshold": 10,           // Duplicate distance threshold
  "applyConstraints": false,          // Apply geometric constraints
  "classifyExterior": true,           // Classify interior/exterior
  "edgeThreshold": null               // Auto-calculate if null
}
```

### Thick Wall Detection (Experimental)
```json
"thickWallDetection": {
  "enabled": false,                   // Enable thick wall mode
  "minWallLength": 50,
  "minThickness": 2,
  "maxThickness": 30,
  "minAspectRatio": 3,
  "maxParallelSeparation": 30
}
```

### Topology Analysis (Experimental)
```json
"topologyAnalysis": {
  "enabled": false,                   // Enable topology mode
  "cannyLow": 50,                     // Canny low threshold
  "cannyHigh": 150,                   // Canny high threshold
  "houghThreshold": 50,               // Hough transform threshold
  "minLineLength": 30,
  "maxLineGap": 10,
  "minSegmentLength": 15,
  "endpointTolerance": 8,
  "parallelTolerance": 5,
  "angleTolerance": 5,
  "gapTolerance": 8,
  "mergeCollinear": true,
  "snapEndpoints": true,
  "minWallLength": 25,
  "minConfidence": 0.3,
  "filterIsolated": false,
  "computeThickness": true,
  "mergeParallel": true
}
```

## 🎯 Goal & Strategy

**Main Goal**: Precisely trace the interior and exterior walls of a condominium floorplan sketch.

**Approach**: Topology-guided line merging with adjacency graph on detected segments.

**Test Image**: ExampleFloorplan.png (automatically loaded)

## 📈 Interpreting Results

### Key Metrics in `analysis.json`
- **processingTime**: Total detection time in milliseconds
- **wallCounts**: Number of walls detected by category
- **wallStatistics**: Length and thickness statistics

### Visual Analysis
1. Check **6-overlay.png** to see how well walls align with original
2. Use **3-exterior-walls.png** to verify perimeter detection
3. Use **4-interior-walls.png** to verify room divisions

### Common Adjustments

**If too many walls detected:**
- Increase `minWallLength`
- Increase `minScore`
- Increase `edgeThresholdPercent`
- Enable `removeIsolated`

**If too few walls detected:**
- Decrease `minWallLength`
- Decrease `minScore`
- Decrease `edgeThresholdPercent`
- Increase `maxGap` in segment merging
- Disable `enforceOrientation`

**If walls are fragmented:**
- Increase `maxGap` in segment merging
- Increase `maxGapLength` in gap filling
- Increase `closingKernelSize` in preprocessing

**If walls are merged incorrectly:**
- Decrease `maxGap` in segment merging
- Decrease `angleTolerance`
- Enable `removeDups`

## 🔬 Advanced Usage

### Comparing Different Configurations

1. Run test with config A, note timestamp
2. Edit `inputs.json` with config B
3. Run test again
4. Compare results in respective timestamp folders

### Batch Testing

Create a script to iterate through different parameter combinations:

```javascript
const configs = [
  { minScore: 0.1, name: 'low-threshold' },
  { minScore: 0.2, name: 'medium-threshold' },
  { minScore: 0.3, name: 'high-threshold' }
];

for (const config of configs) {
  // Update inputs.json
  // Run test
  // Collect results
}
```

### Analyzing Wall Data

The `walls.json` file contains complete wall information:

```json
{
  "boundingBox": { "x1": 0, "y1": 0, "x2": 100, "y2": 10 },
  "length": 100,
  "thickness": 10,
  "isHorizontal": true,
  "centerX": 50,
  "centerY": 5,
  "pixelCount": 1000
}
```

## 🐛 Troubleshooting

### Error: Cannot find module
```bash
npm install canvas
```

### Error: Image not found
- Check that `ExampleFloorplan.png` exists in parent directory
- Verify path in `inputs.json` is correct

### Out of Memory
- Reduce image size
- Decrease `adaptiveWindowSize`
- Disable `debugMode`

## 📝 Notes

- Each test run is independent and timestamped
- Results are never overwritten
- All inputs are saved with results for reproducibility
- Console output shows detailed progress and statistics
- HTML report provides interactive analysis

## 🎨 Customization

You can modify `run-test.js` to:
- Add custom visualizations
- Include additional metrics
- Export data in different formats
- Integrate with other analysis tools

## 📧 Support

For issues or questions, refer to the main project documentation.
