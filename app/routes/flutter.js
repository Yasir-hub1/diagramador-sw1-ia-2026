const express = require('express');
const fs = require('fs');
const { requireApiAuth } = require('../middleware/auth');
const { loadReadableDiagram } = require('../ai/createProposal');
const { LocalAiError, statusForLocalAiError } = require('../ai/errors');
const { createJob, getJob, toClient } = require('../flutter/flutterJobs');
const { runFlutterGeneration } = require('../flutter/generateFlutter');
const { runFullStackGeneration } = require('../flutter/generateFullStack');
const { emitGeneration } = require('../generation/bus');

const router = express.Router();

function sendError(res, error) {
  if (error instanceof LocalAiError) {
    return res.status(statusForLocalAiError(error)).json({ error: error.message });
  }
  console.error(String((error && error.message) || 'error').slice(0, 180));
  return res.status(500).json({ error: 'No se pudo generar el frontend Flutter.' });
}

router.post('/api/flutter/generate', requireApiAuth, async (req, res) => {
  try {
    const diagram = await loadReadableDiagram(req.body.shareToken, req.session.userId);
    const job = createJob({ userId: req.session.userId, shareToken: diagram.share_token });
    emitGeneration(diagram.share_token, 'flutter:generation:started', toClient(job));
    setImmediate(() => {
      runFlutterGeneration(job, diagram).catch(() => {});
    });
    res.status(202).json(toClient(job));
  } catch (error) {
    sendError(res, error);
  }
});

router.post('/api/fullstack/generate', requireApiAuth, async (req, res) => {
  try {
    const diagram = await loadReadableDiagram(req.body.shareToken, req.session.userId);
    const job = createJob({ userId: req.session.userId, shareToken: diagram.share_token });
    emitGeneration(diagram.share_token, 'flutter:generation:started', toClient(job));
    setImmediate(() => {
      runFullStackGeneration(job, diagram, {
        database: req.body.database === 'postgresql' ? 'postgresql' : 'h2',
      }).catch(() => {});
    });
    res.status(202).json(toClient(job));
  } catch (error) {
    sendError(res, error);
  }
});

router.get('/api/flutter/jobs/:jobId', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job) return res.status(404).json({ error: 'Esa generación ya no está disponible.' });
  res.json(toClient(job));
});

router.get('/api/flutter/jobs/:jobId/download', requireApiAuth, (req, res) => {
  const job = getJob(req.params.jobId, req.session.userId);
  if (!job || !job.zipPath || !fs.existsSync(job.zipPath)) {
    return res.status(404).json({ error: 'El ZIP de Flutter aún no está listo.' });
  }
  res.download(job.zipPath, job.zipName || 'trazo-flutter-project.zip');
});

module.exports = router;
