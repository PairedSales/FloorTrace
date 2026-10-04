import { describe, expect, it } from 'vitest';
import {
  serializeSketch,
  deserializeSketch,
  validateProjectSchema,
  validateProjectVersion,
  sanitizeData,
  importProject,
  planStateForSave,
  PERSISTENT_FLOOR_FIELDS,
} from '../projectSerializer';
import { hashDataUrl } from '../hash';
import { makeTrace, normalizeTraces, traceTypeColor } from '../traceTypes';
import useAppStore from '../../store/appStore';

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

// Save and open the way the app does: through the sanitiser and `JSON`, then
// back through `importProject`. Calling `deserializeSketch` on the object
// `serializeSketch` returned skips the parse, so a field the schema dropped
// would still compare equal by reference.
const reopen = (storeState, historyState = null) => importProject(
  JSON.stringify(sanitizeData(serializeSketch(storeState, historyState))),
);

describe('projectSerializer', () => {
  
  // ──────────────────────────────────────────────────────────────────────────
  // sanitizeData
  // ──────────────────────────────────────────────────────────────────────────
  describe('sanitizeData', () => {
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
      const { statePatch } = reopen(storeState);
      expect(statePatch.calibration.quality).toEqual(storeState.calibration.quality);
    });

    // The colour written here is the garage pastel every plan saved before the
    // paper palette carries. A colour that came from the type is the type's to
    // restate, so an old plan opens in the colours of the day.
    it('carries a trace type through a round trip and re-derives its colour from it', () => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].type = 'garage';
      storeState.perimeterTraces[0].colorSource = 'type';
      storeState.perimeterTraces[0].color = '#FFB86C';
      const trace = reopen(storeState).statePatch.perimeterTraces[0];
      expect(trace.type).toBe('garage');
      expect(trace.colorSource).toBe('type');
      expect(trace.color).toBe(traceTypeColor('garage'));
    });

    // Losing either half would let the next trace of a reopened project
    // overwrite the type, and leave "why is this a basement" unanswerable.
    it('carries an automatically detected type and the label it came from', () => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].type = 'below-grade';
      storeState.perimeterTraces[0].typeSource = 'detected';
      storeState.perimeterTraces[0].typeEvidence = {
        keyword: 'basement', text: 'BASEMENT', from: 'inside',
      };
      storeState.areaLabels = [{
        type: 'below-grade', keyword: 'basement', text: 'BASEMENT',
        bbox: { x: 115, y: 651, width: 74, height: 10 },
      }];
      const patch = reopen(storeState).statePatch;
      expect(patch.perimeterTraces[0].typeSource).toBe('detected');
      expect(patch.perimeterTraces[0].typeEvidence.text).toBe('BASEMENT');
      expect(patch.areaLabels).toEqual(storeState.areaLabels);
    });

    // A type in a file written before classification existed can only have come
    // from the user, and re-tracing must not take it back.
    it('imports a type saved before classification existed as the user\'s', () => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].type = 'garage';
      delete storeState.perimeterTraces[0].typeSource;
      const project = serializeSketch(storeState);

      const trace = deserializeSketch(project).statePatch.perimeterTraces[0];
      expect(trace.typeSource).toBe('user');
    });

    // The migration that has to be non-destructive: a project saved before
    // types must not collapse its multi-coloured floors into one hue.
    it('imports a project saved before types as GLA with its colours intact', () => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces = [
        { ...storeState.perimeterTraces[0], id: 'a', color: '#BD93F9' },
        { ...storeState.perimeterTraces[0], id: 'b', color: '#8BE9FD' },
      ];
      const project = serializeSketch(storeState);
      expect(() => validateProjectSchema(project)).not.toThrow();

      const traces = deserializeSketch(project).statePatch.perimeterTraces;
      expect(traces.map((t) => t.type)).toEqual(['gla', 'gla']);
      expect(traces.map((t) => t.colorSource)).toEqual(['user', 'user']);
      expect(traces.map((t) => t.color)).toEqual(['#BD93F9', '#8BE9FD']);
    });
  });

  // ──────────────────────────────────────────────────────────────────────────
  // Schema Validation
  // ──────────────────────────────────────────────────────────────────────────
  // The subject line is what the saved file is filed under and what the
  // exported exhibit is titled with, so it has to survive the round trip — the
  // asymmetry this module has been bitten by before (autosaved but not
  // exported) would lose it on every reopen.
  describe('the subject line', () => {
    it('round-trips, and reaches the file header too', () => {
      const project = serializeSketch(createMockStoreState(), null);
      expect(project.metadata.projectName).toBe('My Test Project');
      expect(deserializeSketch(project).statePatch.projectName).toBe('My Test Project');
    });

    it('reads a file written before it existed as unnamed', () => {
      const project = serializeSketch({ ...createMockStoreState(), projectName: '' }, null);
      expect(project.metadata.projectName).toBe('Untitled Project');
      // Simulating the older writer, which put the placeholder in metadata and
      // nothing in the floor state.
      delete project.floors[0].state.projectName;
      expect(deserializeSketch(project).statePatch.projectName).toBe('');
    });

    it('recovers a name an older file only recorded in metadata', () => {
      const project = serializeSketch(createMockStoreState(), null);
      delete project.floors[0].state.projectName;
      expect(deserializeSketch(project).statePatch.projectName).toBe('My Test Project');
    });
  });

  describe('validateProjectSchema', () => {
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
  });

  // ──────────────────────────────────────────────────────────────────────────
  // hole provenance
  // ──────────────────────────────────────────────────────────────────────────
  describe('trace holes', () => {
    const ring = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];

    const withHoles = (holes) => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].holes = holes;
      return storeState;
    };

    it('round-trips a mixed set of tagged and bare holes', () => {
      const holes = [
        { id: 'hole-auto-0', ring: ring(4), source: 'auto' },
        { id: 'hole-user-0', ring: ring(6), source: 'user' },
        { id: 'hole-auto-1', ring: ring(5), source: 'auto', stale: true, staleReason: 'outside' },
        ring(8),
      ];
      const { statePatch } = reopen(withHoles(holes));
      expect(statePatch.perimeterTraces[0].holes).toEqual(holes);
    });

    it('still rejects a hole that is neither shape', () => {
      const project = serializeSketch(withHoles([{ id: 'h1', source: 'user' }])); // no ring
      expect(() => validateProjectSchema(project)).toThrow(/Project validation failed/);
    });
  });

  // The pair the exterior/interior switch switches between. It is per trace so
  // the switch reaches outlines from every detection pass, which means a
  // reopened project that dropped it has a switch that moves nothing.
  describe('trace wall faces', () => {
    const ring = (n) => [{ x: 0, y: 0 }, { x: n, y: 0 }, { x: n, y: n }, { x: 0, y: n }];
    const wallFaces = {
      outer: { vertices: ring(100), holes: [{ id: 'hole-auto-0', ring: ring(9), source: 'auto' }] },
      inner: { vertices: ring(90), holes: [] },
    };

    const withFaces = (faces) => {
      const storeState = createMockStoreState();
      storeState.perimeterTraces[0].wallFaces = faces;
      return storeState;
    };

    it('round-trips both faces and their voids', () => {
      const { statePatch } = reopen(withFaces(wallFaces));
      expect(statePatch.perimeterTraces[0].wallFaces).toEqual(wallFaces);
    });

    it('accepts a pair with only one face', () => {
      const faces = { outer: { vertices: ring(100), holes: [] }, inner: null };
      expect(reopen(withFaces(faces)).statePatch.perimeterTraces[0].wallFaces).toEqual(faces);
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

  // A hand-set scale must survive a reopen with the evidence it rests on and
  // the reason to doubt it. Losing either leaves a number nobody can check.
  describe('line calibration', () => {
    const withScaleLines = () => ({
      ...createMockStoreState(),
      scaleLines: [
        { id: 'scale-1', start: { x: 10, y: 10 }, end: { x: 210, y: 10 }, feet: 20 },
        { id: 'scale-2', start: { x: 10, y: 10 }, end: { x: 10, y: 110 }, feet: 10.4 },
      ],
      calibration: {
        calibrated: true,
        feetPerPixel: { x: 0.1, y: 0.104 },
        source: 'line-calibration',
        quality: {
          level: 'note',
          reason: 'scale-anisotropic',
          disagreement: 0.0392,
          adopted: true,
          source: 'line',
          lineCount: 2,
          lengthPx: 100,
          feet: 10.4,
          axes: ['x', 'y'],
        },
      },
    });

    it('round-trips the lines, the source and the reason to doubt it', () => {
      const { statePatch } = reopen(withScaleLines());
      expect(statePatch.scaleLines).toHaveLength(2);
      expect(statePatch.scaleLines[0].feet).toBe(20);
      expect(statePatch.calibration.source).toBe('line-calibration');
      expect(statePatch.calibration.quality.source).toBe('line');
      expect(statePatch.calibration.quality.reason).toBe('scale-anisotropic');
      expect(statePatch.calibration.quality.lineCount).toBe(2);
      expect(statePatch.calibration.quality.axes).toEqual(['x', 'y']);
    });
  });
});

// A field a draft keeps and a `.floorplan` drops is the asymmetry that already
// cost this repo `exteriorLabels`. An anchor that does not survive is a warning
// that becomes unclickable the moment a project is reopened.
describe('warning anchors round-trip', () => {
  const withAnchoredWarnings = () => ({
    ...createMockStoreState(),
    perimeterTraces: [{
      id: 'trace-1',
      name: '1st Floor',
      vertices: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }],
      holes: [],
      closed: true,
      visible: true,
      color: '#BD93F9',
      quality: {
        source: 'auto',
        confidence: 0.62,
        warnings: [
          {
            code: 'bridged-opening',
            severity: 'warn',
            message: 'a wide opening was bridged to close the outline',
            detail: { px: 34 },
            scope: 'floor',
            anchor: { kind: 'segment', points: [{ x: 40, y: 12 }, { x: 74, y: 12 }] },
          },
          {
            code: 'weak-wall-support',
            severity: 'warn',
            message: 'much of the outline is not drawn as a wall',
            detail: { support: 0.41 },
            scope: 'floor',
            anchor: { kind: 'segment', runs: [[{ x: 0, y: 0 }, { x: 9, y: 0 }]] },
          },
        ],
      },
    }],
    activeTraceId: 'trace-1',
  });

  it('keeps both the anchor and the scope through export and import', () => {
    const { statePatch } = reopen(withAnchoredWarnings());
    const warnings = statePatch.perimeterTraces[0].quality.warnings;

    expect(warnings[0].anchor).toEqual({
      kind: 'segment', points: [{ x: 40, y: 12 }, { x: 74, y: 12 }],
    });
    expect(warnings[1].anchor).toEqual({
      kind: 'segment', runs: [[{ x: 0, y: 0 }, { x: 9, y: 0 }]],
    });
    expect(warnings[0].scope).toBe('floor');
  });

  it('accepts a project written before anchors existed', () => {
    const state = withAnchoredWarnings();
    for (const w of state.perimeterTraces[0].quality.warnings) {
      delete w.anchor;
      delete w.scope;
    }
    const { statePatch } = reopen(state);
    expect(statePatch.perimeterTraces[0].quality.warnings[0].anchor).toBeUndefined();
    expect(statePatch.perimeterTraces[0].quality.warnings[0].code).toBe('bridged-opening');
  });
});

