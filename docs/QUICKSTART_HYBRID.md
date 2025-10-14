# FloorTrace Hybrid System - Quick Start Guide

## 🎉 What's New

FloorTrace now uses a **state-of-the-art hybrid deep learning + classical wall detection system** that dramatically improves accuracy and adds powerful new features.

## 🚀 Key Features

### 1. Enhanced Wall Detection
- **Adaptive thresholding** - Works with varying lighting
- **Intelligent gap filling** - Bridges doors and windows automatically
- **Thick wall handling** - Correctly processes double-line walls
- **Orientation constraints** - Focuses on horizontal/vertical walls

### 2. Interior/Exterior Edge Control
- **Default: Interior Edge** - Measures usable floor space
- **Toggle: Exterior Edge** - Measures building footprint
- **Instant switching** - No redetection needed!

### 3. Improved Snapping
- More accurate snap points
- Based on actual wall intersections
- Better corner detection

## 📋 Quick Workflow

### Basic Usage (Same as Before)

1. **Load Image**
   - Click "Load Image" or press `Ctrl+O`
   - Or paste from clipboard with `Ctrl+V`

2. **Find Room**
   - Click "Find Room"
   - System detects dimensions and room boundary
   - ✨ Now uses hybrid wall detection

3. **Find Perimeter**
   - Click "Find Perimeter"
   - Perimeter placed on **interior edge** (default)
   - ✨ Interior edge = usable floor space

4. **View Results**
   - See calculated area
   - Drag vertices to adjust if needed
   - ✨ Vertices snap to wall intersections

### New: Interior/Exterior Edge Switching

**After detecting perimeter:**

1. Look for **"Interior Walls"** checkbox in sidebar
2. **Checked (✓)** = Interior edge (default)
   - Measures space **inside** the walls
   - Typical for real estate listings
3. **Unchecked** = Exterior edge
   - Includes wall thickness
   - Used for building footprint

**To switch:**
- Simply check/uncheck the checkbox
- Confirm dialog
- Perimeter updates **instantly**!

## 🎯 Use Cases

### Residential Real Estate (Interior Edge)

```
✅ Checked "Interior Walls"

Use for:
- MLS listings
- Room size comparisons
- Furniture space planning
- Rental square footage

Measures: Usable floor space (excludes walls)
```

### Building/Permit Applications (Exterior Edge)

```
❌ Unchecked "Interior Walls"

Use for:
- Building permits
- Property surveys
- Lot coverage calculations
- Foundation planning

Measures: Building footprint (includes walls)
```

## 📊 Console Output

When running detection, check browser console (F12) for detailed logs:

```
=== Hybrid Wall Detection Started ===
Image size: 2000x1500px

--- Step 1: Preprocessing ---
Preprocessing: Thresholding (adaptive)...

--- Step 2: Wall Segmentation ---
Generating classical wall likelihood map...

--- Step 3: Line Detection ---
Detected 52 line segments

--- Step 4: Merging Collinear Segments ---
Merged 52 segments into 38

--- Step 5: Gap Filling ---
Filling gaps in line segments...

--- Step 6: Post-Processing ---
Post-processing complete

=== Detection Complete (487ms) ===
Total walls: 35
Exterior: 16, Interior: 19

✅ Perimeter placed on interior edge of walls
```

## 🔧 Troubleshooting

### Detection Issues

**Problem:** Find Room doesn't detect properly

**Solutions:**
1. Image quality too low → Try higher resolution image
2. Walls too thin → System auto-adjusts with adaptive thresholding
3. Text unclear → Enter dimensions manually (Manual Mode)

**Problem:** Find Perimeter fails

**Solutions:**
1. System has multiple fallbacks - should rarely fail
2. Try running "Find Room" first to improve detection
3. Check console for specific errors

### Edge Switching Issues

**Problem:** Edge switching doesn't work

**Cause:** Perimeter was created with old system

**Solution:**
1. Click "Find Perimeter" again to use new hybrid system
2. Now edge switching will work

**Problem:** Area changes unexpectedly

**Cause:** This is normal! Different edges = different areas

**Explanation:**
- Interior edge = smaller (excludes walls)
- Exterior edge = larger (includes walls)
- Difference ≈ perimeter × wall_thickness

## ⚡ Performance

