import { z } from 'zod';
import { internKey } from './hash';
import { DEFAULT_TRACE_TYPE, normalizeTraces, traceTypeColor } from './traceTypes';
import { newTraceId } from '../store/ids';
import { PERSISTENT_FLOOR_FIELDS } from '../store/appStore';
import { getFileHandle, rememberFileHandle, forgetFileHandle } from './fileHandles';

// Floor state fields written to a project file. Derived from the store's one
// declaration of working state rather than hand-listed here — the hand-listed
// version silently dropped fields the app had come to depend on.
export { PERSISTENT_FLOOR_FIELDS } from '../store/appStore';

// The trace-type migration. Lives in traceTypes.js so `appStore` can run it on
// the two entry points this file does not own without importing zod into the
// entry chunk, and is re-exported here because this is the file that defines
// what a saved trace may contain.
export { normalizeTraces } from './traceTypes';

// ── Zod Schema Definition ───────────────────────────────────────────────────

const metadataSchema = z.object({
  projectId: z.string(),
  projectName: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

const globalSettingsSchema = z.object({
  canvasRotation: z.number().default(0),
});

const vertexSchema = z.object({
  x: z.number(),
  y: z.number(),
});

// How much the saved scale can be trusted. Declared, not left to zod's
// key-stripping: a reopened project would otherwise keep the doubtful scale
// and lose the reason it was doubtful, which is the one direction this file
// must never fail in.
const scaleQualitySchema = z.object({
  level: z.string(),
  reason: z.string().nullable().optional(),
  disagreement: z.number().optional(),
  adopted: z.boolean().optional(),
  roomCount: z.number().optional(),
  // 'auto' (measured from every label) or 'manual' (the user pinned a room).
  // It selects which wording the Area panel uses, so a reopened project that
  // dropped it would describe an automatic scale in the manual flow's words.
  source: z.string().nullable().optional(),
  // A line calibration's own evidence: which lines set it, how long the
  // weakest was, and whether it holds one scalar or two. Dropped on reopen,
  // a hand-set scale would describe itself in the automatic flow's words.
  lineCount: z.number().optional(),
  lengthPx: z.number().optional(),
  feet: z.number().nullable().optional(),
  axes: z.array(z.string()).optional(),
  rejected: z.array(z.object({
    name: z.string().nullable().optional(),
    reason: z.string(),
    pixelsPerFoot: z.number().nullable().optional(),
  })).optional(),
}).nullable().optional();

const calibrationSchema = z.object({
  calibrated: z.boolean(),
  feetPerPixel: z.union([
    z.number(),
    z.object({ x: z.number(), y: z.number() })
  ]),
  source: z.string().nullable().optional(),
  calibratedRoomId: z.string().nullable().optional(),
  createdAt: z.number().nullable().optional(),
  quality: scaleQualitySchema,
}).optional();

const roomDimensionsSchema = z.object({
  width: z.string(),
  height: z.string(),
}).optional();

const roomOverlaySchema = z.object({
  x1: z.number(),
  y1: z.number(),
  x2: z.number(),
  y2: z.number(),
  polygon: z.array(vertexSchema).nullable().optional(),
  confidence: z.number().nullable().optional(),
}).nullable().optional();

const traceQualitySchema = z.object({
  source: z.string().optional(),
  confidence: z.number().nullable().optional(),
  warnings: z.array(z.object({
    code: z.string(),
    severity: z.string().optional(),
    message: z.string().optional(),
    detail: z.any().optional(),
    // Declared, not left to inference: `z.object` strips unknown keys, so both
    // of these would survive autosave and die on a `.floorplan` round trip —
    // the asymmetry that already cost this repo `exteriorLabels`. `anchor` is
    // in original image px and is what makes a warning clickable on reopen.
    scope: z.string().optional(),
    anchor: z.object({ kind: z.enum(['ring', 'rect', 'point', 'segment']) })
      .catchall(z.any()).nullable().optional(),
  })).optional(),
  // Why this outline is not the one the first search produced: which passes
  // ran, which was kept, and how many known-inside rooms each attempt held.
  // Declared for the same reason `scope` and `anchor` above are — an undeclared
  // key survives autosave and dies on a `.floorplan` round trip, so a reopened
  // project would quietly claim the trace had never been re-searched.
  remediation: z.object({
    ran: z.boolean().optional(),
    accepted: z.string().nullable().optional(),
    passes: z.array(z.object({}).catchall(z.any())).optional(),
    before: z.object({}).catchall(z.any()).optional(),
    after: z.object({}).catchall(z.any()).optional(),
  }).catchall(z.any()).nullable().optional(),
}).nullable().optional();

// A hole is a bare ring or a tagged ring. Both shapes parse so a v1 file
// written before provenance existed still opens; new files round-trip the tag,
// which is what keeps a hand-punched void alive across a re-trace.
const holeSchema = z.union([
  z.array(vertexSchema),
  z.object({
    id: z.string().optional(),
    ring: z.array(vertexSchema),
    source: z.string().optional(),
    // Set when a re-trace moved the outline out from under this void. Declared
    // rather than left to the catchall because area depends on it: a stale void
    // is drawn but not subtracted, and losing the flag on reopen would silently
    // start subtracting a hole that is not inside the building.
    stale: z.boolean().optional(),
    staleReason: z.string().nullable().optional(),
  }).catchall(z.any()),
]);

// The detector's two readings of one outline. Declared rather than left to the
// catchall for the reason stated on `anchor` above: this is what the
// exterior/interior switch switches between, and a reopened project that
// dropped it would have a switch that moves nothing and says nothing.
const wallFaceSchema = z.object({
  vertices: z.array(vertexSchema),
  holes: z.array(holeSchema).optional(),
}).nullable().optional();

const perimeterTraceSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertices: z.array(vertexSchema),
  // Enclosed voids (courtyards, light wells) subtracted from the trace's area.
  holes: z.array(holeSchema).optional(),
  // How much the detector trusted this outline, and why not more.
  quality: traceQualitySchema,
  wallFaces: z.object({
    outer: wallFaceSchema,
    inner: wallFaceSchema,
  }).nullable().optional(),
  closed: z.boolean(),
  visible: z.boolean(),
  locked: z.boolean(),
  color: z.string(),
  // Which reported subtotal this trace's area lands in, and whether `color` is
  // derived from that type or was chosen and must be preserved.
  type: z.string().optional(),
  colorSource: z.string().optional(),
  // Whether `name` was generated from the type or typed by the user. A user
  // name outranks a later type change, so it has to survive the round trip.
  nameSource: z.string().optional(),
  // Where `type` came from: 'user' outranks automatic classification, and
  // 'detected' is what lets a re-scan revise its own earlier reading without
  // touching a type the user set. Losing this on reopen would let the next
  // trace overwrite a hand-picked garage.
  typeSource: z.string().optional(),
  // The label 'detected' was read from, so "why is this a basement" stays
  // answerable long after the toast that said so.
  typeEvidence: z.object({
    keyword: z.string().optional(),
    text: z.string().optional(),
    from: z.string().optional(),
  }).nullable().optional(),
}).catchall(z.any());

