# Classical Wall Detection System

## Overview

The FloorTrace wall detection system uses a **classical image processing approach**. This architecture combines robust preprocessing with precise line detection algorithms to identify walls in floor plan images.

## Architecture

### Pipeline Stages

```
Image Input
    ↓
1. Preprocessing (imagePreprocessor.js)
    ├─ Grayscale conversion
    ├─ Adaptive thresholding (or Otsu/Global)
    ├─ Morphological operations (closing, opening)
    └─ Noise removal
    ↓
2. Wall Segmentation (wallSegmentation.js)
    ├─ Binary to likelihood map conversion
    └─ Gaussian smoothing for edge refinement
    ↓
3. Line Detection (lineRefinement.js)
    ├─ Edge detection (Sobel)
    ├─ Non-maximum suppression
    ├─ Line segment detection (LSD-style)
    └─ Collinear segment merging
    ↓
4. Gap Filling (gapFilling.js)
    ├─ Intelligent gap analysis
    ├─ Segment connection across gaps
    └─ Door/window handling
    ↓
5. Post-Processing (wallPostProcessing.js)
    ├─ Orientation constraints (H/V only)
    ├─ Length/thickness filtering
    ├─ Grid snapping & quantization
    ├─ Duplicate removal
    └─ Geometric validation
    ↓
6. Classification & Perimeter
    ├─ Exterior/interior separation
    └─ Perimeter polygon construction
    ↓
Output: Wall Segments + Perimeter
```

## Key Features

### 1. Preprocessing (imagePreprocessor.js)

**Advanced thresholding methods:**
- **Adaptive thresholding**: Best for images with varying lighting
- **Otsu's method**: Automatic threshold calculation
- **Global thresholding**: Simple threshold-based binarization

**Morphological operations:**
- Erosion/dilation for noise removal
- Opening to remove small objects
- Closing to fill small gaps (doors/windows)

**Noise removal:**
- Connected component analysis
- Size-based filtering

### 2. Classical Segmentation (wallSegmentation.js)

**Binary-to-likelihood conversion:**
- Converts binary preprocessed images to likelihood maps
- Gaussian smoothing for refined edge detection
- Produces 0-1 probability values per pixel

**Benefits:**
- Fast and lightweight (no model required)
- Works entirely client-side
- Consistent and predictable results

### 3. Line Refinement (lineRefinement.js)

**Edge-guided line detection:**
- Sobel edge detection
- Non-maximum suppression for thin edges
- Line segment detection (simplified LSD)
- Merges collinear segments

**Features:**
- Orientation-aware (can constrain to H/V only)
- Handles gaps and breaks
- Score-based filtering using likelihood map

### 4. Gap Filling (gapFilling.js)

**Intelligent bridging:**
- Connects aligned segments across gaps
- Context-aware (differentiates doors vs windows)

**Parameters:**
- `maxGapLength`: Maximum gap to bridge (default 100px)
- `alignmentTolerance`: How aligned segments must be

### 5. Post-Processing (wallPostProcessing.js)

**Multi-stage filtering:**
1. **Orientation filtering**: Keep only H/V walls
2. **Length filtering**: Remove short segments
3. **Orientation snapping**: Force to exact H/V
4. **Grid snapping**: Quantize to regular grid
5. **Duplicate removal**: Eliminate overlapping segments
6. **Isolation filtering**: Remove disconnected segments
7. **Geometric constraints**: Validate wall spacing

**Vectorization:**
- Converts raster detections to clean vector lines
- Snaps nearly-aligned segments
- Quantizes coordinates

## Usage

### Basic Usage

```javascript
import { detectWalls } from './utils/wallDetector';

const wallData = await detectWalls(imageDataUrl, {
  minWallLength: 50,
  thresholdMethod: 'adaptive',  // 'global', 'adaptive', or 'otsu'
  orientationConstraints: true,
  fillGaps: true,
  maxGapLength: 100,
  debugMode: false
});

// Results
console.log('Total walls:', wallData.allWalls.length);
console.log('Exterior walls:', wallData.exterior.length);
console.log('Interior walls:', wallData.interior.length);
console.log('Perimeter vertices:', wallData.perimeter.vertices.length);
```

### Advanced Usage with Debug Mode

```javascript
const wallData = await detectWalls(imageDataUrl, {
  minWallLength: 50,
  debugMode: true  // Get likelihood maps and intermediate results
});

// Access debug data
const likelihoodMap = wallData.debug.likelihood;
const preprocessed = wallData.debug.preprocessed;
```

### Testing & Parameter Tuning

```javascript
import { testWallDetection, compareWallDetectionParameters } from './utils/wallDetectorTest';

// Single test with visualizations
const testResults = await testWallDetection(imageDataUrl, {
  minWallLength: 50,
  thresholdMethod: 'adaptive',
  testPerimeter: true,
  showDebugInfo: true
});

// Compare multiple parameter sets
const comparison = await compareWallDetectionParameters(imageDataUrl, [
  { minWallLength: 30, thresholdMethod: 'adaptive', fillGaps: true },
  { minWallLength: 50, thresholdMethod: 'otsu', fillGaps: true },
  { minWallLength: 75, thresholdMethod: 'adaptive', fillGaps: false }
]);
```

## Configuration Options

