const { LocalAiError } = require('./errors');

const MAX_INSTRUCTION_LENGTH = 2000;

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function ollamaHost() {
  return (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
}

function ollamaModel() {
  return process.env.OLLAMA_MODEL || 'qwen3-vl:4b';
}

function timeoutMs() {
  return positiveInt('AI_TIMEOUT_MS', 120000);
}

function imageTimeoutMs() {
  return positiveInt('AI_IMAGE_TIMEOUT_MS', Math.max(timeoutMs(), 180000));
}

function contextTokens() {
  return positiveInt('OLLAMA_NUM_CTX', 8192);
}

function maxOperations() {
  return positiveInt('AI_MAX_OPERATIONS', 30);
}

function openAiApiKey() {
  return String(process.env.OPENAI_API_KEY || '').trim();
}

function hasOpenAiKey() {
  return openAiApiKey().length > 0;
}

function openaiModel() {
  return String(process.env.OPENAI_MODEL || 'gpt-4o-mini').trim() || 'gpt-4o-mini';
}

function forcedProvider() {
  const value = String(process.env.AI_PROVIDER || '').trim().toLowerCase();
  if (value === 'openai' || value === 'ollama') return value;
  return '';
}

function diagramProvider() {
  const forced = forcedProvider();
  if (forced) return forced;
  return hasOpenAiKey() ? 'openai' : 'ollama';
}

function usesOpenAiDiagrams() {
  return diagramProvider() === 'openai';
}

function assertDiagramProvider() {
  if (usesOpenAiDiagrams() && !hasOpenAiKey()) {
    throw new LocalAiError('unavailable', 'Elegiste OpenAI para los diagramas, pero falta OPENAI_API_KEY.');
  }
}

module.exports = {
  MAX_INSTRUCTION_LENGTH,
  positiveInt,
  ollamaHost,
  ollamaModel,
  openaiModel,
  openAiApiKey,
  hasOpenAiKey,
  timeoutMs,
  imageTimeoutMs,
  contextTokens,
  maxOperations,
  diagramProvider,
  usesOpenAiDiagrams,
  assertDiagramProvider,
  assertOllamaProvider: assertDiagramProvider,
};
