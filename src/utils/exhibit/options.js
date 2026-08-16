// What the exhibit includes, remembered across sessions.
//
// A preference about the shape of an output, not document content — so it lives
// in localStorage beside `saveOnExit` rather than in a `.floorplan`, where it
// would travel to another machine and quietly change someone else's export.

import { EXHIBIT_DEFAULTS } from './model';

const KEY = 'floortrace:exportOptions:v1';

export function readExportOptions() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...EXHIBIT_DEFAULTS };
    const stored = JSON.parse(raw);
    // Key by key, so a stored file from an older build cannot introduce an
    // option the renderer does not know, or drop one it needs.
    return Object.fromEntries(
      Object.entries(EXHIBIT_DEFAULTS).map(([k, v]) => [
        k, typeof stored?.[k] === 'boolean' ? stored[k] : v,
      ]),
    );
  } catch {
    return { ...EXHIBIT_DEFAULTS };
  }
}

export function writeExportOptions(options) {
  try {
    localStorage.setItem(KEY, JSON.stringify(options));
  } catch {
    // A blocked or full localStorage costs the user their checkbox memory and
    // nothing else — never the export itself.
  }
}
