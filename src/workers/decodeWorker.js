// A plan's image, decoded off the page and handed back ready to draw.
//
// The page holds a plan's image as a data URL, and everything about turning
// that into pixels happens on whichever thread asks. Asked on the page, for a
// 12 MP plan (a 30 MB string), it measured:
//
//   475 ms   `img.src = dataUrl` — the URL is parsed and un-base64'd in place
//   ~230 ms  the first `drawImage` of that <img>: the decode itself
//   ~230 ms  the next first draw, onto a canvas of another size
//
// which is a second of frozen page every time such a plan is opened, restored
// from a draft or switched back to. `img.decode()` does not help: it resolved
// in 228 ms and the first canvas draw after it still took 237.
//
// Here the same work costs the page 7 ms — the `postMessage` — and the
// `ImageBitmap` that comes back draws in 1-4 ms at any size, however long it
// was held first. `components/canvas/imageCache.js` is the only caller.
self.onmessage = async (event) => {
  const { id, image } = event.data ?? {};
  try {
    const response = await fetch(image);
    const bitmap = await createImageBitmap(await response.blob());
    self.postMessage({ id, bitmap }, [bitmap]);
  } catch (error) {
    self.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
  }
};
