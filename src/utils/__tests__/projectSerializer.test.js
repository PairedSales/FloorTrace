import { describe, expect, it } from 'vitest';
import {
  serializeSketch,
  deserializeSketch,
  validateProjectSchema,
  validateProjectVersion,
  sanitizeData,
  importProject,
} from '../projectSerializer';

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
      expect(() => validateProjectSchema(invalidProject)).toThrow();
    });

    it('throws on mismatching file type literal', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      project.fileType = 'wrong_filetype';
      expect(() => validateProjectSchema(project)).toThrow();
    });

    it('throws on invalid coordinate type in perimeterTraces', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      // Change vertex x to a string (invalid)
      project.floors[0].state.perimeterTraces[0].vertices[0].x = 'invalid-string';
      expect(() => validateProjectSchema(project)).toThrow();
    });

    it('throws on missing required fields inside customShapes', () => {
      const storeState = createMockStoreState();
      const project = serializeSketch(storeState);
      project.floors[0].state.customShapes = [{
        closed: true,
        // missing vertices
      }];
      expect(() => validateProjectSchema(project)).toThrow();
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
});
