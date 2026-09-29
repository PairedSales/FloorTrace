// JSON with a fixed layout: object keys sorted at every depth, two-space indent,
// one trailing newline. The manifest's hash is the SHA-256 of its bytes, so the
// same content must always be the same bytes, whatever order a builder happened
// to add keys in.
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const sortKeys = (value) => {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = sortKeys(value[key]);
  return out;
};

export const stableStringify = (value) => `${JSON.stringify(sortKeys(value), null, 2)}\n`;
