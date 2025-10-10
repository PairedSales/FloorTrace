# Perimeter Detection Algorithm

## Overview

The FloorTrace application uses a **Morphological Closing + Outer Contour Detection** algorithm to detect the perimeter of condo floorplan sketches. This approach is specifically designed to handle:

- **Varying wall thicknesses** due to window openings and corner columns
- **Rectangular perimeters** with only horizontal and vertical lines
- **Text and icons** within and outside the floorplan that must be ignored
- **Black sketches on white backgrounds**

## Algorithm Pipeline

### 1. Binary Conversion
- Converts the input image to a binary image (black = 1, white = 0)
- Uses a threshold of 128 for brightness
- Dark pixels (walls, lines) become 1, light pixels (background) become 0

### 2. Morphological Closing
**Purpose:** Fill gaps in walls caused by window openings and connect broken wall segments

**Process:**
1. **Dilation** - Expands dark regions using a 15x15 kernel
   - Closes small gaps in walls
   - Connects nearby wall segments
   - Fills window openings

2. **Erosion** - Shrinks dark regions using the same 15x15 kernel
   - Restores approximate original wall size
   - Maintains the overall perimeter shape

**Result:** A solid, continuous perimeter without gaps

### 3. Outer Contour Detection
**Algorithm:** Moore-Neighbor Tracing (8-connected)

**Process:**
1. Find the topmost-leftmost black pixel as the starting point
2. Trace around the outer boundary clockwise
3. At each step, search 8 neighboring pixels in a specific order
4. Follow the boundary until returning to the start point

**Result:** A sequence of (x, y) points forming the outer contour

### 4. Vertex Extraction
**Purpose:** Identify corner points from the contour

**Process:**
1. Analyze direction changes along the contour
2. Calculate angles between consecutive segments
3. Mark points with significant angle changes (>20°) as vertices
4. Filter out vertices that are too close together (<10 pixels)

**Result:** Key corner points of the perimeter

### 5. Rectangular Simplification
**Purpose:** Align vertices to create clean horizontal/vertical edges

**Process:**
1. Classify each edge as horizontal or vertical based on dx vs dy
2. For vertices between two horizontal edges: align Y coordinates
3. For vertices between two vertical edges: align X coordinates
4. For corner vertices (horizontal + vertical): round both coordinates
5. Remove duplicate or very close vertices (<5 pixels apart)

**Result:** Clean rectangular perimeter with axis-aligned edges

## Key Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| Binary Threshold | 128 | Separates dark (walls) from light (background) |
| Morphological Kernel | 15x15 | Size of closing operation to fill gaps |
| Angle Threshold | 20° | Minimum angle change to detect a corner |
| Min Segment Length | 10 px | Minimum distance between vertices |
| Min Vertex Distance | 5 px | Minimum distance to avoid duplicates |

## Advantages

1. **Robust to gaps** - Morphological closing fills window openings automatically
2. **Handles varying thickness** - Contour detection finds the outer boundary regardless of wall thickness
3. **Ignores interior details** - Only traces the outermost perimeter, ignoring text and interior walls
4. **Rectangular alignment** - Ensures clean horizontal/vertical edges as required
5. **Automatic** - No manual parameter tuning needed for typical floorplans

## Fallback Mechanism

If morphological detection fails (e.g., no contour found), the system automatically falls back to:
- **Line-based detection** - Uses the original line detection algorithm
- **Manual mode** - Allows users to manually draw the perimeter

## Files

- `src/utils/morphologicalPerimeterDetector.js` - Main implementation
- `src/utils/perimeterDetector.js` - Integration and fallback logic
- `src/utils/lineDetector.js` - Legacy line-based detection (fallback)

## Testing

To test the algorithm:
1. Load a floorplan image (black on white background)
2. Click "Trace Perimeter" in the application
3. Verify that vertices are placed at corners
4. Check console logs for detection progress

## Future Improvements

Potential enhancements:
- Adaptive kernel size based on image resolution
- Multi-scale detection for very large or small images
- Machine learning-based corner detection
- Support for non-rectangular perimeters (curved walls)