### Detection Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `minWallLength` | number | 50 | Minimum length in pixels for a wall segment |
| `thresholdMethod` | string | 'adaptive' | Thresholding: 'global', 'adaptive', or 'otsu' |
| `orientationConstraints` | boolean | true | Only detect horizontal/vertical walls |
| `fillGaps` | boolean | true | Bridge gaps from doors/windows |
| `maxGapLength` | number | 100 | Maximum gap to bridge (pixels) |
| `debugMode` | boolean | false | Return intermediate results |

### Preprocessing Options

Accessed via `preprocessImage()`:

```javascript
{
  thresholdMethod: 'adaptive',    // 'global', 'adaptive', 'otsu'
  globalThresholdValue: 128,      // For global method
  adaptiveWindowSize: 15,         // Window size for adaptive
  adaptiveC: 2,                   // Constant for adaptive
  removeNoise: true,              // Remove small components
  minComponentSize: 50,           // Min pixels to keep
  useClosing: true,               // Fill small gaps
  closingKernelSize: 3            // Kernel size for closing
}
```

### Post-Processing Options

Accessed via `postProcessSegments()`:

```javascript
{
  minLength: 50,                  // Minimum segment length
  enforceOrientation: true,       // Only H/V walls
  allowedOrientations: ['horizontal', 'vertical'],
  angleTolerance: Math.PI / 12,   // 15 degrees
  removeIsolated: true,           // Remove disconnected segments
  connectionThreshold: 20,        // Max distance for connection
  snapGrid: true,                 // Snap to grid
  gridSize: 5,                    // Grid spacing
  snapOrientation: true,          // Force exact H/V
  removeDups: true,               // Remove duplicates
  duplicateThreshold: 10,         // Duplicate distance threshold
  applyConstraints: true,         // Geometric validation
  classifyExterior: true          // Separate exterior/interior
}
```

## Performance

### Benchmarks

Typical performance on a 2000×1500px floor plan:

| Stage | Time | Notes |
|-------|------|-------|
| Preprocessing | 50-100ms | Adaptive thresholding |
| Segmentation | 100-200ms | Binary to likelihood conversion |
| Line Detection | 100-200ms | Edge detection + LSD |
| Post-Processing | 50-100ms | Filtering + snapping |
| **Total** | **300-600ms** | Complete pipeline |

### Optimization Tips

1. **Reduce image size** before processing (downscale to ~1000px width)
2. **Disable debug mode** in production
3. **Adjust minWallLength** to filter more aggressively
4. **Use Web Workers** for heavy computation
5. **Cache wall data** when switching between interior/exterior edges

## Module Structure

```
src/utils/
├── wallDetector.js              # Main entry point, classical pipeline
├── imagePreprocessor.js         # Adaptive thresholding, morphology
├── wallSegmentation.js          # Classical likelihood map generation
├── lineRefinement.js            # Line detection, edge detection
├── gapFilling.js                # Intelligent gap bridging
├── wallPostProcessing.js        # Filtering, snapping, classification
└── wallDetectorTest.js          # Testing utilities
```

## Advantages Over Previous System

### Old System (Connected Components)
- ❌ Struggled with thin lines
- ❌ Confused by furniture and text
- ❌ Fixed aspect ratio thresholds
- ❌ Poor gap handling
- ❌ No orientation awareness

### New Classical System
- ✅ Handles varying line widths
- ✅ Better preprocessing for cleaner binary images
- ✅ Adaptive thresholding methods
- ✅ Intelligent gap filling
- ✅ Orientation constraints
- ✅ Vectorized output
- ✅ Robust to noise
- ✅ Fast and lightweight

## Future Improvements

### Short Term
1. ✨ Add support for diagonal walls
2. ✨ Improve door/window detection
3. ✨ Better room boundary detection
4. ✨ Automatic parameter tuning

### Long Term
1. 🚀 Real-time processing with Web Workers
2. 🚀 GPU acceleration via WebGL for image processing
3. 🚀 Support for curved walls
4. 🚀 Integration with topology-guided system
5. 🚀 3D floor plan reconstruction

## Troubleshooting

### Too Many False Positives
- Increase `minWallLength`
- Enable `orientationConstraints`
- Use stricter `thresholdMethod` ('otsu')
- Adjust `minScore` in line detection

### Missing Walls
- Decrease `minWallLength`
- Disable `removeIsolated`
- Increase `maxGapLength`
- Use 'adaptive' thresholding

### Broken/Disconnected Walls
- Enable `fillGaps`
- Increase `maxGapLength`
- Adjust `closingKernelSize` in preprocessing
- Disable `orientationConstraints` if walls are diagonal

### Poor Performance
- Downscale image before detection
- Increase `minWallLength` to reduce segments
- Disable `debugMode` in production
- Use Web Workers for background processing

## References

- **LSD Algorithm**: [Line Segment Detector](http://www.ipol.im/pub/art/2012/gjmr-lsd/)
- **Canny Edge Detection**: [A Computational Approach to Edge Detection](https://ieeexplore.ieee.org/document/4767851)
- **Hough Transform**: [Use of the Hough Transformation to Detect Lines and Curves in Pictures](https://dl.acm.org/doi/10.1145/361237.361242)

## License

Part of the FloorTrace project.
