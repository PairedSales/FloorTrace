// @vitest-environment happy-dom
//
// A PDF is the best input this app can get: vector content has no resolution of
// its own, so it can be rendered at whatever density the pipeline wants. Get the
// scale wrong and that advantage is thrown away silently — the trace is simply
// worse, with nothing on screen to say why. So the scale is what is tested.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const rendered = vi.hoisted(() => ({ calls: [], numPages: 2, fails: null, destroyed: 0 }));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'worker.js' }));
vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    // `destroy` is on the loading task. The document this resolves to
    // deliberately has none, because in pdf.js v6 it has none — a mock that
    // offers more than the library turns a crash into a passing test.
    destroy: async () => { rendered.destroyed += 1; },
    promise: rendered.fails
      ? Promise.reject(rendered.fails)
      : Promise.resolve({
        numPages: rendered.numPages,
        getPage: async (n) => ({
          // A US Letter page in points, which is what `scale: 1` means: 72 dpi.
          getViewport: ({ scale }) => ({ scale, width: 612 * scale, height: 792 * scale }),
          render: ({ viewport }) => {
            rendered.calls.push({ page: n, scale: viewport.scale, w: viewport.width, h: viewport.height });
            return { promise: Promise.resolve() };
          },
          cleanup: () => {},
        }),
      }),
  }),
}));

const { pdfToPageImages } = await import('../pdfLoader');

/** happy-dom has no 2D context, and the renderer needs one that records. */
const installCanvas = () => {
  const ops = [];
  const real = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation((tag) => {
    if (tag !== 'canvas') return real(tag);
    const canvas = {
      width: 0, height: 0,
      getContext: () => ({
        set fillStyle(v) { ops.push(['fillStyle', v]); },
        fillRect: (...a) => ops.push(['fillRect', ...a]),
      }),
      toDataURL: (type) => `data:${type};base64,RENDERED`,
    };
    ops.push(['canvas', canvas]);
    return canvas;
  });
  return ops;
};

const pdfFile = (bytes = 1024) => ({
  name: 'Maple Ave plan.pdf',
  size: bytes,
  arrayBuffer: async () => new ArrayBuffer(8),
});

describe('pdfToPageImages', () => {
  beforeEach(() => {
    rendered.calls = [];
    rendered.numPages = 2;
    rendered.fails = null;
    rendered.destroyed = 0;
    vi.restoreAllMocks();
  });

  // The document is megabytes of decoded state and a live worker port; leaking
  // one per import is a session that gets slower the more plans you open.
  it('tears the document down when it is finished with it', async () => {
    installCanvas();
    await pdfToPageImages(pdfFile(), { maxDimension: 4000 });
    expect(rendered.destroyed).toBe(1);
  });

  it('tears it down even when a page fails to render', async () => {
    installCanvas();
    vi.spyOn(document, 'createElement').mockImplementation(() => ({
      width: 0, height: 0, getContext: () => null,
    }));
    await expect(pdfToPageImages(pdfFile(), { maxDimension: 4000 })).rejects.toThrow();
    expect(rendered.destroyed).toBe(1);
  });

  // `scale: 1` is 72 dpi — a Letter page comes out 612x792, which is unreadable
  // to OCR and useless to the tracer. This is the whole point of the feature.
  it('renders to the ceiling the app keeps, not pdf.js\u2019s 72 dpi default', async () => {
    installCanvas();
    await pdfToPageImages(pdfFile(), { maxDimension: 4000 });

    const first = rendered.calls[0];
    expect(Math.round(first.h)).toBe(4000);
    expect(first.scale).toBeGreaterThan(5);
    // ~364 dpi for Letter, against the 72 a default render would have given.
    expect(Math.round(first.h / 11)).toBe(364);
  });

  it('scales a page larger than the ceiling down to it', async () => {
    installCanvas();
    await pdfToPageImages(pdfFile(), { maxDimension: 1000 });
    expect(Math.round(rendered.calls[0].h)).toBe(1000);
  });

  // A PDF page has no background. Left transparent, `toDataURL` gives
  // black-on-transparent and Otsu binarization reads the whole sheet as ink.
  it('paints the sheet white before rendering onto it', async () => {
    const ops = installCanvas();
    await pdfToPageImages(pdfFile(), { maxDimension: 4000 });

    const fill = ops.findIndex(([op, v]) => op === 'fillStyle' && v === '#ffffff');
    const rect = ops.findIndex(([op]) => op === 'fillRect');
    expect(fill).toBeGreaterThanOrEqual(0);
    expect(rect).toBeGreaterThan(fill);
  });

  it('gives every page its own plan name, in order', async () => {
    installCanvas();
    const { pages } = await pdfToPageImages(pdfFile(), { maxDimension: 4000 });
    expect(pages.map((p) => p.name)).toEqual(['Maple Ave plan p1.png', 'Maple Ave plan p2.png']);
    expect(pages.every((p) => p.mimeType === 'image/png')).toBe(true);
  });

  it('does not number a single-page plan', async () => {
    rendered.numPages = 1;
    installCanvas();
    const { pages } = await pdfToPageImages(pdfFile(), { maxDimension: 4000 });
    expect(pages.map((p) => p.name)).toEqual(['Maple Ave plan.png']);
  });

  it('stops at the plan cap and says how many it left', async () => {
    rendered.numPages = 9;
    installCanvas();
    const { pages, skipped } = await pdfToPageImages(pdfFile(), { maxDimension: 4000, maxPages: 6 });
    expect(pages).toHaveLength(6);
    expect(skipped).toBe(3);
  });

  it('reports progress so a slow render is not a frozen app', async () => {
    installCanvas();
    const seen = [];
    await pdfToPageImages(pdfFile(), { maxDimension: 4000, onProgress: (n, t) => seen.push(`${n}/${t}`) });
    expect(seen).toEqual(['1/2', '2/2']);
  });

  it('refuses a file too large to hold', async () => {
    await expect(pdfToPageImages(pdfFile(200 * 1024 * 1024), { maxDimension: 4000 }))
      .rejects.toThrow(/too large/i);
  });

  // pdf.js's own wording ("No password given") is not a thing to show a user.
  it('says plainly when a PDF is locked', async () => {
    rendered.fails = Object.assign(new Error('No password given'), { name: 'PasswordException' });
    await expect(pdfToPageImages(pdfFile(), { maxDimension: 4000 }))
      .rejects.toThrow('That PDF is password protected.');
  });

  it('says plainly when a PDF cannot be parsed', async () => {
    rendered.fails = new Error('InvalidPDFException: bad xref');
    await expect(pdfToPageImages(pdfFile(), { maxDimension: 4000 }))
      .rejects.toThrow('That PDF could not be read.');
  });
});
