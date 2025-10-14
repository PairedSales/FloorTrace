# Wall Detection Deep Testing System

## Overview

A comprehensive, robust testing framework for the hybrid wall detection pipeline. This system validates each stage of the algorithm with detailed assertions, metrics, and visualizations.

## Architecture

The testing system consists of four main components:

### 1. **Test Utilities** (`src/utils/wallTestUtilities.js`)
- **TestAssertion**: Validates specific conditions with expected vs actual values
- **TestStepResult**: Tracks results for each pipeline stage
- **TestSuiteResult**: Aggregates all test steps and provides summary
- **Validators**: Stage-specific validation functions
- **MetricsCalculators**: Compute metrics for each stage
- **TestLogger**: Detailed logging with severity levels

### 2. **Visualization Helpers** (`src/utils/wallTestVisualizations.js`)
- Grayscale and binary image visualization
- Likelihood heatmaps (color-coded intensity)
- Line segment visualization with orientation colors
- Exterior/interior wall classification
- Perimeter polygon rendering
- Room finding results overlay
- Comparison views (before/after)
- Multi-panel diagnostic views

### 3. **Test Runner** (`test-wall-detection.js`)
- Orchestrates the entire test suite
- Manages test execution flow
- Renders results in real-time
- Exports test reports as JSON
- Handles errors gracefully

### 4. **Test UI** (`test-wall-detection.html` + `test-styles.css`)
- Clean, modern interface
- Real-time progress tracking
- Collapsible sections for detailed views
- Responsive design
- Status indicators for each step

## Pipeline Stages Tested

### Stage 1: Preprocessing & Binarization
**Purpose**: Convert image to binary for wall detection

**Validations**:
- ✓ Grayscale array matches image dimensions
- ✓ Binary array matches image dimensions
- ✓ Binary values are only 0 or 1
- ✓ Wall pixel ratio is reasonable (2-40%)

**Metrics**:
- Wall pixels count
- Wall ratio percentage
- Average brightness

**Visualizations**:
- Grayscale output
- Binary output (black = walls)

### Stage 2: Wall Segmentation
**Purpose**: Generate wall likelihood map using CNN or classical methods

**Validations**:
- ✓ Likelihood map size matches image dimensions
- ✓ Values are in valid range [0, 1]
- ✓ High-likelihood pixels exist

**Metrics**:
- Min/max/average likelihood
- High-likelihood pixel count and ratio

**Visualizations**:
- Likelihood heatmap (blue→cyan→green→yellow→red)

### Stage 3: Line Detection
**Purpose**: Extract line segments from likelihood map

**Validations**:
- ✓ Segments were detected
- ✓ All segments meet minimum length requirement
- ✓ Valid coordinates (no NaN values)

**Metrics**:
- Total segments
- Average/min/max length
- Angle range

**Visualizations**:
- Detected lines overlay
- Orientation-colored lines (red=horizontal, blue=vertical)

### Stage 4: Collinear Merging
**Purpose**: Merge nearby collinear segments

**Metrics**:
- Before/after segment count
- Reduction percentage

**Visualizations**:
- After merging result

### Stage 5: Gap Filling
**Purpose**: Bridge gaps from doors/windows

**Validations**:
- ✓ Segment count didn't increase (merging, not creating)
- ✓ Segments remain after filling

**Metrics**:
- Before/after segment count

**Visualizations**:
- After gap filling result

### Stage 6: Post-Processing & Classification
**Purpose**: Filter, snap, classify walls

**Validations**:
- ✓ Required arrays exist (all, horizontal, vertical)
- ✓ Orientation classification complete
- ✓ Exterior walls detected

**Metrics**:
- Total/horizontal/vertical/exterior/interior counts
- Classification ratios

**Visualizations**:
- N/A (uses Stage 7 visualizations)

### Stage 7: Complete Pipeline Integration
**Purpose**: Run full pipeline with detectWalls()

