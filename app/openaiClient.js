// openaiClient.js
// El SDK de OpenAI necesita `File` como global para subir archivos (audio,
// en app/routes/voice.js). Node solo lo expone así desde la v20; en
// versiones anteriores hay que polyfillearlo con el `File` de node:buffer.
if (typeof globalThis.File === 'undefined') {
  const { File } = require('node:buffer');
  globalThis.File = File;
}

const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

module.exports = openai;
