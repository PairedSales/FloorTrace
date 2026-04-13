# OCR System Design for Extracting Room Dimensions from Residential Floor Plans

## 1) System Goals and Constraints

### Primary goal
Extract **only room dimension values** (e.g., `14' 2" x 12' 1"`, `12.5 ft x 10.0 ft`, `3.8 m x 2.7 m`) from floor plan images.

### Must handle
- Feet/inches format (`12'5"`)
- Decimal feet (`12.5 ft`)
- Meters (`12.5 m`)
- Separator `x` or `X`
- OCR symbol confusions (`'`, `"`, `ft`, `m`, `x`, digits)

### Must ignore
- Room names (Living Room, etc.)
- Rotated/vertical dimensions
- Other text (notes, logos, disclaimers, appliance labels)

### Performance target
- **Fast batch throughput**
- **~95% extraction accuracy** (not extreme, slow perfection)

---

## 2) High-Level Pipeline

1. **Input normalization**
2. **Text-region detection**
3. **Orientation filtering** (keep horizontal only)
4. **OCR recognition (line-level + fallback char-level)**
5. **Dimension candidate parsing**
6. **Error correction + format repair**
7. **Validation/scoring**
8. **Deduplication + output**

This staged design gives speed and robustness while allowing targeted corrections.

---

## 3) Image Preprocessing Pipeline

### 3.1 Normalize image
- Convert to grayscale
- Contrast normalization (CLAHE)
- Mild denoise (bilateral or non-local means)
- Adaptive threshold (Sauvola/Otsu hybrid)
- Optional super-resolution only when input DPI is low

**Why:** floor plans are high-contrast; normalization makes symbols (`'`, `"`, `x`) more stable for OCR.

### 3.2 Multi-scale versions
Create 2–3 scales (e.g., 1.0x, 1.5x, 2.0x).
Run text detector at 1.0x and OCR at best scale per region.

**Why:** apostrophe/quote are tiny; scale-up helps feet/inches parsing without full-image heavy compute.

### 3.3 Structural masking (optional speed boost)
Use line detection (Hough/morphological) to down-weight thick walls before OCR.

**Why:** reduces false detections on wall edges and symbols near boundaries.

---

## 4) Text Detection Strategy

Use a modern scene-text detector:
- **DBNet** or **CRAFT** (good recall for small text lines)
- Detect text boxes, then group into line-level regions

For each box, estimate orientation angle (from box geometry or minAreaRect):
- Keep only near-horizontal text, e.g. `|angle| <= 12°`
- Reject vertical/rotated candidates early

**Why:** your requirement explicitly ignores rotated/vertical dimensions, so this instantly cuts noise and improves precision.

---

## 5) OCR Model Selection / Architecture

### Recommended architecture (fast + robust)
- Primary OCR: **PaddleOCR PP-OCRv4/v5 recognition**
- Secondary fallback OCR: **Tesseract (LSTM) with custom whitelist**
- Optional third pass for hard cases: CRNN/TrOCR on tiny cropped symbol windows

### OCR configuration
- Character whitelist for dimension zones:
  `0123456789.'"xXfFtTmM -`
- Run recognition per detected text line
- If confidence low, re-run at higher crop scale + sharpen

**Why:** single OCR engines often fail on `'` and `"`; dual-engine fallback improves robustness with limited latency penalty.

---

## 6) Post-Processing & Error Correction Logic

This is where most gains happen.

### 6.1 Normalize OCR string
- Upper/lowercase normalization
- Replace unicode lookalikes:
  - smart quote → `'` or `"`
  - multiplication sign `×` → `x`
  - comma decimal `12,5` → `12.5`
- Collapse spaces (`14 ' 2 " x 12 ' 1 "` → `14'2" x 12'1"`)

### 6.2 Symbol confusion map (probabilistic)
Common OCR confusions:
- `'` ↔ `I`, `l`, `|`, `!`, `*`, `` ` ``
- `"` ↔ `II`, `''`, `”`, `*`
- `x` ↔ `X`, `K`, `*`, `%`
- `0` ↔ `O`
- `5` ↔ `S`

Apply edits only if resulting string matches valid dimension grammar (below).

### 6.3 Grammar-based correction (critical)
Use finite-state parser / regex grammar + candidate scoring.

