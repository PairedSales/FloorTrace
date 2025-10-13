# FloorTrace Web - Floor Plan Area Calculator

A modern web-based floor plan area calculator that runs entirely client-side. Upload or paste a floor plan image, detect room dimensions using OCR, trace the perimeter, and calculate the total area.

## Features

- **Advanced Line Detection**: Detects horizontal and vertical lines of varying widths for accurate wall identification
- **Image Loading**: Load floor plans via file picker or clipboard paste (Ctrl+V)
- **Smart OCR Room Detection**: Automatically detect room dimensions from multiple formats:
  - Feet and inches: `5' 10" x 6' 3"` or `3' - 7" x 12' - 0"`
  - Decimal feet: `5.2 ft x 6.3 ft` or `21.3 feet x 11.1 feet`
  - Simple format: `12 x 10` (assumed feet)
- **Intelligent Perimeter Tracing**: Uses detected wall lines and intersection points for precise perimeter detection
- **Interior/Exterior Wall Toggle**: Choose between interior or exterior wall detection for perimeter placement
- **Interactive Overlays**: Drag and adjust room boundaries and perimeter vertices with precise control
- **Side Length Labels**: Toggle display of perimeter side lengths in decimal feet (e.g., "12.5 ft")
- **Manual Mode**: Highlight all detected dimensions and manually select with fixed-size overlays
- **Area Calculation**: Automatic area calculation using detected scale
- **Save Screenshot**: Export the entire application window as a high-quality WebP image
- **Zoom & Pan**: Mouse wheel to zoom, drag canvas to pan
- **Responsive UI**: Clean, modern interface with overlay sidebar

## Tech Stack

- **React** with Vite for fast development
- **Tailwind CSS v3** for styling
- **React-Konva** for interactive canvas overlays
- **Tesseract.js** for client-side OCR
- **html2canvas** for screenshot capture
- **Lucide-React** for icons

## Getting Started

### Prerequisites

- Node.js 16+ and npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Open http://localhost:5173 in your browser.

### Build for Production

```bash
npm run build
```

The built files will be in the `dist/` directory, ready to deploy to any static hosting service.

## Usage

1. **Load Image**: Click "Load Image" or press Ctrl+O to select a floor plan image, or click "Paste Image" (Ctrl+V) to paste from clipboard
2. **Find Room**: Click "Find Room" to automatically find room dimensions using OCR and line detection
   - Supports multiple dimension formats (feet/inches, decimal feet, etc.)
   - Automatically places room overlay using detected wall lines
3. **Adjust Room Overlay**: 
   - Drag the green room overlay to move it
   - Drag corner handles to resize
4. **Find Perimeter**: Click "Find Perimeter" to automatically detect the floor plan outline
   - Uses detected wall line intersections for precise placement
   - Toggle "Interior Walls" checkbox to switch between interior/exterior wall detection
5. **Adjust Perimeter**: 
   - Drag purple vertices to adjust position precisely
   - Double-click anywhere on canvas to add a new vertex
   - Right-click on a vertex to delete it (minimum 3 vertices required)
6. **View Side Lengths** (optional): Check "Show Side Lengths" to display measurements on each perimeter side
7. **View Area**: The calculated area appears in the sidebar in square feet

### Manual Mode

If automatic detection doesn't work well:

1. Click "Manual Mode" to highlight all detected room dimensions (left-to-right reading order)
   - If overlays exist, you'll be prompted to confirm clearing them
2. Click on any highlighted dimension to select it
   - A 200x200 pixel room overlay is placed on the dimension
   - A 400x400 pixel perimeter overlay is automatically created
3. Manually adjust the overlays by dragging vertices and corners as needed

## Important Notes

- Room dimensions must be readable text in the image (e.g., "12x10", "12' x 10'")
- Rooms are assumed to be rectangular
- Perimeters are assumed to be rectilinear (no curved or angled walls)
- The smallest room dimension is automatically matched to the smallest overlay dimension for scaling

## Keyboard Shortcuts

- **Ctrl+O**: Open file picker
- **Ctrl+V**: Paste image from clipboard

## Deployment

### GitHub Pages (Automatic)

This project is configured for automatic deployment to GitHub Pages:

1. **Enable GitHub Pages** in your repository:
   - Go to Settings → Pages
   - Under "Source", select "GitHub Actions"

2. **Push to master branch**:
   ```bash
   git add .
   git commit -m "Setup GitHub Pages deployment"
   git push origin master
   ```

3. The site will automatically build and deploy on every push to `master`
4. Access your site at: `https://[username].github.io/FloorTrace/`

### Other Hosting Options

This static web app can also be deployed to:
- Netlify
- Vercel
- Any static hosting service

Simply run `npm run build` and upload the `dist/` folder.

## License

See LICENSE file for details.
