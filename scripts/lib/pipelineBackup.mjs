// A copy of the set folder beside it (`realPipeline backup`, and `freeze
// --backup`). The set folder holds the only copy of every plan, and a freeze
// rewrites hundreds of them, so the orchestrator backs it up first or after; the
// copy is checked (the file count, then the size and SHA-256 of every file, read
// back from disk) because a backup nobody verified is a hope.
//
// It never overwrites: an existing folder makes the name `-2`, `-3`, ... Folders
// called `zz-*` (scratch) are not copied. Files are copied one at a time with a
// retry, since Google Drive holds a file it is syncing.
import fs from 'fs';
import path from 'path';
import { sha256Of } from './pipelineStages.mjs';

const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** `real-backup-YYYY-MM-DD`, for the local date (the orchestrator's day, not UTC's). */
export const defaultBackupName = (date = new Date()) => {
  const p = (n) => String(n).padStart(2, '0');
  return `real-backup-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

const copyRetry = async (from, to, delayMs) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      // No exclusive flag: the folder is one this run just made, and a retry after
      // a half-copied file must be able to write the file again.
      fs.copyFileSync(from, to);
      return;
    } catch (error) {
      if (!BUSY.has(error?.code) || attempt >= 8) throw error;
      await sleep(delayMs * (attempt + 1));
    }
  }
};

// Every file under `root` that would be copied, as paths relative to it.
const filesUnder = (root) => {
  const found = [];
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!/^zz-/.test(entry.name)) walk(path.join(rel, entry.name));
      } else if (entry.isFile()) found.push(path.join(rel, entry.name));
    }
  };
  walk('');
  return found;
};

const KEY_FILES = ['answer-keys.json', path.join('orchestration', 'manifest.json')];

/**
 * Copies the set folder `dir` to a new sibling folder `name` (or `name-2`, ...)
 * and verifies it. Returns `{dest, files, bytes, hashes}`; throws, leaving the
 * copy where it is, when the copy does not match.
 */
export const backupSet = async (dir, { name = defaultBackupName(), retryDelayMs = 250 } = {}) => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new Error(`"${name}" is not a backup name (letters, digits, . _ - only)`);
  const src = path.resolve(dir);
  if (!fs.existsSync(src)) throw new Error(`there is no set folder ${src} to back up`);
  const base = path.dirname(src);
  let dest = null;
  for (let n = 1; n < 1000 && !dest; n += 1) {
    const candidate = path.join(base, n === 1 ? name : `${name}-${n}`);
    try {
      fs.mkdirSync(candidate);
      dest = candidate;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }
  }
  if (!dest) throw new Error(`no free backup name from ${name} to ${name}-999`);
  const files = filesUnder(src);
  let bytes = 0;
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    await copyRetry(path.join(src, rel), path.join(dest, rel), retryDelayMs);
    bytes += fs.statSync(path.join(dest, rel)).size;
  }
  // Verify from what is on disk now, not from what the loop believes it did.
  const copied = filesUnder(dest);
  if (copied.length !== files.length) throw new Error(`the backup ${dest} holds ${copied.length} files, and ${src} held ${files.length}: it was left as it is, not to be trusted`);
  // Every file, by size and by SHA-256 (the set is a few hundred MB, so this is seconds):
  // a plan cut short by a full disk or a half-synced file is the case a backup exists for.
  const hashes = {};
  for (const rel of [...KEY_FILES, ...files.filter((f) => !KEY_FILES.includes(f))]) {
    const [from, to] = [path.join(src, rel), path.join(dest, rel)];
    const sizes = [fs.existsSync(from) ? fs.statSync(from).size : null, fs.existsSync(to) ? fs.statSync(to).size : null];
    const digests = sizes[0] === sizes[1] ? [sha256Of(from), sha256Of(to)] : [null, null];
    if (sizes[0] !== sizes[1] || digests[0] !== digests[1]) {
      const bytes = (n) => (n === null ? 'absent' : `${n} bytes`);
      const why = sizes[0] !== sizes[1]
        ? `${bytes(sizes[0])} against ${bytes(sizes[1])}`
        : `SHA-256 ${digests[0]?.slice(0, 12) ?? 'absent'} against ${digests[1]?.slice(0, 12) ?? 'absent'}`;
      throw new Error(`the backup ${dest} does not match ${src} in ${rel} (${why}): it was left as it is, not to be trusted`);
    }
    if (KEY_FILES.includes(rel)) hashes[rel] = digests[0];
  }
  return {
    dest, files: files.length, bytes, hashes,
  };
};
