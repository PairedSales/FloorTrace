// The sourcing tool's network layer (scripts/lib/sourceNet.mjs): what it will
// fetch, that requests never overlap or come faster than the gap, that a
// refusal or a back-off holds for every process, and that an HTML error page
// never passes for a page image. The clock is virtual and the fetch is
// scripted, so nothing here waits or touches the network.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  HttpError, RefusedUrl, acquireLock, checkUrl, createNet, fetchSourceBytes, hostClass, imageStem, isAllowedHost, netConfig, parseRetryAfter, readCachedImage, sniffImage,
} from '../sourceNet.mjs';
import {
  HTML_ERROR, JPEG, PNG_BYTES, fakeClock, reply, scriptedFetch,
} from './fakeNet.mjs';

let dir;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sourcenet-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const CONFIG = {
  gapMs: { wayback: 1000, other: 300 },
  timeoutMs: 60000,
  maxAttempts: 4,
  baseBackoffMs: 2000,
  maxBackoffMs: 60000,
  maxWaitMs: 120000,
  staleMs: 300000,
  pollMs: 100,
};
const netWith = (clock, fetchImpl, config = {}) => createNet({
  dir, fetchImpl, clock, env: {}, config: { ...CONFIG, ...config }, jitter: () => 0, exitHooks: false,
});
const ok = (body = JPEG, headers = { 'content-type': 'image/jpeg' }) => reply(200, body, headers);
const PAGE = 'https://archive.org/download/someitem/page/n12';

describe('the allowlist', () => {
  it('takes archive.org and its subdomains', () => {
    for (const u of [
      'https://archive.org/metadata/x', 'https://web.archive.org/web/2021id_/https://x.com/a.png', 'https://ia800104.us.archive.org/BookReader/x',
      'https://ARCHIVE.ORG/a', 'https://archive.org./a',
    ]) expect(checkUrl(u).hostname.endsWith('archive.org') || checkUrl(u).hostname.endsWith('archive.org.')).toBe(true);
    expect(isAllowedHost('web.archive.org')).toBe(true);
    expect(isAllowedHost('archive.org')).toBe(true);
  });

  it('upgrades http to https for an allowed host', () => {
    expect(checkUrl('http://archive.org/metadata/x').protocol).toBe('https:');
  });

  it('refuses every other host, with a message that names it', () => {
    for (const u of [
      'https://example.com/a.png', 'https://github.com/x', 'https://archive.org.evil.com/a', 'https://notarchive.org/a', 'https://evilarchive.org/a',
      'https://archive.org@evil.com/a', 'https://127.0.0.1/a', 'https://localhost/a', 'https://xn--archve-2ua.org/a',
    ]) {
      expect(() => checkUrl(u), u).toThrow(RefusedUrl);
    }
    expect(() => checkUrl('https://example.com/a')).toThrow(/refused example\.com.*archive\.org/);
  });

  it('refuses credentials, ports, other schemes and garbage', () => {
    expect(() => checkUrl('https://user:pw@archive.org/a')).toThrow(/credentials/);
    expect(() => checkUrl('https://archive.org:8443/a')).toThrow(/port/);
    expect(() => checkUrl('ftp://archive.org/a')).toThrow(/http/);
    expect(() => checkUrl('file:///etc/passwd')).toThrow(RefusedUrl);
    expect(() => checkUrl('not a url')).toThrow(/not a URL/);
  });

  it('sorts hosts into the two spacing classes', () => {
    expect(hostClass('web.archive.org')).toBe('wayback');
    expect(hostClass('archive.org')).toBe('other');
    expect(hostClass('ia801.us.archive.org')).toBe('other');
  });

  it('never calls fetch for a refused URL, or for one a redirect points off the list', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => ok());
    const net = netWith(clock, fetchImpl);
    await expect(clock.run(net.request('https://example.com/a.png'))).rejects.toThrow(/refused example\.com/);
    expect(fetchImpl.calls).toHaveLength(0);

    const redirecting = scriptedFetch(clock, () => reply(302, '', { location: 'https://evil.example/steal.png' }));
    const net2 = netWith(clock, redirecting);
    await expect(clock.run(net2.request(PAGE))).rejects.toThrow(/redirects to https:\/\/evil\.example.*refused evil\.example/);
    expect(redirecting.calls).toHaveLength(1);
  });

  it('follows redirects within archive.org, each hop a request of its own', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (url, n) => (n === 0
      ? reply(302, '', { location: 'https://ia800104.us.archive.org/BookReader/BookReaderImages.php?id=x' })
      : ok()));
    const net = netWith(clock, fetchImpl);
    const res = await clock.run(net.request(PAGE));
    expect(res.status).toBe(200);
    expect(res.url).toBe('https://ia800104.us.archive.org/BookReader/BookReaderImages.php?id=x');
    expect(fetchImpl.calls.map((c) => new URL(c.url).host)).toEqual(['archive.org', 'ia800104.us.archive.org']);
    // ... and the second hop waited out the gap after the first.
    expect(fetchImpl.calls[1].start - fetchImpl.calls[0].end).toBeGreaterThanOrEqual(300);
  });

  it('stops a redirect loop', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(302, '', { location: PAGE }));
    await expect(clock.run(netWith(clock, fetchImpl).request(PAGE))).rejects.toThrow(/redirects/);
  });
});

