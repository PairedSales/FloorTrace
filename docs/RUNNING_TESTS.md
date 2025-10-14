# Running Wall Detection Tests

## CORS Error Fix

The test HTML files use ES6 modules which **cannot** be loaded from `file://` protocol due to browser security (CORS policy).

## ✅ Solution: Use Vite Dev Server

### Method 1: Quick Start (Recommended)

```bash
# From the FloorTrace directory
npm run dev
```

Then open in your browser:
- **Deep Testing Suite** (NEW): http://localhost:5173/test-wall-detection.html
- **Perimeter Test**: http://localhost:5173/test-perimeter-tracing.html

### Method 2: Alternative HTTP Server

If Vite isn't working, use any HTTP server:

```bash
# Option A: Using Python
python -m http.server 8000

# Option B: Using Node.js http-server (install globally first)
npx http-server -p 8000

# Option C: Using PHP
php -S localhost:8000
```

Then open:
- http://localhost:8000/test-room-finding.html
- http://localhost:8000/test-perimeter-tracing.html

## 🧪 Test Features

### 🆕 Deep Testing Suite (`test-wall-detection.html`) - RECOMMENDED

**The most comprehensive testing system with step-by-step validation:**

**What it tests:**
1. ✅ **Preprocessing & Binarization** - Grayscale conversion, thresholding, noise removal
2. ✅ **Wall Segmentation** - Likelihood map generation with validation
3. ✅ **Line Detection** - Edge detection and line segment extraction
4. ✅ **Collinear Merging** - Segment consolidation
5. ✅ **Gap Filling** - Door/window gap bridging
6. ✅ **Post-Processing** - Filtering, snapping, classification
7. ✅ **Complete Pipeline** - Full integration test with perimeter
8. ✅ **Room Finding** - OCR + room boundary detection

**Features:**
- ⚡ Real-time progress tracking
- ✓ Automated assertions for each step
- 📊 Detailed metrics (timing, counts, ratios)
- 🎨 Rich visualizations (heatmaps, overlays, comparisons)
- 💾 Exportable JSON test reports
- 🔍 Collapsible sections for detailed inspection
- ⚠️ Warning and error detection

**Interactive Controls:**
- Min Wall Length (10-500px)
- Threshold Method (Adaptive/Otsu/Global)
- Max Gap Length (20-300px)
- Gap Filling toggle
- Orientation Constraints toggle
- OCR toggle

**See TESTING_SYSTEM.md for complete documentation.**

### Perimeter Tracing Test (`test-perimeter-tracing.html`)

Tests perimeter detection:
1. Wall detection
2. Exterior wall identification
3. Perimeter polygon construction

## 📊 What to Look For

### Success Indicators
✅ Walls detected (30-100 segments typical)
✅ Exterior walls identified (15-30 typical)
✅ Interior walls separated
✅ Clean perimeter polygon
✅ Detection time < 1 second
✅ OCR dimensions found

### Common Issues

#### Too Many False Positives
**Symptom:** Furniture, text detected as walls

**Solution:**
- Increase "Min Wall Length" to 75-100
- Threshold Method: "Otsu" (automatic)
- Keep "Fill Gaps" enabled

#### Missing Walls
**Symptom:** Some walls not detected

**Solution:**
- Decrease "Min Wall Length" to 30-40
- Threshold Method: "Adaptive"
- Enable "Fill Gaps"

#### Broken Walls
**Symptom:** Walls appear disconnected

**Solution:**
- Enable "Fill Gaps"
- Threshold Method: "Adaptive"
- Increase "Min Wall Length" slightly

## 🔬 Debug Mode

Both tests run with `debugMode: true` automatically. Check browser console for:

```
=== Hybrid Wall Detection Started ===
Image size: 1200x900px

--- Step 1: Preprocessing ---
Preprocessing: Converting to grayscale...
Preprocessing: Thresholding (adaptive)...

--- Step 2: Wall Segmentation ---
Generating classical wall likelihood map...

--- Step 3: Line Detection ---
Detecting line segments...
Found 87 edge chains
Detected 52 line segments

--- Step 4: Merging Collinear Segments ---
Merged 52 segments into 38

--- Step 5: Gap Filling ---
Filling gaps in line segments...

--- Step 6: Post-Processing ---
Starting post-processing pipeline...
Length filter: 38 -> 35 segments
Orientation filter: 35 -> 35 segments

--- Step 7: Format Conversion ---

--- Step 8: Building Perimeter ---
Built perimeter with 12 vertices

=== Detection Complete (487.23ms) ===
Total walls: 35
Horizontal: 18, Vertical: 17
Exterior: 16, Interior: 19
```

## 🎨 Visualization Legend

### Wall Colors
- **Red**: Horizontal walls
- **Blue**: Vertical walls
- **Green**: Exterior walls
- **Purple**: Interior walls

### Room Finding Colors
- **Yellow dashed**: OCR dimension bounding boxes
- **Lime/Green**: Detected room boundaries

## 📝 Export Reports

Click "💾 Export Report" to download JSON with:
- Detection statistics
- Performance timing
- Dimension locations
- Wall counts

## 🚀 Performance Expectations

**Typical 2000×1500px floor plan:**

| Stage | Time | Notes |
|-------|------|-------|
| Preprocessing | 50-100ms | Adaptive thresholding |
| Segmentation | 200-400ms | Classical fallback |
| Line Detection | 100-200ms | Edge detection + LSD |
| Post-Processing | 50-100ms | Filtering + snapping |
| **Total** | **400-800ms** | Complete pipeline |

**Slower than expected?**
- Check image size (downscale large images)
- Disable debug mode in production
- Close other browser tabs

## 🆘 Troubleshooting

### Still Getting CORS Errors?

**Check:**
1. ✅ Dev server is running (`npm run dev`)
2. ✅ Opening http://localhost:5173/test-room-finding.html (not `file://`)
3. ✅ Dependencies installed (`npm install`)

### Module Import Errors?

**Solution:**
```bash
# Reinstall dependencies
npm install

# Clear cache and restart
npm run dev -- --force
```

### TensorFlow.js Errors?

The system uses **classical fallback** by default. If you see TensorFlow warnings, they're safe to ignore unless you specifically enabled CNN mode.

### Visualization Not Showing?

**Check browser console** for:
- Image loading errors
- Canvas rendering issues
- Memory errors (reduce image size)

## 📚 Related Documentation

- **HYBRID_WALL_DETECTION.md** - Algorithm architecture
- **WALL_DETECTION_SETUP.md** - Integration guide
- **ALGORITHM_FLOWCHARTS.md** - Original algorithm docs

## ✨ New in Hybrid System

Compared to the old test system:

✅ **New Features:**
- Adaptive thresholding options
- Gap filling controls
- Performance timing display
- Enhanced visualizations
- Debug console output
- Configurable parameters

✅ **Improvements:**
- Better wall detection accuracy
- Cleaner line detection
- Smarter gap bridging
- Faster processing
- More robust to noise

## 🎯 Next Steps

1. **Run the tests** via Vite dev server
2. **Adjust parameters** for your floor plans
3. **Export reports** for analysis
4. **Integrate** into your main app

The hybrid system is production-ready! 🚀