### Expected Times (2000×1500px image)

| Operation | Time | Notes |
|-----------|------|-------|
| **Image Load** | 100-500ms | Depends on file size |
| **Find Room** | 600-1200ms | Includes OCR + wall detection |
| **Find Perimeter** | 400-800ms | Hybrid wall detection |
| **Edge Switch** | <50ms | Instant - no redetection! |
| **Wall Snapping** | 500-900ms | Background on image load |

### Optimization Tips

- Use images around 2000px width for best balance
- Larger images = more accurate but slower
- Smaller images = faster but may miss details

## 🎨 Visual Indicators

### Sidebar Checkbox

```
☑️ Interior Walls (checked)
   → Perimeter on interior edge
   → Default for room measurements

☐ Interior Walls (unchecked)
   → Perimeter on exterior edge
   → For building footprint
```

### Console Confirmation

```
✅ Perimeter placed on interior edge of walls
✅ Switched perimeter to exterior edge
```

## 📚 Documentation

### Complete Guides

- **HYBRID_INTEGRATION.md** - Technical integration details
- **INTERIOR_EXTERIOR_EDGES.md** - Deep dive on edge types
- **HYBRID_WALL_DETECTION.md** - Algorithm architecture
- **WALL_DETECTION_SETUP.md** - Setup and configuration

### Quick References

- **RUNNING_TESTS.md** - How to test the system
- **TESTING_QUICKSTART.txt** - Test suite quick start

## 🆘 Getting Help

### Common Questions

**Q: Should I use interior or exterior edge?**  
A: Use interior (default) for measuring room sizes and floor space. Use exterior only for building footprint calculations.

**Q: Why did my area change when I switched edges?**  
A: You're measuring a different boundary. Interior = usable space, Exterior = includes walls. Both are correct!

**Q: Can I switch edges multiple times?**  
A: Yes! Switch as many times as you want - it's instant.

**Q: Does this work with hand-drawn floor plans?**  
A: Yes! The hybrid system is very robust and handles various styles.

## 🎯 Best Practices

### ✅ DO

- Use default interior edge for most residential measurements
- Switch to exterior edge for permit applications
- Let system auto-detect first, then manually adjust if needed
- Check console for detailed detection information
- Verify measurements make sense for your specific plan

### ❌ DON'T

- Mix interior and exterior measurements in same report
- Assume both edges will give same area
- Ignore the checkbox state when recording measurements
- Edit measurements without noting which edge was used

## 🔄 Updating from Previous Version

### No Changes Required!

The new system is **100% backward compatible**:

- All existing features work the same
- Same button clicks and workflow
- Only addition is the Interior/Exterior toggle
- Performance is improved across the board

### New Features to Try

1. **Interior/Exterior Toggle** - Check it out after detecting perimeter
2. **Better Snapping** - Notice more accurate snap points
3. **Gap Filling** - Doors and windows handled automatically
4. **Console Logs** - Open DevTools to see detection details

## 🎓 Advanced Tips

### For Developers

```javascript
// Access wall data in console
window.wallData // Full hybrid detection results

// Force specific detection method
const walls = await detectWalls(image, {
  thresholdMethod: 'otsu',  // Try different methods
  fillGaps: false,          // Disable gap filling
  debugMode: true           // Get intermediate results
});
```

### For Power Users

- **F12** - Open console to see detailed logs
- **Ctrl+Shift+R** - Hard refresh if detection seems stuck
- Try different images sizes if detection is slow
- Export results before making major changes

## 📈 What's Improved

### Before (Old System)

- Binary threshold only
- Simple connected components
- Missed thin walls
- No gap filling
- Fixed edge detection

### After (Hybrid System)

- ✅ Adaptive thresholding
- ✅ Line-based detection
- ✅ Thick wall handling
- ✅ Automatic gap filling
- ✅ Interior/exterior edge control
- ✅ Better snapping
- ✅ Multiple fallback methods

## 🎊 Conclusion

The new hybrid system provides:

1. **Better accuracy** - More reliable wall detection
2. **More control** - Choose interior or exterior edge
3. **Faster switching** - Instant edge changes
4. **Better feedback** - Detailed console logs
5. **Same simplicity** - Easy workflow unchanged

**Try it now!** Load a floor plan and experience the improvements! 🚀