// ---------------------------------------------------------------------------
// planStateForSave — what "Save all plans" writes for one plan
// ---------------------------------------------------------------------------

describe('planStateForSave', () => {
  const live = {
    projectName: 'Plan on screen',
    image: 'data:image/png;base64,LIVE',
    unit: 'decimal',
    perimeterTraces: [{ id: 'live' }],
  };

  it('takes the plan’s own state over the plan that happens to be live', () => {
    const record = {
      projectName: 'Parked plan',
      image: 'data:image/png;base64,PARKED',
      perimeterTraces: [{ id: 'parked' }],
    };
    const state = planStateForSave(live, record);
    expect(state.projectName).toBe('Parked plan');
    expect(state.image).toBe('data:image/png;base64,PARKED');
    expect(state.perimeterTraces).toEqual([{ id: 'parked' }]);
  });

  // The whole point. `writeDocDraft` stores the image as a separate record, so
  // a draft read back without it has no `image` KEY at all — and a spread over
  // the live state then left the plan on screen supplying the picture for
  // someone else's file, saved under someone else's name.
  it('never lets a record with no image key inherit the live one', () => {
    const state = planStateForSave(live, {
      projectName: 'Lost its picture',
      perimeterTraces: [{ id: 'parked' }],
    });
    expect(state.image).toBeNull();
    expect(state.projectName).toBe('Lost its picture');
  });

  it('still supplies fields the record legitimately omits', () => {
    expect(planStateForSave(live, { image: 'x' }).unit).toBe('decimal');
  });

  it('refuses to invent a plan when there is no record', () => {
    expect(planStateForSave(live, null)).toBeNull();
    expect(planStateForSave(live, undefined)).toBeNull();
  });
});

