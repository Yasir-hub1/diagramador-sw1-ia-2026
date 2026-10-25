const crypto = require('crypto');
const { stopProcess, runtimeOf } = require('./springProcess');

const TTL_MS = 30 * 60 * 1000;
const jobs = new Map();

function teardown(job) {
  stopProcess(job);
  if (job.cleanup) job.cleanup();
}

function prune(now) {
  for (const [id, job] of jobs) {
    if (job.expiresAt <= now) {
      teardown(job);
      jobs.delete(id);
    }
  }
}

function stopJobsForToken(shareToken) {
  for (const job of jobs.values()) {
    if (job.shareToken === shareToken) stopProcess(job);
  }
}

function lastReadyJob(shareToken, exceptId) {
  let found = null;
  for (const job of jobs.values()) {
    if (job.shareToken !== shareToken || job.status !== 'READY' || job.id === exceptId) continue;
    if (!found || job.createdAt > found.createdAt) found = job;
  }
  return found;
}

function createJob({ userId, shareToken }) {
  prune(Date.now());
  stopJobsForToken(shareToken);
  const job = {
    id: crypto.randomUUID(),
    userId: String(userId),
    shareToken,
    status: 'QUEUED',
    step: 'QUEUED',
    progress: 0,
    message: 'En cola',
    warnings: [],
    errors: [],
    preview: null,
    typeNotes: [],
    changes: [],
    uml: null,
    zipPath: '',
    zipName: '',
    projectDir: '',
    logs: [],
    port: null,
    child: null,
    runtimeStatus: 'stopped',
    createdAt: Date.now(),
    expiresAt: Date.now() + TTL_MS,
  };
  jobs.set(job.id, job);
  return job;
}

function getJob(jobId, userId) {
  prune(Date.now());
  const job = jobs.get(jobId);
  if (!job || job.userId !== String(userId)) return null;
  return job;
}

function toClient(job) {
  return {
    jobId: job.id,
    status: job.status,
    step: job.step,
    progress: job.progress,
    message: job.message,
    warnings: job.warnings,
    errors: job.errors,
    preview: job.preview,
    typeNotes: job.typeNotes || [],
    changes: job.changes || [],
    logs: (job.logs || []).slice(-80),
    runtime: runtimeOf(job),
    downloadReady: Boolean(job.zipPath) && job.status === 'READY',
  };
}

module.exports = { createJob, getJob, lastReadyJob, toClient };