**Validations**:
- ✓ Perimeter has sufficient vertices (≥4)
- ✓ Vertices are within image bounds

**Metrics**:
- All wall counts and classifications
- Perimeter statistics

**Visualizations**:
- Exterior/interior walls (green/purple)
- Perimeter polygon with vertices

### Stage 8: Room Finding with OCR
**Purpose**: Detect room dimensions and find room boundaries

**Validations**:
- ✓ Rooms found (>0)
- ✓ Success rate ≥50%

**Metrics**:
- Dimensions found
- Rooms successfully detected

**Visualizations**:
- Original image with walls, dimension boxes, and room boundaries
- Yellow dashed = OCR dimensions
- Green solid = Detected rooms

## Running Tests

### Quick Start
```bash
# Start dev server
npm run dev

# Navigate to
http://localhost:5173/test-wall-detection.html

# Test runs automatically on page load
```

### Configuration Options

**Minimum Wall Length**: Controls sensitivity (lower = more walls detected)
- Default: 50px
- Range: 10-500px

**Threshold Method**: Binarization approach
- `adaptive`: Best for varying lighting (recommended)
- `otsu`: Automatic global threshold
- `global`: Fixed threshold at 128

**Max Gap Length**: Maximum gap to bridge (doors/windows)
- Default: 100px
- Range: 20-300px

**Toggles**:
- **Gap Filling**: Bridge gaps in walls
- **Orientation Constraints**: Only horizontal/vertical walls
- **Run OCR**: Include room detection step

### Exporting Results

Click "💾 Export Report" to download a JSON file containing:
- Test summary (passed/failed/warnings)
- All assertions with results
- All metrics
- Execution times
- Full log output

Example:
```json
{
  "timestamp": "2024-01-15T12:34:56.789Z",
  "suiteName": "Wall Detection Pipeline",
  "summary": {
    "totalSteps": 8,
    "passed": 7,
    "failed": 0,
    "warnings": 1,
    "successRate": "100.0",
    "totalDuration": 2345.67
  },
  "steps": [...]
}
```

## Interpreting Results

### Status Indicators

🟢 **PASSED**: All assertions passed, no warnings
- Green border
- ✅ checkmarks on assertions

🟡 **WARNING**: Assertions passed but has warnings
- Yellow border
- ⚠️ warnings displayed

🔴 **FAILED**: One or more assertions failed
- Red border
- ❌ marks on failed assertions
- Error details shown

### Common Issues

**High wall pixel ratio (>40%)**
- Image may be too dark or noisy
- Try different threshold method
- Check preprocessing

**No segments detected**
- Minimum wall length too high
- Binary image may be empty
- Check preprocessing step

**Low room finding success rate (<50%)**
- Walls may not be properly classified
- Interior walls missing
- OCR dimension detection issues

## Extending the Test System

### Adding New Validators

```javascript
// In wallTestUtilities.js
export const Validators = {
  validateMyNewStage(output, expectedData) {
    const assertions = [];
    
    assertions.push(new TestAssertion(
      'My validation',
      output.value > 0,
      '> 0',
      output.value,
      'Description of what this checks'
    ));
    
    return assertions;
  }
};
```

### Adding New Visualizations

```javascript
// In wallTestVisualizations.js
export const visualizeMyData = (data, width, height) => {
  const { canvas, ctx } = createCanvas(width, height);
  
  // Draw your visualization
  ctx.fillStyle = 'red';
  ctx.fillRect(0, 0, 100, 100);
  
  return canvas.toDataURL();
};
```

### Adding New Test Steps

```javascript
// In test-wall-detection.js
const stepN = new TestStepResult('My New Step', N);
stepN.start();
stepsDiv.innerHTML += renderTestStep(stepN);

// Run your algorithm
const result = await myAlgorithm(input);

// Validate
Validators.validateMyNewStage(result, expected).forEach(a => stepN.addAssertion(a));

// Metrics
stepN.addMetric('My Metric', result.value, 'units');

// Visualize
stepN.addVisualization('My Viz', visualizeMyData(result));

stepN.finish(result);
document.getElementById(`step-${stepN.stepNumber}`).outerHTML = renderTestStep(stepN);
suite.addStep(stepN);
```

