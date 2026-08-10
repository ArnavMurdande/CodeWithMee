'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { createExecutionJobQueue } = require('../modules/execution/job-queue');

test('P1B-S2: job queue enforces max concurrency, timeouts, and queue depth limits', async () => {
  const queue = createExecutionJobQueue({
    maxConcurrency: 2,
    maxQueueDepth: 3,
    defaultTimeoutMs: 100,
  });

  try {
    // 1. Successful task
    const res = await queue.enqueueJob(async () => 'ok');
    assert.equal(res, 'ok');

    // 2. Task failure
    await assert.rejects(
      queue.enqueueJob(async () => {
        throw new Error('task_failed');
      }),
      (err) => err.message === 'task_failed'
    );

    // 3. Timeout task
    await assert.rejects(
      queue.enqueueJob(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 300)),
        50
      ),
      (err) => err.status === 504 && err.code === 'execution_timeout'
    );

    // 4. Late success/failure after timeout does not crash or double settle
    let lateResolve;
    let lateReject;
    const pendingPromise = queue.enqueueJob(
      () =>
        new Promise((resolve, reject) => {
          lateResolve = resolve;
          lateReject = reject;
        }),
      30
    );

    await assert.rejects(pendingPromise, (err) => err.code === 'execution_timeout');
    assert.doesNotThrow(() => lateResolve('late_ok'));
    assert.doesNotThrow(() => lateReject(new Error('late_err')));

    // 5. Concurrency & Queue Depth
    const blocker1 = queue.enqueueJob(() => new Promise((r) => setTimeout(r, 200)));
    const blocker2 = queue.enqueueJob(() => new Promise((r) => setTimeout(r, 200)));

    // Fill queue
    const queued1 = queue.enqueueJob(() => new Promise((r) => setTimeout(r, 200)));
    const queued2 = queue.enqueueJob(() => new Promise((r) => setTimeout(r, 200)));
    const queued3 = queue.enqueueJob(() => new Promise((r) => setTimeout(r, 200)));

    // 6th job should exceed queue capacity (maxConcurrency=2 + maxQueueDepth=3 = 5 total)
    await assert.rejects(
      queue.enqueueJob(() => Promise.resolve('overflow')),
      (err) => err.status === 429 && err.code === 'queue_full'
    );

    const metrics = queue.getMetrics();
    assert.equal(metrics.activeCount, 2);
    assert.equal(metrics.queuedCount, 3);

    // Clean up blockers
    await Promise.allSettled([blocker1, blocker2, queued1, queued2, queued3]);
  } finally {
    queue.destroy();
  }
});
