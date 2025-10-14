# Wall Detection Systems in FloorTrace

## ⚠️ IMPORTANT: Which System to Use

**USE THE TOPOLOGY-GUIDED SYSTEM** - It is the primary, production system and matches the project specifications.

The Classical Wall Detection System exists but is **NOT the primary system** and should be considered experimental/alternative.

---

## Overview

FloorTrace has **TWO distinct wall detection systems**:

1. **Topology-Guided System** ⭐ (PRIMARY - Currently Active in App.jsx)
2. **Classical Wall Detection System** (Alternative - NOT integrated in App.jsx)

## System Comparison

### 1. Topology-Guided System ⭐ (ACTIVE)

**Location:** `src/utils/topology*.js`

**Components:**
- `topologyRoomDetector.js` - Room detection using graph cycles
- `topologyPerimeterTracer.js` - Perimeter tracing using graph traversal
- `segmentDetection.js` - OpenCV Canny + Hough line detection
- `topologyGraph.js` - Adjacency graph with spatial indexing
- `lineMerging.js` - Collinear segment merging
- `wallClassifier.js` - Wall classification and quality scoring

**Approach (Matches Project Specs):**
1. **Strong line segment detector** - OpenCV Canny edge detection + Hough Transform
2. **Connectivity graph** - Full adjacency structure with nodes, edges, junctions
3. **Prune & merge segments** - Collinear chain building with confidence scoring  
4. **Classify walls** - Using orientation, thickness, length, adjacency constraints
5. **Deterministic & debuggable** - Comprehensive test suite, parameterizable

**Key Features:**
- Topologically structured line graph
- Room detection via cycle detection
- Perimeter tracing via connected components
- Interior/exterior edge selection
- Spatial indexing for performance

**Status:** ✅ **PRIMARY SYSTEM - Currently integrated in App.jsx**

**Documentation:**
- `TOPOLOGY_SYSTEM_README.md` ⭐ **START HERE**
- `TOPOLOGY_IMPLEMENTATION_GUIDE.md`
- `TOPOLOGY_SNAPPING_GUIDE.md`
- `TOPOLOGY_TESTING.md`

### 2. Classical Wall Detection System

**Location:** `src/utils/wallDetector.js`, `roomDetector.js`, `perimeterDetector.js`

**Components:**
- `wallDetector.js` - Main detection engine (classical only)
- `imagePreprocessor.js` - Adaptive thresholding & morphology
- `wallSegmentation.js` - Classical likelihood map generation
- `lineRefinement.js` - Line segment detection (LSD-style)
- `gapFilling.js` - Intelligent gap bridging
- `wallPostProcessing.js` - Filtering, snapping, classification
- `roomDetector.js` - Room detection from walls (simplified)
- `perimeterDetector.js` - Perimeter detection from walls (simplified)
- `perimeterDetectorHybrid.js` - Interior/exterior edge calculation

**Approach:**
- Preprocessing with adaptive thresholding
- Classical segmentation (binary to likelihood map)
- Line detection and refinement
- Morphological operations for gap filling
- Post-processing with geometric constraints
- Direct wall-based room and perimeter detection

**Status:** ⚠️ **Not currently integrated in App.jsx** (though code exists and is functional)

**Note:** CNN/trained model functionality has been **removed** - system now uses classical image processing only

**Documentation:**
- `HYBRID_WALL_DETECTION.md` (renamed from "Hybrid" but now describes classical approach)
- `WALL_DETECTION_SETUP.md`

## Recent Changes (Oct 2025)

### Removal of CNN/Trained Model Functionality

**Decision:** CNN-based wall segmentation has been **removed** from the codebase.

**Rationale:** The project decided not to implement the trained model approach.

**Changes:**
- `wallSegmentation.js` - Removed all TensorFlow.js and CNN code, kept only classical method
- `wallDetector.js` - Removed `useCNN` and `cnnModelPath` parameters
- Updated documentation to remove CNN references
- System now uses purely classical image processing

### Simplification of Classical System

The following files were simplified to use `detectWalls()` directly:

1. **`roomDetector.js`**
   - Removed complex fallback logic (morphological, line-based)
   - Now uses `detectWalls()` and `findRoomFromWalls()` directly
   - Simple fallback only for error cases

2. **`perimeterDetector.js`**
   - Removed multiple fallback methods (morphological, line-based)
   - Now uses `detectWalls()` to get perimeter directly
   - Uses `calculateInteriorEdge()` / `calculateExteriorEdge()` for edge selection
   - Reuses wall data when available (no redundant detection)

3. **`perimeterDetectorHybrid.js`**
   - Exported `calculateInteriorEdge()` and `calculateExteriorEdge()` functions
   - These handle shifting perimeter vertices inward/outward by wall thickness

