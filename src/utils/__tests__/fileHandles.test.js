import { describe, it, expect, beforeEach } from 'vitest';
import { getFileHandle, rememberFileHandle, forgetFileHandle } from '../fileHandles';

const handle = (name) => ({ name });

describe('file handle cache', () => {
  beforeEach(() => {
    ['doc-1', 'doc-2'].forEach(forgetFileHandle);
  });

  it('does not cache under a missing plan id', () => {
    rememberFileHandle(null, handle('nowhere.floorplan'));
    expect(getFileHandle(null)).toBeNull();
    expect(getFileHandle(undefined)).toBeNull();
  });
});
