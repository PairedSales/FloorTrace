import { describe, expect, it } from 'vitest';
import {
  serializeSketch,
  deserializeSketch,
  validateProjectSchema,
  validateProjectVersion,
  sanitizeData,
  importProject,
} from '../projectSerializer';
import { hashDataUrl } from '../hash';

// Mock storeState
const createMockStoreState = () => ({
  projectId: 'test-uuid-1234',
  projectName: 'My Test Project',
  createdAt: '2026-06-07T12:00:00.000Z',
  canvasRotation: 90,
  // Active floor state on root
  image: 'data:image/png;base64,FloorOneImageContent',
  roomOverlay: { x1: 5, y1: 5, x2: 50, y2: 50 },
  perimeterTraces: [
    {
      id: 'trace-1',
      name: '1st Floor Trace',
      vertices: [{ x: 5, y: 5 }, { x: 50, y: 5 }, { x: 50, y: 50 }],
      closed: true,
      visible: true,
      locked: false,
      color: '#BD93F9',
    }
  ],
  activeTraceId: 'trace-1',
  roomDimensions: { width: '5', height: '5' },
  area: 20,
  calibration: {
    calibrated: true,
    feetPerPixel: { x: 2.0, y: 2.0 },
    source: 'room-calibration',
    calibratedRoomId: null,
    createdAt: 1234567890
  },
  mode: 'normal',
  zoomScale: 1.0,
  stageX: 0,
  stageY: 0,
});

// Helper to calculate mock history image hash dynamically (matches implementation)
function hashImage(dataUrl) {
  if (!dataUrl) return null;
  const sample = dataUrl.slice(0, 8192) + '|' + dataUrl.length;
  let h = 0x811c9dc5;
  for (let i = 0; i < sample.length; i++) {
    h ^= sample.charCodeAt(i);
    h = (Math.imul(h, 0x01000193) >>> 0);
  }
  return h.toString(16);
}

const f1Image = 'data:image/png;base64,FloorOneImageContent';
const f1Hash = hashImage(f1Image);

// Mock historyState
const createMockHistoryState = () => ({
  undoStack: [
    {
      roomOverlay: { x1: 5, y1: 5, x2: 40, y2: 40 },
      __imageRef: f1Hash, // Reference to f1
    },
  ],
  redoStack: [],
  imagePool: [
    [f1Hash, f1Image],
  ],
});

