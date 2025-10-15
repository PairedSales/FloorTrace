# Wall Detection Testing System - Overview

## 🎯 Purpose

This comprehensive testing system allows you to:
1. **Test different parameter configurations** for wall detection
2. **Analyze results systematically** with visualizations and metrics
3. **Compare different approaches** to find optimal settings
4. **Document your experiments** for reproducibility

## 📦 What's Included

### Core Files
- **`run-test.js`** - Main test runner (loads image, runs detection, saves outputs)
- **`inputs.json`** - Configuration file with all tunable parameters
- **`package.json`** - Node.js dependencies

### Documentation
- **`README.md`** - Complete parameter reference and usage guide
- **`QUICK-START.md`** - Get running in 3 steps
- **`SYSTEM-OVERVIEW.md`** - This file
- **`EXPERIMENT-LOG-TEMPLATE.md`** - Template for documenting experiments

### Utilities
- **`.gitignore`** - Excludes test results from version control

## 🔄 Workflow

```
1. Edit inputs.json
   └─> Modify parameters you want to test
   
2. Run test
   └─> node run-test.js
   
3. Analyze results
   └─> Open test-results/[timestamp]/report.html
   
4. Document findings
   └─> Update EXPERIMENT-LOG-TEMPLATE.md
   
5. Iterate
   └─> Go back to step 1 with new insights
```

## 📊 Output Structure

```
test-results/
└── 2024-01-15T10-30-45/          # Timestamp folder
    ├── report.html                # Interactive HTML report ⭐
    ├── 1-original.png             # Original image
    ├── 2-all-walls.png            # All detected walls
    ├── 3-exterior-walls.png       # Exterior walls (red)
    ├── 4-interior-walls.png       # Interior walls (blue)
    ├── 5-combined.png             # Combined visualization
    ├── 6-overlay.png              # Overlay on original ⭐
    ├── analysis.json              # Metrics and statistics
    ├── walls.json                 # Complete wall data
    └── inputs-used.json           # Parameters used (for reproducibility)
```

## 🎨 Detection Pipeline

The system runs this pipeline:

```
1. Load Image
   └─> ExampleFloorplan.png

2. Preprocessing
   └─> Grayscale → Thresholding → Noise Removal → Morphological Operations

3. Wall Segmentation
   └─> Generate wall likelihood map

4. Line Detection
   └─> Edge detection → Line segment extraction

5. Segment Merging
   └─> Merge collinear segments → Fill gaps

6. Post-Processing
   └─> Filter → Snap → Classify (exterior/interior)

7. Output Generation
   └─> Visualizations → Metrics → Report
```

## 🔧 Parameter Categories

### 1. Preprocessing (Image Enhancement)
Controls how the raw image is cleaned and prepared.
- Thresholding method
- Noise removal
- Morphological operations

### 2. Wall Detection (Core Algorithm)
Main detection parameters.
- Minimum wall length
- Gap filling
- Debug mode

### 3. Line Detection (Segment Extraction)
How individual line segments are detected.
- Edge detection thresholds
- Minimum scores
- Orientation constraints

### 4. Segment Merging (Combining Fragments)
How broken wall segments are joined.
- Distance tolerances
- Gap bridging
- Angle tolerances

### 5. Post-Processing (Refinement)
Final cleanup and classification.
- Filtering
- Snapping
- Classification

## 📈 Evaluation Metrics

The system provides these metrics:

### Quantitative
- **Total walls detected**
- **Processing time**
- **Wall statistics** (length, thickness)
- **Classification counts** (exterior/interior, horizontal/vertical)

### Qualitative
- **Visual accuracy** (check overlay image)
- **Completeness** (are all walls found?)
- **Precision** (are false positives minimal?)
- **Perimeter quality** (is exterior complete?)

## 🎓 Best Practices

### 1. Start Simple
Begin with default parameters, then adjust one at a time.

### 2. Document Everything
Use the experiment log template to track changes and results.

### 3. Visual Validation
Always check the overlay image (6-overlay.png) - metrics alone aren't enough!

### 4. Iterative Refinement
- Run test
- Identify issues
- Adjust 1-2 parameters
- Re-run
- Compare results

### 5. Keep Good Results
When you find a good configuration, save the timestamp folder and document why it worked.

## 🔍 Common Use Cases

### Finding All Walls
**Goal**: Detect every wall in the floor plan  
**Key Parameters**: `minScore`, `edgeThresholdPercent`, `minWallLength`  
**Strategy**: Lower thresholds, disable aggressive filtering

### Clean Perimeter Detection
**Goal**: Perfect exterior wall detection  
**Key Parameters**: `classifyExterior`, `edgeThreshold`, `maxGap`  
**Strategy**: Focus on exterior classification and gap filling

### Precise Interior Walls
**Goal**: Accurate room divisions  
**Key Parameters**: `removeIsolated`, `connectionThreshold`, `minLength`  
**Strategy**: Filter isolated segments, enforce connectivity

### Handling Dashed Lines
**Goal**: Detect walls drawn with dashed lines  
**Key Parameters**: `closingKernelSize`, `maxGap`, `maxGapLength`  
**Strategy**: Increase gap bridging and morphological closing

## 🐛 Troubleshooting Guide

### Problem: Missing walls
**Symptoms**: Some walls not detected  
**Solutions**:
- Lower `minScore` in lineDetection
- Lower `edgeThresholdPercent`
- Increase `maxGap` in segmentMerging
- Check preprocessing - might be removing too much

### Problem: Too many false positives
**Symptoms**: Text/symbols detected as walls  
**Solutions**:
- Increase `minScore`
- Increase `minWallLength`
- Enable `removeIsolated`
- Adjust `minComponentSize` in preprocessing

### Problem: Fragmented walls
**Symptoms**: Single walls detected as multiple segments  
**Solutions**:
- Increase `maxGap` in segmentMerging
- Increase `maxGapLength` in gapFilling
- Increase `closingKernelSize`

### Problem: Merged walls
**Symptoms**: Separate walls detected as one  
**Solutions**:
- Decrease `maxGap`
- Decrease `maxDistance`
- Decrease `angleTolerance`

### Problem: Slow processing
**Symptoms**: Takes too long to run  
**Solutions**:
- Disable `debugMode`
- Reduce `adaptiveWindowSize`
- Increase `minComponentSize`

## 💻 System Requirements

- **Node.js** 14+ 
- **npm** 
- **canvas** package (for image processing)

## 📚 Related Documentation

- **Main Project**: See FloorTrace README.md
- **Algorithm Details**: See docs/HYBRID_WALL_DETECTION.md
- **Topology Approach**: See docs/HYBRID_INTEGRATION.md

## 🚀 Next Steps

1. **Read** QUICK-START.md
2. **Run** your first test with defaults
3. **Analyze** the results
4. **Experiment** with different parameters
5. **Document** your findings
6. **Optimize** to achieve your goal

## 📝 Notes

- This system is designed for **iterative experimentation**
- Results are **timestamped and never overwritten**
- All parameters are **preserved with results** for reproducibility
- The system **reads directly** from your working codebase
- You can **run multiple tests** and compare them side-by-side

## 🎯 Success Criteria

You've succeeded when:
- ✅ All major walls are detected
- ✅ Exterior perimeter is complete
- ✅ Interior room divisions are clear
- ✅ Minimal false positives
- ✅ Parameters are documented
- ✅ Results are reproducible

Good luck with your wall detection optimization! 🏗️
