// @vitest-environment happy-dom
//
// The things a file can be wrong about on the way in, and whether the app says
// the right one. Every case here used to come out as some other case's message.

import { describe, it, expect, afterEach } from 'vitest';
import {
  loadImageFromClipboard, pageShortfall, lowResolutionNote, isPdfFile,
} from '../imageLoader';

const setClipboard = (read) => {
  Object.defineProperty(navigator, 'clipboard', { value: { read }, configurable: true });
};
const item = (type, blob) => ({ types: [type], getType: async () => blob });

afterEach(() => {
  Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true });
});

describe('loadImageFromClipboard', () => {
  // The size check sat inside the clipboard-permission `try`, so a 30 MB
  // screenshot came back as "copy an image first" — advice for a clipboard that
  // in fact held exactly what was wanted.
  it('says an oversized image is oversized', async () => {
    setClipboard(async () => [item('image/png', { size: 30 * 1024 * 1024, type: 'image/png' })]);
    await expect(loadImageFromClipboard()).rejects.toThrow(/too large/i);
  });

  it('says an empty clipboard is empty', async () => {
    setClipboard(async () => [item('text/plain', null)]);
    await expect(loadImageFromClipboard()).rejects.toThrow(/copy an image first/i);
  });

  it('says a refused clipboard is refused, and how else to get the file in', async () => {
    setClipboard(async () => { throw new Error('NotAllowedError'); });
    await expect(loadImageFromClipboard()).rejects.toThrow(/clipboard access|drop the file/i);
  });
});

describe('pageShortfall', () => {
  it('says nothing when the whole document opened', () => {
    expect(pageShortfall({ opened: 2, rendered: 2, totalPages: 2 })).toBeNull();
    expect(pageShortfall({ opened: 1, rendered: 1, totalPages: 1 })).toBeNull();
  });

  // The old message counted the pages *rendered*: "Opened the first 6 pages"
  // printed over three plans, because the plan cap stopped the loop halfway.
  it('counts the plans opened, not the pages rendered', () => {
    const text = pageShortfall({ opened: 3, rendered: 6, totalPages: 9 });
    expect(text).toMatch(/Opened 3 of 9 pages/);
    expect(text).toMatch(/no room for more plans/);
  });

  it('names the render cap when that is what stopped it', () => {
    const text = pageShortfall({ opened: 6, rendered: 6, totalPages: 9 });
    expect(text).toMatch(/Opened 6 of 9 pages/);
    expect(text).toMatch(/6 pages at a time/);
  });
});

describe('lowResolutionNote', () => {
  it('says nothing when nothing was too small', () => {
    expect(lowResolutionNote(0)).toBeNull();
  });

  it('warns before the trace rather than ten seconds into it', () => {
    expect(lowResolutionNote(1)).toMatch(/small/i);
    expect(lowResolutionNote(3)).toMatch(/^3 of these pages/);
  });
});

describe('isPdfFile', () => {
  it('reads the extension whatever its case', () => {
    expect(isPdfFile({ name: 'Plan.PDF', type: '' })).toBe(true);
    expect(isPdfFile({ name: 'plan.png', type: 'image/png' })).toBe(false);
  });
});