describe('one request at a time, with a gap', () => {
  it('serialises callers that contend, from one client and from two', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => ok(), 80);
    const a = netWith(clock, fetchImpl);
    const b = netWith(clock, fetchImpl); // a second process: its own client, the same folder
    await clock.run(Promise.all([
      a.request('https://archive.org/download/i/page/n1'),
      b.request('https://archive.org/download/i/page/n2'),
      a.request('https://archive.org/download/i/page/n3'),
      b.request('https://archive.org/download/i/page/n4'),
    ]));
    const calls = [...fetchImpl.calls].sort((x, y) => x.start - y.start);
    expect(calls).toHaveLength(4);
    for (let i = 1; i < calls.length; i += 1) {
      expect(calls[i].start, `call ${i} began before call ${i - 1} ended`).toBeGreaterThanOrEqual(calls[i - 1].end);
      expect(calls[i].start - calls[i - 1].end, `gap before call ${i}`).toBeGreaterThanOrEqual(300);
    }
  });

  it('spaces web.archive.org requests by the longer gap', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => ok(), 20);
    const net = netWith(clock, fetchImpl);
    const wayback = 'https://web.archive.org/web/20210101000000id_/https://x.com/';
    await clock.run(Promise.all([net.request(`${wayback}a.png`), net.request(`${wayback}b.png`), net.request(`${wayback}c.png`)]));
    const [c0, c1, c2] = fetchImpl.calls;
    expect(c1.start - c0.end).toBeGreaterThanOrEqual(1000);
    expect(c2.start - c1.end).toBeGreaterThanOrEqual(1000);
  });

  it('takes the gaps from the environment', () => {
    expect(netConfig({}).gapMs).toEqual({ wayback: 1000, other: 300 });
    expect(netConfig({ FLOORTRACE_SOURCE_GAP_WAYBACK_MS: '2500', FLOORTRACE_SOURCE_GAP_MS: '0' }).gapMs).toEqual({ wayback: 2500, other: 0 });
    expect(netConfig({ FLOORTRACE_SOURCE_GAP_MS: 'soon' }).gapMs.other).toBe(300);
  });

  it('leaves no lock behind', async () => {
    const clock = fakeClock();
    const net = netWith(clock, scriptedFetch(clock, () => ok()));
    await clock.run(net.request(PAGE));
    expect(fs.existsSync(path.join(dir, '.net.lock'))).toBe(false);
  });
});

