const express = require('express');
const multer = require('multer');
const { requireApiAuth } = require('../middleware/auth');
const { inspectImage, maxImageBytes } = require('../ai/imageFile');
const { createDiagramProposal, loadReadableDiagram } = require('../ai/createProposal');
const { LocalAiError, statusForLocalAiError } = require('../ai/errors');
const { emitGeneration } = require('../generation/bus');
const roomChat = require('../ai/roomChat');

const router = express.Router();

function uploadImage(req, res, next) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxImageBytes(), files: 1 },
  }).single('image');
  upload(req, res, (error) => {
    if (!error) return next();
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'La imagen supera el tamaño permitido.' });
    }
    return res.status(400).json({ error: 'No se pudo leer la imagen.' });
  });
}

function broadcastProposal(shareToken, result) {
  emitGeneration(shareToken, 'ai:message', result.userMessage);
  emitGeneration(shareToken, 'ai:message', result.assistantMessage);
  if (result.proposal) {
    emitGeneration(shareToken, 'ai:proposal', result.proposal);
  }
  emitGeneration(shareToken, 'ai:idle', {});
}

router.get('/api/ai/history', requireApiAuth, async (req, res) => {
  try {
    const diagram = await loadReadableDiagram(req.query.shareToken, req.session.userId);
    res.json({ messages: await roomChat.listMessages(diagram.id) });
  } catch (error) {
    if (error instanceof LocalAiError) {
      return res.status(statusForLocalAiError(error)).json({ error: error.message });
    }
    res.status(500).json({ error: 'No se pudo leer el chat de la sala.' });
  }
});

router.post('/api/ai/image', requireApiAuth, uploadImage, async (req, res) => {
  const inspected = inspectImage(req.file && req.file.buffer);
  if (!inspected.ok) return res.status(400).json({ error: inspected.message });
  const shareToken = req.body.shareToken;
  emitGeneration(shareToken, 'ai:busy', { authorName: req.session.userName });
  try {
    const result = await createDiagramProposal({
      userId: req.session.userId,
      userName: req.session.userName,
      shareToken,
      text: req.body.instruction,
      imageBase64: req.file.buffer.toString('base64'),
      source: 'image',
    });
    broadcastProposal(shareToken, result);
    res.json(result);
  } catch (error) {
    (error.roomMessages || []).forEach((message) => emitGeneration(shareToken, 'ai:message', message));
    emitGeneration(shareToken, 'ai:idle', {});
    if (error instanceof LocalAiError) {
      return res.status(statusForLocalAiError(error)).json({ error: error.message });
    }
    console.error(String(error && error.message || 'error').slice(0, 180));
    res.status(500).json({ error: 'No se pudo analizar la imagen.' });
  }
});

module.exports = router;