// A field that used to be persisted and has since been removed from the app.
// `manualEntryMode` is the concrete case — it was in PERSISTENT_FLOOR_FIELDS,
// so every .floorplan written before its removal still carries it — but the
// property under test is general: dropping a persisted field must degrade an
// existing file quietly, neither rejecting it nor bringing the field back.
describe('a persisted field removed from the app', () => {
  const fileCarryingRemovedField = () => ({
    fileType: 'floorplan',
    version: 1,
    metadata: {
      projectId: 'p-1',
      projectName: 'Written before the field was removed',
      createdAt: '2026-06-07T12:00:00.000Z',
      updatedAt: '2026-06-07T12:00:00.000Z',
    },
    globalSettings: { canvasRotation: 0 },
    floors: [{
      id: 'floor-1',
      name: '1st Floor',
      state: {
        roomDimensions: { width: '10', height: '12' },
        calibration: { calibrated: true, feetPerPixel: { x: 1, y: 1 } },
        perimeterTraces: [],
        manualEntryMode: true,
        // And a key no version of the app ever wrote.
        notAStoreField: { x: 1 },
      },
    }],
    activeFloorId: 'floor-1',
  });

  it('still validates — unknown keys are not a reason to refuse a file', () => {
    expect(() => validateProjectSchema(fileCarryingRemovedField())).not.toThrow();
  });

  // Through the store, because `loadProject` spreading the patch is where an
  // extra key becomes live state. Asked of the patch's own keys, not of the
  // `{ statePatch, historyPatch }` wrapper, which never has them either way.
  it('does not put the removed field, or any unknown key, on the store', () => {
    const { statePatch } = importProject(JSON.stringify(fileCarryingRemovedField()));
    expect(Object.hasOwn(statePatch, 'manualEntryMode')).toBe(false);
    expect(Object.hasOwn(statePatch, 'notAStoreField')).toBe(false);

    useAppStore.getState().loadProject(statePatch);
    const state = useAppStore.getState();
    expect(Object.hasOwn(state, 'manualEntryMode')).toBe(false);
    expect(Object.hasOwn(state, 'notAStoreField')).toBe(false);
    // ...while the fields it does know still arrive.
    expect(state.roomDimensions).toEqual({ width: '10', height: '12' });
    expect(state.calibration.calibrated).toBe(true);
  });
});