describe('the lock', () => {
  const lockFile = () => path.join(dir, 'x.lock');
  const opts = (clock, extra = {}) => ({ clock, jitter: () => 0, exitHooks: false, staleMs: 10000, pollMs: 100, graceMs: 2000, ...extra });
  const writeOwner = (owner) => fs.writeFileSync(lockFile(), JSON.stringify(owner));

  it('makes a second holder wait until the first lets go', async () => {
    const clock = fakeClock();
    const order = [];
    const first = await clock.run(acquireLock(lockFile(), opts(clock)));
    const second = acquireLock(lockFile(), opts(clock)).then((release) => {
      order.push('second');
      return release;
    });
    await clock.run(clock.sleep(2000)); // plenty of polls
    expect(order).toEqual([]);
    order.push('release first');
    first();
    const release = await clock.run(second);
    expect(order).toEqual(['release first', 'second']);
    release();
    expect(fs.existsSync(lockFile())).toBe(false);
  });

  it('takes over a lock older than the stale timeout', async () => {
    const clock = fakeClock();
    writeOwner({ token: 'old', pid: process.pid, host: 'another-machine', at: clock.now() - 60000 });
    const release = await clock.run(acquireLock(lockFile(), opts(clock)));
    expect(JSON.parse(fs.readFileSync(lockFile(), 'utf8')).token).not.toBe('old');
    release();
    expect(fs.readdirSync(dir).filter((f) => f.includes('.stale-'))).toEqual([]);
  });

  it('takes over a lock whose owner process is gone, at once', async () => {
    const clock = fakeClock();
    writeOwner({ token: 'dead', pid: 999999, host: os.hostname(), at: clock.now() });
    const start = clock.now();
    const release = await clock.run(acquireLock(lockFile(), opts(clock, { alive: () => false })));
    expect(clock.now() - start).toBe(0);
    release();
  });

  it('does not take a live lock that is not yet stale', async () => {
    const clock = fakeClock();
    writeOwner({ token: 'busy', pid: process.pid, host: os.hostname(), at: clock.now() });
    let got = false;
    const waiting = acquireLock(lockFile(), opts(clock, { alive: () => true })).then(() => { got = true; });
    await clock.run(clock.sleep(5000));
    expect(got).toBe(false);
    expect(JSON.parse(fs.readFileSync(lockFile(), 'utf8')).token).toBe('busy');
    await clock.run(clock.sleep(6000)); // now past staleMs
    await clock.run(waiting);
    expect(got).toBe(true);
  });

  it('takes over an empty or garbled lock file only after the grace period', async () => {
    const clock = fakeClock();
    fs.writeFileSync(lockFile(), '{"tok');
    const start = clock.now();
    const release = await clock.run(acquireLock(lockFile(), opts(clock)));
    expect(clock.now() - start).toBeGreaterThan(2000);
    release();
  });

  it('releases only its own lock', async () => {
    const clock = fakeClock();
    const release = await clock.run(acquireLock(lockFile(), opts(clock)));
    writeOwner({ token: 'someone-else', pid: process.pid, host: os.hostname(), at: clock.now() });
    release();
    expect(JSON.parse(fs.readFileSync(lockFile(), 'utf8')).token).toBe('someone-else');
  });

  it('lets go of the lock when the request throws', async () => {
    const clock = fakeClock();
    const net = netWith(clock, scriptedFetch(clock, () => new Error('boom')), { maxAttempts: 1 });
    await expect(clock.run(net.request(PAGE))).rejects.toThrow(/gave up after 1 tries \(boom\)/);
    expect(fs.existsSync(path.join(dir, '.net.lock'))).toBe(false);
  });
});