Valid forms for **one side**:
- Feet-inch: `\d{1,3}'\s?\d{1,2}"?`
- Decimal feet: `\d{1,3}(\.\d+)?\s?ft`
- Meter: `\d{1,3}(\.\d+)?\s?m`

Pair form:
- `<side>\s?[xX]\s?<side>`

If OCR output is malformed (e.g., `100I6*`):
1. Generate minimal-edit candidates via confusion map
2. Keep candidates that satisfy grammar
3. Score by:
   - OCR confidence
   - Edit distance penalty
   - Statistical plausibility (room dimensions expected range)
4. Choose highest score

Example:
`100I6*` → candidates include `10'6"` (likely), `100'6"` (less likely depending on range)
- If in a room context, prefer plausible range (`6–40 ft`) unless domain expects mansion scale.

---

## 7) Dimension Parsing & Validation Rules

After candidate string matched:

### 7.1 Parse into structured numeric fields
Output canonical JSON per dimension:
- `raw_text`
- `value_1`, `unit_1`, `value_2`, `unit_2`
- `format_type`: `feet_inches | decimal_ft | meter | mixed`
- `bbox`, `confidence`

For feet/inches:
- Convert `a'b"` to decimal feet for validation and comparison

### 7.2 Validation constraints
- Must contain exactly one separator `x`/`X`
- Each side must parse as one valid dimension token
- Reject if both sides missing units and not feet-inch style
- Range checks (configurable):
  - each side 3–80 ft equivalent
  - aspect ratio sanity (e.g., not 1:20 unless explicitly allowed)

### 7.3 Consistency heuristics
- In one plan, units are usually consistent.
If 95% are feet-inch, penalize odd meter outliers unless confidence high.

---

## 8) Heuristics for Irrelevant Text Filtering

Since you only want dimensions, aggressively filter non-dim text:

1. **Regex prefilter**: must contain `x`/`X` and at least 2 numeric groups
2. **Lexical reject list**: lines containing room words only and no separator (`LIVING`, `BEDROOM`, `FOYER`, etc.)
3. **Geometry prior**:
   - Dimension text typically centered inside rooms
   - Labels often above dimensions; if two-line block, lower line more likely dimension
4. **Orientation filter**: reject vertical/rotated
5. **Length constraints**: too long lines likely notes/disclaimers

---

## 9) Handling Low-Resolution / Noisy Symbols

Targeted strategies for `'` and `"`:

1. **Micro-crop symbol enhancement**
   - For suspicious patterns near digits, crop around ambiguous character and re-OCR at 3x scale
2. **Character-level classifier (lightweight CNN)**
   - classify ambiguous glyph among `'`, `"`, `1`, `I`, `|`
3. **N-best OCR rescoring**
   - Ask OCR for top-k hypotheses and choose best via grammar + plausibility
4. **Template prior for feet-inch**
   - If pattern looks like `NN?N` around separator, infer missing quote markers

This gives large accuracy gains with modest speed cost because it runs only on low-confidence lines.

---

## 10) Recommended Output Schema

```json
{
  "image_id": "plan_001",
  "dimensions": [
    {
      "text": "23'0\" x 13'6\"",
      "normalized": "23'0\" x 13'6\"",
      "side1": {"feet": 23, "inches": 0, "unit": "ft_in"},
      "side2": {"feet": 13, "inches": 6, "unit": "ft_in"},
      "bbox": [x1, y1, x2, y2],
      "confidence": 0.97
    }
  ]
}
```

Optional:
- `rejected_candidates` with reason (`vertical_text`, `failed_grammar`, etc.) for debugging.

---

## 11) Accuracy/Performance Tuning Plan

### For speed
- Single pass detection
- OCR only on horizontal boxes
- Fallback OCR only when primary confidence < threshold
- Symbol-level repair only on malformed lines

### For accuracy
- Strong grammar-correction engine
- Confusion-aware rescoring
- Multi-scale OCR only for low-confidence boxes

**Expected:** this hybrid approach usually reaches your 95% goal with practical latency.

---

## 12) Minimal Implementation Stack (Practical)

- **OpenCV**: preprocessing, geometry, orientation
- **PaddleOCR**: detector + recognizer
- **Python parsing module**:
  - regex + finite-state grammar
  - weighted correction engine
- **Optional**: ONNX runtime for fast inference deployment

---

If you want, I can provide a **reference pseudocode implementation** for each stage (detector → OCR → repair → parser), including concrete regex patterns and scoring formulas.
