// Grayscale image-data-like -> PNG Blob. tesseract.js accepts canvases but
// serialises them internally with canvas.toBlob(), which costs up to ~1s per
// call on some machines — a per-read tax that starves the whole ROI phase.
// Hand-rolled PNG with stored (uncompressed) deflate blocks is a plain byte
// copy; a targeted read drops to ~20ms.
//
// Its own module, free of the DOM, because the scan runs in a worker
// (`workers/ocrWorker.js`) and, where that cannot be had, on the page.
//
// Slice-by-8: the byte-at-a-time table loop is the only per-byte work left on
// a ~3.9 MB IDAT. Same polynomial, same output — `crc32Slow` in the tests is
// the byte-at-a-time form this is asserted equal to.
let crcTables = null;
const buildCrcTables = () => {
  const tables = [];
  for (let k = 0; k < 8; k += 1) tables.push(new Uint32Array(256));
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    tables[0][n] = c >>> 0;
  }
  for (let k = 1; k < 8; k += 1) {
    for (let n = 0; n < 256; n += 1) {
      const prev = tables[k - 1][n];
      tables[k][n] = (tables[0][prev & 0xff] ^ (prev >>> 8)) >>> 0;
    }
  }
  return tables;
};

export const crc32 = (bytes, start, end) => {
  if (!crcTables) crcTables = buildCrcTables();
  const [t0, t1, t2, t3, t4, t5, t6, t7] = crcTables;
  let crc = 0xffffffff;
  let i = start;
  for (; i + 8 <= end; i += 8) {
    crc ^= bytes[i] | (bytes[i + 1] << 8) | (bytes[i + 2] << 16) | (bytes[i + 3] << 24);
    crc = (t7[crc & 0xff] ^ t6[(crc >>> 8) & 0xff] ^ t5[(crc >>> 16) & 0xff] ^ t4[crc >>> 24]
      ^ t3[bytes[i + 4]] ^ t2[bytes[i + 5]] ^ t1[bytes[i + 6]] ^ t0[bytes[i + 7]]) >>> 0;
  }
  for (; i < end; i += 1) crc = t0[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
};

// Standard zlib chunked form: 5552 is the largest run of byte adds that cannot
// overflow the 32-bit accumulator, so the two modulos move off the per-byte
// path entirely.
export const adler32 = (bytes) => {
  const NMAX = 5552;
  let a = 1;
  let b = 0;
  let i = 0;
  while (i < bytes.length) {
    const end = Math.min(i + NMAX, bytes.length);
    for (; i < end; i += 1) {
      a += bytes[i];
      b += a;
    }
    a %= 65521;
    b %= 65521;
  }
  return { a, b };
};

const pngChunk = (type, body) => {
  const c = new Uint8Array(12 + body.length);
  const dv = new DataView(c.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i += 1) c[4 + i] = type.charCodeAt(i);
  c.set(body, 8);
  dv.setUint32(8 + body.length, crc32(c, 4, 8 + body.length));
  return c;
};

// Takes the pipeline's gray `{data, width, height}` directly. It used to take
// an RGBA ImageData-like, which meant every input was first expanded into a
// w*h*4 buffer (15.5 MB for the pass-1 page) that this function then read one
// byte in four from and dropped.
export const grayToPngBlob = (gray) => {
  const { width, height, data } = gray;
  // Scanlines: filter byte 0 + one gray byte per pixel.
  const raw = new Uint8Array((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw.set(data.subarray(y * width, y * width + width), y * (width + 1) + 1);
  }

  // zlib stream: header + stored deflate blocks + adler32
  const maxBlock = 65535;
  const nBlocks = Math.max(1, Math.ceil(raw.length / maxBlock));
  const idat = new Uint8Array(2 + raw.length + nBlocks * 5 + 4);
  let p = 0;
  idat[p++] = 0x78;
  idat[p++] = 0x01;
  for (let off = 0; off < raw.length; off += maxBlock) {
    const len = Math.min(maxBlock, raw.length - off);
    idat[p++] = off + len >= raw.length ? 1 : 0;
    idat[p++] = len & 0xff;
    idat[p++] = len >>> 8;
    idat[p++] = ~len & 0xff;
    idat[p++] = (~len >>> 8) & 0xff;
    idat.set(raw.subarray(off, off + len), p);
    p += len;
  }
  const { a, b } = adler32(raw);
  idat[p++] = (b >>> 8) & 0xff;
  idat[p++] = b & 0xff;
  idat[p++] = (a >>> 8) & 0xff;
  idat[p++] = a & 0xff;

  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  const sig = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
  return new Blob(
    [sig, pngChunk('IHDR', ihdr), pngChunk('IDAT', idat), pngChunk('IEND', new Uint8Array(0))],
    { type: 'image/png' }
  );
};
