const { LocalAiError } = require('./errors');
const settings = require('./settings');
const { getOpenAiClient } = require('../openaiClient');
const { imageBufferFromBase64, inspectImage } = require('./imageFile');

function asText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function mapFailure(error) {
  if (error instanceof LocalAiError) return error;
  const status = error && (error.status || error.statusCode);
  const message = String((error && error.message) || '');
  if (status === 401 || /incorrect api key|invalid api key|expired/i.test(message)) {
    return new LocalAiError('unavailable', 'La clave de OpenAI no es válida. Revisa OPENAI_API_KEY.');
  }
  if (status === 429) {
    return new LocalAiError('unavailable', 'OpenAI está ocupado. Espera un momento e inténtalo de nuevo.');
  }
  if (error && (error.name === 'TimeoutError' || error.name === 'AbortError' || /timeout/i.test(message))) {
    return new LocalAiError('timeout', 'OpenAI tardó demasiado. Prueba con una instrucción más corta.');
  }
  return new LocalAiError('unavailable', 'No se pudo consultar OpenAI.');
}

function userContent(prompt, imageBase64) {
  if (!imageBase64) return prompt;
  const bytes = Buffer.isBuffer(imageBase64) ? imageBase64 : imageBufferFromBase64(imageBase64);
  const inspected = inspectImage(bytes);
  const mediaType = inspected.ok ? inspected.mediaType : 'image/png';
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: 'data:' + mediaType + ';base64,' + bytes.toString('base64') } },
  ];
}

async function generateOpenAiResponse({ system, prompt, imageBase64, timeout, numPredict }) {
  const client = getOpenAiClient();
  if (!client) {
    throw new LocalAiError('unavailable', 'Falta OPENAI_API_KEY para usar OpenAI en los diagramas.');
  }
  const started = Date.now();
  const response = await client.chat.completions.create(
    {
      model: settings.openaiModel(),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userContent(prompt, imageBase64) },
      ],
      temperature: 0.1,
      max_tokens: numPredict || 2500,
      response_format: { type: 'json_object' },
    },
    { timeout }
  );
  const content = asText(response && response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content);
  console.log('IA openai:', Date.now() - started + 'ms', 'out', content.length);
  return { content, thinking: '' };
}

async function generateOpenAiDiagramResponse(options) {
  const timeout = options.timeoutMs
    || (options.imageBase64 ? settings.imageTimeoutMs() : settings.timeoutMs());
  try {
    return await generateOpenAiResponse({ ...options, timeout });
  } catch (error) {
    const mapped = mapFailure(error);
    console.error('IA openai:', mapped.message);
    throw mapped;
  }
}

module.exports = { generateOpenAiDiagramResponse };
