# Interior vs Exterior Wall Edges - User Guide

## What's the Difference?

When FloorTrace detects the perimeter of your floor plan, it needs to decide where to place the vertices: on the **interior edge** (inner face) or **exterior edge** (outer face) of the exterior walls.

### Visual Explanation

```
                EXTERIOR EDGE (outer face)
                        ↓
        ╔═══════════════════════════════════╗
        ║                                   ║  ← Wall (thickness ~10-15px)
        ╚═══════════════════════════════════╝
                        ↑
                INTERIOR EDGE (inner face)
```

## When to Use Each

### Use Interior Edge (Default) ✅

**Best for:**
- Measuring **usable floor space**
- Calculating **interior square footage** for real estate listings
- Determining **furniture placement area**
- Comparing room sizes for renovation planning

**Example:**
```
Room: 12' x 10'
Interior perimeter: 44 feet
Interior area: ~120 sq ft (actual usable space)
```

### Use Exterior Edge

**Best for:**
- Measuring **building footprint**
- Calculating **exterior dimensions** for permits
- Determining **lot coverage**
- Architectural planning and foundation sizing

**Example:**
```
Room: 12' x 10'
Exterior perimeter: ~45.5 feet (includes wall thickness)
Exterior area: ~125 sq ft (includes walls)
```

## How to Switch

### Method 1: Before Detection

1. Load your floor plan image
2. **Check or Uncheck** "Interior Walls" checkbox in sidebar
3. Click "Find Perimeter"
4. Perimeter will be placed on the selected edge

### Method 2: After Detection (Instant Switch)

1. Already have a perimeter detected
2. **Check or Uncheck** "Interior Walls" checkbox
3. Confirm the dialog: "Switch perimeter to [interior/exterior] edge?"
4. **Perimeter updates instantly** (no redetection needed!)

## Technical Details

### How It Works

1. **Wall Detection** - System detects exterior walls and their thickness
2. **Centerline Calculation** - Finds the center of each wall
3. **Edge Calculation** - Shifts vertices inward (interior) or outward (exterior)

```javascript
// Interior Edge
interiorVertex = centerVertex + (wallThickness / 2) * directionToCenter

// Exterior Edge  
exteriorVertex = centerVertex - (wallThickness / 2) * directionFromCenter
```

### Wall Thickness Estimation

The system **automatically estimates** wall thickness by:
1. Analyzing detected exterior wall segments
2. Measuring average wall width
3. Applying appropriate offset for edge placement

**Typical wall thicknesses:**
- Residential interior: ~4-6 inches (10-15px at typical scale)
- Residential exterior: ~6-8 inches (15-20px)
- Commercial: ~8-12 inches (20-30px)

## Area Calculation Impact

### Example Floor Plan

```
Dimensions: 20' × 15' (from OCR)
Wall thickness: 6 inches (0.5 feet)
```

**Interior Edge (Default):**
```
Interior dimensions: 20' × 15'
Perimeter: (20 + 15) × 2 = 70 feet
Area: 20 × 15 = 300 sq ft
```

**Exterior Edge:**
```
Exterior dimensions: 21' × 16' (adds 1 foot to each dimension)
Perimeter: (21 + 16) × 2 = 74 feet  
Area: 21 × 16 = 336 sq ft
```

**Difference:** 36 sq ft (12% larger on exterior)

## Real Estate & Legal Considerations

### What Real Estate Agents Measure

**In the United States:**
- Most real estate listings use **interior measurements** (GLA - Gross Living Area)
- Excludes wall thickness, garages, unfinished basements
- Measured to interior face of exterior walls

**In Commercial Real Estate:**
- Often uses **exterior measurements** or **usable square footage**
- May include common areas differently
- Check local standards (BOMA, ANSI, etc.)

### Recommendation

**For Home Listings:** Use **Interior Edge** (default) ✅  
**For Building Permits:** Use **Exterior Edge**  
**For Insurance:** Check with your provider (usually interior)

## Troubleshooting

### Issue: Edge switching doesn't work

**Cause:** Perimeter was created before hybrid system integration

**Solution:**
1. Delete perimeter
2. Click "Find Perimeter" again to use new hybrid system
3. Now edge switching will work instantly

### Issue: Area seems wrong after switching

**Cause:** Area calculation is correct - it's just measuring a different boundary

**Solution:**
- Interior edge = smaller area (excludes walls)
- Exterior edge = larger area (includes walls)
- Both are correct, just measuring different things!

### Issue: Perimeter moves incorrectly

**Cause:** Wall thickness estimation may be off

**Solution:**
- Try redetecting perimeter with different settings
- Currently, wall thickness is auto-detected
- Future versions may allow manual adjustment

## Keyboard Shortcut

**Coming Soon:**
- `Ctrl+E` - Toggle interior/exterior edge
- `Ctrl+Shift+E` - Show both edges simultaneously

## API for Developers

### Detecting with Specific Edge

```javascript
import { detectPerimeter } from './utils/perimeterDetector';

// Detect on interior edge (default)
const interiorResult = await detectPerimeter(image, true);

// Detect on exterior edge
const exteriorResult = await detectPerimeter(image, false);
```

### Switching Edges

```javascript
import { switchPerimeterEdge } from './utils/perimeterDetectorHybrid';

// Fast switch without redetection
const newResult = switchPerimeterEdge(currentPerimeter, useInteriorWalls);
```

## Visual Comparison

### Small Room (12' × 10')

```
┌─────────────────────────────┐  } Exterior Edge
│ ╔═══════════════════════════╗│  } Wall
│ ║                           ║│
│ ║  Interior Edge            ║│  12' × 10' = 120 sq ft
│ ║                           ║│
│ ╚═══════════════════════════╝│
└─────────────────────────────┘  } 12.5' × 10.5' = 131 sq ft

Difference: 11 sq ft
```

### Large Room (20' × 30')

```
┌───────────────────────────────────────┐  } Exterior
│ ╔═══════════════════════════════════╗ │
│ ║                                   ║ │
│ ║                                   ║ │
│ ║     Interior Edge Area            ║ │
│ ║     20' × 30' = 600 sq ft         ║ │
│ ║                                   ║ │
│ ║                                   ║ │
│ ╚═══════════════════════════════════╝ │
└───────────────────────────────────────┘
      21' × 31' = 651 sq ft (exterior)

Difference: 51 sq ft
```

## Best Practices

### ✅ DO

- Use **interior edge** for general room measurements
- Use **exterior edge** for building footprint
- Switch edges to compare measurements
- Document which edge type you're using in reports

### ❌ DON'T

- Mix interior and exterior measurements in same report
- Assume both measurements will be identical
- Use wrong edge type for legal/permit documents
- Forget to specify edge type when sharing measurements

## Summary

| Aspect | Interior Edge | Exterior Edge |
|--------|--------------|---------------|
| **Default** | ✅ Yes | No |
| **Measures** | Usable floor space | Building footprint |
| **Includes Walls** | No | Yes |
| **Area** | Smaller | Larger |
| **Real Estate** | Standard | Rare |
| **Permits** | Sometimes | Often |
| **Switching Speed** | Instant | Instant |

---

**Remember:** Interior edge (default) is what most people need for measuring room sizes and floor space. Use exterior edge only when you specifically need to include wall thickness in your measurements.
