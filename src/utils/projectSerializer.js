import { z } from 'zod';

// List of floor state fields that should be persisted (excludes transient/ephemeral states)
export const PERSISTENT_FLOOR_FIELDS = [
  'image',
  'roomOverlay',
  'perimeterOverlay',
  'roomDimensions',
  'area',
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
  'stageY'
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
  const activeFloorId = activeFloor.id;
  const activeFloorState = activeFloor.state;

  // Set the active floor state to null inside floors list (Zustand representation)
  const floors = restoredFloors.map((f) => {
    if (f.id === activeFloorId) {
      return { ...f, state: null };
    }
    return f;
  });

  // Hydrate Zustand store patch
  const statePatch = {
    ...activeFloorState,
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
