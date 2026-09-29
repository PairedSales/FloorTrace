// `bench:real --jobs N`: plans shared out over N worker processes, each the
// same script started with `--worker`. Child processes, not threads: the trace
// core keeps module-level state (memos, pools) that a shared address space
// would blur, and a crash that takes a process down takes one plan with it.
//
// The protocol, over Node's IPC channel:
//   worker -> parent   {type: 'ready'}         once its modules are loaded
//   parent -> worker   {job}                   one plan (see realBenchPlan.runPlan)
//   worker -> parent   {result}                that plan's result; then the next job
// and the parent disconnects a worker that has nothing left, which ends it.
import { fork } from 'child_process';

// A worker that dies before it says it is ready is not coming back: after this
// many, what is left is reported as an error instead of waiting for ever.
const MAX_START_FAILURES = 3;

/**
 * Scores `items` (jobs) on up to `count` workers running `script --worker`.
 * Resolves with one result per item, in the order they finished. A worker that
 * dies on a plan reports that plan as an error and is replaced.
 */
export const runPool = (script, items, count) => new Promise((resolve) => {
  const completions = [];
  const live = new Set();
  let next = 0;
  let startFailures = 0;
  let settled = false;

  const finish = () => {
    if (settled || completions.length < items.length) return;
    settled = true;
    // A worker still loading has nothing to say to a parent that is done.
    for (const worker of live) {
      if (!worker.ready) worker.child.kill();
      else if (worker.child.connected) worker.child.disconnect();
    }
    resolve(completions);
  };

  const start = () => {
    const child = fork(script, ['--worker'], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const worker = { child, job: null, ready: false, gone: false };
    live.add(worker);

    const give = () => {
      if (next >= items.length) {
        if (child.connected) child.disconnect();
        return;
      }
      worker.job = items[next];
      next += 1;
      child.send({ job: worker.job });
    };
    const gone = (why) => {
      if (worker.gone) return;
      worker.gone = true;
      live.delete(worker);
      if (settled) return;
      if (worker.job) {
        completions.push({ name: worker.job.name, error: `worker crashed (${why}) while scoring this plan` });
        worker.job = null;
      } else if (!worker.ready) startFailures += 1;
      if (startFailures >= MAX_START_FAILURES && !live.size) {
        for (; next < items.length; next += 1) {
          completions.push({ name: items[next].name, error: `workers failed to start (${why})` });
        }
      } else if (next < items.length && live.size < count && startFailures < MAX_START_FAILURES) start();
      finish();
    };

    child.on('message', (message) => {
      if (message?.type === 'ready') {
        worker.ready = true;
        give();
      } else {
        completions.push(message.result);
        worker.job = null;
        if (completions.length >= items.length) finish();
        else give();
      }
    });
    child.on('error', (err) => {
      child.kill();
      gone(err.message);
    });
    child.on('exit', (code, signal) => gone(signal ?? `exit code ${code}`));
  };

  if (!items.length) {
    resolve(completions);
    return;
  }
  for (let i = 0; i < Math.min(count, items.length); i += 1) start();
});
