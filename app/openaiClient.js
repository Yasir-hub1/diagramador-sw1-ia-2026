// El SDK de OpenAI necesita `File` como global para subir audio (Whisper).
// Node lo expone desde la v20; en versiones anteriores se polyfillea.
if (typeof globalThis.File === 'undefined') {
  const { File } = require('node:buffer');
  globalThis.File = File;
}

const OpenAI = require('openai');
const { openAiApiKey } = require('./ai/settings');

let cachedClient = null;
let cachedKey = '';

function getOpenAiClient() {
  const apiKey = openAiApiKey();
  if (!apiKey) return null;
  if (cachedClient && cachedKey === apiKey) return cachedClient;
  cachedKey = apiKey;
  cachedClient = new OpenAI({ apiKey });
  return cachedClient;
}

module.exports = { getOpenAiClient };