describe('backing off', () => {
  const starts = (fetchImpl) => fetchImpl.calls.map((c) => c.start);

  it('honours Retry-After on a 429 and then succeeds', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (u, n) => (n === 0 ? reply(429, '', { 'retry-after': '7' }) : ok()));
    const messages = [];
    const net = createNet({
      dir, fetchImpl, clock, env: {}, config: CONFIG, jitter: () => 0, exitHooks: false, log: (m) => messages.push(m),
    });
    const res = await clock.run(net.request(PAGE));
    expect(res.status).toBe(200);
    expect(fetchImpl.calls[1].start - fetchImpl.calls[0].end).toBeGreaterThanOrEqual(7000);
    expect(messages.join('\n')).toMatch(/HTTP 429; waiting 7000 ms, then try 2 of 4/);
  });

  it('reads Retry-After as a date, too', () => {
    const now = Date.parse('2026-09-29T10:00:00Z');
    expect(parseRetryAfter('120', now)).toBe(120000);
    expect(parseRetryAfter('Tue, 29 Sep 2026 10:00:30 GMT', now)).toBe(30000);
    expect(parseRetryAfter('nonsense', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('doubles its own wait when the server names none', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (u, n) => (n < 3 ? reply(503) : ok()));
    await clock.run(netWith(clock, fetchImpl).request(PAGE));
    const [a, b, c, d] = fetchImpl.calls;
    expect(b.start - a.end).toBeGreaterThanOrEqual(2000);
    expect(c.start - b.end).toBeGreaterThanOrEqual(4000);
    expect(d.start - c.end).toBeGreaterThanOrEqual(8000);
  });

  it('caps the back-off', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (u, n) => (n < 3 ? reply(503) : ok()));
    await clock.run(netWith(clock, fetchImpl, { maxBackoffMs: 3000, maxAttempts: 5 }).request(PAGE));
    const [, b, c, d] = fetchImpl.calls;
    expect(d.start - c.end).toBeLessThan(3400);
    expect(c.start - b.end).toBeLessThan(3400);
  });

  it('gives up after a few tries with a message that says why', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(503));
    await expect(clock.run(netWith(clock, fetchImpl, { maxAttempts: 3 }).request(PAGE))).rejects.toThrow(/gave up after 3 tries \(HTTP 503\)/);
    expect(fetchImpl.calls).toHaveLength(3);
  });

  it('fails at once when the server asks for more than it will wait', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(429, '', { 'retry-after': '3600' }));
    await expect(clock.run(netWith(clock, fetchImpl).request(PAGE))).rejects.toThrow(/asks to wait 3600 s; try again later/);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('retries a timeout', async () => {
    const clock = fakeClock();
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    const fetchImpl = scriptedFetch(clock, (u, n) => (n === 0 ? timeout : ok()));
    const res = await clock.run(netWith(clock, fetchImpl).request(PAGE));
    expect(res.status).toBe(200);
    expect(starts(fetchImpl)).toHaveLength(2);
  });

  it('retries a body that ended early', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (u, n) => (n === 0 ? ok(JPEG, { 'content-length': JPEG.length + 500 }) : ok()));
    const res = await clock.run(netWith(clock, fetchImpl).request(PAGE));
    expect(res.bytes.equals(JPEG)).toBe(true);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('does not retry a 404 or a 403', async () => {
    for (const status of [404, 403]) {
      const clock = fakeClock();
      const fetchImpl = scriptedFetch(clock, () => reply(status));
      const res = await clock.run(netWith(clock, fetchImpl).request(PAGE));
      expect(res.status).toBe(status);
      expect(fetchImpl.calls).toHaveLength(1);
    }
  });

  it('makes every process wait out a back-off one of them met', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (url, n) => (n === 0 ? reply(429, '', { 'retry-after': '30' }) : ok()), 50);
    const first = netWith(clock, fetchImpl);
    const second = netWith(clock, fetchImpl);
    // The second process asks a little after the first was told to wait.
    await clock.run(Promise.all([
      first.request('https://archive.org/download/i/page/n1'),
      clock.sleep(400).then(() => second.request('https://archive.org/download/i/page/n2')),
    ]));
    const [refused, ...later] = fetchImpl.calls;
    expect(later).toHaveLength(2);
    for (const call of later) expect(call.start - refused.end, call.url).toBeGreaterThanOrEqual(30000);
  });
});

describe('drafting from a source URL (realDraft.loadSource)', () => {
  it('takes an archive.org URL through the polite client and its cache, never a bare fetch', async () => {
    const clock = fakeClock();
    const netFetch = scriptedFetch(clock, () => ok());
    const net = netWith(clock, netFetch);
    const bare = async () => { throw new Error('a bare fetch was made'); };
    const first = await clock.run(fetchSourceBytes(PAGE, { net, fetchImpl: bare }));
    expect(first.mime).toBe('image/jpeg');
    expect(first.bytes.equals(JPEG)).toBe(true);
    // The page `leaf` cached is the page a draft reads: no second request.
    await clock.run(fetchSourceBytes(`${PAGE}.jpg`, { net, fetchImpl: bare }));
    expect(netFetch.calls).toHaveLength(1);
  });

  it('does not take a URL off the list through the client, and leaves it to the plain fetch as before', async () => {
    const clock = fakeClock();
    const net = netWith(clock, scriptedFetch(clock, () => ok()));
    const plain = async () => reply(200, PNG_BYTES, { 'content-type': 'image/png; charset=binary' });
    const got = await clock.run(fetchSourceBytes('https://example.org/plan.png', { net, fetchImpl: plain }));
    expect(got.mime).toBe('image/png');
    expect(got.bytes.equals(PNG_BYTES)).toBe(true);
    await expect(clock.run(fetchSourceBytes('https://example.org/gone.png', { net, fetchImpl: async () => ({ ok: false, status: 404 }) }))).rejects.toThrow(/gone\.png: HTTP 404/);
  });
});

