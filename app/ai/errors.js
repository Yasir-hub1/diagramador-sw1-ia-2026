class LocalAiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'LocalAiError';
    this.code = code;
  }
}

function statusForLocalAiError(error) {
  if (error.code === 'timeout') return 504;
  if (error.code === 'forbidden') return 403;
  if (error.code === 'not_found') return 404;
  if (error.code === 'too_long' || error.code === 'rejected') return 400;
  return 503;
}

module.exports = { LocalAiError, statusForLocalAiError };
