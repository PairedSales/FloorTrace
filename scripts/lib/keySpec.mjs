// What an annotator writes and what the key tool reads back: the spec (rough
// outlines with their snapping options) and the outline files of every other
// command. Validation lives here so `snap` refuses a malformed spec with the
// place and the reason, before anything is written.

export const OUTLINE_TYPES = ['gla', 'below-grade', 'garage', 'porch', 'unfinished'];
// The classes compare and check reason in, and the types each holds.
export const CLASS_OF = {
  gla: 'building', 'below-grade': 'building', garage: 'nonGla', porch: 'nonGla', unfinished: 'unfinished',
};

// `existingDraft: true` marks the spec `realPipeline import-existing` writes for
// a plan whose stored key predates the protocol (annotation A of the first 75
// plans). Nobody's hand drew it, and the pipeline must be able to tell.
const SPEC_KEYS = ['author', 'notes', 'outlines', 'waive', 'stated', 'existingDraft'];
const OUTLINE_KEYS = ['type', 'v', 'fix', 'in', 'R', 'tilt', 'bridge', 'name'];

const isNum = (x) => typeof x === 'number' && Number.isFinite(x);
const isInt = (x) => Number.isInteger(x);
export const isRef = (p) => Array.isArray(p) && p[0] === 'ref';
const isPoint = (p) => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]);

/**
 * Checks a parsed spec and returns it (unchanged). Throws one Error whose
 * message lists what is wrong, each item naming its place.
 */
export const validateSpec = (spec) => {
  const problems = [];
  const bad = (where, text) => problems.push(`${where}: ${text}`);
  if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
    throw new Error('the spec must be a JSON object {"outlines": [...]}');
  }
  for (const key of Object.keys(spec)) {
    if (!SPEC_KEYS.includes(key)) bad(key, `unknown key (allowed: ${SPEC_KEYS.join(', ')})`);
  }
  if (spec.author !== undefined && typeof spec.author !== 'string') bad('author', 'must be a string');
  if (spec.notes !== undefined && typeof spec.notes !== 'string') bad('notes', 'must be a string');
  if (spec.existingDraft !== undefined && typeof spec.existingDraft !== 'boolean') bad('existingDraft', 'must be true or false');
  const { outlines } = spec;
  if (!Array.isArray(outlines) || !outlines.length) {
    throw new Error('outlines: must be a non-empty array of {"type", "v"}');
  }
  outlines.forEach((o, k) => {
    const at = `outlines[${k}]`;
    if (!o || typeof o !== 'object' || Array.isArray(o)) {
      bad(at, 'must be an object {"type", "v", …}');
      return;
    }
    for (const key of Object.keys(o)) {
      if (!OUTLINE_KEYS.includes(key)) bad(`${at}.${key}`, `unknown key (allowed: ${OUTLINE_KEYS.join(', ')})`);
    }
    if (!OUTLINE_TYPES.includes(o.type)) bad(`${at}.type`, `must be one of ${OUTLINE_TYPES.join(', ')} (got ${JSON.stringify(o.type)})`);
    if (o.name !== undefined && typeof o.name !== 'string') bad(`${at}.name`, 'must be a string');
    if (!Array.isArray(o.v) || o.v.length < 3) {
      bad(`${at}.v`, 'needs at least 3 vertices');
      return;
    }
    o.v.forEach((p, i) => {
      if (isRef(p)) {
        const [, rk, ri] = p;
        if (!isInt(rk) || !isInt(ri) || p.length !== 3) bad(`${at}.v[${i}]`, 'a reference is ["ref", outline, vertex] with two integers');
        else if (rk < 0 || rk >= outlines.length) bad(`${at}.v[${i}]`, `refers to outline ${rk}, which does not exist (0..${outlines.length - 1})`);
        else if (rk === k) bad(`${at}.v[${i}]`, 'refers to its own outline');
        else if (!Array.isArray(outlines[rk]?.v) || ri < 0 || ri >= outlines[rk].v.length) bad(`${at}.v[${i}]`, `outline ${rk} has no vertex ${ri}`);
      } else if (!isPoint(p)) {
        bad(`${at}.v[${i}]`, `must be [x, y] numbers or ["ref", k, i] (got ${JSON.stringify(p)})`);
      }
    });
    const edgeList = (key) => {
      if (o[key] === undefined) return [];
      if (!Array.isArray(o[key]) || !o[key].every(isInt)) {
        bad(`${at}.${key}`, 'must be an array of edge numbers');
        return [];
      }
      o[key].forEach((e) => {
        if (e < 0 || e >= o.v.length) bad(`${at}.${key}`, `edge ${e} is out of range (0..${o.v.length - 1}); edge i runs from v[i] to v[i+1]`);
      });
      return o[key];
    };
    const fix = edgeList('fix');
    const inner = edgeList('in');
    for (const e of fix) if (inner.includes(e)) bad(`${at}`, `edge ${e} is in both fix and in`);
    if (o.R !== undefined && !(isNum(o.R) && o.R >= 2 && o.R <= 60)) bad(`${at}.R`, 'must be a number of pixels from 2 to 60');
    if (o.tilt !== undefined && typeof o.tilt !== 'boolean') bad(`${at}.tilt`, 'must be true or false');
    if (o.bridge !== undefined && !(isNum(o.bridge) && o.bridge >= 0 && o.bridge <= 20)) bad(`${at}.bridge`, 'must be a gap of 0 to 20 px a hatched or double-line wall may have');
  });
  if (!problems.length) {
    let flat = null;
    try {
      flat = resolveRefs(outlines);
    } catch (error) {
      problems.push(`outlines: ${error.message}`);
    }
    // A zero-length edge has no direction to snap along.
    flat?.forEach((o, k) => {
      o.v.forEach((a, i) => {
        const b = o.v[(i + 1) % o.v.length];
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 1e-6) problems.push(`outlines[${k}]: vertices ${i} and ${(i + 1) % o.v.length} coincide, so edge ${i} has no direction`);
      });
    });
  }
  if (spec.waive !== undefined) {
    if (!Array.isArray(spec.waive)) bad('waive', 'must be an array of {"label", "reason"}');
    else {
      spec.waive.forEach((w, i) => {
        if (!w || typeof w !== 'object') bad(`waive[${i}]`, 'must be {"label", "reason"}');
        else {
          for (const key of Object.keys(w)) if (!['label', 'reason'].includes(key)) bad(`waive[${i}].${key}`, 'unknown key (allowed: label, reason)');
          if (typeof w.label !== 'string' || !w.label) bad(`waive[${i}].label`, 'must be a label id from labels.json');
          if (typeof w.reason !== 'string' || !w.reason.trim()) bad(`waive[${i}].reason`, 'a waiver needs its reason: the reviewer reads it');
        }
      });
    }
  }
  if (spec.stated !== undefined) {
    if (!Array.isArray(spec.stated)) bad('stated', 'must be an array of {"sqft", "of", "explained"}');
    else {
      spec.stated.forEach((s, i) => {
        if (!s || typeof s !== 'object') bad(`stated[${i}]`, 'must be {"sqft", "of", "explained"}');
        else {
          for (const key of Object.keys(s)) if (!['sqft', 'of', 'explained'].includes(key)) bad(`stated[${i}].${key}`, 'unknown key (allowed: sqft, of, explained)');
          if (!(isNum(s.sqft) && s.sqft > 0)) bad(`stated[${i}].sqft`, 'must be a positive number');
          if (s.of !== undefined && typeof s.of !== 'string') bad(`stated[${i}].of`, 'must be a string');
          if (s.explained !== undefined && typeof s.explained !== 'string') bad(`stated[${i}].explained`, 'must be a string');
        }
      });
    }
  }
  if (problems.length) {
    const shown = problems.slice(0, 6).join('; ');
    throw new Error(`invalid spec: ${shown}${problems.length > 6 ? `; and ${problems.length - 6} more` : ''}`);
  }
  return spec;
};