describe('the cache', () => {
  it('reads a page image as an image only by its first bytes', () => {
    expect(sniffImage(JPEG)).toBe('image/jpeg');
    expect(sniffImage(PNG_BYTES)).toBe('image/png');
    expect(sniffImage(Buffer.concat([Buffer.from('GIF89a'), Buffer.alloc(20)]))).toBe('image/gif');
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBPVP8 '), Buffer.alloc(20)]))).toBe('image/webp');
    expect(sniffImage(Buffer.from(HTML_ERROR))).toBeNull();
    expect(sniffImage(Buffer.from('{"error":"Not Found","status":404}'))).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
    expect(sniffImage(Buffer.from([0xff, 0xd8]))).toBeNull();
    // Two letters that any text can start with are not a bitmap.
    expect(sniffImage(Buffer.from('BM is the abbreviation and a long line follows'))).toBeNull();
  });

  it('gives a page and its .jpg form one cache entry, and any other form its own', () => {
    const stem = (u) => imageStem(dir, new URL(u));
    expect(stem('https://archive.org/download/book1/page/n12')).toBe(path.join(dir, 'items', 'book1', 'n12'));
    expect(stem('https://archive.org/download/book1/page/n12.jpg')).toBe(stem('https://archive.org/download/book1/page/n12'));
    expect(stem('https://archive.org/download/book1/page/n12_w800.jpg')).toMatch(/urls[\\/][0-9a-f]{24}$/);
    expect(stem('https://archive.org/download/book1/page/n12.jpg?x=1')).toMatch(/urls[\\/]/);
    expect(stem('https://web.archive.org/web/20210101000000id_/https://x.com/a.png')).toMatch(/urls[\\/][0-9a-f]{24}$/);
    expect(stem('https://web.archive.org/web/20210101000000id_/https://x.com/a.png')).not.toBe(stem('https://web.archive.org/web/20210101000001id_/https://x.com/a.png'));
  });

  it('counts an entry only if it is non-empty and starts as an image', () => {
    const stem = path.join(dir, 'items', 'b', 'n1');
    fs.mkdirSync(path.dirname(stem), { recursive: true });
    expect(readCachedImage(stem)).toBeNull();
    fs.writeFileSync(`${stem}.jpg`, '');
    expect(readCachedImage(stem)).toBeNull();
    fs.writeFileSync(`${stem}.jpg`, HTML_ERROR);
    expect(readCachedImage(stem)).toBeNull();
    fs.writeFileSync(`${stem}.jpg`, JPEG);
    expect(readCachedImage(stem)).toMatchObject({ mime: 'image/jpeg', size: JPEG.length });
  });

  it('fetches an image once and serves it from the cache afterwards', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => ok());
    const net = netWith(clock, fetchImpl);
    const first = await clock.run(net.fetchImage(PAGE));
    expect(first).toMatchObject({ cached: false, mime: 'image/jpeg', size: JPEG.length });
    expect(first.file).toBe(path.join(dir, 'items', 'someitem', 'n12.jpg'));
    expect(fs.readFileSync(first.file).equals(JPEG)).toBe(true);
    const second = await clock.run(net.fetchImage(`${PAGE}.jpg`));
    expect(second).toMatchObject({ cached: true, file: first.file });
    // A second process, too.
    const third = await clock.run(netWith(clock, fetchImpl).fetchImage(PAGE));
    expect(third.cached).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('fetches a page once when two processes ask for it at the same moment', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => ok());
    const first = netWith(clock, fetchImpl);
    const second = netWith(clock, fetchImpl); // another process: its own client, the same folder
    const [a, b] = await clock.run(Promise.all([first.fetchImage(PAGE), second.fetchImage(PAGE)]));
    // Both missed the cache, but the second, waiting for the lock, looked again
    // once it had it and found the page the first had just saved.
    expect(fetchImpl.calls).toHaveLength(1);
    expect(a.file).toBe(b.file);
    expect([a.cached, b.cached].sort()).toEqual([false, true]);
  });

  it('looks again after a back-off, too: a page saved meanwhile is not fetched', async () => {
    const clock = fakeClock();
    const stem = imageStem(dir, new URL(PAGE));
    const fetchImpl = scriptedFetch(clock, (u, n) => {
      if (n === 0) {
        // While this process waits out the 429, another one saves the page.
        fs.mkdirSync(path.dirname(stem), { recursive: true });
        fs.writeFileSync(`${stem}.jpg`, JPEG);
        return reply(429, '', { 'retry-after': '5' });
      }
      return ok();
    });
    const got = await clock.run(netWith(clock, fetchImpl).fetchImage(PAGE));
    expect(got.cached).toBe(true);
    expect(fetchImpl.calls).toHaveLength(1);
  });

  it('does not cache an HTML error page as an image', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(200, HTML_ERROR, { 'content-type': 'text/html' }));
    const net = netWith(clock, fetchImpl);
    await expect(clock.run(net.fetchImage(PAGE))).rejects.toThrow(/answered 200 text\/html but starts "<!DOCTYPE html>.*not an image; nothing was cached/);
    const files = fs.existsSync(path.join(dir, 'items')) ? fs.readdirSync(path.join(dir, 'items', 'someitem')) : [];
    expect(files).toEqual([]);
    // The next call asks again; nothing stood in for the image.
    await expect(clock.run(net.fetchImage(PAGE))).rejects.toThrow(/not an image/);
    expect(fetchImpl.calls).toHaveLength(2);
  });

  it('ignores a cache entry that is an error page, and replaces it', async () => {
    const clock = fakeClock();
    const stem = path.join(dir, 'items', 'someitem', 'n12');
    fs.mkdirSync(path.dirname(stem), { recursive: true });
    fs.writeFileSync(`${stem}.jpg`, HTML_ERROR);
    const fetchImpl = scriptedFetch(clock, () => ok());
    const got = await clock.run(netWith(clock, fetchImpl).fetchImage(PAGE));
    expect(got.cached).toBe(false);
    expect(fs.readFileSync(`${stem}.jpg`).equals(JPEG)).toBe(true);
  });

  it('names the mime by the bytes, not by what the server said', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(200, PNG_BYTES, { 'content-type': 'application/octet-stream' }));
    const got = await clock.run(netWith(clock, fetchImpl).fetchImage('https://web.archive.org/web/20210101000000id_/https://x.com/plan.png'));
    expect(got.mime).toBe('image/png');
    expect(got.file.endsWith('.png')).toBe(true);
  });

  it('reports an HTTP error as one, and caches nothing', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(403, '', { 'content-type': 'text/html' }));
    const failure = await clock.run(netWith(clock, fetchImpl).fetchImage(PAGE)).catch((e) => e);
    expect(failure).toBeInstanceOf(HttpError);
    expect(failure.status).toBe(403);
  });

  it('caches a JSON answer for a day, and only a JSON one', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, (u, n) => reply(200, JSON.stringify({ n })));
    const net = netWith(clock, fetchImpl);
    const url = 'https://archive.org/metadata/someitem';
    expect((await clock.run(net.fetchJson(url))).json).toEqual({ n: 0 });
    expect(await clock.run(net.fetchJson(url))).toEqual({ json: { n: 0 }, cached: true });
    expect(fetchImpl.calls).toHaveLength(1);
    expect((await clock.run(net.fetchJson(url, { refresh: true }))).json).toEqual({ n: 1 });
    clock.advance(25 * 3600 * 1000);
    expect((await clock.run(net.fetchJson(url))).json).toEqual({ n: 2 });

    const html = scriptedFetch(clock, () => reply(200, HTML_ERROR, { 'content-type': 'text/html' }));
    const failing = netWith(clock, html);
    await expect(clock.run(failing.fetchJson('https://archive.org/metadata/other'))).rejects.toThrow(/it is not JSON.*nothing was cached/);
    await expect(clock.run(failing.fetchJson('https://archive.org/metadata/other'))).rejects.toThrow(/not JSON/);
    expect(html.calls).toHaveLength(2);
  });

  it('reads an empty answer as no rows when the caller says it may be', async () => {
    const clock = fakeClock();
    const fetchImpl = scriptedFetch(clock, () => reply(200, ''));
    const net = netWith(clock, fetchImpl);
    const url = 'https://web.archive.org/cdx/search/cdx?url=nothing.example';
    expect((await clock.run(net.fetchJson(url, { emptyOk: true }))).json).toBeNull();
    await expect(clock.run(net.fetchJson(`${url}2`))).rejects.toThrow(/not JSON/);
  });
});
