# Snapping Control - Hold Ctrl to Disable

## Quick Guide

**Hold the Control key (Ctrl) to temporarily disable all snapping.**

### When to Use

✅ **Use snapping (default):**
- Aligning vertices to wall intersections
- Precision placement on detected corners
- Ensuring walls connect properly

🔓 **Disable snapping (hold Ctrl):**
- Fine-tuning vertex positions between snap points
- Placing vertices at exact custom locations
- Making small adjustments without jumping to snaps

## How It Works

### Visual Feedback

When you press and hold **Ctrl** (or **⌘ Cmd** on Mac):

1. **Yellow indicator appears** at top of canvas
   ```
   🔓 Snapping Disabled (Ctrl)
   ```

2. **Cursor changes** to crosshair (✚)

3. **All snapping is disabled** until you release the key

### What Gets Disabled

When Ctrl is held, the following snapping behaviors are disabled:

#### 1. Perimeter Vertex Snapping
- Vertices won't snap to detected wall intersections
- You can place/drag vertices anywhere

#### 2. Room Overlay Corner Snapping
- Room corners won't snap to wall lines
- You can position precisely between walls

#### 3. Manual Vertex Placement Snapping
- New vertices won't snap to corners
- Click exactly where you want

#### 4. Edge Insertion Snapping
- Adding new vertices between existing ones
- Won't snap to nearby corners

## Usage Examples

### Example 1: Fine-Tuning a Vertex

```
Problem: Vertex is snapping to corner but needs slight offset

Solution:
1. Start dragging the vertex
2. Hold Ctrl key
3. Position exactly where needed
4. Release mouse, then release Ctrl
```

### Example 2: Placing Vertex Between Walls

```
Problem: Need vertex in middle of room, not on walls

Solution:
1. Hold Ctrl key
2. Click where you want the vertex
3. Release Ctrl key
```

### Example 3: Adjusting Room Overlay

```
Problem: Room corner keeps snapping, need custom position

Solution:
1. Click room corner handle
2. Hold Ctrl while dragging
3. Position precisely
4. Release
```

## Keyboard Shortcuts

| Key | Action | Scope |
|-----|--------|-------|
| **Ctrl** (or **⌘**) | Disable snapping | While held |
| Release Ctrl | Re-enable snapping | Immediate |

## Technical Details

### Snap Points Detected

The system detects snap points from:
- **Wall intersections** - Where horizontal and vertical walls cross
- **Corner points** - Detected from hybrid wall detection
- **Wall centerlines** - For room overlay edges

**Typical floor plan:** 50-200 snap points

### Snap Distance

- **Vertex snapping:** 20 pixels
- **Room edge snapping:** 5 pixels
- **Secondary alignment:** 5 pixels

### When Ctrl is Pressed

All snap distance checks return `null`, allowing free positioning.

```javascript
// Snapping disabled when Ctrl pressed
const snappedPoint = isCtrlPressed ? null : findNearestIntersection(
  position,
  snapPoints,
  SNAP_TO_INTERSECTION_DISTANCE
);
```

## Best Practices

### ✅ DO

- **Use snapping by default** - Fastest way to get accurate results
- **Hold Ctrl for fine adjustments** - Small tweaks between snap points
- **Watch the indicator** - Confirms snapping is disabled
- **Release Ctrl when done** - Re-enable snapping for next action

### ❌ DON'T

- Don't disable snapping for entire workflow - slower and less accurate
- Don't forget to release Ctrl - may confuse why snapping isn't working later
- Don't use for major adjustments - snapping is more efficient

## Comparison

### Without Ctrl (Snapping Enabled)

```
Drag vertex near wall intersection
    ↓
Automatically snaps to exact corner
    ↓
Precise alignment guaranteed
    ✅ Fast & accurate
```

### With Ctrl (Snapping Disabled)

```
Hold Ctrl, drag vertex
    ↓
Position exactly where cursor is
    ↓
No automatic alignment
    ✅ Full control, custom positioning
```

## Use Cases

### Real Estate Floor Plans

**Snapping ON:** Tracing walls along detected lines  
**Snapping OFF:** Adjusting for curved walls or custom shapes

### Renovation Planning

**Snapping ON:** Aligning to existing structure  
**Snapping OFF:** Planning new walls between existing ones

### Sketch Measurements

**Snapping ON:** Following hand-drawn lines  
**Snapping OFF:** Smoothing irregular sketches

## Troubleshooting

### Issue: Snapping won't disable

**Check:**
- Is Ctrl key actually pressed? (Check indicator)
- Try releasing and pressing again
- Make sure focus is on the canvas

### Issue: Indicator doesn't show

**Cause:** Canvas might not have keyboard focus

**Solution:**
- Click on the canvas area first
- Then press Ctrl

### Issue: Snapping still seems active

**Cause:** Might be confusion between snap distance and precision

**Explanation:**
- Even with Ctrl, you can still place vertices near snap points
- Difference is: without Ctrl = jumps to snap, with Ctrl = stays at cursor

## Platform Differences

| Platform | Key |
|----------|-----|
| **Windows** | Ctrl |
| **Mac** | ⌘ Cmd or Ctrl |
| **Linux** | Ctrl |

Both `Control` and `Meta` (⌘) keys are supported for Mac compatibility.

## Mobile Support

**Note:** This feature is desktop-only. Mobile touch interface doesn't support keyboard modifiers.

For mobile:
- Snapping is always enabled
- Use tap-and-hold for delete options
- Adjust snap distance in settings (future feature)

## Performance

**No performance impact:**
- Key detection is lightweight
- Snapping calculations are only skipped (faster!)
- Visual indicator is simple overlay

## Related Features

- **Snap Points** - Auto-detected from hybrid wall system
- **Wall Detection** - Generates intersection points for snapping
- **Secondary Alignment** - Aligns nearby vertices (also disabled with Ctrl)

## Summary

| Feature | Default | With Ctrl |
|---------|---------|-----------|
| **Vertex Snapping** | ✅ Enabled | ❌ Disabled |
| **Room Edge Snapping** | ✅ Enabled | ❌ Disabled |
| **Manual Placement** | ✅ Snaps | ❌ Free |
| **Cursor** | Default | Crosshair |
| **Indicator** | Hidden | Yellow badge |
| **Speed** | Fast | Full control |

---

**Remember:** Hold Ctrl for precise control, release for fast snapping! 🎯
