// The only door the sourcing tool has to the network (scripts/realSource.mjs).
//
// Three promises, all about being a polite guest at archive.org while several
// agents source plans at once:
//
//  1. Only archive.org and its subdomains are ever fetched, redirects included
//     (the project's network rule is archive.org, GitHub and npm; the tool
//     needs only the first). Everything else is refused with a message.
//  2. One request at a time across every process on the machine, with a gap
//     between requests (1000 ms to web.archive.org, 300 ms elsewhere). The
//     lock is a file made with `wx`; the last request's end time and any
//     "wait until" a 429/503 asked for are kept beside it, so a back-off one
//     process meets is kept by all of them. A lock whose owner died, or that is
//     older than STALE_MS, is taken over; the holder removes its lock on exit.
//  3. Nothing is downloaded twice: images are cached by URL under
//     datasets/archive-cache/ (the main checkout's, git-ignored), and an entry
//     counts only if it is non-empty and starts with an image's magic bytes, so
//     an HTML error page never passes for a page image. API answers (search,
//     metadata, CDX) are cached as JSON for a day.
//
// Everything that touches the clock takes it as a parameter ({now, sleep}) and
// the fetch is injected, so the tests never wait and never reach the network.
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DATASETS_DIR } from './cubicasa.mjs';
import { writeFileRetry } from './keyFiles.mjs';

// ---- where things live -----------------------------------------------------

// `FLOORTRACE_ARCHIVE_CACHE` points the tool at another folder (the tests, a
// scratch run); by default the main checkout's datasets/, whatever worktree
// runs the tool.
export const cacheDir = (env = process.env) => (env.FLOORTRACE_ARCHIVE_CACHE
  ? path.resolve(env.FLOORTRACE_ARCHIVE_CACHE)
  : path.join(DATASETS_DIR, 'archive-cache'));

// ---- the allowlist ---------------------------------------------------------

export class RefusedUrl extends Error {}
export class HttpError extends Error {
  constructor(status, url, note = '') {
    super(`${url}: HTTP ${status}${note ? ` (${note})` : ''}`);
    this.status = status;
    this.url = url;
  }
}

export const isAllowedHost = (host) => {
  const h = String(host).toLowerCase().replace(/\.$/, '');
  return h === 'archive.org' || h.endsWith('.archive.org');
};

/**
 * The URL as a `URL` on https, or a `RefusedUrl`. The host is what
 * `new URL` says it is (so `archive.org@evil.com` is evil.com, and
 * `archive.org.evil.com` and `notarchive.org` are neither archive.org nor a
 * subdomain), never a port, never credentials. An http URL to an allowed host
 * is upgraded, not refused: archive.org answers http with a redirect anyway.
 */
export const checkUrl = (text, what = 'URL') => {
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new RefusedUrl(`${what} "${text}" is not a URL`);
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new RefusedUrl(`${what} ${text}: only http(s) URLs are fetched`);
  if (!isAllowedHost(url.hostname)) {
    throw new RefusedUrl(`refused ${url.hostname}: this tool fetches from archive.org and its subdomains only (the project's network rule is archive.org, GitHub and npm)`);
  }
  if (url.username || url.password) throw new RefusedUrl(`${what} ${text}: a URL with credentials is refused`);
  if (url.port) throw new RefusedUrl(`${what} ${text}: a URL with a port is refused`);
  url.protocol = 'https:';
  return url;
};

// The two spacing classes: the Wayback Machine is the expensive one.
export const hostClass = (host) => (String(host).toLowerCase() === 'web.archive.org' ? 'wayback' : 'other');

// ---- images ----------------------------------------------------------------

const startsWith = (bytes, sig, at = 0) => sig.every((b, i) => bytes[at + i] === b);

/** The mime type an image's first bytes say, or null. */
export const sniffImage = (bytes) => {
  if (!bytes || bytes.length < 12) return null;
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return 'image/gif';
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp';
  // "BM" alone is two letters any text can start with: also want a plausible
  // DIB header size (12, 40, 52, 56, 64, 108 or 124).
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && [12, 40, 52, 56, 64, 108, 124].includes(bytes.readUInt32LE(14))) return 'image/bmp';
  return null;
};

