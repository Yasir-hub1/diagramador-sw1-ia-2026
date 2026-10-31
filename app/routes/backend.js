const express = require('express');
const fs = require('fs');
const { requireApiAuth } = require('../middleware/auth');
const { loadReadableDiagram } = require('../ai/createProposal');
const { LocalAiError, statusForLocalAiError } = require('../ai/errors');
const { createJob, getJob, toClient } = require('../generation/jobs');
const { runGeneration } = require('../generation/generateBackend');
const { emitGeneration } = require('../generation/bus');
const { startProcess, stopProcess } = require('../generation/springProcess');
const { proxyToGeneratedApi } = require('../generation/apiProxy');
const { inspectRuntime } = require('../generation/tools');
const { previewFromDiagram } = require('../generation/previewUml');
const { resolveDatabase } = require('../generation/databaseChoice');

const router = express.Router();

function sendError(res, error) {
  if (error instanceof LocalAiError) {
    return res.status(statusForLocalAiError(error)).json({ error: error.message });
  }
  console.error(String((error && error.message) || 'error').slice(0, 180));
  return res.status(500).json({ error: 'No se pudo generar el backend.' });
}

router.post('/api/backend/generate', requireApiAuth, async (req, res) => {
  try {
    const diagram = await loadReadableDiagram(req.body.shareToken, req.session.userId);
    const job = createJob({ userId: req.session.userId, shareToken: diagram.share_token });
    emitGeneration(diagram.share_token, 'generation:started', toClient(job));
    setImmediate(() => {
      runGeneration(job, diagram, {
        database: resolveDatabase(req.body.database),
        useAi: Boolean(req.body.useAi),
      }).catch(() => {});
    });
    res.status(202).json(toClient(job));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/api/backend/jobs/:jobId', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  res.json(toClient(job));
});

router.get('/api/backend/jobs/:jobId/download', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job || !job.zipPath || !fs.existsSync(job.zipPath)) {
    return res.status(404).json({ error: 'El ZIP aún no está listo.' });
  }
  res.download(job.zipPath, job.zipName || 'trazo-backend-project.zip');
});

function previewHandler(req, res) {
  return loadReadableDiagram(req.body.shareToken || req.query.shareToken, req.session.userId)
    .then((diagram) => {
      try {
        res.json(
          previewFromDiagram(diagram, {
            database: resolveDatabase(req.body.database || req.query.database),
            graphJson: req.body.graphJson,
          })
        );
      } catch (error) {
        sendError(res, error);
      }
    })
    .catch((error) => sendError(res, error));
}

router.get('/api/backend/preview', requireApiAuth, previewHandler);
router.post('/api/backend/preview', requireApiAuth, previewHandler);

router.get('/api/backend/tools', requireApiAuth, (_req, res) => {
  res.json(inspectRuntime());
});

router.post('/api/backend/jobs/:jobId/start', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job || job.status !== 'READY' || !job.projectDir) {
    return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  }
  if (job.runtimeStatus === 'running') return res.json(toClient(job));
  const tools = inspectRuntime(job.projectDir);
  job.tools = tools;
  if (!tools.ok) {
    job.runtimeStatus = 'stopped';
    job.message = !tools.maven.ok ? tools.maven.message : tools.java.message;
    return res.status(400).json({ error: job.message, ...toClient(job) });
  }
  job.runtimeStatus = 'starting';
  job.message = 'Arrancando Maven';
  emitGeneration(job.shareToken, 'generation:runtime', toClient(job));
  setImmediate(() => {
    startProcess(job)
      .then(() => {
        job.message = 'API lista en el puerto ' + job.port;
        emitGeneration(job.shareToken, 'generation:runtime', toClient(job));
      })
      .catch((error) => {
        stopProcess(job);
        job.message = error.message || 'Maven no pudo arrancar.';
        emitGeneration(job.shareToken, 'generation:runtime', toClient(job));
      });
  });
  res.status(202).json(toClient(job));
});

router.post('/api/backend/jobs/:jobId/stop', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  stopProcess(job);
  job.message = 'API detenida';
  emitGeneration(job.shareToken, 'generation:runtime', toClient(job));
  res.json(toClient(job));
});

router.get('/api/backend/jobs/:jobId/logs', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  res.json({ logs: job.logs || [], runtime: job.runtimeStatus || 'stopped' });
});

router.post('/api/backend/jobs/:jobId/proxy', requireApiAuth, async (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  try {
    const result = await proxyToGeneratedApi(job, {
      method: req.body.method,
      path: req.body.path,
      body: req.body.body,
    });
    res.json(result);
  } catch (error) {
    sendError(res, error);
  }
});

module.exports = router;
