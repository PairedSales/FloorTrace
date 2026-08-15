import { describe, expect, it } from 'vitest';
import { grayToPngBlob, crc32, adler32 } from '../DimensionsOCR';
import { grayToImageDataLike } from '../dimensions/raster';

// The encoder used to take an RGBA ImageData-like and read one byte in four.
// These assert the gray fast path, the slice-by-8 CRC and the chunked adler
// are byte-for-byte what they replaced — Tesseract must receive identical
// bytes or the detection rate moves.

const crc32Slow = (bytes, start, end) => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  let crc = 0xffffffff;
  for (let i = start; i < end; i += 1) crc = table[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

const adler32Slow = (bytes) => {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return { a, b };
};

// The shipped encoder before the gray fast path: RGBA in, one byte in four out.
const rgbaScanlines = (imageDataLike) => {
  const { width, height, data } = imageDataLike;
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const src = y * width * 4;
    const dst = y * (width + 1);
    for (let x = 0; x < width; x += 1) raw[dst + 1 + x] = data[src + x * 4];
  }
  return raw;
};

const grayScanlines = (gray) => {
  const { width, height, data } = gray;
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(data.subarray(y * width, y * width + width), y * (width + 1) + 1);
  }
  return raw;
};

const makeGray = (width, height, seed = 1) => {
  const data = new Uint8Array(width * height);
  let s = seed;
  for (let i = 0; i < data.length; i += 1) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (s >>> 16) & 0xff;
  }
  return { data, width, height };
};

describe('gray PNG scanline path', () => {
  // Real tile shapes: a wide page, a tall vertical ROI, an odd single row.
  const shapes = [[2000, 137], [23, 400], [1, 1], [640, 480], [7, 3]];

  it.each(shapes)('matches the RGBA-strided read at %ix%i', (width, height) => {
    const gray = makeGray(width, height, width * 31 + height);
    const viaRgba = rgbaScanlines(grayToImageDataLike(gray));
    const viaGray = grayScanlines(gray);
    expect(viaGray).toEqual(viaRgba);
  });

  it('produces a PNG with a grayscale IHDR and the right dimensions', async () => {
    const gray = makeGray(64, 48, 9);
    const blob = grayToPngBlob(gray);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(bytes.buffer);
    // IHDR body starts at 16: width, height, bit depth, colour type.
    expect(dv.getUint32(16)).toBe(64);
    expect(dv.getUint32(20)).toBe(48);
    expect(bytes[24]).toBe(8);
    expect(bytes[25]).toBe(0);
  });
});

describe('crc32 slice-by-8', () => {
  it('matches the byte-at-a-time table loop on every tail length', () => {
    const bytes = makeGray(521, 1, 4).data;
    for (let end = 0; end <= bytes.length; end += 1) {
      expect(crc32(bytes, 0, end)).toBe(crc32Slow(bytes, 0, end));
    }
  });

  it('matches for non-zero starts and on a large buffer', () => {
    const bytes = makeGray(1024, 64, 7).data;
    for (const start of [1, 2, 3, 4, 5, 6, 7, 8, 100]) {
      expect(crc32(bytes, start, bytes.length)).toBe(crc32Slow(bytes, start, bytes.length));
    }
  });

  it('agrees with the known CRC-32 of "123456789"', () => {
    const bytes = new Uint8Array([...'123456789'].map((c) => c.charCodeAt(0)));
    expect(crc32(bytes, 0, bytes.length)).toBe(0xcbf43926);
  });
});

describe('adler32 chunked', () => {
  it('matches the per-byte modulo form across the NMAX boundary', () => {
    // 5552 is the chunk size, so straddle it in both directions.
    for (const n of [0, 1, 5551, 5552, 5553, 11104, 20000]) {
      const bytes = makeGray(n || 1, 1, n + 3).data.subarray(0, n);
      expect(adler32(bytes)).toEqual(adler32Slow(bytes));
    }
  });

  it('matches on an all-255 buffer, the worst case for overflow', () => {
    const bytes = new Uint8Array(16384).fill(255);
    expect(adler32(bytes)).toEqual(adler32Slow(bytes));
  });
});
