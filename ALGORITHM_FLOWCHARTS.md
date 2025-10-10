# Algorithm Flowcharts

## Perimeter Detection Algorithm Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    START: Perimeter Detection                │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Load Image    │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Convert to     │
                    │ Binary Image   │
                    │ (threshold=128)│
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Morphological  │
                    │ Closing        │
                    │ (15x15 kernel) │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Find Outer     │
                    │ Contour        │
                    │ (Moore-Neighbor)│
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Extract        │
                    │ Vertices       │
                    │ (angle > 20°)  │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Simplify &     │
                    │ Align to Axes  │
                    └────────┬───────┘
                             │
                             ▼
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
         ┌──────────┐              ┌──────────┐
         │ Success? │──YES──────▶  │ Return   │
         │          │              │ Vertices │
         └────┬─────┘              └──────────┘
              │
              NO
              │
              ▼
         ┌──────────┐
         │ Fallback │
         │ to Line  │
         │ Detection│
         └──────────┘
```

## Room Detection Algorithm Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     START: Room Detection                    │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
                    ┌────────────────┐
                    │  Load Image    │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Run OCR        │
                    │ (Tesseract.js) │
                    └────────┬───────┘
                             │
                             ▼
                    ┌────────────────┐
                    │ Parse First    │
                    │ Dimension Text │
                    │ & Get BBox     │
                    └────────┬───────┘
                             │
                             ▼
                ┌────────────┴────────────┐
                │                         │
                ▼                         ▼
         ┌──────────┐              ┌──────────┐
         │ Found?   │──NO───────▶  │ Return   │
         │          │              │ NULL     │
         └────┬─────┘              └──────────┘
              │
              YES
              │
              ▼
    ┌─────────────────────┐
    │ PRIMARY METHOD:     │
    │ Morphological       │
    │ Flood-Fill          │
    └──────────┬──────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Convert to Binary    │
    │ & Invert             │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Flood-Fill from      │
    │ Dimension Center     │
    │ (BFS, 4-connected)   │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Find Bounding Box    │
    │ of Filled Region     │
    └──────────┬───────────┘
               │
               ▼
    ┌──────────────────────┐
    │ Refine Box to        │
    │ Align with Walls     │
    └──────────┬───────────┘
               │
               ▼
         ┌─────────┐
         │Success? │──YES──┐
         └────┬────┘       │
              │            │
              NO           │
              │            │
              ▼            │
    ┌─────────────────┐   │
    │ FALLBACK 1:     │   │
    │ Line-Based      │   │
    │ Detection       │   │
    └────────┬────────┘   │
             │            │
             ▼            │
       ┌─────────┐       │
       │Success? │──YES──┤
       └────┬────┘       │
            │            │
            NO           │
            │            │
            ▼            │
    ┌─────────────────┐ │
    │ FALLBACK 2:     │ │
    │ Legacy Line     │ │
    │ Detection       │ │
    └────────┬────────┘ │
             │          │
             ▼          │
       ┌─────────┐     │
       │Success? │─YES─┤
       └────┬────┘     │
            │          │
            NO         │
            │          │
            ▼          │
    ┌─────────────────┐│
    │ FALLBACK 3:     ││
    │ Simple Padding  ││
    │ (50px)          ││
    └────────┬────────┘│
             │         │
             └─────────┘
                  │
                  ▼
            ┌──────────┐
            │ Return   │
            │ Room Box │
            └──────────┘
```

## Morphological Closing Detail

```
Input Binary Image
        │
        ▼
┌───────────────┐
│   DILATION    │  ← Expands dark regions
│               │    (15x15 kernel)
│  ████  ████   │
│  ████  ████   │    Fills gaps between walls
│  ████  ████   │
│  ████████████ │
└───────┬───────┘
        │
        ▼
┌───────────────┐
│   EROSION     │  ← Shrinks dark regions
│               │    (15x15 kernel)
│  ████████████ │
│  ████████████ │    Restores approximate size
│  ████████████ │
│  ████████████ │
└───────┬───────┘
        │
        ▼
Closed Binary Image
(gaps filled, size restored)
```

## Flood-Fill Detail

