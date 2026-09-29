// Test doubles for the sourcing tool's network layer (not a test file): a
// virtual clock that runs the code under test without waiting, and canned
// fetch answers. No test that uses them touches the network.

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
};

/**
 * A clock whose time moves only when everything is waiting on it. `run(p)`
 * lets `p` (and anything else in flight) proceed, advancing to the next timer
 * whenever nothing else can, and returns what `p` settles with.
 */
export const fakeClock = (start = 1_800_000_000_000) => {
  let now = start;
  const timers = [];
  const clock = {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => {
      timers.push({ at: now + Math.max(0, ms), resolve });
    }),
    pending: () => timers.length,
    advance: (ms) => { now += ms; },
    async run(promise) {
      let done = false;
      let value;
      let error;
      promise.then((v) => { done = true; value = v; }, (e) => { done = true; error = e; });
      for (let guard = 0; !done; guard += 1) {
        await settle();
        if (done) break;
        if (!timers.length) throw new Error('deadlock: nothing is running and nothing waits on the clock');
        if (guard > 100000) throw new Error('the code under test never finished');
        timers.sort((a, b) => a.at - b.at);
        const next = timers.shift();
        now = Math.max(now, next.at);
        next.resolve();
      }
      if (error) throw error;
      return value;
    },
  };
  return clock;
};

/** A fetch answer: status, body (string or Buffer), headers by lower-case name. */
export const reply = (status, body = '', headers = {}) => {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k) => lower[k.toLowerCase()] ?? null },
    arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    body: { cancel: async () => {} },
  };
};

// The first bytes of a JPEG and of a PNG: all that "looks like an image" reads.
export const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), Buffer.alloc(64, 7)]);
export const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 3)]);
export const HTML_ERROR = '<!DOCTYPE html><html><body>Sorry, you must borrow this book to read it</body></html>';

/**
 * A fetch that answers from `script(url, callNumber)` after `latencyMs` on the
 * clock, and records `{url, start, end}` for every call.
 */
export const scriptedFetch = (clock, script, latencyMs = 50) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const call = { url, start: clock.now(), end: null, n: calls.length };
    calls.push(call);
    await clock.sleep(latencyMs);
    call.end = clock.now();
    const answer = await script(url, call.n);
    if (answer instanceof Error) throw answer;
    return answer;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
};
