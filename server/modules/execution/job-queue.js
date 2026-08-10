'use strict';

const crypto = require('node:crypto');

/**
 * Durable and admission-controlled execution job queue with per-user bounds, AbortController handles,
 * and clean teardown for both queued and active jobs.
 */
function createExecutionJobQueue(options = {}) {
  const maxConcurrency = options.maxConcurrency || 5;
  const maxQueueDepth = options.maxQueueDepth || 20;
  const maxPerUserConcurrent = options.maxPerUserConcurrent || 5;
  const defaultTimeoutMs = options.defaultTimeoutMs || 5000;
  const dbRepository = options.dbRepository || null;

  let activeCount = 0;
  const queue = [];
  const activeJobs = new Map(); // jobId -> { job, controller, timer }
  const userActiveCounts = new Map(); // userId -> number
  const activeTimers = new Set();

  const metrics = {
    totalEnqueued: 0,
    totalCompleted: 0,
    totalFailed: 0,
    totalRejected: 0,
  };

  async function enqueueJob(taskFunction, timeoutMs = defaultTimeoutMs, metadata = {}) {
    const userId = metadata.userId || crypto.randomUUID();

    // Queue depth check
    if (queue.length >= maxQueueDepth) {
      metrics.totalRejected++;
      const err = new Error('Execution queue capacity limit reached');
      err.code = 'queue_full';
      err.status = 429;
      throw err;
    }

    // Per-user concurrency admission check
    const userActive = userActiveCounts.get(userId) || 0;
    if (userActive >= maxPerUserConcurrent) {
      metrics.totalRejected++;
      const err = new Error('Per-user concurrent execution limit reached');
      err.code = 'user_limit_exceeded';
      err.status = 429;
      throw err;
    }

    metrics.totalEnqueued++;
    const jobId = metadata.jobId || crypto.randomUUID();

    // Persist to DB if repository present
    if (dbRepository && typeof dbRepository.createJob === 'function') {
      try {
        await dbRepository.createJob({
          id: jobId,
          userId,
          challengeId: metadata.challengeId || null,
          versionId: metadata.versionId || null,
          operationType: metadata.operationType || 'RUN',
          language: metadata.language || 'javascript',
          status: 'QUEUED',
        });
      } catch (dbErr) {
        const err = new Error('Execution queue persistence is unavailable');
        err.code = 'queue_persistence_unavailable';
        err.status = 503;
        err.cause = dbErr;
        throw err;
      }
    }

    return new Promise((resolve, reject) => {
      const job = {
        jobId,
        userId,
        taskFunction,
        timeoutMs,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        metadata,
      };
      queue.push(job);
      processNext();
    });
  }

  function processNext() {
    if (activeCount >= maxConcurrency || queue.length === 0) {
      return;
    }

    const job = queue.shift();
    const { jobId, userId } = job;

    activeCount++;
    userActiveCounts.set(userId, (userActiveCounts.get(userId) || 0) + 1);

    const controller = new AbortController();
    let settled = false;
    let timer = null;

    const cleanupTimer = () => {
      if (timer) {
        clearTimeout(timer);
        activeTimers.delete(timer);
        timer = null;
      }
    };

    activeJobs.set(jobId, { job, controller, cleanupTimer });
    if (dbRepository && typeof dbRepository.updateJobStatus === 'function') {
      dbRepository.updateJobStatus(jobId, {
        status: 'RUNNING', result: null, errorCode: null, completedAt: null,
      }).catch(() => {});
    }

    timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanupTimer();
        controller.abort();
        metrics.totalFailed++;
        const err = new Error('Execution job timed out');
        err.code = 'execution_timeout';
        err.status = 504;
        job.reject(err);
        finishJob('TIMED_OUT', null, err);
      }
    }, job.timeoutMs);

    if (timer.unref) timer.unref();
    activeTimers.add(timer);

    let taskPromise;
    try {
      taskPromise = Promise.resolve(job.taskFunction(controller.signal));
    } catch (syncErr) {
      taskPromise = Promise.reject(syncErr);
    }

    taskPromise
      .then((result) => {
        if (!settled) {
          settled = true;
          cleanupTimer();
          metrics.totalCompleted++;
          job.resolve(result);
          finishJob('SUCCEEDED', result, null);
        }
      })
      .catch((err) => {
        if (!settled) {
          settled = true;
          cleanupTimer();
          metrics.totalFailed++;
          job.reject(err);
          finishJob('FAILED', null, err);
        }
      });

    function finishJob(finalStatus, result, error) {
      activeJobs.delete(jobId);
      const currentActive = userActiveCounts.get(userId) || 1;
      if (currentActive <= 1) {
        userActiveCounts.delete(userId);
      } else {
        userActiveCounts.set(userId, currentActive - 1);
      }
      activeCount--;

      if (dbRepository && typeof dbRepository.updateJobStatus === 'function') {
        dbRepository.updateJobStatus(jobId, {
          status: finalStatus,
          result: result ? JSON.stringify(result) : null,
          errorCode: error ? error.code : null,
          completedAt: new Date(),
        }).catch(() => {});
      }

      processNext();
    }
  }

  function getMetrics() {
    return {
      activeCount,
      queuedCount: queue.length,
      maxConcurrency,
      maxQueueDepth,
      maxPerUserConcurrent,
      ...metrics,
    };
  }

  function destroy() {
    for (const timer of activeTimers) {
      clearTimeout(timer);
    }
    activeTimers.clear();

    // Clear and reject queued jobs
    while (queue.length > 0) {
      const job = queue.shift();
      const err = new Error('Execution queue destroyed');
      err.code = 'queue_destroyed';
      err.status = 503;
      job.reject(err);
    }

    // Abort and reject active jobs
    for (const { job, controller, cleanupTimer } of activeJobs.values()) {
      cleanupTimer();
      controller.abort();
      const err = new Error('Execution process terminated during execution');
      err.code = 'queue_destroyed';
      err.status = 503;
      job.reject(err);
    }
    activeJobs.clear();
    userActiveCounts.clear();
    activeCount = 0;
  }

  return {
    enqueueJob,
    getMetrics,
    destroy,
  };
}

module.exports = { createExecutionJobQueue };
