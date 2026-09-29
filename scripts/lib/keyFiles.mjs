// Where the key tool reads and writes (scripts/realKeyTool.mjs).
//
// The set folder is outside every worktree and Google Drive backs it up, so
// two things matter here: a write must survive Drive holding the file for a
// moment (EBUSY/EPERM), and it must never leave a half-written plan behind,
// since the folder holds the only copy of each. `writeFileRetry` therefore
// writes a temporary file and renames it over the target, retrying either step.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATASETS_DIR } from './cubicasa.mjs';
import { decodeImage } from './benchUtils.mjs';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

// `FLOORTRACE_REAL_DIR` points the tool at another folder of plans, so a test
// or a hand check can run `apply` on a scratch copy and never on the set.
export const realDir = () => (process.env.FLOORTRACE_REAL_DIR
  ? path.resolve(process.env.FLOORTRACE_REAL_DIR)
  : path.join(DATASETS_DIR, 'real'));

export const wipDir = (dir = realDir()) => path.join(dir, 'keys-wip');
export const planFile = (name, dir = realDir()) => path.join(dir, `${name}.floorplan`);
export const wipFile = (name, suffix, dir = realDir()) => path.join(wipDir(dir), `${name}${suffix}`);
export const packetDir = (name, dir = realDir()) => path.join(wipDir(dir), 'packets', name);

// A plan name is a file stem: no separators, so `NAME` can never point outside
// the set folder.
export const checkName = (name) => {
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`"${name ?? ''}" is not a plan name (letters, digits, . _ - only)`);
  }
  return name;
};

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const BUSY = new Set(['EBUSY', 'EPERM', 'EACCES', 'EMFILE', 'ENFILE']);

const retrying = async (fn, { retries, delayMs }) => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!BUSY.has(error?.code) || attempt >= retries) throw error;
      await sleep(delayMs * (attempt + 1));
    }
  }
};

/**
 * Writes `data` (string or Buffer) to `file`, making the folder if need be.
 * Retries EBUSY/EPERM a few times, since Drive holds files it is syncing. The
 * write goes to a temporary file that is then renamed over `file`, so a
 * failure leaves the old file whole. `fsImpl` is a seam for the test.
 */
export const writeFileRetry = async (file, data, { retries = 6, delayMs = 200, fsImpl = fs } = {}) => {
  const opts = { retries, delayMs };
  await retrying(() => fsImpl.mkdirSync(path.dirname(file), { recursive: true }), opts);
  const tmp = `${file}.tmp-${process.pid}-${Date.now().toString(36)}`;
  try {
    await retrying(() => fsImpl.writeFileSync(tmp, data), opts);
    await retrying(() => fsImpl.renameSync(tmp, file), opts);
  } catch (error) {
    try {
      fsImpl.rmSync(tmp, { force: true });
    } catch {
      // A temporary file Drive still holds is not worth hiding the real error.
    }
    throw error;
  }
};

export const writeJson = (file, value, options) => writeFileRetry(file, `${JSON.stringify(value, null, 1)}\n`, options);

export const readJson = (file) => {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`${file} does not exist`);
    throw error;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${file} is not valid JSON: ${error.message}`);
  }
};

const MIME_BY_EXT = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp',
};
const EXT_BY_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/bmp': 'bmp',
};
export const mimeOfFile = (file) => MIME_BY_EXT[path.extname(file).slice(1).toLowerCase()] ?? null;
export const extOfMime = (mime) => EXT_BY_MIME[mime] ?? 'img';
export const IMAGE_EXTENSIONS = Object.keys(MIME_BY_EXT);

// The plan's image as its own bytes, and nothing else out of the file: this is
// all `snap`, `view` and `blind` may take from a plan without `--keys`/`--trace`.
export const planImageBytes = (project) => {
  const state = project?.floors?.[0]?.state;
  const url = project?.images?.[state?.imageRef] ?? '';
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!match) throw new Error('the plan holds no image');
  return { mime: match[1], bytes: Buffer.from(match[3], match[2] ? 'base64' : 'utf8') };
};

// Straight-alpha pixels composited over white, as a page is seen on paper: a
// transparent margin must not read as black ink.
export const flattenAlpha = (image) => {
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3];
    if (a === 255) continue;
    const k = a / 255;
    data[i] = data[i] * k + 255 * (1 - k);
    data[i + 1] = data[i + 1] * k + 255 * (1 - k);
    data[i + 2] = data[i + 2] * k + 255 * (1 - k);
    data[i + 3] = 255;
  }
  return image;
};

export const decodeBytes = async (bytes, mime) => flattenAlpha(await decodeImage(bytes, mime));

/**
 * The image a key is drawn on: the blind packet's when there is one (the plan's
 * exact bytes), else the plan's own. Reads no other part of the plan.
 * Returns `{bytes, mime, image, from}`.
 */
export const imageOfPlan = async (name, dir = realDir()) => {
  const pdir = packetDir(name, dir);
  if (fs.existsSync(pdir)) {
    const file = fs.readdirSync(pdir).find((f) => /^image\.[a-z0-9]+$/i.test(f));
    if (file) {
      const bytes = fs.readFileSync(path.join(pdir, file));
      const mime = mimeOfFile(file) ?? 'image/png';
      // A plan drafted again (another crop) leaves its old packet behind, and a
      // key snapped to the old pixels would look right and be wrong.
      const planPath = planFile(name, dir);
      if (fs.existsSync(planPath) && !planImageBytes(readJson(planPath)).bytes.equals(bytes)) {
        throw new Error(`the blind packet of ${name} holds a different image from the plan's (was the plan drafted again?): run blind ${name} again`);
      }
      return { bytes, mime, image: await decodeBytes(bytes, mime), from: path.join(pdir, file) };
    }
  }
  const file = planFile(name, dir);
  if (!fs.existsSync(file)) throw new Error(`no plan named ${name} in ${dir}`);
  const { bytes, mime } = planImageBytes(readJson(file));
  return { bytes, mime, image: await decodeBytes(bytes, mime), from: file };
};

// An IMAGE argument that is a file, or else a plan name.
export const imageOfTarget = async (target, dir = realDir()) => {
  if (fs.existsSync(target) && fs.statSync(target).isFile()) {
    const mime = mimeOfFile(target);
    if (!mime) throw new Error(`${target} is not an image file (${IMAGE_EXTENSIONS.join(', ')})`);
    const bytes = fs.readFileSync(target);
    return { bytes, mime, image: await decodeBytes(bytes, mime), from: target };
  }
  if (/[\\/]/.test(target) || /\.[a-z0-9]{2,5}$/i.test(target)) throw new Error(`no such image file: ${target}`);
  return imageOfPlan(checkName(target), dir);
};

// A label for a view's file name: a packet's `image.png` is named for its plan.
export const labelOfTarget = (target) => {
  const stem = path.basename(target).replace(/\.[^.]+$/, '');
  if (fs.existsSync(target) && stem === 'image') return path.basename(path.dirname(path.resolve(target)));
  return stem;
};