const roomSchema = z.object({
  labelId: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  rect: z.object({
    left: z.number(), right: z.number(), top: z.number(), bottom: z.number(),
  }),
  confidence: z.number().optional(),
  sides: z.any().optional(),
  feetPerPixel: z.object({ x: z.number(), y: z.number() }).nullable().optional(),
}).catchall(z.any());

const measurementLineSchema = z.object({
  start: vertexSchema,
  end: vertexSchema,
});

// A line the user drew and stated the true length of, in original image px.
// `feet` is null between placing the line and typing its length.
const scaleLineSchema = z.object({
  id: z.string().optional(),
  start: vertexSchema,
  end: vertexSchema,
  feet: z.number().nullable().optional(),
});

const customShapeSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  vertices: z.array(vertexSchema),
  closed: z.boolean(),
  color: z.string().optional(),
});

const angleToolStateSchema = z.object({
  center: vertexSchema,
  angle1: z.number(),
  angle2: z.number(),
  radius1: z.number(),
  radius2: z.number(),
  visible: z.boolean(),
  locked: z.boolean(),
  snapEnabled: z.boolean().optional(),
}).nullable().optional();

const bboxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});

const detectedDimensionSchema = z.object({
  width: z.number(),
  height: z.number(),
  text: z.string(),
  bbox: bboxSchema,
  format: z.string(),
  confidence: z.number().optional(),
});

