import { z } from 'zod';

// List of floor state fields that should be persisted (excludes transient/ephemeral states)
export const PERSISTENT_FLOOR_FIELDS = [
  'image',
  'roomOverlay',
  'perimeterTraces',
  'activeTraceId',
  'roomDimensions',
  'scale',
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

const floorStateSchema = z.record(z.any());

const floorSchema = z.object({
  id: z.string(),
  name: z.string(),
  state: floorStateSchema,
});

const historySchema = z.object({
  undoStack: z.array(z.record(z.any())).default([]),
  redoStack: z.array(z.record(z.any())).default([]),
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

// ── Migrations Registry ─────────────────────────────────────────────────────

const MIGRATIONS = {
  1: (data) => {
    // V1 schema initialization
    return data;
  },
};

export function migrateProjectSchema(project) {
  const targetVersion = 1;
  let currentVersion = project.version;
  let migrated = { ...project };

  if (currentVersion > targetVersion) {
    throw new Error(
      `Incompatible project version: The project was saved in a newer version of FloorTrace (v${currentVersion}). Please update FloorTrace to open this project.`
    );
  }

  while (currentVersion < targetVersion) {
    const nextVer = currentVersion + 1;
    const migration = MIGRATIONS[nextVer];
    if (!migration) {
      throw new Error(`No migration found from v${currentVersion} to v${nextVer}`);
    }
    migrated = migration(migrated);
    migrated.version = nextVer;
    currentVersion = nextVer;
  }

  return migrated;
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

  // Restore background images in floor states
  const restoredFloors = project.floors.map((floor) => {
    const state = { ...floor.state };
    if (state.imageRef && images[state.imageRef]) {
      state.image = images[state.imageRef];
    } else {
      state.image = null;
    }
    delete state.imageRef;
    return {
      ...floor,
      state,
    };
  });

  const activeFloor = restoredFloors.find((f) => f.id === project.activeFloorId) || restoredFloors[0];

  // Find canonical floor: first floor with an image and scale
  const canonicalFloor = restoredFloors.find(f => f.state?.image && f.state?.scale) || activeFloor || restoredFloors[0];
  const canonicalState = canonicalFloor ? { ...canonicalFloor.state } : {};

  // ── Legacy Multi-Floor to Multi-Perimeter Migration ──────────────────────
  // Convert legacy multi-tab floor perimeters into traces on the canonical canvas.
  //
  // WARNING/ASSUMPTION:
  // This migration assumes that all legacy floor vertices are already image-space
  // compatible with the canonical canvas. If different tabs supported different images,
  // dimensions, offsets, or transforms, the imported traces may be misaligned.
  const TRACE_COLORS = [
    '#BD93F9', // Purple
    '#8BE9FD', // Cyan
    '#50FA7B', // Green
    '#FF79C6', // Pink
    '#FFB86C', // Orange
    '#F1FA8C', // Yellow
    '#FF5555', // Red
  ];

  let perimeterTraces = canonicalState.perimeterTraces || [];
  if (perimeterTraces.length === 0) {
    restoredFloors.forEach((f, index) => {
      const fState = f.state || {};
      const overlay = fState.perimeterOverlay;
      if (overlay && overlay.vertices && overlay.vertices.length > 0) {
        perimeterTraces.push({
          id: `trace-migrated-${f.id}-${index}`,
          name: f.name || `Floor ${index + 1}`,
          vertices: overlay.vertices,
          closed: true,
          visible: true,
          locked: false,
          color: TRACE_COLORS[index % TRACE_COLORS.length],
        });
      }
    });
  }

  let activeTraceId = canonicalState.activeTraceId;
  if (!activeTraceId && perimeterTraces.length > 0) {
    // Try to select the trace corresponding to the activeFloor in the legacy project
    const activeFloorIndex = restoredFloors.findIndex(f => f.id === project.activeFloorId);
    const matchingMigratedTrace = perimeterTraces.find(t => t.id === `trace-migrated-${project.activeFloorId}-${activeFloorIndex}`);
    if (matchingMigratedTrace) {
      activeTraceId = matchingMigratedTrace.id;
    } else {
      activeTraceId = perimeterTraces[0].id;
    }
  }

  // Force single floor structure for multi-perimeter architecture
  const activeFloorId = 'floor-1';
  const floors = [
    {
      id: 'floor-1',
      name: '1st Floor',
      state: null,
    }
  ];

  // Hydrate Zustand store patch
  const statePatch = {
    ...canonicalState,
    perimeterTraces,
    activeTraceId,
    traceInteractionMode: 'idle',
    perimeterVertices: null, // ensure no in-progress drawing on load
    floors,
    activeFloorId,
    canvasRotation: project.globalSettings?.canvasRotation ?? 0,
    projectId: project.metadata.projectId,
    isDirty: false,
  };

  // Re-hydrate undo/redo history pool
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
  const rawProject = JSON.parse(projectJsonText);
  
  validateProjectSchema(rawProject);
  const migrated = migrateProjectSchema(rawProject);
  const sanitized = sanitizeData(migrated);
  
  return deserializeSketch(sanitized);
}
