# Quick Start Guide

## 🚀 Run Your First Test (3 Steps)

### 1. Install Dependencies
```bash
cd testing-system
npm install canvas
```

### 2. Run Test with Default Settings
```bash
node run-test.js
```

### 3. View Results
Open `test-results/[timestamp]/report.html` in your browser

---

## 📝 Modify Parameters

Edit `inputs.json` and change any parameters you want to test:

```json
{
  "wallDetection": {
    "minWallLength": 50,    // ← Try changing to 30 or 70
    "debugMode": true
  }
}
```

Then run `node run-test.js` again to see the difference!

---

## 🎯 What You're Looking For

The goal is to **detect all interior and exterior walls** of the floor plan.

**Good Results:**
- All major walls detected
- Exterior perimeter is complete
- Interior room divisions are clear
- Few false positives (text/symbols detected as walls)

**Check the overlay image** (`6-overlay.png`) to see how well the detection matches the original.

---

## 🔧 Common Adjustments

**Missing some walls?**
```json
"lineDetection": {
  "minScore": 0.15,           // Lower threshold
  "edgeThresholdPercent": 3   // More sensitive
}
```

**Too many false detections?**
```json
"lineDetection": {
  "minScore": 0.25,           // Higher threshold
  "edgeThresholdPercent": 7   // Less sensitive
}
```

**Walls are broken into pieces?**
```json
"segmentMerging": {
  "maxGap": 75,               // Bridge larger gaps
  "maxDistance": 30           // More aggressive merging
}
```

---

## 📊 Understanding Output Files

| File | Purpose |
|------|---------|
| `report.html` | **START HERE** - Visual report with all images |
| `analysis.json` | Metrics (wall counts, statistics) |
| `walls.json` | Complete wall data for further analysis |
| `6-overlay.png` | Best file to check accuracy |

---

## 💡 Tips

1. **Keep notes** - When you find good parameters, add them to a text file
2. **Compare runs** - Each test gets its own folder, so you can compare different settings
3. **Start simple** - Adjust one parameter at a time to see its effect
4. **Check the console** - Lots of useful debug info printed during the test

---

## ❓ Need Help?

See the full `README.md` for detailed parameter explanations.
