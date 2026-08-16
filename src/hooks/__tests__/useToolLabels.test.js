import { describe, it, expect } from 'vitest';
import { resolveInitialToolLabels } from '../useToolLabels';

// Minimal Storage stand-in: the resolver walks the key list, which the
// object-literal fakes elsewhere in the suite do not provide.
const fakeStorage = (entries = {}) => {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
  };
};

describe('resolveInitialToolLabels', () => {
  it('labels the rail for a browser that has never run FloorTrace', () => {
    expect(resolveInitialToolLabels(fakeStorage())).toBe(true);
  });

  it('leaves a returning user compact', () => {
    expect(resolveInitialToolLabels(fakeStorage({ 'floortrace:theme': 'dark' }))).toBe(false);
    expect(resolveInitialToolLabels(fakeStorage({ 'floortrace:saveOnExit': 'false' }))).toBe(false);
  });

  it('ignores keys belonging to other apps on the same origin', () => {
    expect(resolveInitialToolLabels(fakeStorage({ 'someOtherApp:seen': '1' }))).toBe(true);
  });

  it('honours an explicit choice either way', () => {
    expect(resolveInitialToolLabels(fakeStorage({ 'floortrace:toolLabels': 'false' }))).toBe(false);
    // On even for a returning user who asked for it.
    expect(resolveInitialToolLabels(fakeStorage({
      'floortrace:toolLabels': 'true',
      'floortrace:theme': 'dark',
    }))).toBe(true);
  });

  it('falls back to labelled when storage is unavailable or throws', () => {
    expect(resolveInitialToolLabels(null)).toBe(true);
    expect(resolveInitialToolLabels({
      getItem: () => { throw new Error('blocked'); },
    })).toBe(true);
  });
});