export const EXT_OF_MIME = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp',
};
const EXTS = Object.values(EXT_OF_MIME);

// What a refused body looked like, for the message: an HTML error page shows.
const describeBody = (bytes) => {
  if (!bytes?.length) return 'an empty body';
  const text = bytes.subarray(0, 80).toString('utf8').replace(/\s+/g, ' ').trim();
  return /^[\x20-\x7e]+$/.test(text) ? `starts "${text.slice(0, 60)}"` : 'binary data that is not an image';
};

// A page image's URL keeps its book and leaf in the cache path, so the cache
// reads as books and leaves rather than hashes. `page/n12` and `page/n12.jpg`
// answer with the same bytes (checked on a real item), so they share an entry;
// any other form (a width suffix, .png) is cached by its URL.
const LEAF_URL = /^\/download\/([A-Za-z0-9][A-Za-z0-9._-]*)\/page\/n(\d+)(?:\.jpe?g)?$/i;

const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');

export const imageStem = (dir, url) => {
  const leaf = url.host.toLowerCase() === 'archive.org' && !url.search ? LEAF_URL.exec(url.pathname) : null;
  if (leaf) return path.join(dir, 'items', leaf[1], `n${leaf[2]}`);
  return path.join(dir, 'urls', sha(url.href).slice(0, 24));
};

// A cache entry is valid when its file is non-empty and starts as an image.
export const readCachedImage = (stem) => {
  for (const ext of EXTS) {
    const file = `${stem}.${ext}`;
    let stat;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size === 0) continue;
    const head = Buffer.alloc(32);
    let fd;
    try {
      fd = fs.openSync(file, 'r');
      fs.readSync(fd, head, 0, 32, 0);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    const mime = sniffImage(head);
    if (mime) return { file, mime, size: stat.size };
  }
  return null;
};

// ---- the lock --------------------------------------------------------------

const pidAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

const held = new Set();
let hooked = false;
const releaseAll = () => {
  for (const release of [...held]) release();
};
// A lock left behind by a killed process costs everyone else the stale
// timeout, so a normal exit and the usual signals let go of it.
const hookExit = () => {
  if (hooked) return;
  hooked = true;
  process.on('exit', releaseAll);
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => {
      releaseAll();
      process.exit(code);
    });
  }
};

const readOwner = (file) => {
  try {
    const owner = JSON.parse(fs.readFileSync(file, 'utf8'));
    return owner && typeof owner.token === 'string' ? owner : null;
  } catch (error) {
    return error.code === 'ENOENT' ? undefined : null;
  }
};

export const realClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

/**
 * Takes the lock `file` (one holder at a time, on this machine), waiting for
 * it. Returns `release()`. The file holds `{token, pid, host, at}`; a lock is
 * taken over when its owner's process is gone (same host) or it is older than
 * `staleMs`, and when the file is empty or garbled for longer than `graceMs`
 * (its owner was killed between creating and writing it). The takeover moves
 * the stale file aside before making a new one, so of two waiters that judge
 * the same lock stale only one succeeds; if what was moved turns out to be a
 * newer lock (a race a real process pair essentially never loses twice), it
 * is put back.
 */
