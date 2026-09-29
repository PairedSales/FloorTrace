import fs from 'fs';

// Google Drive backs the folders these write to up, and holds a file it is
// reading: on EBUSY or EPERM wait and try again. Apart from realBenchPlan.mjs so
// the parts of a run that only write files do not load the tracer with it.
export const writeFileRetry = (file, data, tries = 10) => {
  for (let attempt = 1; ; attempt += 1) {
    try {
      fs.writeFileSync(file, data);
      return;
    } catch (err) {
      if (attempt >= tries || !['EBUSY', 'EPERM', 'EACCES'].includes(err.code)) throw err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250 * attempt);
    }
  }
};