const floorStateSchema = z.object({
  imageRef: z.string().nullable().optional(),
  roomOverlay: roomOverlaySchema,
  perimeterTraces: z.array(perimeterTraceSchema).optional(),
  activeTraceId: z.string().nullable().optional(),
  roomDimensions: roomDimensionsSchema,
  calibration: calibrationSchema,
  mode: z.string().optional(),
  detectedDimensions: z.array(detectedDimensionSchema).optional(),
  exteriorLabels: z.array(z.any()).optional(),
  areaLabels: z.array(z.any()).optional(),
  rooms: z.array(roomSchema).optional(),
  imageMimeType: z.string().optional(),
  showSideLengths: z.boolean().optional(),
  useInteriorWalls: z.boolean().optional(),
  autoSnapEnabled: z.boolean().optional(),
  manualEntryMode: z.boolean().optional(),
  ocrFailed: z.boolean().optional(),
  unit: z.string().optional(),
  measurementLines: z.array(measurementLineSchema).optional(),
  scaleLines: z.array(scaleLineSchema).optional(),
  customShapes: z.array(customShapeSchema).optional(),
  tracedBoundaries: z.any().optional(),
  zoomScale: z.number().nullable().optional(),
  stageX: z.number().optional(),
  stageY: z.number().optional(),
  angleToolState: angleToolStateSchema,
}).catchall(z.any());

const floorSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: floorStateSchema,
});

const historyStateSchema = floorStateSchema.extend({
  __imageRef: z.string().nullable().optional(),
  image: z.string().nullable().optional(),
});

const historySchema = z.object({
  undoStack: z.array(historyStateSchema).default([]),
  redoStack: z.array(historyStateSchema).default([]),
});

const projectSchema = z.object({
  fileType: z.literal('floorplan'),
  version: z.number(),
  metadata: metadataSchema,
  globalSettings: globalSettingsSchema,
  floors: z.array(floorSchema),
  activeFloorId: z.string(),
  images: z.record(z.string()).default({}),
  history: historySchema.optional(),
});

// ── Helpers ─────────────────────────────────────────────────────────────────

// Centralized hashing helper imported from './hash'

/**
 * Recursively sanitizes numeric values to prevent Konva stage instability
 * by replacing NaNs, Infinities, and malformed structures with clean defaults.
 */
// Identity memo. Snapshots deliberately share references for their heaviest
// members (`tracedBoundaries` is 15.6 KB of a 16.8 KB snapshot, carried by
// reference across up to 50 of them), and a deep rebuild with no memo expanded
// that one shared object into 50 real ones on the heap *before* JSON was even
// involved. A WeakMap keeps the sharing intact through sanitization.
//
// Safe because the output is never mutated: it goes straight to
// `JSON.stringify`, and a sanitized value is a pure function of its input.
const sanitized = new WeakMap();

export function sanitizeData(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      return 0;
    }
    return val;
  }
  if (typeof val !== 'object') return val;

  const cached = sanitized.get(val);
  if (cached !== undefined) return cached;

  let res;
  if (Array.isArray(val)) {
    res = val.map(sanitizeData);
  } else {
    res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeData(v);
    }
  }
  sanitized.set(val, res);
  return res;
}

// ── Version Validation ─────────────────────────────────────────────────────

export function validateProjectVersion(project) {
  if (project.version > 1) {
    throw new Error(
      `Incompatible project version: The project was saved in a newer version of FloorTrace (v${project.version}). Please update FloorTrace to open this project.`
    );
  }
}

// ── Validation ──────────────────────────────────────────────────────────────

export function validateProjectSchema(project) {
  try {
    projectSchema.parse(project);
  } catch (err) {
    if (err instanceof z.ZodError) {
      const details = err.issues.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
      throw new Error(`Project validation failed:\n${details}`);
    }
    throw err;
  }
}

// ── Serialization & Deserialization ──────────────────────────────────────────

