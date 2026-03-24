# Project Status

## Current

- Detection system rebuild completed for the core client-side pipeline.
- OCR click now attempts region-based room enclosure instead of fixed-size room placement.
- Perimeter tracing now computes and applies real inner/outer candidates.
- Debug overlays can be toggled to inspect snap lines, corners, and dominant angles.

## Validation

- Added unit/integration-style tests for:
  - Dominant orientation detection (including angled walls).
  - Click-seeded room enclosure extraction.
  - Inner/outer perimeter generation and area monotonicity expectations.

## Next Hardening Items

- Improve door-gap handling and anti-leak flood constraints on noisy scans.
- Add benchmark fixtures for very large plans and low-contrast scans.
- Tune simplification thresholds per drawing quality profile.
