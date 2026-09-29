// A seeded random source for the tools that must give the same answer twice:
// `realPipeline sample` (which plans get a second annotator) and `realManifest
// assign-splits` (which books go to test). Math.random would make either a
// different set of plans on every run, so the split and the sample could not be
// reproduced, audited or re-run after a book was added.
import crypto from 'crypto';

// mulberry32: a 32-bit state, a full period, and a few lines, so the sequence
// is easy to reproduce in any language an auditor might check it in.
export const mulberry32 = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// A 32-bit seed from any text: one stratum's stream depends on the run's seed
// and the stratum's own name, so books added to another stratum do not move it.
export const seedOf = (text) => crypto.createHash('sha256').update(String(text)).digest().readUInt32BE(0);

/** A copy of `list` in a random order (Fisher-Yates). */
export const shuffled = (list, rng) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// A code-unit comparison: `localeCompare` orders differently by machine, and a
// split that depended on the locale could not be reproduced.
export const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