// Fields inside a persisted record that the app wrote, never read, and stopped
// writing in October 2026: an outline's `locked`, the protractor's `visible`,
// `locked` and `snapEnabled`, the scale's `calibratedRoomId` and `createdAt`.
// Every file saved before then carries them, and still has to open. A file
// saved now has none, which the schema used to refuse for three of the six;
// every `reopen` in this suite is that case.
describe('fields a saved record no longer has', () => {
  const savedBefore = () => {
    const file = JSON.parse(JSON.stringify(sanitizeData(serializeSketch(createMockStoreState()))));
    const state = file.floors[0].state;
    state.perimeterTraces[0].locked = false;
    Object.assign(state.calibration, { calibratedRoomId: null, createdAt: 1234567890 });
    state.angleToolState = {
      center: { x: 100, y: 100 }, angle1: 0, angle2: 90, radius1: 40, radius2: 60,
      visible: true, locked: false, snapEnabled: true,
    };
    return JSON.stringify(file);
  };

  it('opens a file that carries them', () => {
    const { statePatch } = importProject(savedBefore());
    expect(statePatch.perimeterTraces[0].vertices).toHaveLength(3);
    expect(statePatch.calibration.feetPerPixel).toEqual({ x: 2, y: 2 });
    expect(statePatch.angleToolState.center).toEqual({ x: 100, y: 100 });
  });
});

// ---------------------------------------------------------------------------
// The whole projection through a real file
// ---------------------------------------------------------------------------

// Every field `PERSISTENT_FLOOR_FIELDS` writes, each holding something other
// than its default, in the shapes the app's own producers give it — including
// the keys the schema does not declare (`ocrText`, a warning's `remedy`, a
// room's `sides`), because what `parse` returns is what a project opens with.
const ring = (x, y, n) => [{ x, y }, { x: x + n, y }, { x: x + n, y: y + n }, { x, y: y + n }];

