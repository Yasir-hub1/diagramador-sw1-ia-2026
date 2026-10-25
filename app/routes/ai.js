const express = require('express');
const multer = require('multer');
const { requireApiAuth } = require('../middleware/auth');
const { inspectImage, maxImageBytes } = require('../ai/imageFile');
const { createDiagramProposal } = require('../ai/createProposal');
const { LocalAiError, statusForLocalAiError } = require('../ai/errors');

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

router.post('/api/ai/image', requireApiAuth, uploadImage, async (req, res) => {
  const inspected = inspectImage(req.file && req.file.buffer);
  if (!inspected.ok) return res.status(400).json({ error: inspected.message });
  try {
    const result = await createDiagramProposal({
      userId: req.session.userId,
      shareToken: req.body.shareToken,
      text: req.body.instruction,
      imageBase64: req.file.buffer.toString('base64'),
    });
    res.json(result);
  } catch (error) {
    if (error instanceof LocalAiError) {
      return res.status(statusForLocalAiError(error)).json({ error: error.message });
    }
    console.error(String(error && error.message || 'error').slice(0, 180));
    res.status(500).json({ error: 'No se pudo analizar la imagen.' });
  }
});

module.exports = router;
