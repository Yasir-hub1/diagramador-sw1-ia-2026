// routes/voice.js
const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/auth');
const openai = require('../openaiClient'); // aplica el polyfill de `File` antes de usar el SDK
const { toFile } = require('openai');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

router.post('/api/voice/transcribe', requireAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió audio' });
  }
  try {
    const uploadable = await toFile(req.file.buffer, req.file.originalname || 'audio.webm', {
      type: req.file.mimetype || 'audio/webm',
    });
    const transcription = await openai.audio.transcriptions.create({
      file: uploadable,
      model: 'whisper-1',
      language: 'es',
    });
    res.json({ text: transcription.text });
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ error: 'Error al transcribir el audio' });
  }
});

module.exports = router;