/**
 * The outlines with every `["ref", k, i]` replaced by the vertex it names (as
 * drawn, before any snap). Chains of references resolve; a loop throws.
 */
export const resolveRefs = (outlines) => {
  const memo = new Map();
  const at = (k, i, trail = []) => {
    const key = `${k}:${i}`;
    if (memo.has(key)) return memo.get(key);
    if (trail.includes(key)) throw new Error('vertex references refer to each other in a loop');
    const p = outlines[k]?.v?.[i];
    if (p === undefined) throw new Error(`reference to a vertex that does not exist (outline ${k}, vertex ${i})`);
    const value = isRef(p) ? at(p[1], p[2], [...trail, key]) : p;
    memo.set(key, value);
    return value;
  };
  return outlines.map((o, k) => ({ ...o, v: o.v.map((p, i) => (isRef(p) ? [...at(p[1], p[2], [`${k}:${i}`])] : [...p])) }));
};

const pointOf = (p) => (Array.isArray(p) ? p : (p && isNum(p.x) && isNum(p.y) ? [p.x, p.y] : p));
const isRingLike = (a) => Array.isArray(a) && a.length >= 3 && a.every((p) => isRef(p) || isPoint(pointOf(p)));

/**
 * The outlines in a parsed outline file, as `[{type, v}]`. Accepts what the
 * tool writes and what an annotator or an engineer might hand it:
 * `{outlines: [{type, v | points | vertices}]}` (a spec or a snapped file), a
 * bare array of such outlines, or bare rings `[[x, y], …]` (type gla). Refs are
 * resolved; a ring's points may be `[x, y]` or `{x, y}`. Throws on anything
 * that is not a ring of at least three numeric points.
 */
export const outlinesOfJson = (json, what = 'the file') => {
  let list;
  if (Array.isArray(json?.outlines)) list = json.outlines;
  else if (Array.isArray(json) && isRingLike(json)) list = [json];
  else if (Array.isArray(json)) list = json;
  else throw new Error(`${what} holds no outlines (expected {"outlines": [...]}, an array of outlines, or a ring [[x, y], …])`);
  if (!list.length) throw new Error(`${what} holds no outlines`);
  const rough = list.map((o, k) => {
    const ring = Array.isArray(o) ? o : (o?.v ?? o?.points ?? o?.vertices);
    if (!isRingLike(ring)) throw new Error(`${what}: outline ${k} has no ring of at least 3 [x, y] points`);
    return { type: Array.isArray(o) ? 'gla' : (o.type ?? 'gla'), v: ring.map((p) => (isRef(p) ? p : pointOf(p))) };
  });
  rough.forEach((o, k) => {
    if (!OUTLINE_TYPES.includes(o.type)) throw new Error(`${what}: outline ${k} has type ${JSON.stringify(o.type)}, not one of ${OUTLINE_TYPES.join(', ')}`);
  });
  return resolveRefs(rough);
};