```
Start Point (Dimension Center)
        │
        ▼
┌───────────────────────────┐
│     ░░░░░░░░░░░░░░░       │  ░ = White space (room)
│     ░           ░         │  █ = Black wall
│     ░     ●     ░         │  ● = Seed point
│     ░           ░         │  ▓ = Filled pixels
│     ░░░░░░░░░░░░░░░       │
└───────────────────────────┘
        │
        ▼ (BFS expansion)
┌───────────────────────────┐
│     ░░░░░░░░░░░░░░░       │
│     ░ ▓▓▓▓▓▓▓▓▓ ░         │
│     ░ ▓▓▓●▓▓▓▓▓ ░         │
│     ░ ▓▓▓▓▓▓▓▓▓ ░         │
│     ░░░░░░░░░░░░░░░       │
└───────────────────────────┘
        │
        ▼ (Continue until walls)
┌───────────────────────────┐
│     ░░░░░░░░░░░░░░░       │
│     ░▓▓▓▓▓▓▓▓▓▓▓░         │
│     ░▓▓▓▓▓▓▓▓▓▓▓░         │
│     ░▓▓▓▓▓▓▓▓▓▓▓░         │
│     ░░░░░░░░░░░░░░░       │
└───────────────────────────┘
        │
        ▼
Extract Bounding Box
```

## Vertex Extraction Detail

```
Contour Points (many)
        │
        ▼
┌───────────────────────────┐
│ • • • • • • • • • • • •   │  • = Contour point
│ •                     •   │
│ •                     •   │
│ •                     •   │
│ • • • • • • • • • • • •   │
└───────────────────────────┘
        │
        ▼ (Detect angle changes > 20°)
┌───────────────────────────┐
│ ●                     ●   │  ● = Vertex (corner)
│                           │
│                           │
│                           │
│ ●                     ●   │
└───────────────────────────┘
        │
        ▼ (Align to axes)
┌───────────────────────────┐
│ ●─────────────────────●   │  Clean rectangular
│ │                     │   │  corners aligned to
│ │                     │   │  horizontal/vertical
│ │                     │   │  axes
│ ●─────────────────────●   │
└───────────────────────────┘
```

## Wall Alignment Refinement Detail

```
Initial Bounding Box
        │
        ▼
┌───────────────────────────┐
│     ┌─────────────┐       │
│ ████│             │████   │  Scan outward to find
│ ████│   Room      │████   │  actual wall positions
│ ████│             │████   │
│     └─────────────┘       │
└───────────────────────────┘
        │
        ▼ (Scan left/right/up/down)
┌───────────────────────────┐
│   ┌─────────────────┐     │
│ ██│                 │██   │  Refined box aligned
│ ██│   Room          │██   │  to inner wall edges
│ ██│                 │██   │
│   └─────────────────┘     │
└───────────────────────────┘
```

## Decision Tree: Which Method to Use?

```
                    User Action
                         │
         ┌───────────────┴───────────────┐
         │                               │
         ▼                               ▼
  "Trace Perimeter"              "Detect Room"
         │                               │
         ▼                               ▼
┌─────────────────┐            ┌─────────────────┐
│ Perimeter       │            │ Room Detection  │
│ Detection       │            │ Algorithm       │
│                 │            │                 │
│ • Morphological │            │ • OCR First     │
│   Closing       │            │ • Flood-Fill    │
│ • Contour       │            │ • 4 Fallbacks   │
│   Tracing       │            │                 │
│ • Vertex        │            │ Output:         │
│   Extraction    │            │ Room Box        │
│                 │            │ (x1,y1,x2,y2)   │
│ Output:         │            └─────────────────┘
│ Vertices Array  │
│ [{x,y}, ...]    │
└─────────────────┘
```

## Performance Characteristics

```
┌────────────────────────────────────────────────────┐
│                  Processing Time                   │
├────────────────────────────────────────────────────┤
│                                                    │
│  Perimeter Detection:                             │
│  ├─ Binary Conversion:      ~50ms                 │
│  ├─ Morphological Closing:  ~200ms                │
│  ├─ Contour Tracing:        ~100ms                │
│  ├─ Vertex Extraction:      ~50ms                 │
│  └─ Simplification:         ~50ms                 │
│  Total:                     ~450ms                │
│                                                    │
│  Room Detection:                                  │
│  ├─ OCR (Tesseract):        ~2000ms               │
│  ├─ Binary Conversion:      ~50ms                 │
│  ├─ Flood-Fill:             ~100ms                │
│  ├─ Bounding Box:           ~20ms                 │
│  └─ Wall Refinement:        ~30ms                 │
│  Total:                     ~2200ms               │
│                                                    │
└────────────────────────────────────────────────────┘

Note: Times are approximate and vary with image size
```

## Memory Usage

```
┌────────────────────────────────────────────────────┐
│                   Memory Footprint                 │
├────────────────────────────────────────────────────┤
│                                                    │
│  For 1000x1000 pixel image:                       │
│                                                    │
│  Binary Image:      1 MB (1 byte per pixel)       │
│  Contour Points:    ~100 KB (typical)             │
│  Vertices:          <1 KB (10-50 points)          │
│                                                    │
│  Total Peak:        ~1.5 MB per operation         │
│                                                    │
└────────────────────────────────────────────────────┘
```
