# Vertex Snapping Implementation

## Overview
The vertex snapping system automatically aligns perimeter vertices to detected line intersections when they are placed or dragged on the canvas. This improves precision and ensures vertices align with the underlying floor plan structure.

## Features

### 1. Intersection Snapping
- **Trigger**: When a vertex is placed (double-click) or dragged
- **Behavior**: The system searches for line intersection points within a 20-pixel radius
- **Result**: If an intersection is found, the vertex snaps exactly to that point

### 2. Secondary Alignment
- **Trigger**: After a vertex is snapped to an intersection
- **Behavior**: The system checks all other vertices within 15 pixels in the x or y direction
- **Result**: Nearby vertices are aligned to the same x or y coordinate, creating perfectly straight lines

### 3. No Snapping Fallback
- **Behavior**: If no intersection point is found within the search radius, the vertex is placed at the exact click/drag position
- **Result**: Users maintain full control when working away from detected lines

## Implementation Details

### Files Modified

#### 1. `src/utils/snappingHelper.js`
**New Functions:**
- `extractIntersectionsFromLineData(lineData)` - Extracts intersection points from line detection data
- `snapVertexToIntersection(position, intersections, snapDistance)` - Snaps a position to the nearest intersection
- `alignNearbyVertices(vertices, snappedIndex, snappedPosition, alignDistance)` - Aligns nearby vertices after snapping

**Constants:**
- `SNAP_TO_INTERSECTION_DISTANCE = 20` - Search radius for intersection snapping (pixels)
- `SECONDARY_ALIGNMENT_DISTANCE = 15` - Alignment distance for nearby vertices (pixels)

#### 2. `src/components/Canvas.jsx`
**Changes:**
- Added `lineData` prop to receive line detection data
- Added `intersectionPoints` state to store extracted intersections
- Modified `handleVertexDrag()` to apply snapping when dragging vertices
- Modified `handleStageDoubleClick()` to apply snapping when adding new vertices
- Added useEffect to extract intersection points when lineData changes

#### 3. `src/App.jsx`
**Changes:**
- Passed `lineData` prop to Canvas component (both desktop and mobile)

#### 4. `src/components/MobileUI.jsx`
**Changes:**
- Added `lineData` prop to component signature
- Passed `lineData` to Canvas component

## Usage

### For Users
1. **Load a floor plan image** with visible walls
2. **Run "Find Room" or "Trace Perimeter"** to detect lines
3. **Drag vertices** - they will snap to nearby wall intersections
4. **Double-click to add vertices** - new vertices snap to intersections
5. **Nearby vertices auto-align** - creates clean, straight edges

### For Developers
The snapping system is automatic and requires no manual intervention. Line detection data flows from:
1. `detectLines()` in `lineDetector.js` - Detects lines and intersections
2. Stored in `lineData` state in `App.jsx`
3. Passed to `Canvas` component
4. Extracted and used for snapping in vertex handlers

## Configuration

To adjust snapping behavior, modify constants in `src/utils/snappingHelper.js`:

```javascript
// Increase for more aggressive snapping (larger search radius)
export const SNAP_TO_INTERSECTION_DISTANCE = 20;

// Increase to align vertices that are further apart
export const SECONDARY_ALIGNMENT_DISTANCE = 15;
```

## Technical Notes

### Performance
- Intersection extraction happens once when lineData changes (useEffect)
- Snapping calculations use simple distance formulas (O(n) where n = intersection count)
- No performance impact on systems without line data

### Edge Cases
- **No line data**: Snapping is disabled, vertices behave normally
- **No nearby intersections**: Vertex placed at exact position
- **Multiple nearby intersections**: Snaps to the closest one
- **Alignment conflicts**: Both x and y can be aligned independently

### Future Enhancements
- Visual feedback showing snap targets (highlight nearby intersections)
- Configurable snap distance via UI settings
- Snap to line edges (not just intersections)
- Temporary snap disable (hold Shift key)
