const { LocalAiError } = require('../ai/errors');

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

function assertSafePath(value) {
  const text = String(value || '');
  if (!text.startsWith('/') || text.includes('..') || text.includes('://') || text.length > 200) {
    throw new LocalAiError('rejected', 'La ruta del tester no es válida.');
  }
}

async function proxyToGeneratedApi(job, request) {
  if (job.runtimeStatus !== 'running' || !job.port) {
    throw new LocalAiError('rejected', 'Arranca el backend antes de probar la API.');
  }
  const method = String(request.method || 'GET').toUpperCase();
  if (!METHODS.has(method)) throw new LocalAiError('rejected', 'Método HTTP no permitido.');
  assertSafePath(request.path);
  const url = 'http://127.0.0.1:' + job.port + request.path;
  const hasBody = method !== 'GET' && method !== 'DELETE';
  const response = await fetch(url, {
    method,
    headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
    body: hasBody ? String(request.body || '') : undefined,
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return {
    status: response.status,
    contentType: response.headers.get('content-type') || '',
    body: text.slice(0, 20000),
  };
}

module.exports = { proxyToGeneratedApi };
