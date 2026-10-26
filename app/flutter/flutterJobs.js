const crypto = require('crypto');

const TTL_MS = 30 * 60 * 1000;
const jobs = new Map();

function prune(now) {
  for (const [id, job] of jobs) {
    if (job.expiresAt <= now) {
      if (job.cleanup) job.cleanup();
      jobs.delete(id);
    }
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
    frontend: null,
    zipPath: '',
    zipName: '',
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
    downloadReady: Boolean(job.zipPath) && job.status === 'READY',
  };
}

module.exports = { createJob, getJob, lastReadyJob, toClient };
