// Two distinct data URLs that hashDataUrl maps to the same key. Not stubbed or
// injected — a real FNV-1a collision, found by enumerating equal-length base64
// bodies until two hashes matched (~50k candidates; 32 bits is that small).
// Anything that uses the hash to *return* an image must keep these apart.
export const COLLIDE_A = 'data:image/png;base64,f3cCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const COLLIDE_B = 'data:image/png;base64,BBADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