/**
 * Serializes the Zustand store state and undo history, de-duplicating image assets.
 */
export function serializeSketch(storeState, historyState = null) {
  const images = {};

  // Extract active floor's state
  const activeFloorState = {};
  for (const key of PERSISTENT_FLOOR_FIELDS) {
    activeFloorState[key] = storeState[key];
  }

  // The history pool goes in first, with its keys preserved exactly: they were
  // minted by undoManager's `internKey`, and every snapshot's `__imageRef`
  // points at them. Rewriting one would silently repoint a snapshot.
  if (historyState && historyState.imagePool) {
    for (const [key, dataUrl] of historyState.imagePool) {
      images[key] = dataUrl;
    }
  }

  // `internKey`, not `hashDataUrl`. This key is what `deserializeSketch`
  // resolves back into `image`, so it has to be an identity, not a bucket --
  // the rule hash.js states and undoManager already follows.
  //
  // The old code minted a raw `hashDataUrl` into this same namespace without
  // looking at what was already there, and it corrupted in both directions.
  // `hashDataUrl` folds an 8 KB prefix plus the length into 32 bits, and the
  // crop and eraser tools emit same-length data URLs from one canvas, so a
  // collision between two real images of one project is reachable rather than
  // theoretical. With the active image A hashing to a slot the pool already
  // held for a different image B, the pool merge overwrote A and the reopened
  // project showed B as the floorplan; and where A had been interned at a
  // probed slot, writing A to the base slot clobbered B and every snapshot
  // referencing it restored the wrong drawing. Either way the file stayed
  // schema-valid and nothing looked wrong.
  //
  // When the active image is already in the pool -- the usual case -- this
  // returns that key and the assignment is a no-op, so de-duplication is
  // unchanged.
  let imageRef = null;
  if (activeFloorState.image) {
    imageRef = internKey(activeFloorState.image, (key) => images[key]);
    images[imageRef] = activeFloorState.image;
  }
  delete activeFloorState.image;

  // Construct a legacy single-floor array for file schema compatibility
  const floorsForExport = [
    {
      id: 'floor-1',
      name: '1st Floor',
      state: {
        ...activeFloorState,
        imageRef,
      },
    }
  ];

  // Collect history stacks
  const historyForExport = historyState ? {
    undoStack: historyState.undoStack || [],
    redoStack: historyState.redoStack || [],
  } : undefined;

  return {
    fileType: 'floorplan',
    version: 1,
    metadata: {
      projectId: storeState.projectId || `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`,
      // Mirrored from the floor state so the header of the file names the
      // subject too — this is the field a file browser or a future index would
      // read, and "Untitled Project" was written into every file ever saved.
      projectName: (storeState.projectName || '').trim() || 'Untitled Project',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    globalSettings: {
      canvasRotation: storeState.canvasRotation ?? 0,
    },
    floors: floorsForExport,
    activeFloorId: 'floor-1',
    images,
    history: historyForExport,
  };
}

/**
 * Deserializes project object, re-hydrating de-duplicated image references.
 */
export function deserializeSketch(project) {
  const images = project.images || {};
  const floor = project.floors[0];
  const state = { ...floor.state };

  if (state.imageRef && images[state.imageRef]) {
    state.image = images[state.imageRef];
  } else {
    state.image = null;
  }
  delete state.imageRef;

  // Migrate legacy numeric scale to X/Y scale object format at deserialization boundary
  if (state.calibration) {
    const fpp = state.calibration.feetPerPixel;
    if (typeof fpp === 'number') {
      state.calibration = {
        ...state.calibration,
        feetPerPixel: { x: fpp, y: fpp },
      };
    }
  }

  let perimeterTraces = normalizeTraces(state.perimeterTraces || []);
  if (perimeterTraces.length === 0) {
    perimeterTraces = [
      {
        // Minted, not the old `'trace-default'` constant: this is a second,
        // independent place a default trace was created, so a file with no
        // traces opened alongside a fresh plan gave both the same trace id.
        id: newTraceId(),
        name: '1st Floor',
        vertices: [],
        closed: false,
        visible: true,
        locked: false,
        type: DEFAULT_TRACE_TYPE,
        colorSource: 'type',
        nameSource: 'auto',
        color: traceTypeColor(DEFAULT_TRACE_TYPE),
      }
    ];
  }

  const activeTraceId = state.activeTraceId || perimeterTraces[0].id;

  // A file written before the subject line existed carries it only in metadata,
  // where the writer always put the same placeholder — so that placeholder is
  // read back as "unnamed" rather than adopted as the subject.
  const metaName = project.metadata.projectName === 'Untitled Project'
    ? '' : (project.metadata.projectName ?? '');

  const statePatch = {
    ...state,
    projectName: state.projectName ?? metaName,
    perimeterTraces,
    activeTraceId,
    traceInteractionMode: 'idle',
    perimeterVertices: null,
    canvasRotation: project.globalSettings?.canvasRotation ?? 0,
    projectId: project.metadata.projectId,
    isDirty: false,
  };

  let historyPatch = null;
  if (project.history) {
    const historyPool = [];
    for (const [hash, dataUrl] of Object.entries(images)) {
      historyPool.push([hash, dataUrl]);
    }
    historyPatch = {
      undoStack: project.history.undoStack || [],
      redoStack: project.history.redoStack || [],
      imagePool: historyPool,
    };
  }

  return {
    statePatch,
    historyPatch,
  };
}

// ── Export & Import Orchestration ───────────────────────────────────────────


/**
 * The state to write for one plan of a multi-plan save.
 *
 * `record` is what that plan was parked with, or what its draft holds; the live
 * state supplies only the fields such a projection legitimately omits. `image`
 * is named explicitly because that is precisely where this went wrong: a draft
 * read back without its image record carries no `image` key at all, so
 * spreading it over the live state left the plan on screen supplying the
 * picture for another plan's file — saved under that plan's name.
 */
export const planStateForSave = (liveState, record) => (
  record ? { ...liveState, ...record, image: record.image ?? null } : null
);

export async function exportProject(storeState, historyState, isSaveAs = false, docId = null) {
  // Sanitize on the way out as well as the way in: a NaN produced in-session
  // otherwise yields a file that fails this module's own importer.
  const project = sanitizeData(serializeSketch(storeState, historyState));
  // No indent: the file is 2.08x larger with `null, 2` (1.20 MB -> 2.49 MB),
  // and the non-image part inflates 4x because indent-2 puts every vertex
  // coordinate on its own line. It is mostly base64 and 50 snapshots, so
  // nobody reads it in an editor.
  const jsonString = JSON.stringify(project);

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  // Local date, not `toISOString`: UTC stamps yesterday on any evening west of
  // Greenwich, which on a dated file is wrong in the least visible way.
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const named = (storeState.projectName || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const defaultFilename = `${named || 'Sketch'} ${timestamp}.floorplan`;

  // A plan already saved through the picker this session overwrites that file,
  // rather than asking again or leaving a second dated copy behind.
  const known = getFileHandle(docId);
  if (!isSaveAs && known) {
    try {
      const writable = await known.createWritable();
      await writable.write(jsonString);
      await writable.close();
      return true;
    } catch (err) {
      // The file may have been moved, deleted or had permission revoked since.
      // Fall through to the normal path rather than failing the save.
      if (err.name !== 'AbortError') forgetFileHandle(docId);
    }
  }

  // Native showSaveFilePicker flow if Save As is requested and supported
  if (isSaveAs && 'showSaveFilePicker' in window) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: defaultFilename,
        types: [{
          description: 'Floorplan Project',
          accept: {
            'application/json': ['.floorplan'],
          },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
      rememberFileHandle(docId, handle);
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false; // user cancelled
      throw err;
    }
  }

  // Fallback download logic
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = defaultFilename;
  link.href = url;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
  return true;
}

export function importProject(projectJsonText) {
  let rawProject;
  try {
    rawProject = JSON.parse(projectJsonText);
  } catch {
    throw new Error('Failed to parse project file. The file is not valid JSON.');
  }
  
  validateProjectVersion(rawProject);
  validateProjectSchema(rawProject);
  const sanitized = sanitizeData(rawProject);
  
  return deserializeSketch(sanitized);
}