export const acquireLock = async (file, {
  clock = realClock, staleMs = 300000, pollMs = 150, graceMs = 3000, jitter = Math.random,
  pid = process.pid, host = os.hostname(), alive = pidAlive, exitHooks = true,
} = {}) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const token = `${pid}-${crypto.randomBytes(6).toString('hex')}`;
  let garbledSince = null;
  for (;;) {
    try {
      fs.writeFileSync(file, JSON.stringify({ token, pid, host, at: clock.now() }), { flag: 'wx' });
      break;
    } catch (error) {
      if (!['EEXIST', 'EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
    }
    const owner = readOwner(file);
    if (owner === undefined) continue; // released between our two looks: try at once
    let observed = null;
    let stale = false;
    if (owner === null) {
      garbledSince ??= clock.now();
      stale = clock.now() - garbledSince > graceMs;
    } else {
      garbledSince = null;
      observed = owner.token;
      stale = clock.now() - owner.at > staleMs || (owner.host === host && !alive(owner.pid));
    }
    if (stale) {
      const aside = `${file}.stale-${token}`;
      try {
        fs.renameSync(file, aside);
        const moved = readOwner(aside);
        if ((moved?.token ?? null) !== observed) {
          try {
            fs.linkSync(aside, file);
          } catch {
            // Someone made a new lock already; the moved one's owner will find its lock gone.
          }
        }
        fs.unlinkSync(aside);
      } catch {
        // Another waiter got there first, or Drive holds the file: look again.
      }
      continue;
    }
    await clock.sleep(pollMs + Math.floor(jitter() * pollMs));
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    held.delete(release);
    try {
      if (readOwner(file)?.token === token) fs.unlinkSync(file);
    } catch {
      // Already gone; nothing left to release.
    }
  };
  held.add(release);
  if (exitHooks) hookExit();
  return release;
};

/** `fn()` while holding the lock `file`. */
export const withLock = async (file, options, fn) => {
  const release = await acquireLock(file, options);
  try {
    return await fn();
  } finally {
    release();
  }
};

// ---- the client ------------------------------------------------------------

const num = (value, fallback) => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) && n >= 0 ? n : fallback;
};

/** The request settings, from the environment (each is overridable for tests). */
export const netConfig = (env = process.env) => ({
  gapMs: {
    wayback: num(env.FLOORTRACE_SOURCE_GAP_WAYBACK_MS, 1000),
    other: num(env.FLOORTRACE_SOURCE_GAP_MS, 300),
  },
  timeoutMs: num(env.FLOORTRACE_SOURCE_TIMEOUT_MS, 60000),
  maxAttempts: Math.max(1, num(env.FLOORTRACE_SOURCE_TRIES, 4)),
  baseBackoffMs: num(env.FLOORTRACE_SOURCE_BACKOFF_MS, 2000),
  maxBackoffMs: num(env.FLOORTRACE_SOURCE_BACKOFF_MAX_MS, 60000),
  maxWaitMs: num(env.FLOORTRACE_SOURCE_MAX_WAIT_MS, 120000),
  staleMs: num(env.FLOORTRACE_SOURCE_STALE_MS, 300000),
  pollMs: num(env.FLOORTRACE_SOURCE_POLL_MS, 150),
  trace: Boolean(env.FLOORTRACE_SOURCE_TRACE),
});

const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_HOPS = 6;
const DAY_MS = 24 * 3600 * 1000;

/** `Retry-After` as milliseconds: seconds, or an HTTP date. null when absent or unreadable. */
export const parseRetryAfter = (value, now) => {
  if (value === null || value === undefined || value === '') return null;
  if (/^\d+(\.\d+)?$/.test(String(value).trim())) return Math.round(Number(value) * 1000);
  const at = Date.parse(value);
  return Number.isFinite(at) ? Math.max(0, at - now) : null;
};

const describeError = (error) => {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError') return 'timeout';
  const cause = error?.cause?.code ?? error?.cause?.message;
  return `${error?.message ?? error}${cause ? ` (${cause})` : ''}`;
};

/**
 * The bytes of a plan's source URL, for scripts/lib/realDraft.mjs. A URL on
 * archive.org is fetched through the polite client and cached, and comes back
 * with its mime type read from the bytes. Any other URL is fetched as it always
 * was (mime type from the response, possibly empty), so a draft from elsewhere
 * behaves as before.
 */
export const fetchSourceBytes = async (url, { net, fetchImpl = globalThis.fetch } = {}) => {
  let host = null;
  try {
    host = new URL(url).hostname;
  } catch {
    // Not a URL: the plain fetch below says so.
  }
  if (host && isAllowedHost(host)) {
    const got = await (net ?? createNet()).fetchImage(url);
    return { bytes: fs.readFileSync(got.file), mime: got.mime };
  }
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    mime: (response.headers.get('content-type') ?? '').split(';')[0].trim(),
  };
};

