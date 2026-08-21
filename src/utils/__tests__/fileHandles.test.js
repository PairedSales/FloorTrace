import { describe, it, expect, beforeEach } from 'vitest';
import { getFileHandle, rememberFileHandle, forgetFileHandle } from '../fileHandles';

const handle = (name) => ({ name });

describe('file handle cache', () => {
  beforeEach(() => {
    ['doc-1', 'doc-2'].forEach(forgetFileHandle);
  });

  it('hands a plan back the file it was saved to', () => {
    rememberFileHandle('doc-1', handle('123 Main St.floorplan'));
    expect(getFileHandle('doc-1')).toEqual(handle('123 Main St.floorplan'));
  });

  it('keeps plans apart', () => {
    rememberFileHandle('doc-1', handle('a.floorplan'));
    rememberFileHandle('doc-2', handle('b.floorplan'));
    expect(getFileHandle('doc-2')).toEqual(handle('b.floorplan'));
    expect(getFileHandle('doc-1')).toEqual(handle('a.floorplan'));
  });

  // The whole reason this is callable from outside the serializer: `restart`
  // empties the last plan in place and keeps its id, so a handle left behind
  // sends the next property's first Save into the closed plan's file.
  it('forgets a handle so a reused id cannot inherit it', () => {
    rememberFileHandle('doc-1', handle('a.floorplan'));
    forgetFileHandle('doc-1');
    expect(getFileHandle('doc-1')).toBeUndefined();
  });

  it('does not cache under a missing plan id', () => {
    rememberFileHandle(null, handle('nowhere.floorplan'));
    expect(getFileHandle(null)).toBeNull();
    expect(getFileHandle(undefined)).toBeNull();
  });
});