describe('projectSerializer', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // sanitizeData
  // ──────────────────────────────────────────────────────────────────────────
  describe('sanitizeData', () => {
    it('converts NaN to 0', () => {
      expect(sanitizeData(NaN)).toBe(0);
    });

    it('converts Infinity and -Infinity to 0', () => {
      expect(sanitizeData(Infinity)).toBe(0);
      expect(sanitizeData(-Infinity)).toBe(0);
    });

    it('recursively sanitizes nested objects and arrays', () => {
      const input = {
        zoomScale: Infinity,
        coords: [10, NaN, 20],
        nested: {
          val: -Infinity,
          ok: 5,
        },
      };
      const expected = {
        zoomScale: 0,
        coords: [10, 0, 20],
        nested: {
          val: 0,
          ok: 5,
        },
      };
      expect(sanitizeData(input)).toEqual(expected);
    });

    it('leaves standard types untouched', () => {
      expect(sanitizeData(5.5)).toBe(5.5);
      expect(sanitizeData('hello')).toBe('hello');
      expect(sanitizeData(null)).toBeNull();
      expect(sanitizeData(true)).toBe(true);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // serializeSketch & deserializeSketch
  // ──────────────────────────────────────────────────────────────────────────
  describe('serialization & deserialization round-trip', () => {
    it('should de-duplicate background images and serialize all state accurately', () => {
      const storeState = createMockStoreState();
      const historyState = createMockHistoryState();

      const project = serializeSketch(storeState, historyState);

      // Verify serialization output format
      expect(project.fileType).toBe('floorplan');
      expect(project.version).toBe(1);
      expect(project.metadata.projectId).toBe('test-uuid-1234');
      expect(project.globalSettings.canvasRotation).toBe(90);

      // Verify de-duplication: image data URLs are NOT nested in floors, only references
      expect(project.floors[0].state.image).toBeUndefined();
      expect(project.floors[0].state.imageRef).toBeDefined();

      // Verify the de-duplicated images pool contains the background image
      const imageHashes = Object.keys(project.images);
      expect(imageHashes.length).toBe(1); // Floor 1 image
      
      // Re-hydrate the project
      const { statePatch, historyPatch } = deserializeSketch(project);

      // Verify active floor state hydration on root patch
      expect(statePatch.image).toBe('data:image/png;base64,FloorOneImageContent');
      expect(statePatch.roomOverlay).toEqual({ x1: 5, y1: 5, x2: 50, y2: 50 });
      expect(statePatch.calibration).toEqual({
        calibrated: true,
        feetPerPixel: { x: 2.0, y: 2.0 },
        source: 'room-calibration',
        calibratedRoomId: null,
        createdAt: 1234567890
      });
      expect(statePatch.projectId).toBe('test-uuid-1234');
      expect(statePatch.canvasRotation).toBe(90);

      // Verify history stack is restored correctly
      expect(historyPatch).toBeDefined();
      expect(historyPatch.undoStack.length).toBe(1);
      expect(historyPatch.undoStack[0].__imageRef).toBe(f1Hash);
      
      // Image pool map entries restored
      expect(historyPatch.imagePool.length).toBeGreaterThanOrEqual(1);
    });

    it('should migrate legacy numeric feetPerPixel to {x, y} format on deserialization', () => {
      const storeState = createMockStoreState();
      // Force legacy scalar format in the store state before serialize
      storeState.calibration.feetPerPixel = 3.5;
      const project = serializeSketch(storeState);

      // Verify that Zod accepts the serialized version
      expect(() => validateProjectSchema(project)).not.toThrow();

      // De-serialize and verify migration to {x: 3.5, y: 3.5}
      const { statePatch } = deserializeSketch(project);
      expect(statePatch.calibration.feetPerPixel).toEqual({ x: 3.5, y: 3.5 });
    });

    it('carries how much the scale can be trusted through a round trip', () => {
      // Reopening a project must not keep a doubtful scale while losing the
      // reason it was doubtful — that is a warning silently downgraded to none.
      const storeState = createMockStoreState();
      storeState.calibration.quality = {
        level: 'check',
        reason: 'room-vs-project',
        disagreement: 0.4,
        adopted: false,
        roomCount: 3,
      };
      const project = serializeSketch(storeState);
      expect(() => validateProjectSchema(project)).not.toThrow();

      const { statePatch } = deserializeSketch(project);
      expect(statePatch.calibration.quality).toEqual(storeState.calibration.quality);
    });

    it('accepts a project saved before scale quality existed', () => {
      const storeState = createMockStoreState();
      delete storeState.calibration.quality;
      const project = serializeSketch(storeState);
      expect(() => validateProjectSchema(project)).not.toThrow();
      expect(deserializeSketch(project).statePatch.calibration.quality).toBeUndefined();
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Schema Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('validateProjectSchema', () => {
    it('passes for a valid project format', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      expect(() => validateProjectSchema(project)).not.toThrow();
    });

    it('throws on missing critical schema components', () => {
      const invalidProject = {
        fileType: 'floorplan',
        version: 1,
        // missing metadata and activeFloorId
        floors: [],
      };
      // Assert on the message: a TypeError here means the ZodError field
      // mapping broke (Zod v4 renamed .errors to .issues)
      expect(() => validateProjectSchema(invalidProject)).toThrow(/Project validation failed/);
    });

    it('throws on mismatching file type literal', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      project.fileType = 'wrong_filetype';
      expect(() => validateProjectSchema(project)).toThrow(/Project validation failed/);
    });

    it('throws on invalid coordinate type in perimeterTraces', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      // Change vertex x to a string (invalid)
      project.floors[0].state.perimeterTraces[0].vertices[0].x = 'invalid-string';
      expect(() => validateProjectSchema(project)).toThrow(/Project validation failed/);
    });

    it('throws on missing required fields inside customShapes', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      project.floors[0].state.customShapes = [{
        closed: true,
        // missing vertices
      }];
      expect(() => validateProjectSchema(project)).toThrow(/Project validation failed/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // hole provenance
  // ──────────────────────────────────────────────────────────────────────────
  describe('trace holes', () => {
    const ring = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];

    const withHoles = (holes) => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].holes = holes;
      return serializeSketch(storeState);
    };

    it('round-trips a mixed set of tagged and bare holes', () => {
      const holes = [
        { id: 'hole-auto-0', ring: ring(4), source: 'auto' },
        { id: 'hole-user-0', ring: ring(6), source: 'user' },
        ring(8),
      ];
      const project = withHoles(holes);
      expect(() => validateProjectSchema(project)).not.toThrow();

      const { statePatch } = deserializeSketch(project);
      expect(statePatch.perimeterTraces[0].holes).toEqual(holes);
    });

    // The tag is what keeps a hand-punched void alive across a re-trace, so
    // losing it in the file would make reopening a project quietly destructive.
    it('keeps the source tag rather than stripping it to a bare ring', () => {
      const project = withHoles([{ id: 'h1', ring: ring(4), source: 'user' }]);
      const { statePatch } = deserializeSketch(project);
      expect(statePatch.perimeterTraces[0].holes[0].source).toBe('user');
    });

    // A file written before provenance existed carries bare rings.
    it('accepts a v1 file whose holes are bare rings', () => {
      const project = withHoles([ring(4), ring(6)]);
      expect(() => validateProjectSchema(project)).not.toThrow();

      const { statePatch } = deserializeSketch(project);
      expect(statePatch.perimeterTraces[0].holes).toEqual([ring(4), ring(6)]);
    });

    it('still rejects a hole that is neither shape', () => {
      const project = withHoles([{ id: 'h1', source: 'user' }]); // no ring
      expect(() => validateProjectSchema(project)).toThrow(/Project validation failed/);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // importProject
  // ──────────────────────────────────────────────────────────────────────────
  describe('importProject', () => {
    it('throws on invalid JSON string', () => {
      expect(() => importProject('not-a-json-string')).toThrow('Failed to parse project file. The file is not valid JSON.');
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Version Validation
  // ──────────────────────────────────────────────────────────────────────────
  describe('validateProjectVersion', () => {
    it('passes if version matches target version', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      expect(() => validateProjectVersion(project)).not.toThrow();
    });

    it('throws if project version is newer than supported', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      project.version = 99; // Far in the future
      expect(() => validateProjectVersion(project)).toThrow(/Incompatible project version/);
    });
  });

  // `hashDataUrl` samples only the first 8 KB plus the total length, so two
  // images that share a prefix and a length collide *deterministically* -- no
  // birthday luck required. The crop and eraser tools emit exactly that shape:
  // same-length data URLs from one canvas at one size. These are the cases
  // where the saved file used to come back holding someone else's floorplan.
  describe('image identity in the saved file', () => {
    const PREFIX = 'data:image/png;base64,' + 'A'.repeat(9000);
    // Same first 8 KB, same total length, different pixels.
    const IMAGE_A = `${PREFIX}AAAAdiffer-A`;
    const IMAGE_B = `${PREFIX}AAAAdiffer-B`;

    it('the two fixtures really do collide, or these tests prove nothing', () => {
      expect(IMAGE_A.length).toBe(IMAGE_B.length);
      expect(IMAGE_A).not.toBe(IMAGE_B);
      expect(hashDataUrl(IMAGE_A)).toBe(hashDataUrl(IMAGE_B));
    });

    it('keeps the active image when the history pool holds a colliding one', () => {
      const storeState = { ...createMockStoreState(), image: IMAGE_A };
      // B was interned first, so it occupies the base slot A would hash to.
      const historyState = {
        undoStack: [{ __imageRef: hashDataUrl(IMAGE_B), roomOverlay: null }],
        redoStack: [],
        imagePool: [[hashDataUrl(IMAGE_B), IMAGE_B]],
      };

      const project = serializeSketch(storeState, historyState);
      const restored = deserializeSketch(project);

      expect(restored.statePatch.image).toBe(IMAGE_A);
      // ...and B is still intact under its own key, so the snapshot that
      // references it still resolves to B rather than to A.
      const poolAfter = Object.fromEntries(restored.historyPatch.imagePool);
      expect(poolAfter[hashDataUrl(IMAGE_B)]).toBe(IMAGE_B);
      expect(project.images[project.floors[0].state.imageRef]).toBe(IMAGE_A);
    });

    it('does not repoint a snapshot when the active image collides with it', () => {
      const storeState = { ...createMockStoreState(), image: IMAGE_A };
      const refB = hashDataUrl(IMAGE_B);
      const historyState = {
        undoStack: [{ __imageRef: refB, roomOverlay: { x1: 1, y1: 1, x2: 2, y2: 2 } }],
        redoStack: [],
        imagePool: [[refB, IMAGE_B]],
      };

      const project = serializeSketch(storeState, historyState);

      // The snapshot's key must still resolve to the image it was taken with.
      expect(project.images[refB]).toBe(IMAGE_B);
      expect(project.floors[0].state.imageRef).not.toBe(refB);
      expect(Object.keys(project.images)).toHaveLength(2);
    });

    it('still de-duplicates when the active image is already interned', () => {
      const storeState = { ...createMockStoreState(), image: IMAGE_A };
      const refA = hashDataUrl(IMAGE_A);
      const historyState = {
        undoStack: [{ __imageRef: refA, roomOverlay: null }],
        redoStack: [],
        imagePool: [[refA, IMAGE_A]],
      };

      const project = serializeSketch(storeState, historyState);

      expect(Object.keys(project.images)).toHaveLength(1);
      expect(project.floors[0].state.imageRef).toBe(refA);
      expect(deserializeSketch(project).statePatch.image).toBe(IMAGE_A);
    });

    it('reads a file written before the fix unchanged', () => {
      // Legacy shape: one image under its raw hash, which is still a valid key.
      const legacy = {
        fileType: 'floorplan',
        version: 1,
        metadata: { projectId: 'legacy', projectName: 'x', createdAt: '', updatedAt: '' },
        globalSettings: { canvasRotation: 0 },
        floors: [{ id: 'floor-1', name: '1st', state: { imageRef: hashDataUrl(IMAGE_A) } }],
        activeFloorId: 'floor-1',
        images: { [hashDataUrl(IMAGE_A)]: IMAGE_A },
      };
      expect(deserializeSketch(legacy).statePatch.image).toBe(IMAGE_A);
    });
  });
});
