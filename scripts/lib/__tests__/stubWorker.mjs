// A worker for the pool test (realBenchPool.test.mjs), speaking the same
// protocol as `realBenchmark.mjs --worker` without the tracer: it echoes each
// job, and dies on the plan named `boom`, the way a crashed tracer would.
const say = (message) => process.send(message, (err) => {
  if (err) process.exit(0);
});
process.on('disconnect', () => process.exit(0));
process.on('message', ({ job }) => {
  if (job.name === 'boom') process.exit(3);
  say({ result: { name: job.name, echoed: true } });
});
say({ type: 'ready' });
