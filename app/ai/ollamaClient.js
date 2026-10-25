const { LocalAiError } = require('./errors');
const settings = require('./settings');
const { imageBufferFromBase64 } = require('./imageFile');

let queue = Promise.resolve();

function enqueue(task) {
  const run = queue.then(task, task);
  queue = run.then(
    () => {},
    () => {}
  );
  return run;
}

function logSafe(error) {
  const text = String((error && error.message) || 'error').replace(/\s+/g, ' ').slice(0, 180);
  console.error('IA local:', text);
}

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapFailure(error) {
  if (error instanceof LocalAiError) return error;
  const name = error && error.name;
  const message = String((error && error.message) || '');
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(message)) {
    return new LocalAiError('timeout', 'La IA local tardó demasiado. Prueba con una instrucción más corta o una imagen más simple.');
  }
  if (/ECONNREFUSED|fetch failed|ENOTFOUND|ECONNRESET|network/i.test(message)) {
    return new LocalAiError('unavailable', 'Ollama no está respondiendo en esta computadora. Ábrelo y vuelve a intentar.');
  }
  if (/not found|404|unknown model/i.test(message)) {
    return new LocalAiError('model_missing', 'El modelo local configurado no está disponible. Revisa OLLAMA_MODEL.');
  }
  return new LocalAiError('unavailable', 'No se pudo consultar la IA local.');
}

function createClient(timeout) {
  const { Ollama } = require('ollama');
  return new Ollama({
    host: settings.ollamaHost(),
    fetch: (url, options = {}) => fetch(url, { ...options, signal: AbortSignal.timeout(timeout) }),
  });
}

function stitchPrefill(prefill, content) {
  const text = asText(content);
  if (!prefill || !text) return text;
  if (text.startsWith(prefill) || (prefill === '{' && text.startsWith('{'))) return text;
  return prefill + text;
}

async function requestModel({ system, prompt, imageBase64, timeout, format, numPredict, prefill }) {
  const userMessage = { role: 'user', content: prompt };
  if (imageBase64) {
    const bytes = Buffer.isBuffer(imageBase64) ? imageBase64 : imageBufferFromBase64(imageBase64);
    if (bytes.length) userMessage.images = [bytes];
  }
  const messages = [{ role: 'system', content: system }, userMessage];
  if (prefill) messages.push({ role: 'assistant', content: prefill });

  const started = Date.now();
  const client = createClient(timeout);
  const response = await client.chat({
    model: settings.ollamaModel(),
    messages,
    stream: false,
    format: format || undefined,
    think: false,
    keep_alive: '30m',
    options: {
      temperature: 0.1,
      num_predict: numPredict || 2500,
      num_ctx: settings.contextTokens(),
    },
  });
  const body = (response && response.message) || {};
  const content = stitchPrefill(prefill, body.content);
  const thinking = asText(body.thinking);
  console.log(
    'IA local:',
    Date.now() - started + 'ms',
    'out',
    content.length,
    'think',
    thinking.length
  );
  return { content, thinking };
}

async function generateLocalResponse(options) {
  const timeout = options.timeoutMs
    || (options.imageBase64 ? settings.imageTimeoutMs() : settings.timeoutMs());
  return enqueue(async () => {
    try {
      return await requestModel({ ...options, timeout });
    } catch (error) {
      const mapped = mapFailure(error);
      logSafe(error);
      throw mapped;
    }
  });
}

module.exports = { generateLocalResponse };