## Interior vs Exterior Edges 🏠

Both systems support interior/exterior edge selection:

### For Condo Floor Plans (Default: Interior)
- **Interior edge:** Inner face of walls (living space)
- Use for calculating interior square footage
- Default in current implementation (`useInteriorWalls = true`)

### For Exterior Walls (Optional)
- **Exterior edge:** Outer face of walls (building envelope)
- Use for property boundaries
- Available via toggle in UI

## Architecture Decision Needed ⚠️

**Question:** Which system should be the primary system moving forward?

### Option A: Keep Topology System (Current)
- ✅ Already integrated in App.jsx
- ✅ Full graph-based analysis
- ✅ Well-documented and tested
- ✅ Works with `tracePerimeter()` and `detectRoom()`

### Option B: Switch to Hybrid System
- ✅ CNN-based semantic filtering (optional)
- ✅ More sophisticated preprocessing
- ✅ Just simplified for easier use
- ❌ Not currently integrated in App.jsx
- ❌ Would require App.jsx modifications

### Option C: Hybrid Approach
- Use Hybrid Wall Detection for initial wall finding
- Feed results into Topology System for graph analysis
- Best of both worlds but more complex

## Migration Status

According to `MIGRATION_GUIDE.md`:
- Topology system REPLACED old detection systems
- `wallDetector.js`, `roomDetector.js`, `perimeterDetector.js` marked as DEPRECATED
- However, `HYBRID_WALL_DETECTION.md` describes wall detection as "completely rewritten" and "new"

**This suggests two possible scenarios:**
1. Hybrid system was developed first, then replaced by topology system
2. Both systems were developed in parallel for different use cases
3. Documentation needs updating to reflect current architecture

## Recommendations ⭐

### For Development & Testing

1. **Use Topology-Guided System** - It's the production system and matches project specs
2. **Follow TOPOLOGY_SYSTEM_README.md** - Primary documentation
3. **Run Topology tests** - `npm test` for comprehensive test suite
4. **Use existing integration** - App.jsx already correctly uses Topology system

### Architecture Decisions

1. ✅ **Primary System**: Topology-Guided (already integrated)
2. ⚠️ **Classical System**: Consider experimental/alternative, not for production
3. ✅ **Interior edges**: Default for condo floor plans (already implemented)
4. ✅ **Exterior edge toggle**: Available in UI (already implemented)

### What NOT to Do

❌ Don't switch App.jsx to use Classical system (wallDetector.js)
❌ Don't prioritize Classical system documentation
❌ Don't write tests for Classical system as primary approach

## File Status

### Active (Topology System)
- ✅ `topologyRoomDetector.js`
- ✅ `topologyPerimeterTracer.js`
- ✅ `segmentDetection.js`
- ✅ `topologyGraph.js`
- ✅ `lineMerging.js`
- ✅ `wallClassifier.js`

### Simplified (Hybrid System)
- 🔧 `roomDetector.js` - Simplified to use detectWalls directly
- 🔧 `perimeterDetector.js` - Simplified to use detectWalls directly
- 🔧 `perimeterDetectorHybrid.js` - Exported edge calculation functions

### Core (Hybrid System)
- 📦 `wallDetector.js` - Full hybrid wall detection pipeline
- 📦 `imagePreprocessor.js`
- 📦 `wallSegmentation.js`
- 📦 `lineRefinement.js`
- 📦 `wallCenterline.js`
- 📦 `gapFilling.js`
- 📦 `wallPostProcessing.js`

## Next Steps

### ✅ Your Current Setup is CORRECT

**App.jsx is already using the right system:**
```javascript
// ✅ CORRECT - Keep these imports
import { detectRoom, detectAllDimensions } from './utils/topologyRoomDetector';
import { tracePerimeter, switchPerimeterEdge } from './utils/topologyPerimeterTracer';
```

**No changes needed to App.jsx** - it already matches your project specifications.

### For Development

1. **Reference Topology documentation:**
   - Read `TOPOLOGY_SYSTEM_README.md` for overview
   - See `TOPOLOGY_IMPLEMENTATION_GUIDE.md` for details
   - Check `TOPOLOGY_TESTING.md` for test patterns

2. **Run existing tests:**
   ```bash
   npm test                    # All tests
   npm test:integration        # Integration tests only
   npm test:ui                 # Interactive test UI
   ```

3. **Use existing topology files:**
   - `segmentDetection.js` - Line detection (Hough)
   - `topologyGraph.js` - Adjacency graph
   - `lineMerging.js` - Segment merging
   - `wallClassifier.js` - Wall classification

### Classical System (Optional)

The Classical system (`wallDetector.js`, etc.) can be:
- Kept as alternative approach
- Used for experimentation
- Ignored for production development

---

*Last Updated: October 13, 2025*