## Best Practices

### When Testing
1. **Start with defaults** - Use default settings first
2. **Examine failures** - Check visualizations for failed steps
3. **Adjust incrementally** - Change one parameter at a time
4. **Export reports** - Save results for comparison
5. **Check logs** - Console output has detailed debugging info

### When Debugging
1. Look at the **last successful step** visualization
2. Check **assertion details** for expected vs actual values
3. Review **metrics** for anomalies
4. Compare **before/after** visualizations
5. Export and analyze **JSON report**

### Performance Tips
- OCR step is slowest (~2-5 seconds)
- Disable OCR for faster wall-only testing
- Use smaller test images for iteration
- Gap filling adds ~100-200ms

## Maintenance

### Updating Test Cases
When modifying the pipeline:
1. Update relevant validators in `wallTestUtilities.js`
2. Add new metrics to calculators
3. Create visualizations for new data
4. Update this documentation

### Adding Test Images
Place test images in project root:
```javascript
// Modify loadTestImage() in test-wall-detection.js
const response = await fetch('./your-test-image.png');
```

## Architecture Diagram

```
┌─────────────────────────────────────────────┐
│         test-wall-detection.html            │
│              (UI Layer)                     │
└─────────────────┬───────────────────────────┘
                  │
┌─────────────────▼───────────────────────────┐
│        test-wall-detection.js               │
│           (Test Runner)                     │
└───┬────────────────────────────────┬────────┘
    │                                │
┌───▼─────────────────┐   ┌─────────▼─────────┐
│ wallTestUtilities.js│   │wallTestVisualiz...│
│  - Validators       │   │  - Render funcs   │
│  - Metrics          │   │  - Canvas helpers │
│  - Assertions       │   │  - Heatmaps       │
│  - Test structure   │   │  - Comparisons    │
└──────────┬──────────┘   └─────────┬─────────┘
           │                        │
           └──────────┬─────────────┘
                      │
         ┌────────────▼──────────────┐
         │   Wall Detection Pipeline │
         │   - preprocessImage       │
         │   - segmentWalls          │
         │   - detectLineSegments    │
         │   - fillGapsInSegments    │
         │   - postProcessSegments   │
         │   - detectWalls           │
         │   - findRoomFromWalls     │
         └───────────────────────────┘
```

## Future Enhancements

### Planned Features
- [ ] Comparative testing (multiple configurations)
- [ ] Benchmark mode (performance profiling)
- [ ] Regression testing (compare with baseline)
- [ ] Visual diff for image outputs
- [ ] Test image gallery with expected results
- [ ] Automated issue detection and suggestions
- [ ] Per-step performance breakdown
- [ ] Memory usage tracking

### Integration Possibilities
- CI/CD pipeline integration
- Automated regression detection
- Performance monitoring dashboard
- Test result database
- Visualization comparison tool

## Troubleshooting

### "ES6 module" Error
**Problem**: Opening HTML directly in browser
**Solution**: Must use dev server (`npm run dev`)

### Visualizations Not Loading
**Problem**: Canvas rendering issues
**Solution**: Check browser console for errors, ensure sufficient memory

### Test Hangs on OCR Step
**Problem**: Tesseract.js loading or processing
**Solution**: Disable OCR temporarily, check network tab for worker loading

### Unexpected Failures
**Problem**: Pipeline changes broke tests
**Solution**: Review recent changes, update validators/expectations

## Support

For issues or questions:
1. Check console logs for detailed error messages
2. Export test report and review assertions
3. Compare with baseline test results
4. Review recent pipeline modifications
5. Create issue with exported test report attached