const fullyPopulatedPlan = () => {
  const warnings = [{
    code: 'bridged-opening',
    severity: 'warn',
    message: 'a wide opening was bridged to close the outline',
    detail: { px: 34 },
    remedy: 'check the opening',
    scope: 'floor',
    anchor: { kind: 'segment', points: [{ x: 40, y: 12 }, { x: 74, y: 12 }] },
    acknowledged: { at: 1700000000000, note: 'checked' },
  }];
  const quality = {
    source: 'auto',
    confidence: 0.62,
    warnings,
    edited: true,
    remediation: {
      ran: true,
      accepted: 'rooms-seeded',
      passes: [{ name: 'rooms-seeded', roomsInside: 3 }],
      before: { roomsInside: 2 },
      after: { roomsInside: 3 },
    },
  };
  const traces = normalizeTraces([
    makeTrace({
      id: 'trace-main',
      name: 'Basement',
      vertices: ring(10, 10, 300),
      closed: true,
      type: 'below-grade',
      typeSource: 'detected',
      typeEvidence: { keyword: 'basement', text: 'BASEMENT', from: 'inside' },
      holes: [
        { id: 'hole-auto-0', ring: ring(50, 50, 20), source: 'auto' },
        { id: 'hole-user-0', ring: ring(120, 120, 15), source: 'user', stale: true, staleReason: 'outside' },
        ring(200, 200, 10),
      ],
      quality,
      wallFaces: {
        outer: { vertices: ring(8, 8, 304), holes: [{ id: 'hole-auto-0', ring: ring(50, 50, 20), source: 'auto' }] },
        inner: { vertices: ring(14, 14, 292), holes: [] },
      },
    }),
    makeTrace({
      id: 'trace-garage',
      name: 'Workshop',
      nameSource: 'user',
      vertices: ring(320, 10, 120),
      closed: true,
      visible: false,
      type: 'garage',
      typeSource: 'user',
      colorSource: 'user',
      color: '#123456',
    }),
  ]);

  return {
    image: 'data:image/png;base64,FullyPopulatedPlan',
    imageMimeType: 'image/jpeg',
    roomOverlay: {
      x1: 20, y1: 30, x2: 140, y2: 130,
      polygon: ring(20, 30, 100),
      confidence: 0.81,
    },
    perimeterTraces: traces,
    activeTraceId: 'trace-garage',
    roomDimensions: { width: '12\'6"', height: '10\'' },
    calibration: {
      calibrated: true,
      feetPerPixel: { x: 0.104, y: 0.1 },
      source: 'room-calibration',
      quality: {
        level: 'check',
        reason: 'room-vs-project',
        disagreement: 0.06,
        adopted: true,
        roomCount: 3,
        source: 'auto',
        rejected: [{ name: 'KITCHEN', reason: 'outlier', pixelsPerFoot: 7.1 }],
      },
    },
    mode: 'manual',
    detectedDimensions: [{
      width: 12.5,
      height: 10,
      text: '12\'6" x 10\'',
      ocrText: '12\'6"x10\'',
      bbox: { x: 40, y: 60, width: 80, height: 14 },
      confidence: 88,
      format: 'inches',
    }],
    exteriorLabels: [{
      type: 'garage', keyword: 'garage', text: 'GARAGE',
      bbox: { x: 350, y: 50, width: 60, height: 12 },
    }],
    areaLabels: [{
      type: 'below-grade', keyword: 'basement', text: 'BASEMENT',
      bbox: { x: 115, y: 151, width: 74, height: 10 },
    }],
    rooms: [{
      labelId: 'label-3',
      name: null,
      rect: { left: 20, right: 140, top: 30, bottom: 130 },
      confidence: 0.81,
      sides: { left: 20, right: 140, top: 30, bottom: 130 },
      feetPerPixel: { x: 0.104, y: 0.1 },
    }],
    showSideLengths: false,
    useInteriorWalls: true,
    autoSnapEnabled: false,
    ocrFailed: true,
    unit: 'inches',
    angleToolState: {
      center: { x: 100, y: 100 },
      angle1: 0,
      angle2: 90,
      radius1: 40,
      radius2: 60,
    },
    measurementLines: [{ start: { x: 0, y: 0 }, end: { x: 100, y: 0 } }],
    scaleLines: [{ id: 'scale-1', start: { x: 10, y: 10 }, end: { x: 210, y: 10 }, feet: 20 }],
    customShapes: [{ id: 'shape-1', name: 'Deck', vertices: ring(500, 500, 40), closed: true, color: '#FF0000' }],
    tracedBoundaries: { floors: [{ vertices: ring(10, 10, 300), confidence: 0.62 }], imageWidth: 800 },
    lastTraceOutcome: { at: 1700000000000, level: 'check', reason: 'bridged-opening', floors: 1, source: 'auto' },
    drawStrokes: [{ points: [{ x: 5, y: 5 }, { x: 90, y: 5 }, { x: 90, y: 70 }] }],
    zoomScale: 1.5,
    stageX: 12,
    stageY: -4,
    projectName: '12 Elm St',
    // The store's own non-persisted fields, so the save has to choose.
    canvasRotation: 90,
    projectId: 'project-full',
  };
};

