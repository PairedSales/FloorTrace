import { describe, it, expect } from 'vitest';
import {
  ACCENT, CRIT, SCALE, contrastOnPaper, lineColor, solidColor, inkColor, tintColor, withAlpha,
} from '../overlayStyle';
import { TRACE_TYPES, assignTypeColors } from '../../../utils/traceTypes';

// The pastels every plan saved before this palette may still carry.
const LEGACY = ['#BD93F9', '#8BE9FD', '#FFB86C', '#50FA7B', '#F1FA8C'];

describe('what is drawn on the plan can be read on white paper', () => {
  it('every outline type carries white text as it stands', () => {
    for (const type of TRACE_TYPES) {
      expect(contrastOnPaper(type.color), type.id).toBeGreaterThanOrEqual(4.5);
      // Already dark enough, so the canvas draws the saved colour itself.
      expect(solidColor(type.color), type.id).toBe(type.color);
    }
  });

  it('no outline type is the colour of the scale, a warning or a refusal', () => {
    const taken = [SCALE, CRIT, '#A65200'];
    for (const type of TRACE_TYPES) expect(taken).not.toContain(type.color);
  });

  // Two GLA outlines on one plan are told apart by shade; the lighter shades
  // must still be lines a person can see.
  it('keeps every shade of a type visible as a line', () => {
    const traces = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`, type: 'gla', colorSource: 'type', color: '#000000',
    }));
    for (const t of assignTypeColors(traces)) {
      expect(contrastOnPaper(lineColor(t.color))).toBeGreaterThanOrEqual(3);
    }
  });

  it('darkens a saved pastel until it can be read, without leaving its hue', () => {
    for (const hex of LEGACY) {
      expect(contrastOnPaper(hex)).toBeLessThan(3);
      expect(contrastOnPaper(lineColor(hex)), hex).toBeGreaterThanOrEqual(3);
      expect(contrastOnPaper(solidColor(hex)), hex).toBeGreaterThanOrEqual(4.5);
      expect(contrastOnPaper(inkColor(hex)), hex).toBeGreaterThanOrEqual(7);
    }
    // Darker, not a different colour: violet stays the bluest-and-reddest.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(solidColor('#BD93F9').slice(i, i + 2), 16));
    expect(b).toBeGreaterThan(r);
    expect(r).toBeGreaterThan(g);
  });

  it('survives a colour it cannot parse', () => {
    expect(lineColor(undefined)).toBe(ACCENT);
    expect(lineColor('not-a-colour')).toBe(ACCENT);
    expect(withAlpha('nope', 0.5)).toBe('rgba(91, 63, 214, 0.5)');
  });

  it('tints toward white and states alpha as rgba', () => {
    expect(contrastOnPaper(tintColor(ACCENT))).toBeLessThan(contrastOnPaper(ACCENT));
    expect(withAlpha('#157347', 0.07)).toBe('rgba(21, 115, 71, 0.07)');
  });
});