export const createNet = ({
  dir = cacheDir(), fetchImpl = globalThis.fetch, clock = realClock, env = process.env, config,
  jitter = Math.random, exitHooks = true, log = () => {}, userAgent = 'FloorTrace-realSource/1 (dataset builder; one request at a time; cached)',
} = {}) => {
  const cfg = { ...netConfig(env), ...config };
  const lockFile = path.join(dir, '.net.lock');
  const stateFile = path.join(dir, '.net-state.json');
  const lockOptions = {
    clock, staleMs: cfg.staleMs, pollMs: cfg.pollMs, jitter, exitHooks,
  };

  const readState = () => {
    try {
      const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      return { lastEnd: s.lastEnd ?? {}, notBefore: s.notBefore ?? {} };
    } catch {
      return { lastEnd: {}, notBefore: {} };
    }
  };

  // One HTTP exchange, the body read in full: this is what the lock covers.
  const exchange = async (url) => {
    const res = await fetchImpl(url.href, {
      redirect: 'manual',
      signal: AbortSignal.timeout(cfg.timeoutMs),
      headers: { 'user-agent': userAgent, accept: '*/*' },
    });
    const out = {
      status: res.status,
      contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
      location: res.headers.get('location'),
      retryAfter: res.headers.get('retry-after'),
      bytes: null,
      short: false,
    };
    if (res.status >= 200 && res.status < 300) {
      out.bytes = Buffer.from(await res.arrayBuffer());
      const declared = res.headers.get('content-length');
      // A body shorter than it said is a dropped connection, not an answer.
      out.short = declared !== null && !res.headers.get('content-encoding') && out.bytes.length !== Number(declared);
    } else {
      try {
        await res.body?.cancel();
      } catch {
        // The connection is being dropped anyway.
      }
    }
    return out;
  };

  // One URL, one hop: waits its turn, spaces itself, backs off on 429/5xx and
  // timeouts (every process sees the back-off), gives up after a few tries.
  // `recheck()` looks once more, holding the lock, for what a process that was
  // ahead of us may just have cached: it returns that (`{hit}`) and no request
  // is made, so two agents asking for one page at once fetch it once.
  const attempt = async (url, recheck) => {
    const cls = hostClass(url.hostname);
    for (let tries = 1; ; tries += 1) {
      const { res, retry, hit } = await withLock(lockFile, lockOptions, async () => {
        const found = recheck?.();
        if (found) return { hit: found };
        const state = readState();
        const wait = Math.max(
          0,
          (state.notBefore[cls] ?? 0) - clock.now(),
          (state.lastEnd[cls] ?? 0) + cfg.gapMs[cls] - clock.now(),
        );
        if (wait > 0) await clock.sleep(wait);
        let response = null;
        let failure = null;
        const began = clock.now();
        try {
          response = await exchange(url);
        } catch (error) {
          failure = describeError(error);
        }
        const end = clock.now();
        // FLOORTRACE_SOURCE_TRACE=1: when each request began and ended, to see
        // that two processes never overlap.
        if (cfg.trace) log(`request ${new Date(began).toISOString()} .. ${new Date(end).toISOString()} pid ${process.pid} ${url.href.slice(0, 110)} -> ${failure ?? response.status}`);
        state.lastEnd[cls] = end;
        let back = null;
        if (failure) back = { reason: failure };
        else if (response.short) back = { reason: 'the body ended early' };
        else if (RETRY_STATUS.has(response.status)) {
          back = { reason: `HTTP ${response.status}`, asked: parseRetryAfter(response.retryAfter, end) };
        }
        if (back) {
          const own = cfg.baseBackoffMs * 2 ** (tries - 1);
          back.delayMs = back.asked === null || back.asked === undefined ? Math.min(cfg.maxBackoffMs, own) : back.asked;
          state.notBefore[cls] = end + Math.min(back.delayMs, cfg.maxWaitMs);
        }
        await writeFileRetry(stateFile, JSON.stringify(state));
        return { res: response, retry: back };
      });
      if (hit) return { hit };
      if (!retry) return res;
      if (retry.delayMs > cfg.maxWaitMs) {
        throw new Error(`${url.href}: ${retry.reason}, and the server asks to wait ${Math.round(retry.delayMs / 1000)} s; try again later`);
      }
      if (tries >= cfg.maxAttempts) throw new Error(`${url.href}: gave up after ${tries} tries (${retry.reason})`);
      log(`${url.href}: ${retry.reason}; waiting ${Math.round(retry.delayMs)} ms, then try ${tries + 1} of ${cfg.maxAttempts}`);
      await clock.sleep(retry.delayMs);
    }
  };

  // Follows redirects, each hop checked against the allowlist and made under
  // the same lock and spacing. Returns the last answer with its final URL, or
  // `{hit}` when `recheck` (see `attempt`) found the answer already cached.
  const request = async (rawUrl, { recheck } = {}) => {
    let url = checkUrl(rawUrl);
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      const res = await attempt(url, hop === 0 ? recheck : undefined);
      if (res.hit) return res;
      if (res.status >= 300 && res.status < 400 && res.location) {
        const next = new URL(res.location, url);
        try {
          url = checkUrl(next.href, 'redirect');
        } catch (error) {
          throw new RefusedUrl(`${url.href} redirects to ${next.href}: ${error.message}`);
        }
        continue;
      }
      return { ...res, url: url.href };
    }
    throw new Error(`${rawUrl}: more than ${MAX_HOPS} redirects`);
  };

  /**
   * An image by URL, from the cache when it is there. `{file, mime, size,
   * cached, url}`; a non-image answer (an HTML error page, a login page) is an
   * error and nothing is cached.
   */
  const fetchImage = async (rawUrl) => {
    const url = checkUrl(rawUrl);
    const stem = imageStem(dir, url);
    const hit = readCachedImage(stem);
    if (hit) return { ...hit, cached: true, url: url.href };
    const res = await request(url.href, { recheck: () => readCachedImage(stem) });
    if (res.hit) return { ...res.hit, cached: true, url: url.href };
    if (res.status !== 200) throw new HttpError(res.status, res.url);
    const mime = sniffImage(res.bytes);
    if (!mime) {
      throw new Error(`${res.url} answered 200 ${res.contentType || 'with no content type'} but ${describeBody(res.bytes)}, not an image; nothing was cached`);
    }
    const file = `${stem}.${EXT_OF_MIME[mime]}`;
    await writeFileRetry(file, res.bytes);
    await writeFileRetry(`${stem}.json`, `${JSON.stringify({
      url: url.href, finalUrl: res.url, mime, size: res.bytes.length, fetchedAt: new Date(clock.now()).toISOString(),
    }, null, 1)}\n`);
    return { file, mime, size: res.bytes.length, cached: false, url: url.href };
  };

  /**
   * An API answer by URL as text, cached for `ttlMs` (a day; `refresh` skips
   * the cache). `check(text)` may throw to say the answer is unusable (not
   * JSON, an error page), and then nothing is cached.
   */
  const fetchText = async (rawUrl, { ttlMs = DAY_MS, refresh = false, check = () => {} } = {}) => {
    const url = checkUrl(rawUrl);
    const file = path.join(dir, 'api', `${sha(url.href).slice(0, 24)}.json`);
    if (!refresh) {
      try {
        const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (entry.url === url.href && typeof entry.text === 'string' && clock.now() - entry.at < ttlMs) {
          check(entry.text);
          return { text: entry.text, cached: true };
        }
      } catch {
        // No entry, or one that does not read: fetch it.
      }
    }
    const res = await request(url.href);
    if (res.status !== 200) throw new HttpError(res.status, res.url);
    const text = res.bytes.toString('utf8');
    try {
      check(text);
    } catch (error) {
      throw new Error(`${res.url} answered 200 but ${error.message} (${describeBody(res.bytes)}); nothing was cached`);
    }
    await writeFileRetry(file, JSON.stringify({ url: url.href, at: clock.now(), text }));
    return { text, cached: false };
  };

  /**
   * A JSON answer by URL, as `fetchText`. `emptyOk` reads an empty body as
   * null (the CDX API answers a search with no hits that way).
   */
  const fetchJson = async (rawUrl, { emptyOk = false, ...options } = {}) => {
    const parse = (text) => {
      if (!text.trim() && emptyOk) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw new Error('it is not JSON');
      }
    };
    const { text, cached } = await fetchText(rawUrl, { ...options, check: parse });
    return { json: parse(text), cached };
  };

  return { request, fetchImage, fetchText, fetchJson, config: cfg, dir };
};
