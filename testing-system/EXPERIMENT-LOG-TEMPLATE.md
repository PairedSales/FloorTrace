# Parameter Tuning Experiment Log

Use this template to document your parameter tuning experiments.

---

## Experiment #1: [Description]

**Date**: YYYY-MM-DD  
**Goal**: [What are you trying to improve?]

### Parameters Changed
```json
{
  "parameter1": "value1",
  "parameter2": "value2"
}
```

### Results
- **Timestamp**: [folder name]
- **Total Walls**: X
- **Exterior Walls**: X
- **Interior Walls**: X
- **Processing Time**: Xms

### Observations
- [What worked well?]
- [What didn't work?]
- [Any unexpected behavior?]

### Next Steps
- [What to try next?]

---

## Experiment #2: [Description]

**Date**: YYYY-MM-DD  
**Goal**: [What are you trying to improve?]

### Parameters Changed
```json
{
  "parameter1": "value1",
  "parameter2": "value2"
}
```

### Results
- **Timestamp**: [folder name]
- **Total Walls**: X
- **Exterior Walls**: X
- **Interior Walls**: X
- **Processing Time**: Xms

### Observations
- [What worked well?]
- [What didn't work?]
- [Any unexpected behavior?]

### Next Steps
- [What to try next?]

---

## Best Configuration So Far

**Date**: YYYY-MM-DD  
**Timestamp**: [folder name]

```json
{
  "preprocessing": {
    "thresholdMethod": "adaptive",
    ...
  },
  "wallDetection": {
    ...
  }
}
```

**Why this works best**:
- [Reason 1]
- [Reason 2]
- [Reason 3]

**Remaining Issues**:
- [Issue 1]
- [Issue 2]

---

## Parameter Impact Summary

| Parameter | Effect When Increased | Effect When Decreased |
|-----------|----------------------|----------------------|
| `minScore` | Fewer walls, less noise | More walls, more noise |
| `maxGap` | More merging | More fragments |
| `minWallLength` | Fewer short walls | More short walls |
| ... | ... | ... |

---

## Notes & Insights

[General observations about the algorithm behavior, patterns you've noticed, etc.]