describe('every persisted field through a real file', () => {
  // Without these two the comparison below could pass by comparing nothing:
  // a field missing from the fixture compares `undefined` with `undefined`,
  // and one left at its default cannot tell a dropped value from a kept one.
  it('the fixture populates every persisted field, each away from its default', () => {
    useAppStore.getState().loadProject({});
    const defaults = useAppStore.getState();
    const plan = fullyPopulatedPlan();
    expect(PERSISTENT_FLOOR_FIELDS.filter((k) => !Object.hasOwn(plan, k))).toEqual([]);
    const atDefault = PERSISTENT_FLOOR_FIELDS.filter(
      (k) => JSON.stringify(plan[k]) === JSON.stringify(defaults[k]),
    );
    expect(atDefault).toEqual([]);
  });

  it('opens with every persisted field as it was saved', () => {
    const plan = fullyPopulatedPlan();
    const { statePatch } = reopen(plan);
    for (const key of PERSISTENT_FLOOR_FIELDS) {
      expect({ [key]: statePatch[key] }).toEqual({ [key]: plan[key] });
    }
    expect(statePatch.canvasRotation).toBe(90);
    expect(statePatch.projectId).toBe('project-full');
  });

  // The undo stacks are file content too: undoing into a snapshot that lost a
  // field would hand that field back as its default.
  it('carries an undo snapshot with every field it held', () => {
    const plan = fullyPopulatedPlan();
    const snapshot = { ...plan, __imageRef: 'img-0' };
    delete snapshot.image;
    const { historyPatch } = reopen(plan, {
      undoStack: [snapshot],
      redoStack: [],
      imagePool: [['img-0', plan.image]],
    });
    expect(historyPatch.undoStack).toEqual([snapshot]);
  });

  it('is what the store holds after opening it', () => {
    const plan = fullyPopulatedPlan();
    useAppStore.getState().loadProject(reopen(plan).statePatch);
    const state = useAppStore.getState();
    for (const key of PERSISTENT_FLOOR_FIELDS) {
      expect({ [key]: state[key] }).toEqual({ [key]: plan[key] });
    }
  });
});

// The parse is what a project opens with, so it must not strip anything the
// app wrote. A `z.object` anywhere in the schema strips keys it was not told
// about; this marks every object in a fully populated file with a key the
// schema cannot know and checks that every mark survives.
describe('the schema keeps what it does not declare', () => {
  const mark = (value) => {
    if (Array.isArray(value)) return value.map(mark);
    if (value && typeof value === 'object') {
      const out = { __unknown: 1 };
      for (const [k, v] of Object.entries(value)) out[k] = mark(v);
      return out;
    }
    return value;
  };

  it('returns every object of the file with its unknown keys intact', () => {
    const plan = fullyPopulatedPlan();
    const snapshot = { ...plan, __imageRef: 'img-0' };
    delete snapshot.image;
    const file = JSON.parse(JSON.stringify(sanitizeData(serializeSketch(plan, {
      undoStack: [snapshot],
      redoStack: [snapshot],
      imagePool: [['img-0', plan.image]],
    }))));
    // `images` is a record from key to data URL: a marker there would be an
    // image that is not a string, which the schema rightly refuses.
    const { images, ...rest } = file;
    const marked = { ...mark(rest), images };
    expect(validateProjectSchema(marked)).toEqual(marked);
  });
});
