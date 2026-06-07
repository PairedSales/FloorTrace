import { z } from 'zod';

// List of floor state fields that should be persisted (excludes transient/ephemeral states)
export const PERSISTENT_FLOOR_FIELDS = [
  'image',
  'roomOverlay',
  'perimeterTraces',
  'activeTraceId',
  'roomDimensions',
  'calibration',
  'mode',
  'detectedDimensions',
  'showSideLengths',
  'useInteriorWalls',
  'autoSnapEnabled',
  'manualEntryMode',
  'ocrFailed',
  'unit',
  'measurementLines',
  'customShapes',
  'tracedBoundaries',
  'debugDetection',
  'detectionDebugData',
  'zoomScale',
  'stageX',
  'stageY',
  'angleToolState'
];

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

const calibrationSchema = z.object({
  calibrated: z.boolean(),
  feetPerPixel: z.number(),
  source: z.string().nullable().optional(),
  calibratedRoomId: z.string().nullable().optional(),
  createdAt: z.number().nullable().optional(),
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

const perimeterTraceSchema = z.object({
  id: z.string(),
  name: z.string(),
  vertices: z.array(vertexSchema),
  closed: z.boolean(),
  visible: z.boolean(),
  locked: z.boolean(),
  color: z.string(),
});

const measurementLineSchema = z.object({
  start: vertexSchema,
  end: vertexSchema,
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
  showSideLengths: z.boolean().optional(),
  useInteriorWalls: z.boolean().optional(),
  autoSnapEnabled: z.boolean().optional(),
  manualEntryMode: z.boolean().optional(),
  ocrFailed: z.boolean().optional(),
  unit: z.string().optional(),
  measurementLines: z.array(measurementLineSchema).optional(),
  customShapes: z.array(customShapeSchema).optional(),
  tracedBoundaries: z.any().optional(),
  debugDetection: z.boolean().optional(),
  detectionDebugData: z.any().optional(),
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

/**
 * Fast, non-cryptographic hash of a string (FNV-1a, 32-bit).
 * Keeps keys consistent with undoManager's hashing.
 */
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

/**
 * Recursively sanitizes numeric values to prevent Konva stage instability
 * by replacing NaNs, Infinities, and malformed structures with clean defaults.
 */
export function sanitizeData(val) {
  if (val === null || val === undefined) return val;
  if (typeof val === 'number') {
    if (Number.isNaN(val) || !Number.isFinite(val)) {
      return 0;
    }
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(sanitizeData);
  }
  if (typeof val === 'object') {
    const res = {};
    for (const [k, v] of Object.entries(val)) {
      res[k] = sanitizeData(v);
    }
    return res;
  }
  return val;
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
      const details = err.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('\n');
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

  // De-duplicate floor background images
  const floorsForExport = storeState.floors.map((floor) => {
    const rawState = floor.id === storeState.activeFloorId ? activeFloorState : floor.state;
    const serializedState = { ...rawState };
    
    let imageRef = null;
    if (serializedState.image) {
      const hash = hashImage(serializedState.image);
      images[hash] = serializedState.image;
      imageRef = hash;
    }
    delete serializedState.image;

    return {
      id: floor.id,
      name: floor.name,
      state: {
        ...serializedState,
        imageRef,
      },
    };
  });

  // Collect history stacks
  const historyForExport = historyState ? {
    undoStack: historyState.undoStack || [],
    redoStack: historyState.redoStack || [],
  } : undefined;

  // Add all history images to top-level pool
  if (historyState && historyState.imagePool) {
    for (const [hash, dataUrl] of historyState.imagePool) {
      images[hash] = dataUrl;
    }
  }

  return {
    fileType: 'floorplan',
    version: 1,
    metadata: {
      projectId: storeState.projectId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      projectName: storeState.projectName || 'Untitled Project',
      createdAt: storeState.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    globalSettings: {
      canvasRotation: storeState.canvasRotation ?? 0,
    },
    floors: floorsForExport,
    activeFloorId: storeState.activeFloorId,
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

  let perimeterTraces = state.perimeterTraces || [];
  if (perimeterTraces.length === 0) {
    perimeterTraces = [
      {
        id: 'trace-default',
        name: '1st Floor',
        vertices: [],
        closed: false,
        visible: true,
        locked: false,
        color: '#BD93F9',
      }
    ];
  }

  const activeTraceId = state.activeTraceId || perimeterTraces[0].id;
  const activeFloorId = 'floor-1';
  const floors = [
    {
      id: 'floor-1',
      name: '1st Floor',
      state: null,
    }
  ];

  const statePatch = {
    ...state,
    perimeterTraces,
    activeTraceId,
    traceInteractionMode: 'idle',
    perimeterVertices: null,
    floors,
    activeFloorId,
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

export async function exportProject(storeState, historyState, isSaveAs = false) {
  const project = serializeSketch(storeState, historyState);
  const jsonString = JSON.stringify(project, null, 2);

  const timestamp = new Date().toISOString().split('T')[0];
  const defaultFilename = `Sketch ${timestamp}.floorplan`;

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
  } catch (err) {
    throw new Error('Failed to parse project file. The file is not valid JSON.');
  }
  
  validateProjectVersion(rawProject);
  validateProjectSchema(rawProject);
  const sanitized = sanitizeData(rawProject);
  
  return deserializeSketch(sanitized);
}
