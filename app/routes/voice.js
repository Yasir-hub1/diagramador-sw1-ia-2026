// routes/voice.js
// La transcripción sigue en Whisper remoto. El modelo visual local no sustituye este paso.
const express = require('express');
const multer = require('multer');
const { requireApiAuth } = require('../middleware/auth');
const { getOpenAiClient } = require('../openaiClient');
const { toFile } = require('openai');
const { hasOpenAiKey } = require('../ai/settings');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const router = express.Router();

function transcriptionFailure(err) {
  const status = err && (err.status || err.statusCode);
  const detail = String((err && err.message) || '');
  if (status === 401 || /incorrect api key|invalid api key|expired/i.test(detail)) {
    return {
      status: 503,
      error: 'La transcripción de voz necesita una clave de OpenAI válida. Actualiza OPENAI_API_KEY y reinicia el servidor.',
    };
  }
  if (status === 429) {
    return { status: 429, error: 'Whisper está ocupado. Espera un momento e inténtalo de nuevo.' };
  }
  return { status: 500, error: 'No se pudo transcribir el audio.' };
}

router.post('/api/voice/transcribe', requireApiAuth, upload.single('audio'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No se recibió audio.' });
  }
  const openai = getOpenAiClient();
  if (!openai || !hasOpenAiKey()) {
    return res.status(503).json({
      error: 'La transcripción de voz necesita OPENAI_API_KEY. Sin esa clave, escribe el pedido a mano.',
    });
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
    const text = String((transcription && transcription.text) || '').trim();
    if (!text) {
      return res.status(422).json({ error: 'No se escuchó nada claro. Dicta un poco más cerca del micrófono.' });
    }
    res.json({ text });
  } catch (err) {
    const failure = transcriptionFailure(err);
    console.error('Voz:', failure.status);
    res.status(failure.status).json({ error: failure.error });
  }
});

module.exports = router;
